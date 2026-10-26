import { randomUUID } from "node:crypto";
import { audit, database, transaction } from "./db";
import {
  parseBrandBrief, parseGeneratedIdeas, parseIdeaPatch, parseWeeklyPlan, validWeekStart,
  type BrandBrief, type StrategyIdea, type StrategyProvider, type StrategyState, type WeeklyPlan,
} from "../strategy";
import type { SavedDraft } from "../workspace";

type PayloadRow = { payload: string };
const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value);

function decodedPlan(row: PayloadRow | undefined): WeeklyPlan {
  if (!row) throw new Error("Plan not found.");
  const plan = parseWeeklyPlan(JSON.parse(row.payload));
  if (!plan) throw new Error("Stored plan is invalid.");
  return plan;
}

export function loadBrandBrief(userId: string): BrandBrief | null {
  const row = database().prepare("SELECT payload FROM brand_briefs WHERE user_id=?").get(userId) as PayloadRow | undefined;
  if (!row) return null;
  const brief = parseBrandBrief(JSON.parse(row.payload));
  if (!brief) throw new Error("Stored brand brief is invalid.");
  return brief;
}

export function listStrategy(userId: string): StrategyState {
  const rows = database().prepare("SELECT payload FROM weekly_plans WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 12")
    .all(userId) as PayloadRow[];
  return { brief: loadBrandBrief(userId), plans: rows.map((row) => decodedPlan(row)) };
}

export class StrategyConflictError extends Error {}

function sameIdeaContent(current: StrategyIdea, expected: unknown): expected is Record<string, unknown> {
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) return false;
  const value = expected as Record<string, unknown>;
  return value.id === current.id && value.title === current.title && value.angle === current.angle &&
    value.rationale === current.rationale && value.seed === current.seed &&
    Array.isArray(value.platforms) && value.platforms.length === current.platforms.length &&
    value.platforms.every((id, index) => id === current.platforms[index]);
}

function sameIdeaSnapshot(current: StrategyIdea, expected: unknown): boolean {
  return sameIdeaContent(current, expected) && expected.status === current.status && expected.draftId === current.draftId;
}

function requireCurrentIdea(current: StrategyIdea, expected: unknown, action: string): void {
  if (expected !== undefined && !sameIdeaSnapshot(current, expected)) {
    throw new StrategyConflictError(`This idea changed in another window. Review the latest version before ${action}.`);
  }
}

