import { createHash } from "node:crypto";
import { audit, database, transaction } from "./db";
import { mastodonConnection, MastodonError, publishMastodonText } from "./mastodon";

const UUID_PATTERN = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const STALE_AFTER_MS = 2 * 60_000;
const MAX_AHEAD_MS = 366 * 24 * 60 * 60_000;

/** Set false to stop future real dispatch; restart both web and worker after editing .env.local. */
export function mastodonScheduleExecutionEnabled(): boolean {
  return !["false", "0", "off"].includes((process.env.PLYPOST_MASTODON_SCHEDULE_ENABLED ?? "").trim().toLowerCase());
}

export function touchMastodonWorker(): void {
  database().prepare(`INSERT INTO mastodon_worker_heartbeat(id,seen_at) VALUES (1,?)
    ON CONFLICT(id) DO UPDATE SET seen_at=excluded.seen_at`).run(new Date().toISOString());
}

export function mastodonWorkerLastSeen(): string | null {
  const row = database().prepare("SELECT seen_at FROM mastodon_worker_heartbeat WHERE id=1")
    .get() as { seen_at: string } | undefined;
  return row?.seen_at ?? null;
}

type Status = "queued" | "inflight" | "posted" | "unknown" | "rejected" | "cancelled";
type Row = {
  client_request_id: string; user_id: string; instance: string; account_id: string;
  account_username: string; account_url: string; text: string; content_hash: string;
  scheduled_for: string; status: Status; dispatch_authorized: number; claimed_at: string | null;
  remote_id: string | null; remote_url: string | null; last_error: string | null;
  resolution: "found" | "absent" | null; resolved_at: string | null;
  created_at: string; updated_at: string;
};

export type MastodonScheduledPost = {
  clientRequestId: string; status: Status; text: string; scheduledFor: string;
  createdAt: string; instance: string;
  account: { id: string; username: string; url: string };
  id?: string; postUrl?: string; error?: string;
  resolution?: "found" | "absent"; resolvedAt?: string;
};

export class MastodonScheduleError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const validId = (value: unknown): value is string => typeof value === "string" && UUID_PATTERN.test(value);
const validUtc = (value: unknown): value is string =>
  typeof value === "string" && UTC_PATTERN.test(value) && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;

function publicItem(row: Row): MastodonScheduledPost {
  return {
    clientRequestId: row.client_request_id, status: row.status, text: row.text,
    scheduledFor: row.scheduled_for, createdAt: row.created_at, instance: row.instance,
    account: { id: row.account_id, username: row.account_username, url: row.account_url },
    ...(row.remote_id ? { id: row.remote_id } : {}),
    ...(row.remote_url ? { postUrl: row.remote_url } : {}),
    ...(row.last_error ? { error: row.last_error } : {}),
    ...(row.resolution ? { resolution: row.resolution, resolvedAt: row.resolved_at ?? undefined } : {}),
  };
}

function inputObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some((key) => !keys.includes(key))) {
    throw new MastodonScheduleError("Invalid Mastodon scheduling request.");
  }
  return value as Record<string, unknown>;
}

