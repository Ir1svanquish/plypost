import { isPlatformId, type PlatformId } from "./platforms.ts";
import type { SavedDraft } from "./workspace.ts";

export type StrategyProvider = "nebius" | "nvidia";

export type BrandBrief = {
  brandName: string;
  description: string;
  audience: string;
  goal: string;
  voice: string;
  facts: string;
  contentPillars: string[];
  platforms: PlatformId[];
  updatedAt: string;
};

export type StrategyIdea = {
  id: string;
  title: string;
  angle: string;
  rationale: string;
  seed: string;
  platforms: PlatformId[];
  status: "proposed" | "approved" | "dismissed";
  draftId?: string;
};

export type WeeklyPlan = {
  id: string;
  weekStart: string;
  createdAt: string;
  provider: StrategyProvider;
  briefSnapshot: BrandBrief;
  ideas: StrategyIdea[];
};

export type StrategyState = { brief: BrandBrief | null; plans: WeeklyPlan[]; draft?: SavedDraft };
export type StrategyProposal = Pick<StrategyIdea, "title" | "angle" | "rationale" | "seed" | "platforms">;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value);
const utcInstant = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const text = (value: unknown, max: number, required = true): value is string =>
  typeof value === "string" && Array.from(value.trim()).length <= max && (!required || Boolean(value.trim()));

export function validWeekStart(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && date.getUTCDay() === 1;
}

function parsePlatforms(value: unknown, allowed?: readonly PlatformId[]): PlatformId[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4 ||
      value.some((id) => !isPlatformId(id) || (allowed && !allowed.includes(id))) ||
      new Set(value).size !== value.length) return null;
  return [...value] as PlatformId[];
}

export function parseBrandBrief(value: unknown): BrandBrief | null {
  if (!isRecord(value) || !text(value.brandName, 80) || !text(value.description, 2000, false) ||
      !text(value.audience, 500) || !text(value.goal, 500) || !text(value.voice, 500) ||
      !text(value.facts, 3000, false) || !utcInstant(value.updatedAt) ||
      !Array.isArray(value.contentPillars) || value.contentPillars.length < 1 || value.contentPillars.length > 5 ||
      value.contentPillars.some((pillar) => !text(pillar, 120)) ||
      new Set(value.contentPillars.map((pillar: string) => pillar.trim().toLocaleLowerCase())).size !== value.contentPillars.length) return null;
  const platforms = parsePlatforms(value.platforms);
  if (!platforms) return null;
  return {
    brandName: value.brandName.trim(), description: value.description.trim(),
    audience: value.audience.trim(), goal: value.goal.trim(), voice: value.voice.trim(),
    facts: value.facts.trim(), contentPillars: value.contentPillars.map((pillar: string) => pillar.trim()),
    platforms, updatedAt: value.updatedAt,
  };
}

function parseProposal(value: unknown, allowed: readonly PlatformId[]): StrategyProposal | null {
  if (!isRecord(value) || !text(value.title, 120) || !text(value.angle, 400) ||
      !text(value.rationale, 500) || !text(value.seed, 3000)) return null;
  const platforms = parsePlatforms(value.platforms, allowed);
  if (!platforms) return null;
  return {
    title: value.title.trim(), angle: value.angle.trim(), rationale: value.rationale.trim(),
    seed: value.seed.trim(), platforms,
  };
}

/** Reject malformed model output instead of silently dropping ideas or unsupported destinations. */
export function parseGeneratedIdeas(raw: string, allowed: readonly PlatformId[]): StrategyProposal[] | null {
  if (raw.length > 20_000) return null;
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try { parsed = JSON.parse(stripped); } catch { return null; }
  if (!isRecord(parsed) || !Array.isArray(parsed.ideas) || parsed.ideas.length < 1 || parsed.ideas.length > 3) return null;
  const ideas = parsed.ideas.map((item) => parseProposal(item, allowed));
  if (ideas.some((item) => item === null)) return null;
  const valid = ideas as StrategyProposal[];
  if (new Set(valid.map((item) => item.title.toLocaleLowerCase())).size !== valid.length) return null;
  return valid;
}

export function parseWeeklyPlan(value: unknown): WeeklyPlan | null {
  if (!isRecord(value) || !uuid(value.id) || !validWeekStart(value.weekStart) || !utcInstant(value.createdAt) ||
      (value.provider !== "nebius" && value.provider !== "nvidia") || !Array.isArray(value.ideas) ||
      value.ideas.length < 1 || value.ideas.length > 3) return null;
  const briefSnapshot = parseBrandBrief(value.briefSnapshot);
  if (!briefSnapshot) return null;
  const ideas: StrategyIdea[] = [];
  for (const item of value.ideas) {
    if (!isRecord(item) || !uuid(item.id) ||
        (item.status !== "proposed" && item.status !== "approved" && item.status !== "dismissed") ||
        (item.status === "approved" ? !uuid(item.draftId) : item.draftId !== undefined)) return null;
    const proposal = parseProposal(item, briefSnapshot.platforms);
    if (!proposal) return null;
    ideas.push({ id: item.id, ...proposal, status: item.status,
      ...(item.status === "approved" ? { draftId: item.draftId as string } : {}) });
  }
  if (new Set(ideas.map((idea) => idea.id)).size !== ideas.length) return null;
  return {
    id: value.id, weekStart: value.weekStart, createdAt: value.createdAt,
    provider: value.provider, briefSnapshot, ideas,
  };
}

export function parseIdeaPatch(value: unknown, allowed: readonly PlatformId[]):
  Partial<Pick<StrategyIdea, "title" | "seed" | "platforms">> | null {
  if (!isRecord(value) || Object.keys(value).length < 1 ||
      Object.keys(value).some((key) => !["title", "seed", "platforms"].includes(key))) return null;
  const patch: Partial<Pick<StrategyIdea, "title" | "seed" | "platforms">> = {};
  if ("title" in value) {
    if (!text(value.title, 120)) return null;
    patch.title = value.title.trim();
  }
  if ("seed" in value) {
    if (!text(value.seed, 3000)) return null;
    patch.seed = value.seed.trim();
  }
  if ("platforms" in value) {
    const platforms = parsePlatforms(value.platforms, allowed);
    if (!platforms) return null;
    patch.platforms = platforms;
  }
  return patch;
}
