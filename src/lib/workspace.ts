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
  createdAt: string;
  updatedAt: string;
};

export type ScheduledPost = {
  id: string;
  title: string;
  source: string;
  posts: Partial<Record<PlatformId, string>>;
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
  scheduledFor: string;
  createdAt: string;
  status: "queued" | "posted";
  postedAt?: string;
  notifiedAt?: string;
};

export type Workspace = {
  version: 3;
  drafts: SavedDraft[];
  schedule: ScheduledPost[];
  assisted: AssistedPost[];
};

export const emptyWorkspace = (): Workspace => ({ version: 3, drafts: [], schedule: [], assisted: [] });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const validDate = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

const validUtcInstant = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(new Date(value).getTime()) && new Date(value).toISOString() === value;

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
  if (value.mediaIds !== undefined && (!Array.isArray(value.mediaIds) || value.mediaIds.length > 4 ||
      new Set(value.mediaIds).size !== value.mediaIds.length ||
      value.mediaIds.some((id) => typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id)))) return null;
  return {
    id: value.id,
    title: value.title,
    source: value.source,
    selected: selectedPlatforms(value.selected),
    variants: validVariants(value.variants),
    ...(value.mediaIds !== undefined ? { mediaIds: value.mediaIds as string[] } : {}),
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
  return {
    id: value.id,
    title: value.title,
    destination: value.destination,
    text: value.text,
    scheduledFor: value.scheduledFor,
    createdAt: value.createdAt,
    status: value.status,
    ...(value.status === "posted" && validDate(value.postedAt) ? { postedAt: value.postedAt } : {}),
    ...(validDate(value.notifiedAt) ? { notifiedAt: value.notifiedAt } : {}),
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

export function assistedState(post: AssistedPost, now: number): "upcoming" | "due" | "posted" {
  if (post.status === "posted") return "posted";
  return Date.parse(post.scheduledFor) <= now ? "due" : "upcoming";
}

export function localDateTimeValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
