import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { closeDatabase, database } from "../src/lib/server/db.ts";
import { createSession, SESSION_COOKIE } from "../src/lib/server/auth.ts";
import { createMedia } from "../src/lib/server/media.ts";
import { addAssisted, deleteAssisted, listWorkspace, prepareAssistedBatch, saveDraft, setAssistedStatus, updateAssistedMediaAlt, updateAssistedText } from "../src/lib/server/workspace.ts";
import { parseWorkspace } from "../src/lib/workspace.ts";
import { POST as workspacePost } from "../src/app/api/workspace/route.ts";

const temporary = mkdtempSync(join(tmpdir(), "plypost-batch-"));
process.env.PLYPOST_DB_PATH = join(temporary, "batch.sqlite");
process.env.PLYPOST_OWNER_EMAIL = "owner@example.test";
process.env.PLYPOST_OWNER_PASSWORD_HASH = "test-only-placeholder";
const owner = "owner@example.test";
const other = "other@example.test";
after(() => { closeDatabase(); if (temporary.startsWith(tmpdir())) rmSync(temporary, { recursive: true, force: true }); });

function draft(source = "Saved source", selected = ["bluesky", "linkedin"], variants = { bluesky: "Edited Bluesky text" }, mediaIds) {
  const now = new Date().toISOString();
  return { id: randomUUID(), title: "Reviewed idea", source, selected, variants,
    ...(mediaIds ? { mediaIds } : {}), createdAt: now, updatedAt: now };
}
function handoffs() {
  return [
    { destination: "bluesky", scheduledFor: new Date(Date.now() + 60_000).toISOString() },
    { destination: "linkedin", scheduledFor: new Date(Date.now() + 120_000).toISOString() },
  ];
}

test("batch handoffs snapshot saved platform versions and media, while repeat requests return originals", async () => {
  const image = (await createMedia(owner, {
    name: "cover.png", type: "image/png",
    bytes: await sharp({ create: { width: 4, height: 4, channels: 3, background: "#3366cc" } }).png().toBuffer(),
  })).media;
  const saved = saveDraft(owner, { ...draft("Saved source", undefined, undefined, [image.id]), mediaAlt: ["Blue cover image"] });
  const batchId = randomUUID();
  const items = handoffs();
  const first = prepareAssistedBatch(owner, saved.id, batchId, items);
  assert.equal(first.length, 2);
  assert.deepEqual(first.map((item) => item.text), ["Edited Bluesky text", "Saved source"]);
  assert.deepEqual(first.map((item) => item.destination), ["bluesky", "linkedin"]);
  assert.ok(first.every((item) => item.sourceDraftId === saved.id && item.batchId === batchId && item.status === "queued"));
  assert.ok(first.every((item) => item.title === saved.title && item.mediaIds[0] === image.id && item.mediaAlt[0] === "Blue cover image"));
  assert.equal(listWorkspace(owner).log.find((entry) => entry.action === "assisted.batch_prepared").detail, "2 manual handoffs");
  closeDatabase();
  assert.deepEqual(prepareAssistedBatch(owner, saved.id, batchId, [...items].reverse()), [...first].reverse());
  assert.equal(listWorkspace(owner).assisted.length, 2);
  assert.deepEqual(listWorkspace(other).assisted, []);
  assert.throws(() => prepareAssistedBatch(other, saved.id, randomUUID(), items), /Saved draft not found/);

  saveDraft(owner, { ...saved, source: "New source", variants: { bluesky: "New version" }, mediaAlt: ["Changed description"] }, saved.updatedAt);
  assert.deepEqual(prepareAssistedBatch(owner, saved.id, batchId, items).map((item) => item.text), first.map((item) => item.text));
  assert.deepEqual(prepareAssistedBatch(owner, saved.id, batchId, items).map((item) => item.mediaAlt), first.map((item) => item.mediaAlt));
  assert.throws(() => prepareAssistedBatch(owner, saved.id, batchId, items.slice(0, 1)), /different or partial/);
  assert.throws(() => prepareAssistedBatch(owner, saved.id, batchId, [items[0], { ...items[1], scheduledFor: new Date(Date.now() + 180_000).toISOString() }]), /different or partial/);
  assert.throws(() => prepareAssistedBatch(owner, randomUUID(), batchId, items), /different or partial/);
  assert.equal(listWorkspace(owner).assisted.length, 2);
  assert.equal(deleteAssisted(owner, first[0].id), true);
  assert.throws(() => prepareAssistedBatch(owner, saved.id, batchId, items), /different or partial/);
  assert.throws(() => prepareAssistedBatch(owner, saved.id, batchId, [items[1]]), /different or partial/);
  assert.equal(deleteAssisted(owner, first[1].id), true);
  assert.throws(() => prepareAssistedBatch(owner, saved.id, batchId, items), /handoffs were removed/);
});

