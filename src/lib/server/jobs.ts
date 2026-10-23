import { audit, database, transaction } from "./db";
import { platformIds, type PlatformId } from "../platforms";
import { publishers } from "../publishers";
import type { PublishReceipt } from "../publishers/types";
import type { ScheduledPost } from "../workspace";

type ClaimedJob = {
  id: string; user_id: string; payload: string; attempts: number; receipts: string;
};

export function touchWorker() {
  database().prepare("INSERT INTO worker_heartbeat(id,seen_at) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET seen_at=excluded.seen_at")
    .run(new Date().toISOString());
}

export function claimDue(now = new Date()): ClaimedJob | null {
  const stamp = now.toISOString();
  return transaction((db) => {
    const row = db.prepare(`SELECT id,user_id,payload,attempts,receipts FROM jobs
      WHERE (status='queued' AND next_attempt_at <= ?) OR (status='running' AND lease_until <= ?)
      ORDER BY next_attempt_at,id LIMIT 1`).get(stamp, stamp) as ClaimedJob | undefined;
    if (!row) return null;
    db.prepare("UPDATE jobs SET status='running',attempts=attempts+1,lease_until=? WHERE id=?")
      .run(new Date(now.getTime() + 5 * 60_000).toISOString(), row.id);
    audit(row.user_id, "schedule.claimed", row.id, String(row.attempts + 1));
    return { ...row, attempts: row.attempts + 1 };
  });
}

export async function processOneDue(
  now = new Date(),
  publish: (platform: PlatformId, content: string) => Promise<PublishReceipt> = (platform, content) => publishers[platform].publish(content),
): Promise<boolean> {
  const job = claimDue(now);
  if (!job) return false;
  const post = JSON.parse(job.payload) as ScheduledPost;
  const receipts = JSON.parse(job.receipts) as PublishReceipt[];
  try {
    for (const platform of platformIds) {
      const content = post.posts[platform];
      if (!content || receipts.some((receipt) => receipt.platform === platform)) continue;
      const receipt = await publish(platform, content);
      if (receipt.platform !== platform || receipt.status !== "simulated") throw new Error(`Invalid ${platform} receipt.`);
      receipts.push(receipt);
      transaction((db) => {
        db.prepare("UPDATE jobs SET receipts=? WHERE id=? AND status='running'").run(JSON.stringify(receipts), job.id);
        audit(job.user_id, "schedule.receipt", job.id, platform);
      });
    }
    transaction((db) => {
      db.prepare("UPDATE jobs SET status='simulated',completed_at=?,lease_until=NULL,last_error=NULL WHERE id=? AND status='running'")
        .run(new Date().toISOString(), job.id);
      audit(job.user_id, "schedule.simulated", job.id);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "Unknown worker error";
    const terminal = job.attempts >= 3;
    const delay = Math.min(60_000 * 2 ** (job.attempts - 1), 15 * 60_000);
    transaction((db) => {
      db.prepare("UPDATE jobs SET status=?,next_attempt_at=?,lease_until=NULL,last_error=? WHERE id=? AND status='running'")
        .run(terminal ? "failed" : "queued", new Date(Date.now() + delay).toISOString(), message, job.id);
      audit(job.user_id, terminal ? "schedule.failed" : "schedule.retry_pending", job.id, message);
    });
  }
  return true;
}