/** A queued intent is an explicit owner instruction; its text and account are immutable. */
export function createMastodonSchedule(userId: string, body: unknown): { item: MastodonScheduledPost; created: boolean } {
  if (!mastodonScheduleExecutionEnabled()) {
    throw new MastodonScheduleError("Automatic Mastodon publishing is paused on this installation.", 503);
  }
  const input = inputObject(body, ["clientRequestId", "text", "scheduledFor", "accountId"]);
  if (!validId(input.clientRequestId) || typeof input.text !== "string" ||
      input.text.length > 10_000 || !input.text.trim() || !validUtc(input.scheduledFor) ||
      typeof input.accountId !== "string" || !input.accountId || input.accountId.length > 512) {
    throw new MastodonScheduleError("Choose a connected account, nonempty text and a valid UTC time.");
  }
  const text = input.text.trim();
  const id = input.clientRequestId;
  const scheduledFor = input.scheduledFor;
  const accountId = input.accountId;
  const now = new Date();
  const contentHash = hash(text);
  return transaction((db) => {
    const prior = db.prepare("SELECT * FROM mastodon_scheduled_posts WHERE client_request_id=?").get(id) as Row | undefined;
    if (prior) {
      if (prior.user_id !== userId || prior.account_id !== accountId || prior.text !== text ||
          prior.scheduled_for !== scheduledFor) {
        throw new MastodonScheduleError("This scheduling request ID has already been used.", 409);
      }
      return { item: publicItem(prior), created: false };
    }
    if (Date.parse(scheduledFor) < now.getTime() + 10_000 ||
        Date.parse(scheduledFor) > now.getTime() + MAX_AHEAD_MS) {
      throw new MastodonScheduleError("Choose a time at least 10 seconds ahead and within one year.");
    }
    const connection = mastodonConnection(userId);
    if (!connection.configured || !connection.connected || !connection.instance ||
        !connection.account || connection.account.id !== accountId) {
      throw new MastodonScheduleError("Reconnect or refresh the selected Mastodon account before scheduling.", 409);
    }
    const activeConnection = db.prepare("SELECT disconnecting FROM mastodon_connections WHERE user_id=?")
      .get(userId) as { disconnecting: number } | undefined;
    if (!activeConnection || activeConnection.disconnecting) {
      throw new MastodonScheduleError("This Mastodon connection is being removed. Refresh before scheduling.", 409);
    }
    if (db.prepare("SELECT 1 FROM mastodon_publish_attempts WHERE client_request_id=?").get(id)) {
      throw new MastodonScheduleError("This request ID was already used for a live Mastodon post.", 409);
    }
    const count = db.prepare("SELECT COUNT(*) AS count FROM mastodon_scheduled_posts WHERE user_id=? AND status IN ('queued','inflight','unknown')")
      .get(userId) as { count: number };
    if (count.count >= 100) throw new MastodonScheduleError("The Mastodon publishing plan is full.", 409);
    if (db.prepare(`SELECT 1 FROM mastodon_scheduled_posts WHERE user_id=? AND instance=? AND account_id=?
      AND content_hash=? AND ((status='queued' AND scheduled_for=?) OR status='inflight' OR
      (status='unknown' AND (resolution IS NULL OR resolution='found')) OR
      (status='posted' AND scheduled_for=?)) LIMIT 1`)
      .get(userId, connection.instance, accountId, contentHash, scheduledFor, scheduledFor)) {
      throw new MastodonScheduleError("This text is already queued, being sent, or needs a result check for this account.", 409);
    }
    if (db.prepare(`SELECT 1 FROM mastodon_publish_attempts WHERE user_id=? AND instance=? AND account_id=?
      AND content_hash=? AND (status='inflight' OR (status='unknown' AND (resolution IS NULL OR resolution='found')))
      LIMIT 1`).get(userId, connection.instance, accountId, contentHash)) {
      throw new MastodonScheduleError("A previous live post for this text needs a result check before scheduling.", 409);
    }
    const stamp = now.toISOString();
    db.prepare(`INSERT INTO mastodon_scheduled_posts
      (client_request_id,user_id,instance,account_id,account_username,account_url,text,content_hash,
       scheduled_for,status,dispatch_authorized,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,'queued',1,?,?)`).run(id, userId, connection.instance, accountId,
      connection.account.username, connection.account.url, text, contentHash, scheduledFor, stamp, stamp);
    audit(userId, "mastodon.schedule_created", id, `${accountId}; ${scheduledFor}`);
    const row = db.prepare("SELECT * FROM mastodon_scheduled_posts WHERE client_request_id=?").get(id) as Row;
    return { item: publicItem(row), created: true };
  });
}

