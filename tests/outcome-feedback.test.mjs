import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase } from "../src/lib/server/db.ts";
import { addAssisted, listWorkspace, setAssistedOutcome, setAssistedStatus } from "../src/lib/server/workspace.ts";
import { parseAssistedOutcomeInput, parseWorkspace } from "../src/lib/workspace.ts";
import { exportPortableBackup, importPortableBackup } from "../src/lib/server/portable-backup.ts";
import { createSession, SESSION_COOKIE } from "../src/lib/server/auth.ts";
import { POST } from "../src/app/api/workspace/route.ts";

const temporary = mkdtempSync(join(tmpdir(), "plypost-outcome-"));
process.env.PLYPOST_DB_PATH = join(temporary, "outcome.sqlite");
process.env.PLYPOST_OWNER_EMAIL = "outcome-owner@example.test";
process.env.PLYPOST_OWNER_PASSWORD_HASH = "configured";
const owner = "outcome-owner@example.test";
const other = "another@example.test";
const postUrl = "https://social.example/creator/post/123";

after(() => { closeDatabase(); if (temporary.startsWith(tmpdir())) rmSync(temporary, { recursive: true, force: true }); });

function item() {
  return { id: randomUUID(), title: "Launch", destination: "x", text: "A post to publish",
    scheduledFor: new Date(Date.now() + 60_000).toISOString(), createdAt: new Date().toISOString(), status: "queued" };
}

function request(body, { token, origin = "http://localhost" } = {}) {
  return new globalThis.Request("http://localhost/api/workspace", { method: "POST",
    headers: { origin, "content-type": "application/json", ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}) },
    body: JSON.stringify(body) });
}

test("outcome parser accepts old items and rejects malformed or unverified feedback", () => {
  const old = { ...item(), status: "posted", postedAt: new Date().toISOString() };
  const parse = (post) => parseWorkspace({ version: 3, drafts: [], schedule: [], assisted: [post] }).assisted;
  assert.deepEqual(parse(old), [old]);
  const valid = { ...old, outcome: { views: 0, likes: 12, notes: "A useful response", recordedAt: new Date().toISOString() } };
  assert.deepEqual(parse(valid), [valid]);
  for (const outcome of [
    { views: -1 }, { views: 1.5 }, { views: Number.POSITIVE_INFINITY }, { likes: 1_000_000_001 },
    { replies: "3" }, { notes: " " }, { notes: "a".repeat(501) }, {},
    { views: 1, recordedAt: "invalid" }, { views: 1, recordedAt: valid.outcome.recordedAt, extra: "discard me" },
  ]) {
    assert.equal(parse({ ...old, outcome }).length, 0);
  }
  assert.equal(parse({ ...item(), outcome: valid.outcome }).length, 0);
  assert.equal(parse({ ...old, postedAt: undefined, outcome: valid.outcome }).length, 0);
  assert.deepEqual(parseAssistedOutcomeInput({ views: 0 }), { views: 0 });
  assert.equal(parseAssistedOutcomeInput({ notes: "  padded  " }), null);
});

