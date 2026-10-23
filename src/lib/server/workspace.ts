import { randomUUID } from "node:crypto";
import { audit, database, transaction } from "./db";
import { parseWorkspace, type AssistedPost, type SavedDraft, type ScheduledPost } from "../workspace";
import { isPlatformId, platformIds } from "../platforms";
import { validatePlatformText } from "../platform-validation";
import { assertOwnedMedia } from "./media";

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
  const mapped: ServerSchedule = {
    ...post,
    status: row.status as ServerSchedule["status"],
    attempts: row.attempts,
    receipts: JSON.parse(row.receipts) as ServerSchedule["receipts"],
  };
  delete mapped.nextAttemptAt;
  delete mapped.lastError;
  delete mapped.simulatedAt;
  if (row.status === "queued") mapped.nextAttemptAt = row.next_attempt_at;
  if (row.last_error) mapped.lastError = row.last_error;
  if (row.status === "simulated" && row.completed_at) mapped.simulatedAt = row.completed_at;
  return mapped;
}

export function listWorkspace(userId: string) {
  const db = database();
  const drafts = db.prepare("SELECT payload FROM drafts WHERE user_id=? ORDER BY updated_at DESC LIMIT 100")
    .all(userId).map((row) => JSON.parse((row as DraftRow).payload) as SavedDraft);
  const assisted = db.prepare("SELECT payload FROM assisted WHERE user_id=? ORDER BY scheduled_for ASC,id LIMIT 100")
    .all(userId).map((row) => JSON.parse((row as DraftRow).payload) as AssistedPost);
  const schedule = db.prepare("SELECT id,payload,status,attempts,next_attempt_at,last_error,completed_at,receipts FROM jobs WHERE user_id=? ORDER BY scheduled_for ASC LIMIT 100")
    .all(userId).map((row) => mapJob(row as JobRow));
  const log = db.prepare("SELECT action,subject_id,detail,created_at FROM audit WHERE user_id=? ORDER BY id DESC LIMIT 30")
    .all(userId);
  const heartbeat = db.prepare("SELECT seen_at FROM worker_heartbeat WHERE id=1").get() as { seen_at: string } | undefined;
  return { drafts, schedule, assisted, log, workerLastSeen: heartbeat?.seen_at ?? null };
}

function validDraft(value: unknown): SavedDraft | null {
  const result = parseWorkspace({ version: 3, drafts: [value], schedule: [], assisted: [] });
  return result?.drafts[0] ?? null;
}

function validSchedule(value: unknown): ScheduledPost | null {
  const result = parseWorkspace({ version: 3, drafts: [], schedule: [value], assisted: [] });
  return result?.schedule[0] ?? null;
}

function validAssisted(value: unknown): AssistedPost | null {
  const result = parseWorkspace({ version: 3, drafts: [], schedule: [], assisted: [value] });
  return result?.assisted[0] ?? null;
}

const validId = (id: string) => /^[a-f0-9-]{36}$/i.test(id);

const MIN_SCHEDULE_LEAD_MS = 10_000;

function validFutureUtc(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value && date.getTime() >= Date.now() + MIN_SCHEDULE_LEAD_MS;
}

function validTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64 || !/^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){1,3})$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function addAssisted(userId: string, value: unknown): AssistedPost {
  const item = validAssisted(value);
  if (!item || !validId(item.id) || item.status !== "queued") throw new Error("Invalid assisted item.");
  if (isPlatformId(item.destination) && !validatePlatformText(item.destination, item.text).valid) {
    throw new Error("Fix platform draft limits before adding to assisted publishing.");
  }
  transaction((db) => {
    assertOwnedMedia(userId, item.mediaIds ?? []);
    if (db.prepare("SELECT id FROM assisted WHERE id=?").get(item.id)) throw new Error("Assisted item already exists.");
    const count = db.prepare("SELECT COUNT(*) AS count FROM assisted WHERE user_id=?").get(userId) as { count: number };
    if (count.count >= 100) throw new Error("Assisted publishing list is full.");
    db.prepare("INSERT INTO assisted(id,user_id,payload,scheduled_for,updated_at) VALUES (?,?,?,?,?)")
      .run(item.id, userId, JSON.stringify(item), item.scheduledFor, new Date().toISOString());
    audit(userId, "assisted.created", item.id);
  });
  return item;
}