/** Reconcile durable attempts before ageing an abandoned reservation to unknown. Never resend it. */
export function reconcileMastodonSchedules(now = new Date()): void {
  transaction((db) => {
    const staleBefore = new Date(now.getTime() - STALE_AFTER_MS).toISOString();
    db.prepare(`UPDATE mastodon_publish_attempts SET status='unknown',
      last_error='Publishing result was not confirmed. Check Mastodon before trying again.',updated_at=?
      WHERE status='inflight' AND created_at <= ? AND EXISTS
        (SELECT 1 FROM mastodon_scheduled_posts AS scheduled WHERE
          scheduled.client_request_id=mastodon_publish_attempts.client_request_id AND
          scheduled.user_id=mastodon_publish_attempts.user_id AND
          scheduled.instance=mastodon_publish_attempts.instance AND
          scheduled.account_id=mastodon_publish_attempts.account_id AND
          scheduled.content_hash=mastodon_publish_attempts.content_hash)`)
      .run(now.toISOString(), staleBefore);
    const active = db.prepare(`SELECT * FROM mastodon_scheduled_posts WHERE status IN ('inflight','unknown')`)
      .all() as Row[];
    for (const row of active) {
      const attempt = db.prepare(`SELECT status,remote_id,remote_url,last_error FROM mastodon_publish_attempts
        WHERE client_request_id=? AND user_id=? AND instance=? AND account_id=? AND content_hash=?`)
        .get(row.client_request_id, row.user_id, row.instance, row.account_id, row.content_hash) as
        { status: "inflight" | "posted" | "unknown" | "rejected"; remote_id: string | null;
          remote_url: string | null; last_error: string | null } | undefined;
      let nextStatus: Status | null = null;
      if (attempt?.status === "posted" && attempt.remote_id) nextStatus = "posted";
      else if (attempt?.status === "rejected") nextStatus = "rejected";
      else if (attempt?.status === "unknown") nextStatus = "unknown";
      else if (row.status === "inflight" && row.claimed_at && row.claimed_at <= staleBefore) nextStatus = "unknown";
      if (!nextStatus || nextStatus === row.status) continue;
      const error = nextStatus === "unknown" ? "Publishing result was not confirmed. Check Mastodon before trying again." :
        nextStatus === "rejected" ? attempt?.last_error ?? "Mastodon rejected this post." : null;
      db.prepare(`UPDATE mastodon_scheduled_posts SET status=?,remote_id=?,remote_url=?,last_error=?,
        resolution=CASE WHEN ? IN ('posted','rejected') THEN NULL ELSE resolution END,
        resolved_at=CASE WHEN ? IN ('posted','rejected') THEN NULL ELSE resolved_at END,updated_at=?
        WHERE client_request_id=? AND status IN ('inflight','unknown')`).run(nextStatus,
          nextStatus === "posted" ? attempt?.remote_id ?? null : null,
          nextStatus === "posted" ? attempt?.remote_url ?? null : null,
          error, nextStatus, nextStatus, now.toISOString(), row.client_request_id);
      audit(row.user_id, `mastodon.schedule_${nextStatus}`, row.client_request_id, "reconciled");
    }
  });
}

export function listMastodonSchedules(userId: string): MastodonScheduledPost[] {
  reconcileMastodonSchedules();
  return (database().prepare(`SELECT * FROM mastodon_scheduled_posts WHERE user_id=? AND
    (status IN ('queued','inflight') OR (status='unknown' AND resolution IS NULL) OR client_request_id IN (
      SELECT client_request_id FROM mastodon_scheduled_posts WHERE user_id=?
      ORDER BY created_at DESC,client_request_id DESC LIMIT 100
    )) ORDER BY scheduled_for DESC,client_request_id DESC`).all(userId, userId) as Row[]).map(publicItem);
}

export function cancelMastodonSchedule(userId: string, body: unknown): MastodonScheduledPost {
  const input = inputObject(body, ["clientRequestId"]);
  if (!validId(input.clientRequestId)) throw new MastodonScheduleError("Invalid scheduling request ID.");
  const clientRequestId = input.clientRequestId as string;
  return transaction((db) => {
    const row = db.prepare("SELECT * FROM mastodon_scheduled_posts WHERE client_request_id=? AND user_id=?")
      .get(clientRequestId, userId) as Row | undefined;
    if (!row) throw new MastodonScheduleError("Scheduled post was not found.", 404);
    if (row.status === "cancelled") return publicItem(row);
    if (row.status !== "queued") throw new MastodonScheduleError("This post has already started and cannot be cancelled.", 409);
    const stamp = new Date().toISOString();
    db.prepare("UPDATE mastodon_scheduled_posts SET status='cancelled',updated_at=? WHERE client_request_id=? AND user_id=? AND status='queued'")
      .run(stamp, row.client_request_id, userId);
    audit(userId, "mastodon.schedule_cancelled", row.client_request_id);
    return publicItem({ ...row, status: "cancelled", updated_at: stamp });
  });
}

