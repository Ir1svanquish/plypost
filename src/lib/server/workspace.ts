import { randomUUID } from "node:crypto";
import { audit, database, transaction } from "./db";
import { parseWorkspace, type SavedDraft, type ScheduledPost } from "../workspace";
import { platformIds } from "../platforms";

type DraftRow = { payload: string };
type JobRow = {
  id: string; payload: string; status: string; attempts: number;
  next_attempt_at: string; last_error: string | null; completed_at: string | null; receipts: string;
};

export type ServerSchedule = ScheduledPost & {
  status: "queued" | "running" | "simulated" | "failed";
  attempts: number;
  nextAttemptAt?: string;
  lastError?: string;
  receipts: { platform: string; id: string; status: string; publishedAt: string; content: string }[];
};

function mapJob(row: JobRow): ServerSchedule {
  const post = JSON.parse(row.payload) as ScheduledPost;
  return {
    ...post,
    status: row.status as ServerSchedule["status"],
    attempts: row.attempts,
    ...(row.status === "queued" ? { nextAttemptAt: row.next_attempt_at } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    ...(row.completed_at ? { simulatedAt: row.completed_at } : {}),
    receipts: JSON.parse(row.receipts) as ServerSchedule["receipts"],
  };
}

export function listWorkspace(userId: string) {
  const db = database();
  const drafts = db.prepare("SELECT payload FROM drafts WHERE user_id=? ORDER BY updated_at DESC LIMIT 100")
    .all(userId).map((row) => JSON.parse((row as DraftRow).payload) as SavedDraft);
  const schedule = db.prepare("SELECT id,payload,status,attempts,next_attempt_at,last_error,completed_at,receipts FROM jobs WHERE user_id=? ORDER BY scheduled_for ASC LIMIT 100")
    .all(userId).map((row) => mapJob(row as JobRow));
  const log = db.prepare("SELECT action,subject_id,detail,created_at FROM audit WHERE user_id=? ORDER BY id DESC LIMIT 30")
    .all(userId);
  const heartbeat = db.prepare("SELECT seen_at FROM worker_heartbeat WHERE id=1").get() as { seen_at: string } | undefined;
  return { drafts, schedule, log, workerLastSeen: heartbeat?.seen_at ?? null };
}

function validDraft(value: unknown): SavedDraft | null {
  const result = parseWorkspace({ version: 3, drafts: [value], schedule: [], assisted: [] });
  return result?.drafts[0] ?? null;
}

function validSchedule(value: unknown): ScheduledPost | null {
  const result = parseWorkspace({ version: 3, drafts: [], schedule: [value], assisted: [] });
  return result?.schedule[0] ?? null;
}

export function saveDraft(userId: string, value: unknown): SavedDraft {
  const draft = validDraft(value);
  if (!draft || !/^[a-f0-9-]{36}$/i.test(draft.id)) throw new Error("Invalid draft.");
  transaction((db) => {
    const existing = db.prepare("SELECT user_id, payload FROM drafts WHERE id=?").get(draft.id) as { user_id: string; payload: string } | undefined;
    if (existing && existing.user_id !== userId) throw new Error("Draft not found.");
    const count = db.prepare("SELECT COUNT(*) AS count FROM drafts WHERE user_id=?").get(userId) as { count: number };
    if (!existing && count.count >= 100) throw new Error("Draft library is full.");
    const normalized = { ...draft, createdAt: existing ? (JSON.parse(existing.payload) as SavedDraft).createdAt : new Date().toISOString(), updatedAt: new Date().toISOString() };
    db.prepare("INSERT INTO drafts(id,user_id,payload,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at")
      .run(normalized.id, userId, JSON.stringify(normalized), normalized.updatedAt);
    audit(userId, existing ? "draft.updated" : "draft.created", draft.id);
    Object.assign(draft, normalized);
  });
  return draft;
}

export function deleteDraft(userId: string, id: string) {
  const result = database().prepare("DELETE FROM drafts WHERE id=? AND user_id=?").run(id, userId);
  if (result.changes) audit(userId, "draft.deleted", id);
  return Boolean(result.changes);
}

export function addSchedule(userId: string, value: unknown, timezone: unknown): ServerSchedule {
  const post = validSchedule(value);
  if (!post || post.status !== "queued" || !/^[a-f0-9-]{36}$/i.test(post.id) ||
      Date.parse(post.scheduledFor) <= Date.now() ||
      typeof timezone !== "string" || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,3}$/.test(timezone)) {
    throw new Error("Choose a future time and valid platform drafts.");
  }
  const now = new Date().toISOString();
  transaction((db) => {
    const count = db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE user_id=?").get(userId) as { count: number };
    if (count.count >= 100) throw new Error("Publishing plan is full.");
    db.prepare("INSERT INTO jobs(id,user_id,payload,scheduled_for,timezone,status,next_attempt_at) VALUES (?,?,?,?,?,'queued',?)")
      .run(post.id, userId, JSON.stringify({ ...post, createdAt: now }), post.scheduledFor, timezone, post.scheduledFor);
    audit(userId, "schedule.created", post.id, timezone);
  });
  return { ...post, createdAt: now, attempts: 0, receipts: [], nextAttemptAt: post.scheduledFor };
}

