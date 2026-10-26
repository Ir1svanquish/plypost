import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, database } from "../src/lib/server/db.ts";
import { createSession, SESSION_COOKIE } from "../src/lib/server/auth.ts";
import { POST as strategyPost } from "../src/app/api/strategy/route.ts";
import { importLegacyLibrary, importLibrary } from "../src/lib/server/workspace.ts";
import {
  approveStrategyIdea, createWeeklyPlan, dismissStrategyIdea, listStrategy,
  saveBrandBrief, saveBrandBriefIfCurrent, StrategyConflictError, updateStrategyIdea,
} from "../src/lib/server/strategy.ts";
import { parseBrandBrief, parseGeneratedIdeas, parseWeeklyPlan, validWeekStart } from "../src/lib/strategy.ts";

const temporary = mkdtempSync(join(tmpdir(), "plypost-strategy-"));
process.env.PLYPOST_DB_PATH = join(temporary, "strategy.sqlite");
after(() => { closeDatabase(); if (temporary.startsWith(tmpdir())) rmSync(temporary, { recursive: true, force: true }); });

const owner = "owner@example.test";
const other = "other@example.test";
const briefInput = {
  brandName: "Plypost", description: "A publishing workspace", audience: "Independent creators",
  goal: "Help creators post consistently", voice: "Warm, direct", facts: "We support assisted handoff.",
  contentPillars: ["Writing", "Workflow"], platforms: ["bluesky", "linkedin"],
};
const proposals = [
  { title: "A weekly writing ritual", angle: "Show the process", rationale: "Relevant to independent creators", seed: "How do you make time to write every week?", platforms: ["bluesky", "linkedin"] },
  { title: "Planning question", angle: "Invite discussion", rationale: "A question fits a discussion format", seed: "What part of social posting takes you the most time?", platforms: ["bluesky"] },
];

test("brand and model parsers reject malformed claims, dates and destinations", () => {
  const timestamped = { ...briefInput, updatedAt: new Date().toISOString() };
  assert.deepEqual(parseBrandBrief(timestamped)?.platforms, ["bluesky", "linkedin"]);
  assert.equal(parseBrandBrief({ ...timestamped, contentPillars: ["Writing", "writing"] }), null);
  assert.equal(parseBrandBrief({ ...timestamped, facts: "x".repeat(3001) }), null);
  assert.equal(parseBrandBrief({ ...timestamped, platforms: ["bluesky", "unknown"] }), null);
  assert.equal(validWeekStart("2026-10-26"), true);
  assert.equal(validWeekStart("2026-10-27"), false);
  assert.equal(validWeekStart("2026-02-30"), false);
  assert.deepEqual(parseGeneratedIdeas(JSON.stringify({ ideas: proposals }), briefInput.platforms), proposals);
  assert.equal(parseGeneratedIdeas(JSON.stringify({ ideas: [...proposals, ...proposals] }), briefInput.platforms), null);
  assert.equal(parseGeneratedIdeas(JSON.stringify({ ideas: [{ ...proposals[0], platforms: ["threads"] }] }), briefInput.platforms), null);
  assert.equal(parseGeneratedIdeas(JSON.stringify({ ideas: [{ ...proposals[0], seed: "" }] }), briefInput.platforms), null);
  assert.equal(parseGeneratedIdeas("Here are ideas: " + JSON.stringify({ ideas: proposals }), briefInput.platforms), null);
});

test("a stale brand profile cannot replace newer AI planning facts", () => {
  const user = `brief-${randomUUID()}@example.test`;
  const first = saveBrandBriefIfCurrent(user, briefInput, null);
  assert.throws(() => saveBrandBriefIfCurrent(user, { ...briefInput, facts: "Stale" }, null), StrategyConflictError);
  const latest = saveBrandBriefIfCurrent(user, { ...briefInput, facts: "Updated facts" }, first.updatedAt);
  assert.ok(latest.updatedAt > first.updatedAt);
  assert.throws(() => saveBrandBriefIfCurrent(user, { ...briefInput, goal: "Old window" }, first.updatedAt), StrategyConflictError);
  assert.deepEqual(listStrategy(user).brief, latest);
});

