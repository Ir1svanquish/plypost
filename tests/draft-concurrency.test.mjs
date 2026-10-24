import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase } from "../src/lib/server/db.ts";
import { deleteDraft, DraftConflictError, importLibrary, listWorkspace, saveDraft } from "../src/lib/server/workspace.ts";

const temporary = mkdtempSync(join(tmpdir(), "plypost-draft-concurrency-"));
process.env.PLYPOST_DB_PATH = join(temporary, "drafts.sqlite");
after(() => { closeDatabase(); rmSync(temporary, { recursive: true, force: true }); });

const owner = "draft-owner@example.test";
const initial = (source) => ({ id: randomUUID(), title: source, source, selected: ["bluesky"], variants: {},
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

test("a stale window cannot overwrite another window's draft, and can save a copy", () => {
  const first = saveDraft(owner, initial("Original"));
  const newer = saveDraft(owner, { ...first, source: "Newer edit" }, first.updatedAt);
  assert.ok(Date.parse(newer.updatedAt) > Date.parse(first.updatedAt));
  assert.throws(() => saveDraft(owner, { ...first, source: "Stale edit" }, first.updatedAt), DraftConflictError);
  assert.throws(() => saveDraft(owner, { ...first, source: "Missing revision" }), DraftConflictError);
  assert.equal(listWorkspace(owner).drafts.find((draft) => draft.id === first.id)?.source, "Newer edit");

  const copy = saveDraft(owner, { ...first, id: randomUUID(), title: "Recovered copy", source: "Stale edit" }, null);
  assert.equal(listWorkspace(owner).drafts.find((draft) => draft.id === copy.id)?.source, "Stale edit");
  assert.equal(listWorkspace(owner).drafts.find((draft) => draft.id === first.id)?.source, "Newer edit");
});

test("a deleted draft cannot be silently recreated by an old window", () => {
  const saved = saveDraft(owner, initial("Delete me"));
  assert.equal(deleteDraft(owner, saved.id, saved.updatedAt), true);
  assert.throws(() => saveDraft(owner, { ...saved, source: "Late edit" }, saved.updatedAt), DraftConflictError);
  assert.equal(listWorkspace(owner).drafts.some((draft) => draft.id === saved.id), false);
});

test("an old library view cannot delete a newer draft revision", () => {
  const saved = saveDraft(owner, initial("Keep newer"));
  const newer = saveDraft(owner, { ...saved, source: "Latest content" }, saved.updatedAt);
  assert.throws(() => deleteDraft(owner, saved.id, saved.updatedAt), DraftConflictError);
  assert.equal(listWorkspace(owner).drafts.find((draft) => draft.id === saved.id)?.source, "Latest content");
  assert.equal(deleteDraft(owner, saved.id, newer.updatedAt), true);
});

test("text backup replacement invalidates an already open editor version", () => {
  const saved = saveDraft(owner, initial("Before import"));
  importLibrary(owner, { version: 3, drafts: [{ ...saved, source: "Restored from backup" }], schedule: [], assisted: [] });
  const restored = listWorkspace(owner).drafts.find((draft) => draft.id === saved.id);
  assert.ok(restored.updatedAt > saved.updatedAt);
  assert.equal(restored.source, "Restored from backup");
  assert.throws(() => saveDraft(owner, { ...saved, source: "Old window" }, saved.updatedAt), DraftConflictError);
  assert.equal(listWorkspace(owner).drafts.find((draft) => draft.id === saved.id)?.source, "Restored from backup");
});
