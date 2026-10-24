import { characterCount, isPlatformId, platformIds, platforms, type PlatformId } from "./platforms.ts";
import { validatePlatformText } from "./platform-validation.ts";
import { isAssistedDestinationId, type AssistedDestinationId } from "./assisted.ts";

export const WORKSPACE_KEY = "socialflow-workspace-v2";

export type SavedDraft = {
  id: string;
  title: string;
  source: string;
  selected: PlatformId[];
  variants: Partial<Record<PlatformId, string>>;
  mediaIds?: string[];
  /** Optional image descriptions, in the same order as mediaIds. */
  mediaAlt?: string[];
  /** A private clip for manual handoffs; simulated and live text publishers ignore it. */
  videoId?: string;
  /** A local calendar day for planning this draft; it never queues a post or reminder. */
  plannedDate?: string;
  createdAt: string;
  updatedAt: string;
};

export type ScheduledPost = {
  id: string;
  title: string;
  source: string;
  posts: Partial<Record<PlatformId, string>>;
  mediaIds?: string[];
  mediaAlt?: string[];
  scheduledFor: string;
  createdAt: string;
  status: "queued" | "running" | "simulated" | "failed";
  simulatedAt?: string;
  attempts?: number;
  nextAttemptAt?: string;
  lastError?: string;
  receipts?: { platform: string; id: string; status: string; publishedAt: string; content: string }[];
};

export type AssistedPost = {
  id: string;
  title: string;
  destination: AssistedDestinationId;
  text: string;
  mediaIds?: string[];
  mediaAlt?: string[];
  /** A private clip for manual handoff; publishing adapters never upload it. */
  videoId?: string;
  /** Present together for handoffs prepared from a saved draft. */
  sourceDraftId?: string;
  batchId?: string;
  scheduledFor: string;
  /** Older handoffs have a reminder. False means this is only a publishing checklist item. */
  reminderEnabled?: boolean;
  createdAt: string;
  status: "queued" | "posted";
  postedAt?: string;
  postUrl?: string;
  outcome?: AssistedOutcome;
  notifiedAt?: string;
  /** The saved handoff text was revised after this item was prepared. */
  contentEditedAt?: string;
};

export type AssistedOutcomeInput = {
  views?: number;
  likes?: number;
  replies?: number;
  notes?: string;
};

/** Results entered by the account owner; these numbers are not verified with a platform. */
export type AssistedOutcome = AssistedOutcomeInput & { recordedAt: string };

export const MAX_ASSISTED_OUTCOME_COUNT = 1_000_000_000;
export const MAX_ASSISTED_OUTCOME_NOTES = 500;
export const MAX_IMAGE_ALT_CHARS = 500;

export type Workspace = {
  version: 3;
  drafts: SavedDraft[];
  schedule: ScheduledPost[];
  assisted: AssistedPost[];
};

export const emptyWorkspace = (): Workspace => ({ version: 3, drafts: [], schedule: [], assisted: [] });

