import { createHash, randomUUID } from "node:crypto";
import { audit, transaction } from "./db";
import { assistedContentSnapshot, assistedDeletionSnapshot, assistedReceiptSnapshot, draftTitle, hasDraftContent, hasManualReminder, normalizePublicPostUrl, parseAssistedOutcomeInput, parseWorkspace, validCalendarDate, validMediaAlt, validMediaIds, type AssistedPost, type SavedDraft, type ScheduledPost } from "../workspace";
import { imageLimitForDestination } from "../media-policy";
import { adaptDraft, characterCount, isPlatformId, platformIds } from "../platforms";
import { assistedIds, isAssistedDestinationId, type AssistedDestinationId } from "../assisted";
import { validatePlatformText } from "../platform-validation";
import { assertOwnedMedia, listMedia } from "./media";
import { assertOwnedVideo, listVideos } from "./video";
import { slotIsFree } from "./slots";
import { suggestedSlotIsReady } from "../slot-settings";
import { workspaceDataRevision } from "./workspace-revision";

type DraftRow = { payload: string };
type JobRow = {
  id: string; payload: string; status: string; attempts: number;
  scheduled_for: string; timezone: string; lease_until: string | null;
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
    revision: jobRevision(row),
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

function jobRevision(row: JobRow): string {
  return createHash("sha256").update(JSON.stringify([
    row.payload, row.scheduled_for, row.timezone, row.status, row.attempts,
    row.next_attempt_at, row.lease_until, row.last_error, row.completed_at, row.receipts,
  ])).digest("hex");
}

function assertCurrentJob(row: JobRow, expectedRevision: unknown): void {
  if (typeof expectedRevision !== "string" || expectedRevision !== jobRevision(row)) {
    throw new ScheduleConflictError();
  }
}

const jobColumns = "id,payload,scheduled_for,timezone,status,attempts,next_attempt_at,lease_until,last_error,completed_at,receipts";

export function listWorkspace(userId: string) {
  // Keep the returned data and its revision on the same database snapshot.
  listMedia(userId);
  listVideos(userId);
  return transaction((db) => {
  const drafts = db.prepare("SELECT payload FROM drafts WHERE user_id=? ORDER BY updated_at DESC LIMIT 100")
    .all(userId).map((row) => JSON.parse((row as DraftRow).payload) as SavedDraft);
  const assisted = db.prepare("SELECT payload FROM assisted WHERE user_id=? ORDER BY scheduled_for ASC,id LIMIT 100")
    .all(userId).map((row) => JSON.parse((row as DraftRow).payload) as AssistedPost);
  const schedule = db.prepare(`SELECT ${jobColumns} FROM jobs WHERE user_id=? ORDER BY scheduled_for ASC LIMIT 100`)
    .all(userId).map((row) => mapJob(row as JobRow));
  const log = (db.prepare("SELECT action,subject_id,detail,created_at FROM audit WHERE user_id=? ORDER BY id DESC LIMIT 30")
    .all(userId) as { action: string; subject_id: string | null; detail: string | null; created_at: string }[])
    .map((entry) => {
      if (entry.action !== "assisted.batch_prepared") return entry;
      try {
        const manifest = JSON.parse(entry.detail ?? "") as { items?: unknown };
        const count = Array.isArray(manifest.items) ? manifest.items.length : 0;
        return { ...entry, detail: count ? `${count} manual handoffs` : "Manual handoffs prepared" };
      } catch {
        return { ...entry, detail: "Manual handoffs prepared" };
      }
    });
  const heartbeat = db.prepare("SELECT seen_at FROM worker_heartbeat WHERE id=1").get() as { seen_at: string } | undefined;
  return { drafts, schedule, assisted, log, workerLastSeen: heartbeat?.seen_at ?? null,
    workspaceRevision: workspaceDataRevision(db, userId) };
  });
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
const validUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const validUtcInstant = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

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
  if (item.sourceDraftId || item.batchId) throw new Error("Use batch preparation for draft-linked handoffs.");
  if (isPlatformId(item.destination) && !validatePlatformText(item.destination, item.text).valid) {
    throw new Error("Fix platform draft limits before adding to assisted publishing.");
  }
  transaction((db) => {
    assertOwnedMedia(userId, item.mediaIds ?? []);
    if ((item.mediaIds?.length ?? 0) > imageLimitForDestination(item.destination, Boolean(item.videoId))) {
      throw new Error("Select fewer images for this platform before preparing its handoff.");
    }
    assertOwnedVideo(userId, item.videoId);
    if (db.prepare("SELECT id FROM assisted WHERE id=?").get(item.id)) throw new Error("Assisted item already exists.");
    const count = db.prepare("SELECT COUNT(*) AS count FROM assisted WHERE user_id=?").get(userId) as { count: number };
    if (count.count >= 100) throw new Error("Assisted publishing list is full.");
    db.prepare("INSERT INTO assisted(id,user_id,payload,scheduled_for,updated_at) VALUES (?,?,?,?,?)")
      .run(item.id, userId, JSON.stringify(item), item.scheduledFor, new Date().toISOString());
    audit(userId, "assisted.created", item.id);
  });
  return item;
}

type BatchHandoff = { destination: AssistedDestinationId; scheduledFor: string; reminderEnabled?: boolean; text?: string; videoId?: string; mediaIds?: string[] };

/** Snapshot reviewed manual-publishing handoffs from one saved draft. */
export function prepareAssistedBatch(userId: string, draftId: unknown, batchId: unknown, items: unknown,
  requireFreeSlots: unknown = false, expectedUpdatedAt: unknown = undefined): AssistedPost[] {
  if (typeof requireFreeSlots !== "boolean") throw new Error("Invalid weekly slot confirmation.");
  if (expectedUpdatedAt !== undefined && !validUtcInstant(expectedUpdatedAt)) throw new Error("Invalid saved draft version.");
  if (!validUuid(draftId) || !validUuid(batchId) || !Array.isArray(items) ||
      items.length < 1 || items.length > assistedIds.length || items.some((entry) =>
        !isRecord(entry) || Object.keys(entry).some((key) => key !== "destination" && key !== "scheduledFor" && key !== "reminderEnabled" && key !== "text" && key !== "videoId" && key !== "mediaIds") ||
        !isAssistedDestinationId(entry.destination) || !validUtcInstant(entry.scheduledFor) ||
        (entry.reminderEnabled !== undefined && typeof entry.reminderEnabled !== "boolean") ||
        (entry.text !== undefined && (typeof entry.text !== "string" || !entry.text.trim() || characterCount(entry.text) > 5000)) ||
        (entry.videoId !== undefined && !validUuid(entry.videoId)) ||
        (entry.mediaIds !== undefined && (!validMediaIds(entry.mediaIds) || entry.mediaIds.length > imageLimitForDestination(entry.destination as string, Boolean(entry.videoId)))))) {
    throw new Error("Choose a saved draft and one to eleven destinations with valid text and UTC timestamps.");
  }
  const requested = items as BatchHandoff[];
  if (new Set(requested.map((item) => item.destination)).size !== requested.length) {
    throw new Error("Choose each destination only once.");
  }
  return transaction((db) => {
    // Keep the original request in the local audit log so a retry cannot shrink a
    // batch after one or all handoffs were deleted. Imported backups may lack this log.
    const manifest = JSON.stringify({ draftId, ...(expectedUpdatedAt !== undefined ? { expectedUpdatedAt } : {}), items: requested
      .map(({ destination, scheduledFor, reminderEnabled, text, videoId, mediaIds }) => ({ destination, scheduledFor,
        ...(reminderEnabled !== undefined ? { reminderEnabled } : {}),
        ...(videoId !== undefined ? { videoId } : {}),
        ...(mediaIds !== undefined ? { mediaIds } : {}),
        ...(text !== undefined ? { textSha256: createHash("sha256").update(text).digest("hex") } : {}) }))
      .sort((a, b) => a.destination.localeCompare(b.destination)) });
    const recorded = db.prepare("SELECT detail FROM audit WHERE user_id=? AND action='assisted.batch_prepared' AND subject_id=? ORDER BY id LIMIT 1")
      .get(userId, batchId) as { detail: string | null } | undefined;
    if (recorded && recorded.detail !== manifest) {
      throw new Error("This batch ID was already used for a different or partial handoff.");
    }
    const existing = (db.prepare("SELECT payload FROM assisted WHERE user_id=?").all(userId) as DraftRow[])
      .map((row) => JSON.parse(row.payload) as AssistedPost)
      .filter((item) => item.batchId === batchId);
    if (existing.length) {
      const byDestination = new Map(existing.map((item) => [item.destination, item]));
      if (existing.length !== requested.length || byDestination.size !== requested.length ||
          existing.some((item) => item.sourceDraftId !== draftId) ||
          requested.some((item) => byDestination.get(item.destination)?.scheduledFor !== item.scheduledFor ||
            byDestination.get(item.destination)?.reminderEnabled !== item.reminderEnabled)) {
        throw new Error("This batch ID was already used for a different or partial handoff.");
      }
      return requested.map((item) => byDestination.get(item.destination)!);
    }
    if (recorded) throw new Error("This batch was already prepared, but its handoffs were removed.");

    const row = db.prepare("SELECT payload FROM drafts WHERE id=? AND user_id=?").get(draftId, userId) as DraftRow | undefined;
    const draft = row && validDraft(JSON.parse(row.payload));
    if (!draft || draft.id !== draftId) throw new Error("Saved draft not found.");
    if (expectedUpdatedAt !== undefined && draft.updatedAt !== expectedUpdatedAt) throw new DraftConflictError();
    if (requested.some((item) => isPlatformId(item.destination) && !draft.selected.includes(item.destination) && item.text === undefined)) {
      throw new Error("Review text for every platform added after saving this draft.");
    }
    if (requireFreeSlots && requested.some((item) =>
      isPlatformId(item.destination) && item.reminderEnabled !== false && (!suggestedSlotIsReady(item.scheduledFor, Date.now()) ||
      !slotIsFree(db, userId, item.destination, item.scheduledFor)))) {
      throw new Error("A suggested slot is now occupied or too soon. Preview free slots again.");
    }
    const count = db.prepare("SELECT COUNT(*) AS count FROM assisted WHERE user_id=?").get(userId) as { count: number };
    if (count.count + requested.length > 100) throw new Error("Assisted publishing list is full.");
    assertOwnedMedia(userId, draft.mediaIds ?? []);
    const draftImageIds = draft.mediaIds ?? [];
    if (requested.some((item) => item.mediaIds?.some((id) => !draftImageIds.includes(id)))) {
      throw new Error("Choose images from this saved draft only.");
    }
    assertOwnedVideo(userId, draft.videoId);
    for (const videoId of new Set(requested.map((item) => item.videoId).filter((id): id is string => id !== undefined))) {
      assertOwnedVideo(userId, videoId);
    }

    const now = new Date().toISOString();
    const prepared = requested.map(({ destination, scheduledFor, reminderEnabled, text: reviewedText, videoId, mediaIds }): AssistedPost => {
      const text = reviewedText ?? (isPlatformId(destination)
        ? draft.variants[destination] ?? adaptDraft(draft.source, destination)
        : draft.source);
      if (!text.trim() || characterCount(text) > 5000 ||
          (isPlatformId(destination) && !validatePlatformText(destination, text).valid)) {
        throw new Error(`Fix the ${reviewedText === undefined ? "saved " : ""}${destination} text before preparing this handoff.`);
      }
      // Omitted selection supports older clients; current clients send an explicit list,
      // including [] when no images should travel with this handoff.
      const selectedMediaIds = mediaIds ?? draftImageIds.slice(0, imageLimitForDestination(destination, Boolean(videoId)));
      const selectedMediaAlt = selectedMediaIds.map((id) => draft.mediaAlt?.[draftImageIds.indexOf(id)] ?? "");
      const item: AssistedPost = {
        id: randomUUID(), title: draftTitle(draft.title, draft.source), destination, text,
        ...(draft.mediaIds !== undefined || mediaIds !== undefined ? { mediaIds: [...selectedMediaIds] } : {}),
        ...(draft.mediaAlt !== undefined ? { mediaAlt: selectedMediaAlt } : {}),
        ...(draft.placeLabel ? { placeLabel: draft.placeLabel } : {}),
        ...(videoId !== undefined ? { videoId } : {}),
        sourceDraftId: draft.id, batchId, scheduledFor,
        ...(reminderEnabled !== undefined ? { reminderEnabled } : {}),
        createdAt: now, status: "queued",
        ...(reminderEnabled !== false && Date.parse(scheduledFor) <= Date.parse(now) ? { notifiedAt: now } : {}),
      };
      if (!validAssisted(item)) throw new Error("Could not prepare a valid handoff.");
      return item;
    });
    const insert = db.prepare("INSERT INTO assisted(id,user_id,payload,scheduled_for,updated_at) VALUES (?,?,?,?,?)");
    for (const item of prepared) {
      insert.run(item.id, userId, JSON.stringify(item), item.scheduledFor, now);
    }
    audit(userId, "assisted.batch_prepared", batchId, manifest);
    return prepared;
  });
}

function matchesReviewedAssistedContent(value: unknown, current: AssistedPost): boolean {
  if (!isRecord(value)) return false;
  const saved = assistedContentSnapshot(current);
  return value.destination === saved.destination && value.text === saved.text &&
    value.videoId === saved.videoId && value.placeLabel === saved.placeLabel &&
    Array.isArray(value.mediaIds) && value.mediaIds.length === saved.mediaIds.length &&
    value.mediaIds.every((id, index) => id === saved.mediaIds[index]) &&
    Array.isArray(value.mediaAlt) && value.mediaAlt.length === saved.mediaAlt.length &&
    value.mediaAlt.every((description, index) => description === saved.mediaAlt[index]);
}

export function setAssistedStatus(userId: string, id: string, status: unknown, postUrl?: unknown, expectedContent?: unknown, expectedReceipt?: unknown, confirmRecordRemoval?: unknown): boolean {
  if (!validId(id) || (status !== "posted" && status !== "queued")) throw new Error("Invalid assisted status.");
  if (status === "queued" && postUrl !== undefined) throw new Error("A post link requires a posted item.");
  // Omission preserves the current link; only an explicit null removes it.
  const normalizedUrl = status === "posted" && postUrl !== undefined && postUrl !== null
    ? normalizePublicPostUrl(postUrl) : undefined;
  if (normalizedUrl === null) throw new Error("Use a public HTTPS post link without credentials (maximum 2,048 characters).");
  return transaction((db) => {
    const row = db.prepare("SELECT payload FROM assisted WHERE id=? AND user_id=?").get(id, userId) as DraftRow | undefined;
    if (!row) return false;
    const current = JSON.parse(row.payload) as AssistedPost;
    if (status === "posted" && (current.status === "queued" || expectedContent !== undefined) &&
        !matchesReviewedAssistedContent(expectedContent, current)) {
      throw new AssistedConflictError("This handoff content changed. Review its latest text and media before marking it posted.");
    }
    if ((status === "queued" || current.status === "posted") &&
        (!isRecord(expectedReceipt) || JSON.stringify(expectedReceipt) !== JSON.stringify(assistedReceiptSnapshot(current)))) {
      throw new AssistedConflictError("This posted record changed in another window. Review its latest link and results before editing it.");
    }
    if (status === "queued" && current.status === "posted" && confirmRecordRemoval !== true) {
      throw new Error("Confirm clearing this posted record before undoing its mark.");
    }
    if (current.status === status && (postUrl === undefined ||
        (postUrl === null && current.postUrl === undefined) || normalizedUrl === current.postUrl)) return true;
    const updated: AssistedPost = { ...current, status };
    if (status === "posted") {
      if (current.status !== "posted") updated.postedAt = new Date().toISOString();
      if (postUrl === null) delete updated.postUrl;
      else if (normalizedUrl !== undefined) updated.postUrl = normalizedUrl;
    } else {
      delete updated.postedAt;
      delete updated.postUrl;
      delete updated.outcome;
    }
    db.prepare("UPDATE assisted SET payload=?,updated_at=? WHERE id=? AND user_id=?")
      .run(JSON.stringify(updated), new Date().toISOString(), id, userId);
    audit(userId, status === "posted" ? current.status === "posted" ? "assisted.post_link_updated" : "assisted.posted" : "assisted.unposted", id);
    return true;
  });
}

export class AssistedConflictError extends Error {
  constructor(message = "This manual reminder changed or is no longer queued. Refresh the plan before moving it.") { super(message); }
}

/** Edit only the queued handoff snapshot, leaving its time, media and draft provenance intact. */
export function updateAssistedText(userId: string, id: string, expectedText: unknown, text: unknown): boolean {
  if (!validId(id) || typeof expectedText !== "string" || expectedText.length > 10_000 ||
      typeof text !== "string" || text.length > 10_000 || !text.trim() || characterCount(text) > 5000) {
    throw new Error("Enter nonempty handoff text of up to 5,000 characters and refresh the item before editing.");
  }
  return transaction((db) => {
    const row = db.prepare("SELECT payload FROM assisted WHERE id=? AND user_id=?").get(id, userId) as DraftRow | undefined;
    if (!row) throw new AssistedConflictError("This handoff is no longer available. Refresh the list before editing.");
    const current = JSON.parse(row.payload) as AssistedPost;
    if (current.status !== "queued" || current.text !== expectedText) {
      throw new AssistedConflictError("This handoff text changed or was marked posted. Refresh the list before editing.");
    }
    const nextText = text.trim();
    if (isPlatformId(current.destination) && !validatePlatformText(current.destination, nextText).valid) {
      throw new Error("Fix the destination's text limit before saving this handoff.");
    }
    if (nextText === current.text) return true;
    const stamp = new Date().toISOString();
    const title = !current.sourceDraftId && current.title === draftTitle("", current.text)
      ? draftTitle("", nextText) : current.title;
    const updated: AssistedPost = { ...current, title, text: nextText, contentEditedAt: stamp };
    db.prepare("UPDATE assisted SET payload=?,updated_at=? WHERE id=? AND user_id=?")
      .run(JSON.stringify(updated), stamp, id, userId);
    audit(userId, "assisted.text_edited", id);
    return true;
  });
}

/** Replace or detach the clip on a queued handoff without changing its text or reminder. */
export function updateAssistedVideo(userId: string, id: string, expectedVideoId: unknown, videoId: unknown): boolean {
  if (!validId(id) || (expectedVideoId !== null && !validUuid(expectedVideoId)) ||
      (videoId !== null && !validUuid(videoId))) {
    throw new Error("Choose a saved video or remove the clip, then refresh the handoff before editing.");
  }
  return transaction((db) => {
    const row = db.prepare("SELECT payload FROM assisted WHERE id=? AND user_id=?").get(id, userId) as DraftRow | undefined;
    if (!row) throw new AssistedConflictError("This handoff is no longer available. Refresh the list before editing.");
    const current = JSON.parse(row.payload) as AssistedPost;
    if (current.status !== "queued" || (current.videoId ?? null) !== expectedVideoId) {
      throw new AssistedConflictError("This handoff video changed or was marked posted. Refresh the list before editing.");
    }
    if (videoId === expectedVideoId) return true;
    if (videoId !== null) assertOwnedVideo(userId, videoId);
    if ((current.mediaIds?.length ?? 0) > imageLimitForDestination(current.destination, videoId !== null)) {
      throw new Error("Select fewer images for this platform before attaching a video.");
    }
    const updated: AssistedPost = { ...current };
    if (videoId === null) delete updated.videoId;
    else updated.videoId = videoId as string;
    db.prepare("UPDATE assisted SET payload=?,updated_at=? WHERE id=? AND user_id=?")
      .run(JSON.stringify(updated), new Date().toISOString(), id, userId);
    audit(userId, "assisted.video_changed", id);
    return true;
  });
}

/** Change one queued handoff's images without altering its source draft or sibling handoffs. */
export function updateAssistedImages(userId: string, id: string, expectedMediaIds: unknown, expectedMediaAlt: unknown, mediaIds: unknown, mediaAlt: unknown): boolean {
  if (!validId(id) || !validMediaAlt(expectedMediaAlt, expectedMediaIds) || !validMediaAlt(mediaAlt, mediaIds)) {
    throw new Error("Choose up to 20 distinct images and provide a description for each selection.");
  }
  const previousIds = expectedMediaIds as string[];
  const nextIds = mediaIds as string[];
  return transaction((db) => {
    const row = db.prepare("SELECT payload FROM assisted WHERE id=? AND user_id=?").get(id, userId) as DraftRow | undefined;
    if (!row) throw new AssistedConflictError("This handoff is no longer available. Refresh the list before editing.");
    const current = JSON.parse(row.payload) as AssistedPost;
    if (nextIds.length > imageLimitForDestination(current.destination, Boolean(current.videoId))) {
      throw new Error("Select fewer images for this platform before preparing its handoff.");
    }
    const savedIds = current.mediaIds ?? [];
    const savedAlt = current.mediaAlt ?? savedIds.map(() => "");
    if (current.status !== "queued" || savedIds.some((value, index) => value !== previousIds[index]) ||
        savedIds.length !== previousIds.length || savedAlt.some((value, index) => value !== expectedMediaAlt[index])) {
      throw new AssistedConflictError("The handoff images changed or it was marked posted. Refresh the list before editing.");
    }
    if (savedIds.length === nextIds.length && savedIds.every((value, index) => value === nextIds[index] && savedAlt[index] === mediaAlt[index])) return true;
    assertOwnedMedia(userId, nextIds);
    const stamp = new Date().toISOString();
    const updated: AssistedPost = { ...current, mediaIds: [...nextIds], mediaAlt: [...mediaAlt] };
    db.prepare("UPDATE assisted SET payload=?,updated_at=? WHERE id=? AND user_id=?")
      .run(JSON.stringify(updated), stamp, id, userId);
    audit(userId, "assisted.images_changed", id);
    return true;
  });
}

/** Correct descriptions on a queued manual handoff without changing its images or source draft. */
export function updateAssistedMediaAlt(userId: string, id: string, expectedMediaIds: unknown, expectedMediaAlt: unknown, mediaAlt: unknown): boolean {
  if (!validId(id)) throw new Error("Invalid handoff ID.");
  if (!validMediaIds(expectedMediaIds)) {
    throw new AssistedConflictError("This image editor is out of date. Reload the page before editing descriptions.");
  }
  if (!validMediaAlt(expectedMediaAlt, expectedMediaIds) || !validMediaAlt(mediaAlt, expectedMediaIds)) {
    throw new Error("Provide one description of up to 500 characters for each saved image.");
  }
  return transaction((db) => {
    const row = db.prepare("SELECT payload FROM assisted WHERE id=? AND user_id=?").get(id, userId) as DraftRow | undefined;
    if (!row) throw new AssistedConflictError("This handoff is no longer available. Refresh the list before editing.");
    const current = JSON.parse(row.payload) as AssistedPost;
    const savedIds = current.mediaIds ?? [];
    const savedDescriptions = current.mediaAlt ?? savedIds.map(() => "");
    if (current.status !== "queued" || savedIds.length !== expectedMediaIds.length ||
        savedIds.some((imageId, index) => imageId !== expectedMediaIds[index]) ||
        savedDescriptions.some((description, index) => description !== expectedMediaAlt[index])) {
      throw new AssistedConflictError("The handoff images or descriptions changed, or it was marked posted. Refresh the list before editing.");
    }
    if (!savedIds.length) throw new Error("This handoff has no saved images to describe.");
    if (savedDescriptions.every((description, index) => description === mediaAlt[index])) return true;
    const stamp = new Date().toISOString();
    db.prepare("UPDATE assisted SET payload=?,updated_at=? WHERE id=? AND user_id=?")
      .run(JSON.stringify({ ...current, mediaAlt: [...mediaAlt] }), stamp, id, userId);
    audit(userId, "assisted.image_descriptions_edited", id);
    return true;
  });
}

/** Move only a pending handoff; retain its reviewed text, media and source draft. */
export function rescheduleAssisted(userId: string, id: string, expectedScheduledFor: unknown, scheduledFor: unknown): boolean {
  if (!validId(id) || !validUtcInstant(expectedScheduledFor) || (scheduledFor !== null && !validFutureUtc(scheduledFor))) {
    throw new Error("Choose a valid future UTC reminder time and refresh the item before moving it.");
  }
  return transaction((db) => {
    const row = db.prepare("SELECT payload FROM assisted WHERE id=? AND user_id=?").get(id, userId) as DraftRow | undefined;
    if (!row) throw new AssistedConflictError();
    const current = JSON.parse(row.payload) as AssistedPost;
    if (current.status !== "queued" || current.scheduledFor !== expectedScheduledFor) throw new AssistedConflictError();
    if ((scheduledFor === null && !hasManualReminder(current)) ||
        (scheduledFor === current.scheduledFor && hasManualReminder(current))) return true;
    const stamp = new Date().toISOString();
    const updated: AssistedPost = { ...current, scheduledFor: scheduledFor ?? stamp, reminderEnabled: scheduledFor !== null };
    delete updated.notifiedAt;
    db.prepare("UPDATE assisted SET payload=?,scheduled_for=?,updated_at=? WHERE id=? AND user_id=?")
      .run(JSON.stringify(updated), updated.scheduledFor, stamp, id, userId);
    audit(userId, scheduledFor === null ? "assisted.reminder_removed" : "assisted.rescheduled", id, scheduledFor ?? undefined);
    return true;
  });
}

/** Saves or clears owner-entered feedback without changing the human posting receipt. */
export function setAssistedOutcome(userId: string, id: string, outcome: unknown, expectedReceipt?: unknown): boolean {
  if (!validId(id)) throw new Error("Invalid assisted item ID.");
  const parsed = outcome === null ? null : parseAssistedOutcomeInput(outcome);
  if (outcome !== null && !parsed) {
    throw new Error("Enter at least one result. Counts must be whole numbers from 0 to 1,000,000,000; notes may be up to 500 characters.");
  }
  return transaction((db) => {
    const row = db.prepare("SELECT payload FROM assisted WHERE id=? AND user_id=?").get(id, userId) as DraftRow | undefined;
    if (!row) return false;
    const current = JSON.parse(row.payload) as AssistedPost;
    if (current.status !== "posted") throw new Error("Mark the item posted before recording results.");
    if (!isRecord(expectedReceipt) || JSON.stringify(expectedReceipt) !== JSON.stringify(assistedReceiptSnapshot(current))) {
      throw new AssistedConflictError("This posted record changed in another window. Review its latest link and results before editing it.");
    }
    if (parsed === null && !current.outcome) return true;
    if (parsed !== null && current.outcome) {
      const existing = Object.fromEntries(Object.entries(current.outcome).filter(([key]) => key !== "recordedAt"));
      if (JSON.stringify(existing) === JSON.stringify(parsed)) return true;
    }
    const updated: AssistedPost = { ...current };
    if (parsed === null) delete updated.outcome;
    else updated.outcome = { ...parsed, recordedAt: new Date().toISOString() };
    db.prepare("UPDATE assisted SET payload=?,updated_at=? WHERE id=? AND user_id=?")
      .run(JSON.stringify(updated), new Date().toISOString(), id, userId);
    audit(userId, parsed === null ? "assisted.outcome_cleared" : "assisted.outcome_recorded", id);
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
      if (item.status !== "queued" || !hasManualReminder(item) || item.notifiedAt || Date.parse(item.scheduledFor) > Date.parse(stamp)) continue;
      db.prepare("UPDATE assisted SET payload=?,updated_at=? WHERE id=? AND user_id=?")
        .run(JSON.stringify({ ...item, notifiedAt: stamp }), stamp, id, userId);
    }
  });
}