test("unmodified platform text uses the same adaptation shown in Create", () => {
  const saved = saveDraft(owner, draft("First line\nSecond line", ["bluesky", "linkedin"], {}));
  const prepared = prepareAssistedBatch(owner, saved.id, randomUUID(), handoffs());
  assert.equal(prepared.find((item) => item.destination === "bluesky").text, "First line Second line");
  assert.equal(prepared.find((item) => item.destination === "linkedin").text, "First line\nSecond line");
});

test("queued handoff descriptions can be corrected without changing the draft or sibling", async () => {
  const image = (await createMedia(owner, {
    name: "detail.png", type: "image/png",
    bytes: await sharp({ create: { width: 4, height: 4, channels: 3, background: "#aabbcc" } }).png().toBuffer(),
  })).media;
  const saved = saveDraft(owner, { ...draft("Image note", undefined, undefined, [image.id]), mediaAlt: ["Original description"] });
  const [first, sibling] = prepareAssistedBatch(owner, saved.id, randomUUID(), handoffs());
  assert.equal(updateAssistedMediaAlt(owner, first.id, ["Original description"], ["Corrected description"]), true);
  const current = listWorkspace(owner);
  assert.deepEqual(current.assisted.find((item) => item.id === first.id).mediaAlt, ["Corrected description"]);
  assert.deepEqual(current.assisted.find((item) => item.id === sibling.id).mediaAlt, ["Original description"]);
  assert.deepEqual(current.drafts.find((item) => item.id === saved.id).mediaAlt, ["Original description"]);
  assert.equal(current.assisted.find((item) => item.id === first.id).scheduledFor, first.scheduledFor);
  assert.throws(() => updateAssistedMediaAlt(owner, first.id, ["Original description"], ["Overwritten"]), /changed/);
  assert.throws(() => updateAssistedMediaAlt(other, first.id, ["Corrected description"], ["Other owner"]), /no longer available/);
  assert.throws(() => updateAssistedMediaAlt(owner, first.id, ["Corrected description"], ["x".repeat(501)]), /up to 500/);

  const token = createSession(owner);
  const request = (cookie, origin = "http://localhost:3000") => new globalThis.Request("http://localhost:3000/api/workspace", {
    method: "POST", headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ action: "update-assisted-media-alt", id: first.id,
      expectedMediaAlt: ["Corrected description"], mediaAlt: ["Final description"] }),
  });
  assert.equal((await workspacePost(request())).status, 401);
  assert.equal((await workspacePost(request(`${SESSION_COOKIE}=${token}`, "https://other.example"))).status, 403);
  assert.equal((await workspacePost(request(`${SESSION_COOKIE}=${token}`))).status, 200);
  assert.deepEqual(listWorkspace(owner).assisted.find((item) => item.id === first.id).mediaAlt, ["Final description"]);
  assert.equal(setAssistedStatus(owner, first.id, "posted"), true);
  assert.throws(() => updateAssistedMediaAlt(owner, first.id, ["Final description"], ["After posting"]), /marked posted/);

  const legacyDraft = saveDraft(owner, draft("Older image note", ["bluesky"], {}, [image.id]));
  const [legacyHandoff] = prepareAssistedBatch(owner, legacyDraft.id, randomUUID(), [handoffs()[0]]);
  assert.equal(legacyHandoff.mediaAlt, undefined);
  assert.equal(updateAssistedMediaAlt(owner, legacyHandoff.id, [""], ["Added later"]), true);
  assert.deepEqual(listWorkspace(owner).assisted.find((item) => item.id === legacyHandoff.id).mediaAlt, ["Added later"]);
});

