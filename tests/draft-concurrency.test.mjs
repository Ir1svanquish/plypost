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

test("an unfinished idea can be saved, completed later, and cannot be empty", () => {
  const idea = saveDraft(owner, { ...initial(""), title: "Workshop idea" });
  assert.equal(idea.source, "");
  assert.equal(listWorkspace(owner).drafts.find((draft) => draft.id === idea.id)?.title, "Workshop idea");

  const completed = saveDraft(owner, { ...idea, source: "Doors open at 1:30." }, idea.updatedAt);
  assert.equal(completed.source, "Doors open at 1:30.");

  const platformOnly = saveDraft(owner, { ...initial(""), title: "", selected: ["linkedin"],
    variants: { linkedin: "Behind the scenes at the workshop" } });
  assert.equal(platformOnly.title, "Behind the scenes at the workshop");
  assert.equal(platformOnly.variants.linkedin, "Behind the scenes at the workshop");

  assert.throws(() => saveDraft(owner, initial("")), /Add a title, caption, platform text, image or video/);
});

test("draft target dates persist, can move or clear, and never create jobs", () => {
  const saved = saveDraft(owner, { ...initial("Plan the workshop"), plannedDate: "2026-11-02" });
  assert.equal(listWorkspace(owner).drafts.find((draft) => draft.id === saved.id)?.plannedDate, "2026-11-02");
  assert.equal(listWorkspace(owner).schedule.length, 0);
  assert.throws(() => saveDraft(owner, { ...saved, plannedDate: "2026-11-31" }, saved.updatedAt), /Invalid draft/);
  const moved = saveDraft(owner, { ...saved, plannedDate: "2026-11-09" }, saved.updatedAt);
  assert.equal(moved.plannedDate, "2026-11-09");
  const withoutDate = { ...moved };
  delete withoutDate.plannedDate;
  const cleared = saveDraft(owner, withoutDate, moved.updatedAt);
  assert.equal(cleared.plannedDate, undefined);
  assert.equal(listWorkspace(owner).schedule.length, 0);
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