/** An idea can be saved before its main caption is ready. */
export function hasDraftContent(value: {
  title: string;
  source: string;
  variants: Partial<Record<PlatformId, string>>;
  mediaIds?: readonly string[];
  videoId?: string | null;
}): boolean {
  return Boolean(value.title.trim() || value.source.trim() || value.mediaIds?.length || value.videoId ||
    platformIds.some((id) => value.variants[id]?.trim()));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const validDate = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

const validUtcInstant = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(new Date(value).getTime()) && new Date(value).toISOString() === value;
export const validCalendarDate = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9]\d{3}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T12:00:00.000Z`)) &&
  new Date(`${value}T12:00:00.000Z`).toISOString().slice(0, 10) === value;
const validUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value);

/** Strictly validates user-entered results. An explicit zero is a valid observation. */
export function parseAssistedOutcomeInput(value: unknown): AssistedOutcomeInput | null {
  if (!isRecord(value) || Object.keys(value).some((key) => !["views", "likes", "replies", "notes"].includes(key))) return null;
  const parsed: AssistedOutcomeInput = {};
  for (const key of ["views", "likes", "replies"] as const) {
    if (value[key] === undefined) continue;
    const count = value[key];
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || count > MAX_ASSISTED_OUTCOME_COUNT) return null;
    parsed[key] = count;
  }
  if (value.notes !== undefined) {
    if (typeof value.notes !== "string" || !value.notes.trim() || value.notes !== value.notes.trim() ||
        characterCount(value.notes) > MAX_ASSISTED_OUTCOME_NOTES || [...value.notes].some((character) => {
          const code = character.codePointAt(0) ?? 0;
          return code <= 8 || (code >= 11 && code <= 31) || code === 127;
        })) return null;
    parsed.notes = value.notes;
  }
  return Object.keys(parsed).length ? parsed : null;
}

function parseAssistedOutcome(value: unknown): AssistedOutcome | null {
  if (!isRecord(value) || !validUtcInstant(value.recordedAt)) return null;
  const input = { ...value };
  delete input.recordedAt;
  const parsed = parseAssistedOutcomeInput(input);
  return parsed ? { ...parsed, recordedAt: value.recordedAt } : null;
}

/** Checks the shape of a public HTTPS post link. This does not verify that a post exists. */
export function normalizePublicPostUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length > 2048 || !/^https:\/\/\S+$/i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (url.protocol !== "https:" || url.username || url.password || !hostname.includes(".") ||
        /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":") ||
        /(?:^|\.)(?:localhost|local|internal)$/.test(hostname) ||
        (url.pathname === "/" && !url.search) || url.toString().length > 2048) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function validMediaIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 4 && new Set(value).size === value.length &&
    value.every((id) => typeof id === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id));
}

export function validMediaAlt(value: unknown, mediaIds: unknown): value is string[] {
  return validMediaIds(mediaIds) && Array.isArray(value) && value.length === mediaIds.length &&
    value.every((description) => typeof description === "string" &&
      description === description.trim() && description.length <= MAX_IMAGE_ALT_CHARS &&
      !Array.from(description).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127));
}

function selectedPlatforms(value: unknown): PlatformId[] {
  if (!Array.isArray(value)) return [];
  return platformIds.filter((id) => value.includes(id));
}

function validVariants(value: unknown): Partial<Record<PlatformId, string>> {
  if (!isRecord(value)) return {};
  const variants: Partial<Record<PlatformId, string>> = {};
  for (const id of platformIds) {
    if (typeof value[id] === "string" && characterCount(value[id]) <= 5000) {
      variants[id] = value[id];
    }
  }
  return variants;
}

function validReceipts(value: unknown): NonNullable<ScheduledPost["receipts"]> | null {
  if (!Array.isArray(value) || value.length > 4) return null;
  const receipts = value.filter((item) =>
    isRecord(item) && isPlatformId(item.platform) &&
    typeof item.id === "string" && item.id.length <= 120 &&
    item.status === "simulated" && validUtcInstant(item.publishedAt) &&
    typeof item.content === "string" &&
    (validatePlatformText(item.platform, item.content).valid || characterCount(item.content) <= platforms[item.platform].limit),
  ).map((item) => ({
    platform: item.platform as PlatformId,
    id: item.id as string,
    status: "simulated",
    publishedAt: item.publishedAt as string,
    content: item.content as string,
  }));
  return receipts.length === value.length && new Set(receipts.map((item) => item.platform)).size === receipts.length ? receipts : null;
}

function parseDraft(value: unknown): SavedDraft | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id ||
      typeof value.title !== "string" || typeof value.source !== "string" ||
      characterCount(value.title) > 120 || characterCount(value.source) > 3000 ||
      !validDate(value.createdAt) || !validDate(value.updatedAt)) return null;
  if (value.mediaIds !== undefined && !validMediaIds(value.mediaIds)) return null;
  if (value.mediaAlt !== undefined && !validMediaAlt(value.mediaAlt, value.mediaIds)) return null;
  if (value.videoId !== undefined && !validUuid(value.videoId)) return null;
  if (value.plannedDate !== undefined && !validCalendarDate(value.plannedDate)) return null;
  return {
    id: value.id,
    title: value.title,
    source: value.source,
    selected: selectedPlatforms(value.selected),
    variants: validVariants(value.variants),
    ...(value.mediaIds !== undefined ? { mediaIds: value.mediaIds as string[] } : {}),
    ...(value.mediaAlt !== undefined ? { mediaAlt: value.mediaAlt as string[] } : {}),
    ...(value.videoId !== undefined ? { videoId: value.videoId as string } : {}),
    ...(value.plannedDate !== undefined ? { plannedDate: value.plannedDate as string } : {}),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseScheduledPost(value: unknown): ScheduledPost | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id ||
      typeof value.title !== "string" || characterCount(value.title) > 120 ||
      typeof value.source !== "string" || characterCount(value.source) > 3000 ||
    !validUtcInstant(value.scheduledFor) || !validDate(value.createdAt) ||
      (value.status !== "queued" && value.status !== "running" && value.status !== "simulated" && value.status !== "failed") ||
      !isRecord(value.posts)) return null;
  if (value.mediaIds !== undefined && !validMediaIds(value.mediaIds)) return null;
  if (value.mediaAlt !== undefined && !validMediaAlt(value.mediaAlt, value.mediaIds)) return null;
  const posts: Partial<Record<PlatformId, string>> = {};
  for (const id of Object.keys(value.posts)) {
    if (!isPlatformId(id)) return null;
    const text = value.posts[id];
    if (typeof text !== "string" || !text.trim() ||
        (!validatePlatformText(id, text).valid && characterCount(text) > platforms[id].limit)) return null;
    posts[id] = text;
  }
  if (!Object.keys(posts).length) return null;
  const receipts = value.receipts === undefined ? undefined : validReceipts(value.receipts);
  if (receipts === null || receipts?.some((receipt) => posts[receipt.platform as PlatformId] !== receipt.content)) return null;
  return {
    id: value.id,
    title: value.title,
    source: value.source,
    posts,
    ...(value.mediaIds !== undefined ? { mediaIds: value.mediaIds as string[] } : {}),
    ...(value.mediaAlt !== undefined ? { mediaAlt: value.mediaAlt as string[] } : {}),
    scheduledFor: value.scheduledFor,
    createdAt: value.createdAt,
    status: value.status,
    ...(value.status === "simulated" && validDate(value.simulatedAt) ? { simulatedAt: value.simulatedAt } : {}),
    ...(typeof value.attempts === "number" ? { attempts: value.attempts } : {}),
    ...(validDate(value.nextAttemptAt) ? { nextAttemptAt: value.nextAttemptAt } : {}),
    ...(typeof value.lastError === "string" ? { lastError: value.lastError } : {}),
    ...(receipts ? { receipts } : {}),
  };
}

function parseAssistedPost(value: unknown): AssistedPost | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id ||
      typeof value.title !== "string" || characterCount(value.title) > 120 ||
      !isAssistedDestinationId(value.destination) ||
      typeof value.text !== "string" || !value.text.trim() || characterCount(value.text) > 5000 ||
      !validUtcInstant(value.scheduledFor) || !validDate(value.createdAt) ||
      (value.status !== "queued" && value.status !== "posted")) return null;
  if ((value.sourceDraftId !== undefined || value.batchId !== undefined) &&
      (!validUuid(value.sourceDraftId) || !validUuid(value.batchId))) return null;
  if (value.mediaIds !== undefined && !validMediaIds(value.mediaIds)) return null;
  if (value.mediaAlt !== undefined && !validMediaAlt(value.mediaAlt, value.mediaIds)) return null;
  if (value.videoId !== undefined && !validUuid(value.videoId)) return null;
  if (value.reminderEnabled !== undefined && typeof value.reminderEnabled !== "boolean") return null;
  if (value.contentEditedAt !== undefined && !validUtcInstant(value.contentEditedAt)) return null;
  if (value.postUrl !== undefined && (value.status !== "posted" ||
      normalizePublicPostUrl(value.postUrl) !== value.postUrl)) return null;
  const outcome = value.outcome === undefined ? undefined : parseAssistedOutcome(value.outcome);
  if (outcome === null || (outcome !== undefined &&
      (value.status !== "posted" || !validUtcInstant(value.postedAt)))) return null;
  return {
    id: value.id,
    title: value.title,
    destination: value.destination,
    text: value.text,
    ...(value.mediaIds !== undefined ? { mediaIds: value.mediaIds as string[] } : {}),
    ...(value.mediaAlt !== undefined ? { mediaAlt: value.mediaAlt as string[] } : {}),
    ...(value.videoId !== undefined ? { videoId: value.videoId as string } : {}),
    ...(value.sourceDraftId !== undefined ? { sourceDraftId: value.sourceDraftId as string, batchId: value.batchId as string } : {}),
    scheduledFor: value.scheduledFor,
    ...(value.reminderEnabled !== undefined ? { reminderEnabled: value.reminderEnabled as boolean } : {}),
    createdAt: value.createdAt,
    status: value.status,
    ...(value.status === "posted" && validDate(value.postedAt) ? { postedAt: value.postedAt } : {}),
    ...(value.postUrl !== undefined ? { postUrl: value.postUrl as string } : {}),
    ...(outcome !== undefined ? { outcome } : {}),
    ...(validDate(value.notifiedAt) ? { notifiedAt: value.notifiedAt } : {}),
    ...(value.contentEditedAt !== undefined ? { contentEditedAt: value.contentEditedAt as string } : {}),
  };
}

export function parseWorkspace(value: unknown): Workspace | null {
  if (!isRecord(value) || (value.version !== 2 && value.version !== 3) ||
      !Array.isArray(value.drafts) || !Array.isArray(value.schedule) ||
      (value.version === 3 && !Array.isArray(value.assisted))) return null;
  return {
    version: 3,
    drafts: value.drafts.slice(0, 100).map(parseDraft).filter((draft): draft is SavedDraft => draft !== null),
    schedule: value.schedule.slice(0, 100).map(parseScheduledPost).filter((post): post is ScheduledPost => post !== null),
    assisted: value.version === 3 && Array.isArray(value.assisted)
      ? value.assisted.slice(0, 100).map(parseAssistedPost).filter((post): post is AssistedPost => post !== null)
      : [],
  };
}

export function draftTitle(title: string, source: string): string {
  return (title.trim() || source.trim().split(/\r?\n/)[0] || "Untitled draft").slice(0, 120);
}

export function scheduleState(post: ScheduledPost, now: number): "upcoming" | "due" | "running" | "failed" | "simulated" {
  if (post.status === "simulated") return "simulated";
  if (post.status === "running") return "running";
  if (post.status === "failed") return "failed";
  const next = post.nextAttemptAt && validUtcInstant(post.nextAttemptAt) ? post.nextAttemptAt : post.scheduledFor;
  return Date.parse(next) <= now ? "due" : "upcoming";
}

export function hasManualReminder(post: AssistedPost): boolean {
  return post.reminderEnabled !== false;
}

export function assistedState(post: AssistedPost, now: number): "unscheduled" | "upcoming" | "due" | "posted" {
  if (post.status === "posted") return "posted";
  if (!hasManualReminder(post)) return "unscheduled";
  return Date.parse(post.scheduledFor) <= now ? "due" : "upcoming";
}

export function localDateTimeValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