export function deleteSchedule(userId: string, id: string) {
  const result = database().prepare("DELETE FROM jobs WHERE id=? AND user_id=? AND status != 'running'").run(id, userId);
  if (result.changes) audit(userId, "schedule.deleted", id);
  return Boolean(result.changes);
}

export function retrySchedule(userId: string, id: string) {
  const result = database().prepare("UPDATE jobs SET status='queued',next_attempt_at=?,last_error=NULL WHERE id=? AND user_id=? AND status='failed'")
    .run(new Date().toISOString(), id, userId);
  if (result.changes) audit(userId, "schedule.retried", id);
  return Boolean(result.changes);
}

export function importLibrary(userId: string, raw: unknown) {
  const workspace = parseWorkspace(raw);
  if (!workspace || !raw || typeof raw !== "object" || !Array.isArray((raw as { drafts?: unknown }).drafts) || !Array.isArray((raw as { schedule?: unknown }).schedule) ||
      workspace.drafts.length !== (raw as { drafts: unknown[] }).drafts.length ||
      workspace.schedule.length !== (raw as { schedule: unknown[] }).schedule.length) throw new Error("Invalid workspace backup.");
  const ids = [...workspace.drafts, ...workspace.schedule].map((item) => item.id);
  if (new Set(ids).size !== ids.length || ids.some((id) => !/^[a-f0-9-]{36}$/i.test(id))) throw new Error("Backup has invalid IDs.");
  transaction((db) => {
    db.prepare("DELETE FROM drafts WHERE user_id=?").run(userId);
    db.prepare("DELETE FROM jobs WHERE user_id=? AND status != 'running'").run(userId);
    const running = db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE user_id=?").get(userId) as { count: number };
    if (running.count) throw new Error("Wait for running jobs before importing.");
    for (const draft of workspace.drafts) {
      db.prepare("INSERT INTO drafts(id,user_id,payload,updated_at) VALUES (?,?,?,?)")
        .run(draft.id, userId, JSON.stringify(draft), draft.updatedAt);
    }
    for (const post of workspace.schedule) {
      const status = post.status === "simulated" ? "simulated" : "queued";
      db.prepare("INSERT INTO jobs(id,user_id,payload,scheduled_for,timezone,status,next_attempt_at,completed_at,receipts) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(post.id, userId, JSON.stringify(post), post.scheduledFor, "UTC", status, post.scheduledFor, post.simulatedAt ?? null, JSON.stringify(post.receipts ?? []));
    }
    audit(userId, "workspace.imported", randomUUID(), `${workspace.drafts.length} drafts; ${workspace.schedule.length} jobs`);
  });
  return workspace;
}

export function aiRateAllowed(userId: string): boolean {
  return transaction((db) => {
    const since = new Date(Date.now() - 60 * 60_000).toISOString();
    db.prepare("DELETE FROM ai_usage WHERE created_at < ?").run(since);
    const row = db.prepare("SELECT COUNT(*) AS count FROM ai_usage WHERE user_id=?").get(userId) as { count: number };
    if (row.count >= 10) return false;
    db.prepare("INSERT INTO ai_usage(user_id,created_at) VALUES (?,?)").run(userId, new Date().toISOString());
    return true;
  });
}

export function receiptPlatforms(post: ScheduledPost): string[] {
  return platformIds.filter((id) => post.posts[id] !== undefined);
}
