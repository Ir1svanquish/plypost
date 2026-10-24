import { test } from "node:test";
import assert from "node:assert/strict";
import { readOwnerEditorCache, writeOwnerEditorCache } from "../src/lib/editor-cache.ts";

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
  assert.equal(readOwnerEditorCache(local, "FIRST@example.test"), "old unsaved draft");
  writeOwnerEditorCache(local, "first@example.test", "first owner's latest draft");
  assert.equal(local.getItem("socialflow-mvp"), null);
  assert.equal(readOwnerEditorCache(local, "First@Example.Test"), "first owner's latest draft");
  assert.equal(readOwnerEditorCache(local, "second@example.test"), null);
  writeOwnerEditorCache(local, "second@example.test", "second owner's draft");
  assert.equal(readOwnerEditorCache(local, "first@example.test"), "first owner's latest draft");
  assert.equal(readOwnerEditorCache(local, "second@example.test"), "second owner's draft");
});

test("an existing owner cache prevents a different owner from claiming stale shared content", () => {
  const local = storage([
    ["plypost-editor-v2:first%40example.test", "first owner's draft"],
    ["socialflow-mvp", "stale shared draft"],
  ]);
  assert.equal(readOwnerEditorCache(local, "second@example.test"), null);
  assert.equal(readOwnerEditorCache(local, "first@example.test"), "first owner's draft");
});

test("a failed scoped write keeps the older browser copy available", () => {
  const local = storage([["socialflow-mvp", "draft to recover"]]);
  local.setItem = () => { throw new Error("storage unavailable"); };
  assert.throws(() => writeOwnerEditorCache(local, "first@example.test", "new content"));
  assert.equal(local.getItem("socialflow-mvp"), "draft to recover");
});
