import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase } from "../src/lib/server/db.ts";
import { addAssisted, deleteAssisted, importLegacyLibrary, importLibrary, listWorkspace, markAssistedNotified, migrateAssisted, setAssistedStatus } from "../src/lib/server/workspace.ts";

const temporary = mkdtempSync(join(tmpdir(), "plypost-assisted-"));
process.env.PLYPOST_DB_PATH = join(temporary, "assisted.sqlite");
const owner = "owner@example.test";
const other = "other@example.test";

after(() => { closeDatabase(); if (temporary.startsWith(tmpdir())) rmSync(temporary, { recursive: true, force: true }); });

function item(text = "A post to publish") {
  return {
    id: randomUUID(), title: "Launch", destination: "x", text,
    scheduledFor: new Date(Date.now() + 60_000).toISOString(),
    createdAt: new Date().toISOString(), status: "queued",
  };
}

test("assisted items persist and status, notification, and deletion are scoped to the owner", () => {
  const post = item();
  assert.deepEqual(addAssisted(owner, post), post);
  closeDatabase();
  assert.deepEqual(listWorkspace(owner).assisted, [post]);
  assert.deepEqual(listWorkspace(other).assisted, []);
  assert.equal(setAssistedStatus(other, post.id, "posted"), false);
  markAssistedNotified(other, [post.id]);
  assert.equal(deleteAssisted(other, post.id), false);
  assert.equal(listWorkspace(owner).assisted[0].notifiedAt, undefined);

  markAssistedNotified(owner, [post.id]);
  const notifiedAt = listWorkspace(owner).assisted[0].notifiedAt;
  assert.ok(notifiedAt);
  markAssistedNotified(owner, [post.id]);
  assert.equal(listWorkspace(owner).assisted[0].notifiedAt, notifiedAt);

  assert.equal(setAssistedStatus(owner, post.id, "posted"), true);
  assert.equal(listWorkspace(owner).assisted[0].status, "posted");
  assert.ok(listWorkspace(owner).assisted[0].postedAt);
  assert.equal(setAssistedStatus(owner, post.id, "queued"), true);
  assert.equal(listWorkspace(owner).assisted[0].postedAt, undefined);
  assert.equal(deleteAssisted(owner, post.id), true);
  assert.deepEqual(listWorkspace(owner).assisted, []);
});

test("browser migration merges missing IDs idempotently and enforces the list cap atomically", () => {
  const posts = [item("One"), item("Two")];
  assert.throws(() => migrateAssisted(other, [posts[0], { ...posts[1], destination: "unknown" }]), /Invalid assisted migration/);
  assert.deepEqual(listWorkspace(other).assisted, []);
  assert.throws(() => migrateAssisted(other, [posts[0], posts[0]]), /Invalid assisted migration/);
  assert.equal(migrateAssisted(other, posts), "imported");
  assert.deepEqual(listWorkspace(other).assisted.map((post) => post.id).sort(), posts.map((post) => post.id).sort());
  const third = item("Third");
  assert.equal(migrateAssisted(other, [posts[0], third]), "imported");
  assert.equal(migrateAssisted(other, [posts[0], third]), "skipped");
  assert.equal(listWorkspace(other).assisted.length, 3);
  const fill = Array.from({ length: 97 }, (_, index) => item(`Fill ${index}`));
  assert.equal(migrateAssisted(other, fill), "imported");
  const overflow = item("Overflow");
  assert.throws(() => migrateAssisted(other, [posts[0], overflow]), /list is full/);
  assert.equal(listWorkspace(other).assisted.length, 100);
  assert.equal(listWorkspace(other).assisted.some((post) => post.id === overflow.id), false);
});

test("workspace backup replaces assisted items with the saved snapshot", () => {
  const replacement = { ...item("Backed up"), status: "posted", postedAt: new Date().toISOString() };
  importLibrary(owner, { version: 3, drafts: [], schedule: [], assisted: [replacement] });
  assert.deepEqual(listWorkspace(owner).assisted, [replacement]);
  assert.deepEqual(listWorkspace(other).assisted.length, 100);
  assert.throws(() => importLibrary(owner, { version: 3, drafts: [], schedule: [], assisted: [replacement, { ...replacement, id: randomUUID(), destination: "bad" }] }), /Invalid workspace backup/);
  assert.deepEqual(listWorkspace(owner).assisted, [replacement]);
});

test("legacy browser import replaces drafts and plans without replacing account assisted items", () => {
  const accountItem = listWorkspace(owner).assisted[0];
  const stamp = new Date().toISOString();
  const draft = { id: randomUUID(), title: "Legacy draft", source: "Hello", selected: ["bluesky"], variants: {}, createdAt: stamp, updatedAt: stamp };
  const schedule = { id: randomUUID(), title: "Legacy plan", source: "Hello", posts: { bluesky: "Hello" }, scheduledFor: new Date(Date.now() + 60_000).toISOString(), createdAt: stamp, status: "queued" };
  importLegacyLibrary(owner, { version: 3, drafts: [draft], schedule: [schedule], assisted: [item("Old browser item")] });
  const workspace = listWorkspace(owner);
  assert.equal(workspace.drafts[0].id, draft.id);
  assert.equal(workspace.schedule[0].id, schedule.id);
  assert.deepEqual(workspace.assisted, [accountItem]);
  assert.throws(() => importLegacyLibrary(owner, { version: 3, drafts: [{ ...draft, id: "invalid" }], schedule: [], assisted: [] }), /Backup has invalid IDs/);
  assert.deepEqual(listWorkspace(owner).assisted, [accountItem]);
  assert.equal(listWorkspace(owner).schedule[0].id, schedule.id);
});