/** Move an individually confirmed intent only before the worker claims it. Its account and text stay immutable. */
export function rescheduleMastodonSchedule(userId: string, body: unknown): MastodonScheduledPost {
  if (!mastodonScheduleExecutionEnabled()) {
    throw new MastodonScheduleError("Automatic Mastodon publishing is paused on this installation.", 503);
  }
  const input = inputObject(body, ["clientRequestId", "expectedScheduledFor", "scheduledFor"]);
  if (!validId(input.clientRequestId) || !validUtc(input.expectedScheduledFor) || !validUtc(input.scheduledFor)) {
    throw new MastodonScheduleError("Choose a valid UTC time and refresh the queued post before moving it.");
  }
  const clientRequestId = input.clientRequestId;
  const expectedScheduledFor = input.expectedScheduledFor;
  const scheduledFor = input.scheduledFor;
  const now = new Date();
  if (Date.parse(scheduledFor) < now.getTime() + 10_000 ||
      Date.parse(scheduledFor) > now.getTime() + MAX_AHEAD_MS) {
    throw new MastodonScheduleError("Choose a time at least 10 seconds ahead and within one year.");
  }
  return transaction((db) => {
    const row = db.prepare("SELECT * FROM mastodon_scheduled_posts WHERE client_request_id=? AND user_id=?")
      .get(clientRequestId, userId) as Row | undefined;
    if (!row || row.status !== "queued" || row.dispatch_authorized !== 1 ||
        row.scheduled_for !== expectedScheduledFor) {
      throw new MastodonScheduleError("This queued post changed or publishing has started. Refresh the real queue before moving it.", 409);
    }
    const connection = mastodonConnection(userId);
    const activeConnection = db.prepare("SELECT disconnecting FROM mastodon_connections WHERE user_id=?")
      .get(userId) as { disconnecting: number } | undefined;
    if (!connection.connected || connection.instance !== row.instance ||
        connection.account?.id !== row.account_id || !activeConnection || activeConnection.disconnecting) {
      throw new MastodonScheduleError("The scheduled Mastodon account is no longer connected. Refresh the account before moving it.", 409);
    }
    if (scheduledFor === row.scheduled_for) return publicItem(row);
    if (db.prepare(`SELECT 1 FROM mastodon_scheduled_posts WHERE client_request_id<>? AND user_id=?
      AND instance=? AND account_id=? AND content_hash=? AND
      ((status='queued' AND scheduled_for=?) OR status='inflight' OR
       (status='unknown' AND (resolution IS NULL OR resolution='found')) OR
       (status='posted' AND scheduled_for=?)) LIMIT 1`)
      .get(clientRequestId, userId, row.instance, row.account_id, row.content_hash, scheduledFor, scheduledFor)) {
      throw new MastodonScheduleError("This text is already queued at that time, being sent, or needs a result check for this account.", 409);
    }
    const stamp = now.toISOString();
    const changed = db.prepare(`UPDATE mastodon_scheduled_posts SET scheduled_for=?,updated_at=?
      WHERE client_request_id=? AND user_id=? AND status='queued' AND dispatch_authorized=1 AND scheduled_for=?`)
      .run(scheduledFor, stamp, clientRequestId, userId, expectedScheduledFor);
    if (changed.changes !== 1) {
      throw new MastodonScheduleError("Publishing started before this time change. Refresh the real queue.", 409);
    }
    audit(userId, "mastodon.schedule_rescheduled", clientRequestId, `${expectedScheduledFor} -> ${scheduledFor}`);
    return publicItem({ ...row, scheduled_for: scheduledFor, updated_at: stamp });
  });
}

export function resolveMastodonSchedule(userId: string, body: unknown): MastodonScheduledPost {
  const input = inputObject(body, ["clientRequestId", "resolution"]);
  if (!validId(input.clientRequestId) || (input.resolution !== "found" && input.resolution !== "absent")) {
    throw new MastodonScheduleError("Invalid result check.");
  }
  const clientRequestId = input.clientRequestId as string;
  const resolution = input.resolution as "found" | "absent";
  reconcileMastodonSchedules();
  return transaction((db) => {
    const row = db.prepare("SELECT * FROM mastodon_scheduled_posts WHERE client_request_id=? AND user_id=?")
      .get(clientRequestId, userId) as Row | undefined;
    if (!row) throw new MastodonScheduleError("Scheduled post was not found.", 404);
    if (row.status !== "unknown" || row.resolution) {
      throw new MastodonScheduleError("Only an unresolved, uncertain post can be checked off.", 409);
    }
    const stamp = new Date().toISOString();
    db.prepare(`UPDATE mastodon_scheduled_posts SET resolution=?,resolved_at=?,updated_at=?
      WHERE client_request_id=? AND user_id=? AND status='unknown' AND resolution IS NULL`)
      .run(resolution, stamp, stamp, row.client_request_id, userId);
    const attempt = db.prepare(`SELECT status,resolution FROM mastodon_publish_attempts
      WHERE client_request_id=? AND user_id=? AND instance=? AND account_id=? AND content_hash=?`)
      .get(row.client_request_id, userId, row.instance, row.account_id, row.content_hash) as
      { status: string; resolution: string | null } | undefined;
    if (attempt?.status === "unknown" && !attempt.resolution) {
      db.prepare(`UPDATE mastodon_publish_attempts SET resolution=?,resolved_at=?,updated_at=?
        WHERE client_request_id=? AND user_id=? AND instance=? AND account_id=? AND content_hash=?
          AND status='unknown' AND resolution IS NULL`)
        .run(resolution, stamp, stamp, row.client_request_id, userId, row.instance, row.account_id, row.content_hash);
    }
    audit(userId, "mastodon.schedule_resolved", row.client_request_id, resolution);
    return publicItem({ ...row, resolution, resolved_at: stamp, updated_at: stamp });
  });
}