function storeBrandBrief(userId: string, value: unknown, expectedUpdatedAt?: string | null): BrandBrief {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Complete the brand brief first.");
  const candidate = parseBrandBrief({ ...value, updatedAt: new Date().toISOString() });
  if (!candidate) throw new Error("Complete the required brand fields and check their length, pillars and destinations.");
  return transaction((db) => {
    const row = db.prepare("SELECT payload FROM brand_briefs WHERE user_id=?").get(userId) as PayloadRow | undefined;
    const previous = row ? parseBrandBrief(JSON.parse(row.payload)) : null;
    if (row && !previous) throw new Error("Stored brand brief is invalid.");
    if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== (previous?.updatedAt ?? null)) {
      throw new StrategyConflictError("Brand profile changed in another window. Review both versions before saving again.");
    }
    const updatedAt = new Date(Math.max(Date.now(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString();
    const brief = { ...candidate, updatedAt };
    db.prepare("INSERT INTO brand_briefs(user_id,payload) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload")
      .run(userId, JSON.stringify(brief));
    audit(userId, "strategy.brief_saved");
    return brief;
  });
}

export function saveBrandBrief(userId: string, value: unknown): BrandBrief {
  return storeBrandBrief(userId, value);
}

export function saveBrandBriefIfCurrent(userId: string, value: unknown, expectedUpdatedAt: string | null): BrandBrief {
  return storeBrandBrief(userId, value, expectedUpdatedAt);
}

export function createWeeklyPlan(
  userId: string, briefSnapshot: BrandBrief, provider: StrategyProvider, weekStart: string, proposals: unknown,
): WeeklyPlan {
  const brief = parseBrandBrief(briefSnapshot);
  const valid = parseGeneratedIdeas(JSON.stringify({ ideas: proposals }), brief?.platforms ?? []);
  if (!brief || !validWeekStart(weekStart) || (provider !== "nebius" && provider !== "nvidia") || !valid) {
    throw new Error("The generated plan is invalid.");
  }
  const now = new Date().toISOString();
  const plan: WeeklyPlan = {
    id: randomUUID(), weekStart, createdAt: now, provider, briefSnapshot: brief,
    ideas: valid.map((idea) => ({ id: randomUUID(), ...idea, status: "proposed" })),
  };
  transaction((db) => {
    const row = db.prepare("SELECT payload FROM brand_briefs WHERE user_id=?").get(userId) as PayloadRow | undefined;
    const current = row ? parseBrandBrief(JSON.parse(row.payload)) : null;
    if (!current || JSON.stringify(current) !== JSON.stringify(brief)) {
      throw new StrategyConflictError("Brand profile changed while ideas were being generated. Review the latest version and generate again.");
    }
    db.prepare("INSERT INTO weekly_plans(id,user_id,payload,created_at) VALUES (?,?,?,?)")
      .run(plan.id, userId, JSON.stringify(plan), now);
    const old = db.prepare("SELECT id FROM weekly_plans WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT -1 OFFSET 12")
      .all(userId) as { id: string }[];
    for (const row of old) db.prepare("DELETE FROM weekly_plans WHERE id=? AND user_id=?").run(row.id, userId);
    audit(userId, "strategy.plan_generated", plan.id, `${weekStart}; ${provider}`);
  });
  return plan;
}

export function updateStrategyIdea(userId: string, planId: unknown, ideaId: unknown, value: unknown, expectedIdea?: unknown): void {
  if (!validId(planId) || !validId(ideaId)) throw new Error("Plan idea not found.");
  transaction((db) => {
    const row = db.prepare("SELECT payload FROM weekly_plans WHERE id=? AND user_id=?").get(planId, userId) as PayloadRow | undefined;
    const plan = decodedPlan(row);
    const idea = plan.ideas.find((item) => item.id === ideaId);
    if (!idea) throw new Error("Plan idea not found.");
    requireCurrentIdea(idea, expectedIdea, "saving");
    if (idea.status !== "proposed") throw new Error("Only proposed ideas can be edited.");
    const patch = parseIdeaPatch(value, plan.briefSnapshot.platforms);
    if (!patch) throw new Error("Edit the title, source, or selected destinations within the allowed limits.");
    Object.assign(idea, patch);
    db.prepare("UPDATE weekly_plans SET payload=? WHERE id=? AND user_id=?")
      .run(JSON.stringify(plan), planId, userId);
    audit(userId, "strategy.idea_updated", ideaId, planId);
  });
}
export function dismissStrategyIdea(userId: string, planId: unknown, ideaId: unknown, expectedIdea?: unknown): void {
  if (!validId(planId) || !validId(ideaId)) throw new Error("Plan idea not found.");
  transaction((db) => {
    const row = db.prepare("SELECT payload FROM weekly_plans WHERE id=? AND user_id=?").get(planId, userId) as PayloadRow | undefined;
    const plan = decodedPlan(row);
    const idea = plan.ideas.find((item) => item.id === ideaId);
    if (!idea) throw new Error("Plan idea not found.");
    requireCurrentIdea(idea, expectedIdea, "dismissing");
    if (idea.status !== "proposed") throw new Error("Only proposed ideas can be dismissed.");
    idea.status = "dismissed";
    db.prepare("UPDATE weekly_plans SET payload=? WHERE id=? AND user_id=?")
      .run(JSON.stringify(plan), planId, userId);
    audit(userId, "strategy.idea_dismissed", ideaId, planId);
  });
}

/** Approval copies the reviewed seed into an ordinary owner-scoped draft; it never publishes. */
export function approveStrategyIdea(userId: string, planId: unknown, ideaId: unknown, expectedIdea?: unknown): SavedDraft {
  if (!validId(planId) || !validId(ideaId)) throw new Error("Plan idea not found.");
  return transaction((db) => {
    const row = db.prepare("SELECT payload FROM weekly_plans WHERE id=? AND user_id=?").get(planId, userId) as PayloadRow | undefined;
    const plan = decodedPlan(row);
    const idea = plan.ideas.find((item) => item.id === ideaId);
    if (!idea) throw new Error("Plan idea not found.");
    const sameApprovalRetry = idea.status === "approved" && sameIdeaContent(idea, expectedIdea) && expectedIdea.status === "proposed";
    if (!sameApprovalRetry) requireCurrentIdea(idea, expectedIdea, "approving");
    if (idea.status === "approved" && idea.draftId) {
      const draftRow = db.prepare("SELECT payload FROM drafts WHERE id=? AND user_id=?")
        .get(idea.draftId, userId) as PayloadRow | undefined;
      if (!draftRow) throw new Error("The previously approved draft was deleted.");
      return JSON.parse(draftRow.payload) as SavedDraft;
    }
    if (idea.status !== "proposed") throw new Error("Only proposed ideas can be approved.");
    const count = db.prepare("SELECT COUNT(*) AS count FROM drafts WHERE user_id=?").get(userId) as { count: number };
    if (count.count >= 100) throw new Error("Draft library is full.");
    const now = new Date().toISOString();
    const draft: SavedDraft = {
      id: randomUUID(), title: idea.title, source: idea.seed,
      selected: [...idea.platforms], variants: {}, createdAt: now, updatedAt: now,
    };
    db.prepare("INSERT INTO drafts(id,user_id,payload,updated_at) VALUES (?,?,?,?)")
      .run(draft.id, userId, JSON.stringify(draft), now);
    idea.status = "approved";
    idea.draftId = draft.id;
    db.prepare("UPDATE weekly_plans SET payload=? WHERE id=? AND user_id=?")
      .run(JSON.stringify(plan), planId, userId);
    audit(userId, "strategy.idea_approved", ideaId, draft.id);
    return draft;
  });
}
