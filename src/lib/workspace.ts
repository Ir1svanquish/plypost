import { characterCount, platformIds, platforms, type PlatformId } from "./platforms.ts";

export const WORKSPACE_KEY = "socialflow-workspace-v2";

export type SavedDraft = {
  id: string;
  title: string;
  source: string;
  selected: PlatformId[];
  variants: Partial<Record<PlatformId, string>>;
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
  status: "queued" | "simulated";
  simulatedAt?: string;
};

export type Workspace = {
  version: 2;
  drafts: SavedDraft[];
  schedule: ScheduledPost[];
};

export const emptyWorkspace = (): Workspace => ({ version: 2, drafts: [], schedule: [] });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const validDate = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

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

function parseDraft(value: unknown): SavedDraft | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id ||
      typeof value.title !== "string" || typeof value.source !== "string" ||
      characterCount(value.title) > 120 || characterCount(value.source) > 3000 ||
      !validDate(value.createdAt) || !validDate(value.updatedAt)) return null;
  return {
    id: value.id,
    title: value.title,
    source: value.source,
    selected: selectedPlatforms(value.selected),
    variants: validVariants(value.variants),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseScheduledPost(value: unknown): ScheduledPost | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id ||
      typeof value.title !== "string" || characterCount(value.title) > 120 ||
      typeof value.source !== "string" || characterCount(value.source) > 3000 ||
      !validDate(value.scheduledFor) || !validDate(value.createdAt) ||
      (value.status !== "queued" && value.status !== "simulated") ||
      !isRecord(value.posts)) return null;
  const posts: Partial<Record<PlatformId, string>> = {};
  for (const id of platformIds) {
    const text = value.posts[id];
    if (typeof text === "string" && text.trim() && characterCount(text) <= platforms[id].limit) {
      posts[id] = text;
    }
  }
  if (!Object.keys(posts).length) return null;
  return {
    id: value.id,
    title: value.title,
    source: value.source,
    posts,
    scheduledFor: value.scheduledFor,
    createdAt: value.createdAt,
    status: value.status,
    ...(value.status === "simulated" && validDate(value.simulatedAt) ? { simulatedAt: value.simulatedAt } : {}),
  };
}

export function parseWorkspace(value: unknown): Workspace | null {
  if (!isRecord(value) || value.version !== 2 ||
      !Array.isArray(value.drafts) || !Array.isArray(value.schedule)) return null;
  return {
    version: 2,
    drafts: value.drafts.slice(0, 100).map(parseDraft).filter((draft): draft is SavedDraft => draft !== null),
    schedule: value.schedule.slice(0, 100).map(parseScheduledPost).filter((post): post is ScheduledPost => post !== null),
  };
}

export function draftTitle(title: string, source: string): string {
  return (title.trim() || source.trim().split(/\r?\n/)[0] || "Untitled draft").slice(0, 120);
}

export function scheduleState(post: ScheduledPost, now: number): "upcoming" | "due" | "simulated" {
  if (post.status === "simulated") return "simulated";
  return Date.parse(post.scheduledFor) <= now ? "due" : "upcoming";
}

export function localDateTimeValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