test("a revised handoff stays separate from its source draft and sibling destination", () => {
  const saved = saveDraft(owner, draft("Original source", ["bluesky", "linkedin"], { bluesky: "Original Bluesky" }));
  const batchId = randomUUID();
  const slots = handoffs();
  const [bluesky, linkedin] = prepareAssistedBatch(owner, saved.id, batchId, slots);
  assert.throws(() => updateAssistedText(owner, bluesky.id, bluesky.text, "x".repeat(301)), /destination's text limit/);
  updateAssistedText(owner, bluesky.id, bluesky.text, "Revised Bluesky");
  const current = listWorkspace(owner);
  const edited = current.assisted.find((item) => item.id === bluesky.id);
  assert.equal(edited.text, "Revised Bluesky");
  assert.equal(edited.sourceDraftId, saved.id);
  assert.equal(edited.batchId, batchId);
  assert.equal(edited.scheduledFor, bluesky.scheduledFor);
  assert.deepEqual(edited.mediaIds, bluesky.mediaIds);
  assert.equal(current.assisted.find((item) => item.id === linkedin.id).text, linkedin.text);
  assert.equal(current.drafts.find((item) => item.id === saved.id).variants.bluesky, "Original Bluesky");
  assert.equal(prepareAssistedBatch(owner, saved.id, batchId, slots)[0].text, "Revised Bluesky");
});

test("ready-now batch handoffs suppress duplicate browser alerts while future reminders remain pending", () => {
  const saved = saveDraft(owner, draft());
  const prepared = prepareAssistedBatch(owner, saved.id, randomUUID(), [
    { destination: "bluesky", scheduledFor: new Date(Date.now() - 1_000).toISOString() },
    { destination: "linkedin", scheduledFor: new Date(Date.now() + 60_000).toISOString() },
  ]);
  assert.equal(prepared[0].notifiedAt, prepared[0].createdAt);
  assert.equal(prepared[1].notifiedAt, undefined);
  const persisted = listWorkspace(owner).assisted.filter((item) => prepared.some((post) => post.id === item.id));
  assert.equal(persisted.find((item) => item.destination === "bluesky").notifiedAt, prepared[0].createdAt);
  assert.equal(persisted.find((item) => item.destination === "linkedin").notifiedAt, undefined);
});

test("invalid member, duplicates, missing media, and list-cap overflow roll back the entire batch", () => {
  const tooLong = saveDraft(other, draft("Normal source", ["bluesky", "linkedin"], { bluesky: "x".repeat(301) }));
  const items = handoffs();
  assert.throws(() => prepareAssistedBatch(other, tooLong.id, randomUUID(), items), /Fix the saved bluesky text/);
  assert.deepEqual(listWorkspace(other).assisted, []);
  assert.throws(() => prepareAssistedBatch(other, tooLong.id, randomUUID(), [items[0], items[0]]), /only once/);
  assert.throws(() => prepareAssistedBatch(other, tooLong.id, randomUUID(), [{ destination: "threads", scheduledFor: items[0].scheduledFor }]), /selected in this saved draft/);
  assert.throws(() => prepareAssistedBatch(other, tooLong.id, randomUUID(), [{ ...items[0], scheduledFor: "2026-02-30T12:00:00.000Z" }]), /UTC reminder times/);
  const missingMedia = saveDraft(other, draft("Okay", ["bluesky"], {}, []));
  database().prepare("UPDATE drafts SET payload=? WHERE id=? AND user_id=?")
    .run(JSON.stringify({ ...missingMedia, mediaIds: [randomUUID()] }), missingMedia.id, other);
  assert.throws(() => prepareAssistedBatch(other, missingMedia.id, randomUUID(), [items[0]]), /attached image is missing/);
  assert.deepEqual(listWorkspace(other).assisted, []);

  const ready = saveDraft(other, draft());
  const now = new Date().toISOString();
  const insert = database().prepare("INSERT INTO assisted(id,user_id,payload,scheduled_for,updated_at) VALUES (?,?,?,?,?)");
  for (let index = 0; index < 99; index++) {
    const post = { id: randomUUID(), title: `Existing ${index}`, destination: "x", text: "Existing", scheduledFor: now, createdAt: now, status: "queued" };
    insert.run(post.id, other, JSON.stringify(post), now, now);
  }
  assert.throws(() => prepareAssistedBatch(other, ready.id, randomUUID(), items), /list is full/);
  assert.equal(listWorkspace(other).assisted.length, 99);
});

test("provenance is a valid UUID pair, and manual action cannot forge draft-linked batch items", () => {
  const post = { id: randomUUID(), title: "Post", destination: "bluesky", text: "Text",
    scheduledFor: new Date().toISOString(), createdAt: new Date().toISOString(), status: "queued",
    sourceDraftId: randomUUID(), batchId: randomUUID() };
  const read = (item) => parseWorkspace({ version: 3, drafts: [], schedule: [], assisted: [item] })?.assisted;
  assert.deepEqual(read(post), [post]);
  for (const invalid of [{ ...post, sourceDraftId: undefined }, { ...post, batchId: undefined },
    { ...post, batchId: "bad" }, { ...post, destination: "x" }]) {
    assert.deepEqual(read(invalid), []);
  }
  assert.throws(() => addAssisted(owner, post), /Use batch preparation/);
});

test("batch route requires owner sign-in and same origin; response includes persisted handoffs", async () => {
  const saved = saveDraft(owner, draft("Route source", ["bluesky"], {}));
  const body = { action: "prepare-assisted-batch", draftId: saved.id, batchId: randomUUID(),
    items: [{ destination: "bluesky", scheduledFor: new Date(Date.now() + 60_000).toISOString() }] };
  const request = (cookie, origin = "http://localhost:3000") => new globalThis.Request("http://localhost:3000/api/workspace", {
    method: "POST", headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
  });
  assert.equal((await workspacePost(request())).status, 401);
  const token = createSession(owner);
  const cookie = `${SESSION_COOKIE}=${token}`;
  assert.equal((await workspacePost(request(cookie, "https://evil.example"))).status, 403);
  const response = await workspacePost(request(cookie));
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.ok(state.assisted.some((post) => post.batchId === body.batchId && post.sourceDraftId === saved.id));
  assert.equal((await workspacePost(request(cookie))).status, 200);
  assert.equal(listWorkspace(owner).assisted.filter((post) => post.batchId === body.batchId).length, 1);
});