export function deleteAssisted(userId: string, id: string, expectedState: unknown): boolean {
  if (!validId(id)) return false;
  return transaction((db) => {
    const row = db.prepare("SELECT payload FROM assisted WHERE id=? AND user_id=?").get(id, userId) as DraftRow | undefined;
    if (!row) return false;
    const current = JSON.parse(row.payload) as AssistedPost;
    if (!isRecord(expectedState) || JSON.stringify(expectedState) !== JSON.stringify(assistedDeletionSnapshot(current))) {
      throw new AssistedConflictError("This handoff changed in another window. Review its latest version before removing it.");
    }
    db.prepare("DELETE FROM assisted WHERE id=? AND user_id=?").run(id, userId);
    audit(userId, "assisted.deleted", id);
    return true;
  });
}

export function migrateAssisted(userId: string, raw: unknown): "imported" | "skipped" {
  if (!Array.isArray(raw) || raw.length > 100) throw new Error("Invalid assisted migration.");
  const items = raw.map(validAssisted);
  if (items.some((item) => !item || !validId(item.id)) || new Set(items.map((item) => item?.id)).size !== items.length) {
    throw new Error("Invalid assisted migration.");
  }
  return transaction((db) => {
    for (const item of items as AssistedPost[]) {
      assertOwnedMedia(userId, item.mediaIds ?? []);
      assertOwnedVideo(userId, item.videoId);
    }
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

export class DraftConflictError extends Error {
  constructor(message = "This draft changed or was deleted in another window. Review the latest saved copy or save your edits as a new draft.") { super(message); }
}

export class ScheduleConflictError extends Error {
  constructor() { super("This plan item changed in another window. Review the latest version before moving, retrying or deleting it."); }
}

export class WorkspaceConflictError extends Error {
  constructor() { super("Saved work changed after you reviewed the backup. Reload the latest workspace before importing again."); }
}

export function saveDraft(userId: string, value: unknown, expectedUpdatedAt: unknown = null): SavedDraft {
  const draft = validDraft(value);
  if (!draft || !/^[a-f0-9-]{36}$/i.test(draft.id)) throw new Error("Invalid draft.");
  if (!hasDraftContent(draft)) throw new Error("Add a title, caption, platform text, image or video before saving.");
  const titleSource = draft.source.trim() || platformIds.map((id) => draft.variants[id]?.trim()).find(Boolean) || "";
  transaction((db) => {
    assertOwnedMedia(userId, draft.mediaIds ?? []);
    assertOwnedVideo(userId, draft.videoId);
    const existing = db.prepare("SELECT user_id, payload FROM drafts WHERE id=?").get(draft.id) as { user_id: string; payload: string } | undefined;
    if (existing && existing.user_id !== userId) throw new Error("Draft not found.");
    const previous = existing ? JSON.parse(existing.payload) as SavedDraft : null;
    if ((previous && expectedUpdatedAt !== previous.updatedAt) || (!previous && expectedUpdatedAt !== null)) throw new DraftConflictError();
    const count = db.prepare("SELECT COUNT(*) AS count FROM drafts WHERE user_id=?").get(userId) as { count: number };
    if (!existing && count.count >= 100) throw new Error("Draft library is full.");
    const updatedAt = new Date(Math.max(Date.now(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString();
    const normalized = { ...draft, title: draftTitle(draft.title, titleSource), createdAt: previous?.createdAt ?? updatedAt, updatedAt };
    db.prepare("INSERT INTO drafts(id,user_id,payload,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at")
      .run(normalized.id, userId, JSON.stringify(normalized), normalized.updatedAt);
    audit(userId, existing ? "draft.updated" : "draft.created", draft.id);
    Object.assign(draft, normalized);
  });
  return draft;
}

export function setDraftTargetDate(userId: string, id: unknown, expectedUpdatedAt: unknown, plannedDate: unknown): SavedDraft {
  if (typeof id !== "string" || !validUuid(id) || typeof expectedUpdatedAt !== "string" ||
      (plannedDate !== null && !validCalendarDate(plannedDate))) {
    throw new Error("Choose a real target date or clear it.");
  }
  return transaction((db) => {
    const row = db.prepare("SELECT payload FROM drafts WHERE id=? AND user_id=?").get(id, userId) as DraftRow | undefined;
    if (!row) throw new DraftConflictError("This draft was deleted or is no longer available. Refresh your drafts before planning it.");
    const previous = JSON.parse(row.payload) as SavedDraft;
    if (previous.updatedAt !== expectedUpdatedAt) throw new DraftConflictError();
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(previous.updatedAt) + 1)).toISOString();
    const updated: SavedDraft = { ...previous, updatedAt };
    if (plannedDate === null) delete updated.plannedDate;
    else updated.plannedDate = plannedDate as string;
    db.prepare("UPDATE drafts SET payload=?,updated_at=? WHERE id=? AND user_id=?")
      .run(JSON.stringify(updated), updatedAt, id, userId);
    audit(userId, "draft.target_date_changed", id);
    return updated;
  });
}

export function deleteDraft(userId: string, id: string, expectedUpdatedAt: unknown) {
  return transaction((db) => {
    const row = db.prepare("SELECT payload FROM drafts WHERE id=? AND user_id=?").get(id, userId) as { payload: string } | undefined;
    if (!row) return false;
    if ((JSON.parse(row.payload) as SavedDraft).updatedAt !== expectedUpdatedAt) {
      throw new DraftConflictError("This draft changed in another window. Review the latest library version before deleting.");
    }
    db.prepare("DELETE FROM drafts WHERE id=? AND user_id=?").run(id, userId);
    audit(userId, "draft.deleted", id);
    return true;
  });
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

export function deleteSchedule(userId: string, id: string, expectedRevision: unknown) {
  if (!validId(id)) return false;
  return transaction((db) => {
    const row = db.prepare(`SELECT ${jobColumns} FROM jobs WHERE id=? AND user_id=?`).get(id, userId) as JobRow | undefined;
    if (!row) return false;
    assertCurrentJob(row, expectedRevision);
    if (row.status === "running") return false;
    db.prepare("DELETE FROM jobs WHERE id=? AND user_id=?").run(id, userId);
    audit(userId, "schedule.deleted", id);
    return true;
  });
}

export function retrySchedule(userId: string, id: string, expectedRevision: unknown) {
  if (!validId(id)) return false;
  return transaction((db) => {
    const row = db.prepare(`SELECT ${jobColumns} FROM jobs WHERE id=? AND user_id=?`).get(id, userId) as JobRow | undefined;
    if (!row) return false;
    assertCurrentJob(row, expectedRevision);
    if (row.status !== "failed") return false;
    db.prepare("UPDATE jobs SET status='queued',attempts=0,next_attempt_at=?,last_error=NULL WHERE id=? AND user_id=?")
      .run(new Date().toISOString(), id, userId);
    audit(userId, "schedule.retried", id);
    return true;
  });
}

export function rescheduleSchedule(userId: string, id: string, scheduledFor: unknown, timezone: unknown, expectedRevision: unknown): boolean {
  if (!validId(id) || !validFutureUtc(scheduledFor) || !validTimezone(timezone)) {
    throw new Error("Choose a valid UTC time at least 10 seconds ahead and a recognized timezone.");
  }
  return transaction((db) => {
    const row = db.prepare(`SELECT ${jobColumns} FROM jobs WHERE id=? AND user_id=?`)
      .get(id, userId) as JobRow | undefined;
    if (!row) return false;
    assertCurrentJob(row, expectedRevision);
    if (row.status !== "queued" && row.status !== "failed") return false;
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

type ImportMode = "replace-all" | "preserve-assisted" | "merge-legacy";

function importWorkspace(userId: string, raw: unknown, mode: ImportMode, expectedRevision?: unknown) {
  const workspace = parseWorkspace(raw);
  if (!workspace || !raw || typeof raw !== "object" || !Array.isArray((raw as { drafts?: unknown }).drafts) || !Array.isArray((raw as { schedule?: unknown }).schedule) ||
      workspace.drafts.length !== (raw as { drafts: unknown[] }).drafts.length ||
      workspace.schedule.length !== (raw as { schedule: unknown[] }).schedule.length ||
      ((raw as { version?: unknown }).version === 3 && !Array.isArray((raw as { assisted?: unknown }).assisted)) ||
      (Array.isArray((raw as { assisted?: unknown }).assisted) && workspace.assisted.length !== (raw as { assisted: unknown[] }).assisted.length)) throw new Error("Invalid workspace backup.");
  const ids = [...workspace.drafts, ...workspace.schedule, ...workspace.assisted].map((item) => item.id);
  if (new Set(ids).size !== ids.length || ids.some((id) => !/^[a-f0-9-]{36}$/i.test(id))) throw new Error("Backup has invalid IDs.");
  const replaceSaved = mode !== "merge-legacy" || workspace.drafts.length > 0 || workspace.schedule.length > 0;
  listMedia(userId);
  listVideos(userId);
  transaction((db) => {
    if (expectedRevision !== undefined &&
        (typeof expectedRevision !== "string" || workspaceDataRevision(db, userId) !== expectedRevision)) {
      throw new WorkspaceConflictError();
    }
    let missingAssisted: AssistedPost[] = [];
    if (mode === "merge-legacy") {
      for (const item of workspace.assisted) {
        assertOwnedMedia(userId, item.mediaIds ?? []);
        assertOwnedVideo(userId, item.videoId);
      }
      const count = db.prepare("SELECT COUNT(*) AS count FROM assisted WHERE user_id=?").get(userId) as { count: number };
      missingAssisted = workspace.assisted.filter((item) => {
        const existing = db.prepare("SELECT user_id FROM assisted WHERE id=?").get(item.id) as { user_id: string } | undefined;
        if (existing && existing.user_id !== userId) throw new Error("A browser handoff belongs to another account.");
        return !existing;
      });
      if (count.count + missingAssisted.length > 100) throw new Error("Assisted publishing list is full.");
    }
    if (replaceSaved) {
      const existingDraftVersions = new Map((db.prepare("SELECT id,payload FROM drafts WHERE user_id=?").all(userId) as { id: string; payload: string }[])
        .map((row) => [row.id, (JSON.parse(row.payload) as SavedDraft).updatedAt]));
      // A text workspace backup has no weekly plans; replacing its drafts invalidates approved idea links.
      db.prepare("DELETE FROM weekly_plans WHERE user_id=?").run(userId);
      db.prepare("DELETE FROM drafts WHERE user_id=?").run(userId);
      db.prepare("DELETE FROM jobs WHERE user_id=? AND status != 'running'").run(userId);
      const running = db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE user_id=?").get(userId) as { count: number };
      if (running.count) throw new Error("Wait for running jobs before importing.");
      for (const draft of workspace.drafts) {
        assertOwnedMedia(userId, draft.mediaIds ?? []);
        assertOwnedVideo(userId, draft.videoId);
        const previousVersion = existingDraftVersions.get(draft.id);
        const updatedAt = new Date(Math.max(Date.now(), Date.parse(draft.updatedAt) + 1,
          previousVersion ? Date.parse(previousVersion) + 1 : 0)).toISOString();
        const imported = { ...draft, updatedAt };
        db.prepare("INSERT INTO drafts(id,user_id,payload,updated_at) VALUES (?,?,?,?)")
          .run(draft.id, userId, JSON.stringify(imported), updatedAt);
      }
      for (const post of workspace.schedule) {
        assertOwnedMedia(userId, post.mediaIds ?? []);
        const status = post.status === "simulated" ? "simulated" : "queued";
        db.prepare("INSERT INTO jobs(id,user_id,payload,scheduled_for,timezone,status,next_attempt_at,completed_at,receipts) VALUES (?,?,?,?,?,?,?,?,?)")
          .run(post.id, userId, JSON.stringify(post), post.scheduledFor, "UTC", status, post.scheduledFor, post.simulatedAt ?? null, JSON.stringify(post.receipts ?? []));
      }
    }
    if (mode === "replace-all") {
      db.prepare("DELETE FROM assisted WHERE user_id=?").run(userId);
      for (const item of workspace.assisted) {
        assertOwnedMedia(userId, item.mediaIds ?? []);
        assertOwnedVideo(userId, item.videoId);
        db.prepare("INSERT INTO assisted(id,user_id,payload,scheduled_for,updated_at) VALUES (?,?,?,?,?)")
          .run(item.id, userId, JSON.stringify(item), item.scheduledFor, new Date().toISOString());
      }
    } else if (mode === "merge-legacy") {
      const stamp = new Date().toISOString();
      for (const item of missingAssisted) {
        db.prepare("INSERT INTO assisted(id,user_id,payload,scheduled_for,updated_at) VALUES (?,?,?,?,?)")
          .run(item.id, userId, JSON.stringify(item), item.scheduledFor, stamp);
      }
    }
    audit(userId, mode === "replace-all" ? "workspace.imported" : "workspace.legacy_imported", randomUUID(),
      `${replaceSaved ? workspace.drafts.length : "preserved"} drafts; ${replaceSaved ? workspace.schedule.length : "preserved"} jobs; ${mode === "replace-all" ? workspace.assisted.length : mode === "merge-legacy" ? missingAssisted.length + " merged" : "preserved"} assisted`);
  });
  return workspace;
}

export function importLibrary(userId: string, raw: unknown, expectedRevision?: unknown) {
  return importWorkspace(userId, raw, "replace-all", expectedRevision);
}

export function importLegacyLibrary(userId: string, raw: unknown, expectedRevision?: unknown) {
  return importWorkspace(userId, raw, "preserve-assisted", expectedRevision);
}

/** Explicitly merge the old browser handoffs with an optional draft/plan replacement. */
export function migrateLegacyBrowserWorkspace(userId: string, raw: unknown, expectedRevision?: unknown) {
  return importWorkspace(userId, raw, "merge-legacy", expectedRevision);
}

type AiQuotaDecision = { allowed: true } | { allowed: false; status: 429 | 503; error: string };

export function reserveAiRequest(userId: string, now = Date.now()): AiQuotaDecision {
  const rawDailyLimit = process.env.PLYPOST_AI_DAILY_LIMIT?.trim();
  const dailyLimit = rawDailyLimit && /^[1-9]\d*$/.test(rawDailyLimit) ? Number(rawDailyLimit) : null;
  if (rawDailyLimit && (dailyLimit === null || !Number.isSafeInteger(dailyLimit) || dailyLimit > 240)) {
    return { allowed: false, status: 503, error: "AI daily limit is misconfigured. Set PLYPOST_AI_DAILY_LIMIT to a whole number from 1 to 240." };
  }
  return transaction((db) => {
    const hourSince = new Date(now - 60 * 60_000).toISOString();
    const daySince = new Date(now - 24 * 60 * 60_000).toISOString();
    db.prepare("DELETE FROM ai_usage WHERE created_at < ?").run(daySince);
    const hourly = db.prepare("SELECT COUNT(*) AS count FROM ai_usage WHERE user_id=? AND created_at>=?")
      .get(userId, hourSince) as { count: number };
    if (hourly.count >= 10) return { allowed: false, status: 429, error: "AI limit reached: 10 requests per hour. Try again later." };
    if (dailyLimit !== null) {
      const daily = db.prepare("SELECT COUNT(*) AS count FROM ai_usage WHERE user_id=? AND created_at>=?")
        .get(userId, daySince) as { count: number };
      if (daily.count >= dailyLimit) return { allowed: false, status: 429, error: `AI demo limit reached: ${dailyLimit} requests per 24 hours. Try again later.` };
    }
    db.prepare("INSERT INTO ai_usage(user_id,created_at) VALUES (?,?)").run(userId, new Date(now).toISOString());
    return { allowed: true };
  });
}

export function receiptPlatforms(post: ScheduledPost): string[] {
  return platformIds.filter((id) => post.posts[id] !== undefined);
}