test("only posted owner items accept self-reported results; post receipt survives changes", () => {
  const post = addAssisted(owner, item());
  assert.throws(() => setAssistedOutcome(owner, post.id, { views: 1 }), /Mark the item posted/);
  assert.equal(setAssistedStatus(owner, post.id, "posted", postUrl), true);
  const postedAt = listWorkspace(owner).assisted[0].postedAt;
  assert.equal(setAssistedOutcome(other, post.id, { views: 1 }), false);
  for (const invalid of [undefined, {}, { views: -1 }, { views: 1.2 }, { likes: "4" },
    { replies: 1_000_000_001 }, { notes: " " }, { notes: "x".repeat(501) },
    { views: 1, recordedAt: new Date().toISOString() }]) {
    assert.throws(() => setAssistedOutcome(owner, post.id, invalid), /Enter at least one result/);
  }
  assert.equal(setAssistedOutcome(owner, post.id, { views: 0, likes: 12, notes: "Good discussion" }), true);
  const first = listWorkspace(owner).assisted[0];
  assert.deepEqual({ ...first.outcome, recordedAt: undefined },
    { views: 0, likes: 12, notes: "Good discussion", recordedAt: undefined });
  assert.ok(Number.isFinite(Date.parse(first.outcome.recordedAt)));
  assert.equal(first.postedAt, postedAt);
  assert.equal(first.postUrl, postUrl);
  assert.equal(setAssistedOutcome(owner, post.id, { views: 0, likes: 12, notes: "Good discussion" }), true);
  assert.equal(listWorkspace(owner).assisted[0].outcome.recordedAt, first.outcome.recordedAt);
  assert.equal(setAssistedOutcome(owner, post.id, { views: 3, replies: 1 }), true);
  assert.deepEqual(Object.keys(listWorkspace(owner).assisted[0].outcome).sort(), ["recordedAt", "replies", "views"]);
  assert.equal(setAssistedOutcome(owner, post.id, null), true);
  assert.equal(listWorkspace(owner).assisted[0].outcome, undefined);
  assert.equal(listWorkspace(owner).assisted[0].postedAt, postedAt);
  assert.equal(listWorkspace(owner).assisted[0].postUrl, postUrl);
  setAssistedOutcome(owner, post.id, { notes: "Worth repeating" });
  setAssistedStatus(owner, post.id, "queued");
  assert.equal(listWorkspace(owner).assisted[0].outcome, undefined);
  assert.equal(listWorkspace(owner).assisted[0].postedAt, undefined);
});

test("workspace route requires same-origin owner session and exposes saved results", async () => {
  const post = addAssisted(owner, item());
  setAssistedStatus(owner, post.id, "posted", postUrl);
  const body = { action: "set-assisted-outcome", id: post.id, outcome: { views: 42, notes: "Clicked through" } };
  assert.equal((await POST(request(body))).status, 401);
  const token = createSession(owner);
  assert.equal((await POST(request(body, { token, origin: "https://elsewhere.example" }))).status, 403);
  const response = await POST(request(body, { token }));
  assert.equal(response.status, 200);
  const saved = (await response.json()).assisted.find((item) => item.id === post.id);
  assert.equal(saved.outcome.views, 42);
  assert.equal(saved.outcome.notes, "Clicked through");
  assert.equal(saved.postUrl, postUrl);
  assert.equal((await POST(request({ ...body, outcome: { views: -1 } }, { token }))).status, 400);
  assert.equal(listWorkspace(owner).assisted.find((item) => item.id === post.id).outcome.views, 42);
});

test("portable backup round-trips outcomes, accepts old items, and rejects tampering", async () => {
  const archive = JSON.parse(exportPortableBackup(owner));
  const withOutcome = archive.assisted.find((post) => post.outcome);
  assert.ok(withOutcome);
  for (const change of [
    (post) => { post.outcome.views = -1; },
    (post) => { post.outcome.recordedAt = "bad"; },
    (post) => { post.outcome.extra = "silently dropped?"; },
    (post) => { post.status = "queued"; },
  ]) {
    const tampered = globalThis.structuredClone(archive);
    change(tampered.assisted.find((post) => post.id === withOutcome.id));
    await assert.rejects(importPortableBackup(owner, tampered), /invalid assisted items/);
  }
  const old = globalThis.structuredClone(archive);
  for (const post of old.assisted) delete post.outcome;
  await importPortableBackup(owner, old);
  assert.equal(listWorkspace(owner).assisted.some((post) => post.outcome), false);
  await importPortableBackup(owner, archive);
  const restored = listWorkspace(owner).assisted.find((post) => post.postUrl === postUrl && post.outcome);
  assert.ok(restored);
  assert.deepEqual(restored.outcome, withOutcome.outcome);
  assert.equal(restored.postedAt, withOutcome.postedAt);
});
