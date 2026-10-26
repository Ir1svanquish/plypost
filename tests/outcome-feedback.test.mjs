import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase } from "../src/lib/server/db.ts";
import { addAssisted, listWorkspace, setAssistedOutcome, setAssistedStatus } from "../src/lib/server/workspace.ts";
import { assistedContentSnapshot, parseAssistedOutcomeInput, parseWorkspace } from "../src/lib/workspace.ts";
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

function receipt(post) {
  return { status: post.status, postedAt: post.postedAt ?? null, postUrl: post.postUrl ?? null,
    outcome: post.outcome ?? null };
}

function currentReceipt(id) {
  return receipt(listWorkspace(owner).assisted.find((entry) => entry.id === id));
}

function saveOutcome(id, outcome) {
  return setAssistedOutcome(owner, id, outcome, currentReceipt(id));
}

function changePostedStatus(id, status, postUrl) {
  return setAssistedStatus(owner, id, status, postUrl, undefined, currentReceipt(id), true);
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
  assert.equal(setAssistedStatus(owner, post.id, "posted", postUrl, assistedContentSnapshot(post)), true);
  const postedAt = listWorkspace(owner).assisted[0].postedAt;
  assert.equal(setAssistedOutcome(other, post.id, { views: 1 }), false);
  for (const invalid of [undefined, {}, { views: -1 }, { views: 1.2 }, { likes: "4" },
    { replies: 1_000_000_001 }, { notes: " " }, { notes: "x".repeat(501) },
    { views: 1, recordedAt: new Date().toISOString() }]) {
    assert.throws(() => setAssistedOutcome(owner, post.id, invalid), /Enter at least one result/);
  }
  assert.equal(saveOutcome(post.id, { views: 0, likes: 12, notes: "Good discussion" }), true);
  const first = listWorkspace(owner).assisted[0];
  assert.deepEqual({ ...first.outcome, recordedAt: undefined },
    { views: 0, likes: 12, notes: "Good discussion", recordedAt: undefined });
  assert.ok(Number.isFinite(Date.parse(first.outcome.recordedAt)));
  assert.equal(first.postedAt, postedAt);
  assert.equal(first.postUrl, postUrl);
  assert.equal(saveOutcome(post.id, { views: 0, likes: 12, notes: "Good discussion" }), true);
  assert.equal(listWorkspace(owner).assisted[0].outcome.recordedAt, first.outcome.recordedAt);
  assert.equal(saveOutcome(post.id, { views: 3, replies: 1 }), true);
  assert.deepEqual(Object.keys(listWorkspace(owner).assisted[0].outcome).sort(), ["recordedAt", "replies", "views"]);
  assert.equal(saveOutcome(post.id, null), true);
  assert.equal(listWorkspace(owner).assisted[0].outcome, undefined);
  assert.equal(listWorkspace(owner).assisted[0].postedAt, postedAt);
  assert.equal(listWorkspace(owner).assisted[0].postUrl, postUrl);
  saveOutcome(post.id, { notes: "Worth repeating" });
  changePostedStatus(post.id, "queued");
  assert.equal(listWorkspace(owner).assisted[0].outcome, undefined);
  assert.equal(listWorkspace(owner).assisted[0].postedAt, undefined);
});

test("stale posted-record actions cannot erase or replace newer links and results", () => {
  const post = addAssisted(owner, item());
  setAssistedStatus(owner, post.id, "posted", postUrl, assistedContentSnapshot(post));
  const first = listWorkspace(owner).assisted.find((entry) => entry.id === post.id);
  const oldReceipt = receipt(first);

  setAssistedOutcome(owner, post.id, { views: 12 }, oldReceipt);
  assert.throws(() => setAssistedStatus(owner, post.id, "queued", undefined, undefined, oldReceipt), /changed/i);
  assert.equal(listWorkspace(owner).assisted.find((entry) => entry.id === post.id).outcome.views, 12);

  const second = listWorkspace(owner).assisted.find((entry) => entry.id === post.id);
  setAssistedStatus(owner, post.id, "posted", "https://social.example/creator/post/new", undefined, receipt(second));
  assert.throws(() => setAssistedStatus(owner, post.id, "posted", "https://social.example/creator/post/stale", undefined, receipt(second)), /changed/i);
  assert.equal(listWorkspace(owner).assisted.find((entry) => entry.id === post.id).postUrl, "https://social.example/creator/post/new");

  const third = listWorkspace(owner).assisted.find((entry) => entry.id === post.id);
  setAssistedOutcome(owner, post.id, { views: 25 }, receipt(third));
  assert.throws(() => setAssistedOutcome(owner, post.id, { views: 2 }, receipt(third)), /changed/i);
  assert.equal(listWorkspace(owner).assisted.find((entry) => entry.id === post.id).outcome.views, 25);
});

test("undoing a posted mark requires acknowledging the saved receipt will be cleared", async () => {
  const post = addAssisted(owner, item());
  setAssistedStatus(owner, post.id, "posted", postUrl, assistedContentSnapshot(post));
  saveOutcome(post.id, { views: 9, notes: "Follow up" });
  const before = listWorkspace(owner).assisted.find((entry) => entry.id === post.id);
  assert.throws(() => setAssistedStatus(owner, post.id, "queued", undefined, undefined, receipt(before)), /confirm|clear/i);
  assert.deepEqual(listWorkspace(owner).assisted.find((entry) => entry.id === post.id), before);
  const token = createSession(owner);
  const body = { action: "set-assisted-status", id: post.id, status: "queued", expectedReceipt: receipt(before) };
  assert.equal((await POST(request(body, { token }))).status, 400);
  assert.deepEqual(listWorkspace(owner).assisted.find((entry) => entry.id === post.id), before);
  assert.equal((await POST(request({ ...body, confirmRecordRemoval: true }, { token }))).status, 200);
  const afterUndo = listWorkspace(owner).assisted.find((entry) => entry.id === post.id);
  assert.equal(afterUndo.status, "queued");
  assert.equal(afterUndo.postedAt, undefined);
  assert.equal(afterUndo.postUrl, undefined);
  assert.equal(afterUndo.outcome, undefined);
});

test("workspace route requires same-origin owner session and exposes saved results", async () => {
  const post = addAssisted(owner, item());
  setAssistedStatus(owner, post.id, "posted", postUrl, assistedContentSnapshot(post));
  const body = { action: "set-assisted-outcome", id: post.id, outcome: { views: 42, notes: "Clicked through" }, expectedReceipt: currentReceipt(post.id) };
  assert.equal((await POST(request(body))).status, 401);
  const token = createSession(owner);
  assert.equal((await POST(request(body, { token, origin: "https://elsewhere.example" }))).status, 403);
  const response = await POST(request(body, { token }));
  assert.equal(response.status, 200);
  const saved = (await response.json()).assisted.find((item) => item.id === post.id);
  assert.equal(saved.outcome.views, 42);
  assert.equal(saved.outcome.notes, "Clicked through");
  assert.equal(saved.postUrl, postUrl);
  const stale = await POST(request({ ...body, outcome: { views: 2 } }, { token }));
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, "ASSISTED_CONFLICT");
  assert.equal((await POST(request({ action: "set-assisted-status", id: post.id, status: "queued" }, { token }))).status, 409);
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
  const restored = listWorkspace(owner).assisted.find((post) => post.postUrl === withOutcome.postUrl && post.outcome);
  assert.ok(restored);
  assert.deepEqual(restored.outcome, withOutcome.outcome);
  assert.equal(restored.postedAt, withOutcome.postedAt);
});