export function claimDueMastodonSchedule(now = new Date()): Row | null {
  if (!mastodonScheduleExecutionEnabled()) return null;
  reconcileMastodonSchedules(now);
  return transaction((db) => {
    const row = db.prepare(`SELECT * FROM mastodon_scheduled_posts WHERE status='queued' AND dispatch_authorized=1 AND scheduled_for <= ?
      ORDER BY scheduled_for,client_request_id LIMIT 1`).get(now.toISOString()) as Row | undefined;
    if (!row) return null;
    const changed = db.prepare(`UPDATE mastodon_scheduled_posts SET status='inflight',claimed_at=?,updated_at=?
      WHERE client_request_id=? AND status='queued' AND dispatch_authorized=1`).run(now.toISOString(), now.toISOString(), row.client_request_id);
    if (changed.changes !== 1) return null;
    audit(row.user_id, "mastodon.schedule_claimed", row.client_request_id);
    return { ...row, status: "inflight" as const, claimed_at: now.toISOString(), updated_at: now.toISOString() };
  });
}

type Dispatch = (userId: string, body: { text: string; clientRequestId: string }, accountId: string) =>
  Promise<{ status: "posted" | "unknown"; id?: string; url?: string }>;

/** A claim is one-shot. A crash, timeout or uncertain outcome is never automatically requeued. */
export async function processOneDueMastodonSchedule(
  now = new Date(),
  dispatch: Dispatch = (userId, body, accountId) => publishMastodonText(userId, body, accountId),
): Promise<boolean> {
  const item = claimDueMastodonSchedule(now);
  if (!item) return false;
  let result: Awaited<ReturnType<Dispatch>> | null = null;
  let failure: unknown = null;
  try {
    const connection = mastodonConnection(item.user_id);
    if (!connection.configured || connection.instance !== item.instance || !connection.connected ||
        connection.account?.id !== item.account_id) {
      throw new MastodonScheduleError("The original Mastodon account is no longer connected.", 409);
    }
    result = await dispatch(item.user_id, { text: item.text, clientRequestId: item.client_request_id }, item.account_id);
  } catch (error) { failure = error; }

  transaction((db) => {
    const attempt = db.prepare(`SELECT status,remote_id,remote_url,last_error FROM mastodon_publish_attempts
      WHERE client_request_id=? AND user_id=? AND instance=? AND account_id=? AND content_hash=?`)
      .get(item.client_request_id, item.user_id, item.instance, item.account_id, item.content_hash) as
      { status: "inflight" | "posted" | "unknown" | "rejected"; remote_id: string | null;
        remote_url: string | null; last_error: string | null } | undefined;
    let status: Status = "unknown";
    let remoteId: string | null = null;
    let remoteUrl: string | null = null;
    let error = "Publishing result was not confirmed. Check Mastodon before trying again.";
    if (attempt?.status === "posted" && attempt.remote_id) {
      status = "posted"; remoteId = attempt.remote_id; remoteUrl = attempt.remote_url; error = "";
    } else if (attempt?.status === "rejected") {
      status = "rejected"; error = attempt.last_error ?? "Mastodon rejected this post.";
    } else if (attempt?.status === "unknown") {
      status = "unknown";
    } else if (result?.status === "posted" && result.id) {
      status = "posted"; remoteId = result.id; remoteUrl = result.url ?? null; error = "";
    } else if (!attempt && (failure instanceof MastodonError || failure instanceof MastodonScheduleError)) {
      status = "rejected"; error = failure.message;
    }
    const changed = db.prepare(`UPDATE mastodon_scheduled_posts SET status=?,remote_id=?,remote_url=?,last_error=?,updated_at=?
      WHERE client_request_id=? AND user_id=? AND status IN ('inflight','unknown')`).run(
        status, remoteId, remoteUrl, error || null, new Date().toISOString(), item.client_request_id, item.user_id,
      );
    if (changed.changes) audit(item.user_id, `mastodon.schedule_${status}`, item.client_request_id);
  });
  return true;
}