export function setAssistedStatus(userId: string, id: string, status: unknown): boolean {
  if (!validId(id) || (status !== "posted" && status !== "queued")) throw new Error("Invalid assisted status.");
  return transaction((db) => {
    const row = db.prepare("SELECT payload FROM assisted WHERE id=? AND user_id=?").get(id, userId) as DraftRow | undefined;
    if (!row) return false;
    const current = JSON.parse(row.payload) as AssistedPost;
    if (current.status === status) return true;
    const updated: AssistedPost = { ...current, status };
    if (status === "posted") updated.postedAt = new Date().toISOString();
    else delete updated.postedAt;
    db.prepare("UPDATE assisted SET payload=?,updated_at=? WHERE id=? AND user_id=?")
      .run(JSON.stringify(updated), new Date().toISOString(), id, userId);
    audit(userId, status === "posted" ? "assisted.posted" : "assisted.unposted", id);
    return true;
  });
}

export function markAssistedNotified(userId: string, ids: unknown): void {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 || ids.some((id) => typeof id !== "string" || !validId(id))) {
    throw new Error("Invalid assisted item IDs.");
  }
  const stamp = new Date().toISOString();
  transaction((db) => {
    for (const id of new Set(ids as string[])) {
      const row = db.prepare("SELECT payload FROM assisted WHERE id=? AND user_id=?").get(id, userId) as DraftRow | undefined;
      if (!row) continue;
      const item = JSON.parse(row.payload) as AssistedPost;
      if (item.status !== "queued" || item.notifiedAt) continue;
      db.prepare("UPDATE assisted SET payload=?,updated_at=? WHERE id=? AND user_id=?")
        .run(JSON.stringify({ ...item, notifiedAt: stamp }), stamp, id, userId);
    }
  });
}

export function deleteAssisted(userId: string, id: string): boolean {
  if (!validId(id)) return false;
  const result = database().prepare("DELETE FROM assisted WHERE id=? AND user_id=?").run(id, userId);
  if (result.changes) audit(userId, "assisted.deleted", id);
  return Boolean(result.changes);
}

export function migrateAssisted(userId: string, raw: unknown): "imported" | "skipped" {
  if (!Array.isArray(raw) || raw.length > 100) throw new Error("Invalid assisted migration.");
  const items = raw.map(validAssisted);
  if (items.some((item) => !item || !validId(item.id)) || new Set(items.map((item) => item?.id)).size !== items.length) {
    throw new Error("Invalid assisted migration.");
  }
  return transaction((db) => {
    for (const item of items as AssistedPost[]) assertOwnedMedia(userId, item.mediaIds ?? []);
    const count = db.prepare("SELECT COUNT(*) AS count FROM assisted WHERE user_id=?").get(userId) as { count: number };
    const missing = (items as AssistedPost[]).filter((item) => {
      const existing = db.prepare("SELECT user_id FROM assisted WHERE id=?").get(item.id) as { user_id: string } | undefined;
      if (existing && existing.user_id !== userId) throw new Error("Invalid assisted migration.");
      return !existing;
    });
    if (!missing.length) return "skipped";
    if (count.count + missing.length > 100) throw new Error("Assisted publishing list is full.");
    const stamp = new Date().toISOString();
    for (const item of missing) {
      db.prepare("INSERT INTO assisted(id,user_id,payload,scheduled_for,updated_at) VALUES (?,?,?,?,?)")
        .run(item.id, userId, JSON.stringify(item), item.scheduledFor, stamp);
    }
    audit(userId, "assisted.migrated", undefined, `${missing.length} items`);
    return "imported";
  });
}