test("brand profile API returns the latest version on a stale save", async () => {
  const user = `brief-api-${randomUUID()}@example.test`;
  process.env.PLYPOST_OWNER_EMAIL = user;
  process.env.PLYPOST_OWNER_PASSWORD_HASH = "test-only-placeholder";
  try {
    const first = saveBrandBriefIfCurrent(user, briefInput, null);
    const latest = saveBrandBriefIfCurrent(user, { ...briefInput, voice: "Updated elsewhere" }, first.updatedAt);
    const session = createSession(user);
    const request = new globalThis.Request("http://localhost:3000/api/strategy", {
      method: "POST",
      headers: { origin: "http://localhost:3000", cookie: `${SESSION_COOKIE}=${session}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "save-brief", brief: { ...briefInput, voice: "Old window" }, expectedUpdatedAt: first.updatedAt }),
    });
    const response = await strategyPost(request);
    assert.equal(response.status, 409);
    assert.deepEqual((await response.json()).brief, latest);
    assert.deepEqual(listStrategy(user).brief, latest);
  } finally {
    delete process.env.PLYPOST_OWNER_PASSWORD_HASH;
    delete process.env.PLYPOST_OWNER_EMAIL;
  }
});

test("stale idea edits, dismissals and approvals cannot act on newer text", () => {
  const user = `idea-${randomUUID()}@example.test`;
  const brief = saveBrandBrief(user, briefInput);
  const plan = createWeeklyPlan(user, brief, "nebius", "2026-10-26", [proposals[0]]);
  const reviewed = plan.ideas[0];
  updateStrategyIdea(user, plan.id, reviewed.id, { title: "Updated elsewhere", seed: "Newer source draft" }, reviewed);
  const latest = listStrategy(user).plans[0].ideas[0];
  assert.throws(() => updateStrategyIdea(user, plan.id, reviewed.id, { title: "Old window" }, reviewed), StrategyConflictError);
  assert.throws(() => dismissStrategyIdea(user, plan.id, reviewed.id, reviewed), StrategyConflictError);
  assert.throws(() => approveStrategyIdea(user, plan.id, reviewed.id, reviewed), StrategyConflictError);
  assert.deepEqual(listStrategy(user).plans[0].ideas[0], latest);
  assert.equal(database().prepare("SELECT COUNT(*) AS count FROM drafts WHERE user_id=?").get(user).count, 0);

  const draft = approveStrategyIdea(user, plan.id, reviewed.id, latest);
  assert.equal(draft.source, "Newer source draft");
  assert.deepEqual(approveStrategyIdea(user, plan.id, reviewed.id, latest), draft);
  assert.equal(database().prepare("SELECT COUNT(*) AS count FROM drafts WHERE user_id=?").get(user).count, 1);
});

test("idea API refuses blind actions and returns the latest idea on conflict", async () => {
  const user = `idea-api-${randomUUID()}@example.test`;
  process.env.PLYPOST_OWNER_EMAIL = user;
  process.env.PLYPOST_OWNER_PASSWORD_HASH = "test-only-placeholder";
  try {
    const brief = saveBrandBrief(user, briefInput);
    const plan = createWeeklyPlan(user, brief, "nebius", "2026-10-26", [proposals[0]]);
    const reviewed = plan.ideas[0];
    updateStrategyIdea(user, plan.id, reviewed.id, { seed: "Edited in another window" }, reviewed);
    const session = createSession(user);
    const send = (body) => strategyPost(new globalThis.Request("http://localhost:3000/api/strategy", {
      method: "POST",
      headers: { origin: "http://localhost:3000", cookie: `${SESSION_COOKIE}=${session}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
    const blind = await send({ action: "approve-idea", planId: plan.id, ideaId: reviewed.id });
    assert.equal(blind.status, 400);
    const stale = await send({ action: "approve-idea", planId: plan.id, ideaId: reviewed.id, expectedIdea: reviewed });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).plans[0].ideas[0].seed, "Edited in another window");
    assert.equal(database().prepare("SELECT COUNT(*) AS count FROM drafts WHERE user_id=?").get(user).count, 0);
  } finally {
    delete process.env.PLYPOST_OWNER_PASSWORD_HASH;
    delete process.env.PLYPOST_OWNER_EMAIL;
  }
});

test("reviewed ideas become owner-scoped drafts exactly once, with immutable approval snapshot", () => {
  const brief = saveBrandBrief(owner, briefInput);
  assert.ok(brief.updatedAt);
  assert.equal(listStrategy(other).brief, null);
  closeDatabase();
  assert.deepEqual(listStrategy(owner).brief, brief);
  assert.throws(() => createWeeklyPlan(owner, brief, "nvidia", "2026-10-27", proposals), /invalid/);
  const plan = createWeeklyPlan(owner, brief, "nvidia", "2026-10-26", proposals);
  assert.deepEqual(parseWeeklyPlan(plan), plan);
  assert.deepEqual(listStrategy(other).plans, []);
  assert.throws(() => updateStrategyIdea(other, plan.id, plan.ideas[0].id, { title: "Stolen" }), /not found/i);
  assert.throws(() => approveStrategyIdea(other, plan.id, plan.ideas[0].id), /not found/i);

  updateStrategyIdea(owner, plan.id, plan.ideas[0].id, { title: "Reviewed title", seed: "Reviewed source", platforms: ["linkedin"] });
  const draft = approveStrategyIdea(owner, plan.id, plan.ideas[0].id);
  assert.equal(draft.title, "Reviewed title");
  assert.equal(draft.source, "Reviewed source");
  assert.deepEqual(draft.selected, ["linkedin"]);
  assert.deepEqual(draft.variants, {});
  assert.deepEqual(approveStrategyIdea(owner, plan.id, plan.ideas[0].id), draft);
  assert.equal(database().prepare("SELECT COUNT(*) AS count FROM drafts WHERE user_id=?").get(owner).count, 1);
  assert.equal(database().prepare("SELECT COUNT(*) AS count FROM jobs WHERE user_id=?").get(owner).count, 0);
  assert.equal(database().prepare("SELECT COUNT(*) AS count FROM assisted WHERE user_id=?").get(owner).count, 0);
  assert.throws(() => updateStrategyIdea(owner, plan.id, plan.ideas[0].id, { seed: "Changed after approval" }), /Only proposed/);
  assert.throws(() => dismissStrategyIdea(owner, plan.id, plan.ideas[0].id), /Only proposed/);
  assert.deepEqual(JSON.parse(database().prepare("SELECT payload FROM drafts WHERE id=?").get(draft.id).payload), draft);

  dismissStrategyIdea(owner, plan.id, plan.ideas[1].id);
  assert.equal(listStrategy(owner).plans[0].ideas[1].status, "dismissed");
  assert.throws(() => approveStrategyIdea(owner, plan.id, plan.ideas[1].id), /Only proposed/);
});

test("plan retention keeps the latest twelve plans and does not delete approved drafts", () => {
  const brief = listStrategy(owner).brief;
  for (let week = 0; week < 13; week++) {
    const date = new Date(Date.UTC(2027, 0, 4 + week * 7)).toISOString().slice(0, 10);
    createWeeklyPlan(owner, brief, "nebius", date, [proposals[0]]);
  }
  assert.equal(listStrategy(owner).plans.length, 12);
  assert.equal(database().prepare("SELECT COUNT(*) AS count FROM drafts WHERE user_id=?").get(owner).count, 1);
});

test("generation sends only approved brief fields and saves proposals without publishing", async () => {
  process.env.PLYPOST_OWNER_EMAIL = owner;
  process.env.PLYPOST_OWNER_PASSWORD_HASH = "test-only-placeholder";
  process.env.NEBIUS_API_KEY = "test-only-placeholder";
  const session = createSession(owner);
  const originalFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.tokenfactory.nebius.com/v1/chat/completions");
    sent = JSON.parse(options.body);
    return globalThis.Response.json({ choices: [{ message: { content: JSON.stringify({ ideas: [proposals[0]] }) } }] });
  };
  try {
    const request = new globalThis.Request("http://localhost:3000/api/strategy", {
      method: "POST",
      headers: { origin: "http://localhost:3000", cookie: `${SESSION_COOKIE}=${session}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "generate", weekStart: "2026-10-26" }),
    });
    const response = await strategyPost(request);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.plans[0].weekStart, "2026-10-26");
    assert.equal(result.plans[0].ideas[0].status, "proposed");
    assert.deepEqual(JSON.parse(sent.messages[1].content), briefInput);
    assert.equal(JSON.stringify(sent).includes("outcome"), false);
    assert.equal(JSON.stringify(sent).includes("2026-10-26"), false);
    assert.equal(database().prepare("SELECT COUNT(*) AS count FROM jobs WHERE user_id=?").get(owner).count, 0);
    assert.equal(database().prepare("SELECT COUNT(*) AS count FROM assisted WHERE user_id=?").get(owner).count, 0);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.NEBIUS_API_KEY;
    delete process.env.PLYPOST_OWNER_PASSWORD_HASH;
    delete process.env.PLYPOST_OWNER_EMAIL;
  }
});

test("text workspace imports remove stale plans but preserve the brief and other owners", () => {
  const ownerBrief = listStrategy(owner).brief;
  const otherBrief = saveBrandBrief(other, briefInput);
  const otherPlan = createWeeklyPlan(other, otherBrief, "nvidia", "2026-10-26", [proposals[0]]);
  assert.ok(listStrategy(owner).plans.length > 0);

  importLibrary(owner, { version: 3, drafts: [], schedule: [], assisted: [] });
  assert.deepEqual(listStrategy(owner), { brief: ownerBrief, plans: [] });
  assert.equal(listStrategy(other).plans[0].id, otherPlan.id);

  createWeeklyPlan(owner, ownerBrief, "nebius", "2026-11-02", [proposals[0]]);
  importLegacyLibrary(owner, { version: 2, drafts: [], schedule: [] });
  assert.deepEqual(listStrategy(owner), { brief: ownerBrief, plans: [] });
  assert.equal(listStrategy(other).plans[0].id, otherPlan.id);
});
