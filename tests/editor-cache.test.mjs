import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureEditorTabId, isUntouchedStarterCache, otherOwnerEditorCopies, readOwnerEditorCache, writeOwnerEditorCache } from "../src/lib/editor-cache.ts";

function storage(entries = []) {
  const values = new Map(entries);
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

test("an older browser draft moves once, then editors stay separate by owner", () => {
  const local = storage([["socialflow-mvp", "old unsaved draft"]]);
  assert.equal(readOwnerEditorCache(local, "FIRST@example.test", "tab-a"), "old unsaved draft");
  writeOwnerEditorCache(local, "first@example.test", "tab-a", "first owner's latest draft");
  assert.equal(local.getItem("socialflow-mvp"), null);
  assert.equal(readOwnerEditorCache(local, "First@Example.Test", "tab-a"), "first owner's latest draft");
  assert.equal(readOwnerEditorCache(local, "second@example.test", "tab-b"), null);
  writeOwnerEditorCache(local, "second@example.test", "tab-b", "second owner's draft");
  assert.equal(readOwnerEditorCache(local, "first@example.test", "tab-a"), "first owner's latest draft");
  assert.equal(readOwnerEditorCache(local, "second@example.test", "tab-b"), "second owner's draft");
});

test("an existing owner cache prevents a different owner from claiming stale shared content", () => {
  const local = storage([
    ["plypost-editor-v2:first%40example.test", "first owner's draft"],
    ["socialflow-mvp", "stale shared draft"],
  ]);
  assert.equal(readOwnerEditorCache(local, "second@example.test", "tab-b"), null);
  assert.equal(readOwnerEditorCache(local, "first@example.test", "tab-a"), "first owner's draft");
});

test("a failed scoped write keeps the older browser copy available", () => {
  const local = storage([["socialflow-mvp", "draft to recover"]]);
  local.setItem = () => { throw new Error("storage unavailable"); };
  assert.throws(() => writeOwnerEditorCache(local, "first@example.test", "tab-a", "new content"));
  assert.equal(local.getItem("socialflow-mvp"), "draft to recover");
});

test("two unsaved editors keep separate browser copies across writes and reloads", () => {
  const local = storage([["plypost-editor-v2:first%40example.test", "older editor"]]);
  const a = JSON.stringify({ source: "First unsaved post", hasUnsavedWork: true, cachedAt: 10 });
  const b = JSON.stringify({ source: "Second unsaved post", hasUnsavedWork: true, cachedAt: 20 });
  assert.equal(readOwnerEditorCache(local, "first@example.test", "tab-a"), "older editor");
  writeOwnerEditorCache(local, "first@example.test", "tab-a", a);
  writeOwnerEditorCache(local, "first@example.test", "tab-b", b);
  assert.equal(readOwnerEditorCache(local, "first@example.test", "tab-a"), a);
  assert.equal(readOwnerEditorCache(local, "first@example.test", "tab-b"), b);
  assert.equal(readOwnerEditorCache(local, "first@example.test", "new-tab"), null);
  assert.deepEqual(otherOwnerEditorCopies(local, "first@example.test", "new-tab").map((copy) => copy.preview),
    ["Second unsaved post", "First unsaved post"]);
  assert.equal(otherOwnerEditorCopies(local, "second@example.test", "new-tab").length, 0);
});

test("a new tab copied from an opener gets a new editor identity while reload keeps its own", () => {
  const session = storage();
  assert.equal(ensureEditorTabId(session, "document-a", "navigate", () => "tab-a"), "tab-a");
  assert.equal(ensureEditorTabId(session, "document-a", "navigate", () => "unused"), "tab-a");
  assert.equal(ensureEditorTabId(session, "document-b", "reload", () => "unused"), "tab-a");
  const clonedSession = storage([["plypost-editor-tab-id", "tab-a"], ["plypost-editor-document", "document-a"]]);
  assert.equal(ensureEditorTabId(clonedSession, "document-c", "navigate", () => "tab-c"), "tab-c");
});

test("clean browser copies are omitted from recovery without deleting stored data", () => {
  const local = storage();
  writeOwnerEditorCache(local, "first@example.test", "tab-a", JSON.stringify({ source: "Saved draft", hasUnsavedWork: false, cachedAt: 10 }));
  assert.deepEqual(otherOwnerEditorCopies(local, "first@example.test", "tab-b"), []);
  assert.ok(readOwnerEditorCache(local, "first@example.test", "tab-a"));
});

test("only an untouched starter template is cleared from the editor cache", () => {
  const samples = ["Old example", "Earlier example"];
  const channels = ["bluesky", "mastodon", "linkedin", "threads"];
  const starter = { editorOrigin: "starter", source: samples[0], selected: channels, variants: {}, title: "", mediaIds: [], videoId: null, plannedDate: "", currentDraftId: null };
  assert.equal(isUntouchedStarterCache(starter, samples, channels), true);
  for (const changed of [
    { source: "My own idea" }, { title: "My title" }, { selected: ["linkedin"] },
    { variants: { linkedin: "My version" } }, { mediaIds: ["kept-image"] }, { mediaAlt: ["My caption"] },
    { videoId: "kept-video" }, { plannedDate: "2026-11-02" }, { currentDraftId: "saved-draft" },
    { editorOrigin: "new" },
  ]) {
    assert.equal(isUntouchedStarterCache({ ...starter, ...changed }, samples, channels), false);
  }
  assert.equal(isUntouchedStarterCache({ ...starter, placeLabel: "Central, Hong Kong" }, samples, channels), false,
    "a place note is an edit worth retaining");
  assert.equal(isUntouchedStarterCache({ ...starter, pendingDraftSave: { snapshot: { source: samples[0] } } }, samples, channels), false,
    "an unconfirmed save must keep its editor text");
});