export function saveDraft(userId: string, value: unknown): SavedDraft {
  const draft = validDraft(value);
  if (!draft || !/^[a-f0-9-]{36}$/i.test(draft.id)) throw new Error("Invalid draft.");
  transaction((db) => {
    assertOwnedMedia(userId, draft.mediaIds ?? []);
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
      !validFutureUtc(post.scheduledFor) || !validTimezone(timezone)) {
    throw new Error("Choose a valid time at least 10 seconds ahead, timezone, and platform drafts.");
  }
  if (platformIds.some((id) => post.posts[id] !== undefined && !validatePlatformText(id, post.posts[id]!).valid)) {
    throw new Error("Fix platform draft limits before adding to the plan.");
  }
  const now = new Date().toISOString();
  transaction((db) => {
    assertOwnedMedia(userId, post.mediaIds ?? []);
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
  const result = database().prepare("UPDATE jobs SET status='queued',attempts=0,next_attempt_at=?,last_error=NULL WHERE id=? AND user_id=? AND status='failed'")
    .run(new Date().toISOString(), id, userId);
  if (result.changes) audit(userId, "schedule.retried", id);
  return Boolean(result.changes);
}

export function rescheduleSchedule(userId: string, id: string, scheduledFor: unknown, timezone: unknown): boolean {
  if (!validId(id) || !validFutureUtc(scheduledFor) || !validTimezone(timezone)) {
    throw new Error("Choose a valid UTC time at least 10 seconds ahead and a recognized timezone.");
  }
  return transaction((db) => {
    const row = db.prepare("SELECT payload FROM jobs WHERE id=? AND user_id=? AND status IN ('queued','failed')")
      .get(id, userId) as { payload: string } | undefined;
    if (!row) return false;
    const post = JSON.parse(row.payload) as ScheduledPost;
    const updated: ScheduledPost = { ...post, scheduledFor, status: "queued" };
    delete updated.nextAttemptAt;
    delete updated.lastError;
    delete updated.simulatedAt;
    delete updated.attempts;
    const result = db.prepare(`UPDATE jobs SET payload=?,scheduled_for=?,timezone=?,status='queued',attempts=0,next_attempt_at=?,
      lease_until=NULL,last_error=NULL,completed_at=NULL WHERE id=? AND user_id=? AND status IN ('queued','failed')`)
      .run(JSON.stringify(updated), scheduledFor, timezone, scheduledFor, id, userId);
    if (!result.changes) return false;
    audit(userId, "schedule.rescheduled", id, `${timezone}; ${scheduledFor}`);
    return true;
  });
}

type ImportMode = "replace-all" | "preserve-assisted";

function importWorkspace(userId: string, raw: unknown, mode: ImportMode) {
  const workspace = parseWorkspace(raw);
  if (!workspace || !raw || typeof raw !== "object" || !Array.isArray((raw as { drafts?: unknown }).drafts) || !Array.isArray((raw as { schedule?: unknown }).schedule) ||
      workspace.drafts.length !== (raw as { drafts: unknown[] }).drafts.length ||
      workspace.schedule.length !== (raw as { schedule: unknown[] }).schedule.length ||
      (Array.isArray((raw as { assisted?: unknown }).assisted) && workspace.assisted.length !== (raw as { assisted: unknown[] }).assisted.length)) throw new Error("Invalid workspace backup.");
  const ids = [...workspace.drafts, ...workspace.schedule, ...workspace.assisted].map((item) => item.id);
  if (new Set(ids).size !== ids.length || ids.some((id) => !/^[a-f0-9-]{36}$/i.test(id))) throw new Error("Backup has invalid IDs.");
  transaction((db) => {
    db.prepare("DELETE FROM drafts WHERE user_id=?").run(userId);
    db.prepare("DELETE FROM jobs WHERE user_id=? AND status != 'running'").run(userId);
    const running = db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE user_id=?").get(userId) as { count: number };
    if (running.count) throw new Error("Wait for running jobs before importing.");
    if (mode === "replace-all") db.prepare("DELETE FROM assisted WHERE user_id=?").run(userId);
    for (const draft of workspace.drafts) {
      assertOwnedMedia(userId, draft.mediaIds ?? []);
      db.prepare("INSERT INTO drafts(id,user_id,payload,updated_at) VALUES (?,?,?,?)")
        .run(draft.id, userId, JSON.stringify(draft), draft.updatedAt);
    }
    for (const post of workspace.schedule) {
      assertOwnedMedia(userId, post.mediaIds ?? []);
      const status = post.status === "simulated" ? "simulated" : "queued";
      db.prepare("INSERT INTO jobs(id,user_id,payload,scheduled_for,timezone,status,next_attempt_at,completed_at,receipts) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(post.id, userId, JSON.stringify(post), post.scheduledFor, "UTC", status, post.scheduledFor, post.simulatedAt ?? null, JSON.stringify(post.receipts ?? []));
    }
    if (mode === "replace-all") {
      for (const item of workspace.assisted) {
        assertOwnedMedia(userId, item.mediaIds ?? []);
        db.prepare("INSERT INTO assisted(id,user_id,payload,scheduled_for,updated_at) VALUES (?,?,?,?,?)")
          .run(item.id, userId, JSON.stringify(item), item.scheduledFor, new Date().toISOString());
      }
    }
    audit(userId, mode === "replace-all" ? "workspace.imported" : "workspace.legacy_imported", randomUUID(),
      `${workspace.drafts.length} drafts; ${workspace.schedule.length} jobs; ${mode === "replace-all" ? workspace.assisted.length : "preserved"} assisted`);
  });
  return workspace;
}

export function importLibrary(userId: string, raw: unknown) {
  return importWorkspace(userId, raw, "replace-all");
}

export function importLegacyLibrary(userId: string, raw: unknown) {
  return importWorkspace(userId, raw, "preserve-assisted");
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
