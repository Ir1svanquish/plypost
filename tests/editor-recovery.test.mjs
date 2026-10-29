import { test } from "node:test";
import assert from "node:assert/strict";
import { openEditorRecovery, reopenedEditorValue, restoreRecoveryRecords, shouldReplaceRecoveryRecord } from "../src/lib/editor-recovery.ts";
import { otherOwnerEditorCopies } from "../src/lib/editor-cache.ts";

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
const owner = "maker@example.test";
const key = `plypost-editor-v3:${encodeURIComponent(owner)}:old-tab`;
const snapshot = (source, time) => JSON.stringify({ source, cachedAt: time, hasUnsavedWork: true });

test("opening an older copy survives the newer empty slot created by this tab", () => {
  const original = JSON.stringify({ source: "Recovered", cachedAt: 10, hasUnsavedWork: true, mediaIds: ["image"], variants: { linkedin: "Kept" } });
  const reopened = reopenedEditorValue(original, 30);
  const local = storage([[key, reopened]]);
  restoreRecoveryRecords(local, owner, [{ key, value: snapshot("", 20), updatedAt: 20 }]);
  assert.equal(local.getItem(key), reopened);
  assert.deepEqual(JSON.parse(reopened), { ...JSON.parse(original), cachedAt: 30 });
  assert.throws(() => reopenedEditorValue("null", 30));
});

test("late mirror writes cannot roll back a newer durable edit or removal", () => {
  const old = { key, value: snapshot("Old", 10), updatedAt: 10 };
  const newer = { key, value: snapshot("New", 20), updatedAt: 20 };
  const removed = { key, value: null, updatedAt: 20 };
  assert.equal(shouldReplaceRecoveryRecord(newer, old), false);
  assert.equal(shouldReplaceRecoveryRecord(old, newer), true);
  assert.equal(shouldReplaceRecoveryRecord(removed, old), false);
  assert.equal(shouldReplaceRecoveryRecord(removed, newer), false);
  assert.equal(shouldReplaceRecoveryRecord(newer, removed), true);
  assert.equal(shouldReplaceRecoveryRecord(removed, { ...newer, updatedAt: 30 }), true);
});

test("durable editor records recover missing and older browser copies", () => {
  for (const local of [storage(), storage([[key, snapshot("Earlier text", 10)]])]) {
    const value = snapshot("Unsaved text after the crash", 20);
    restoreRecoveryRecords(local, owner, [{ key, value, updatedAt: 20 }]);
    assert.equal(local.getItem(key), value);
    assert.equal(otherOwnerEditorCopies(local, owner, "new-tab")[0].preview, "Unsaved text after the crash");
  }
});

test("recovery cannot overwrite a newer or equally recent editor in another tab", () => {
  for (const time of [20, 30]) {
    const current = snapshot("Current tab", time);
    const local = storage([[key, current]]);
    restoreRecoveryRecords(local, owner, [{ key, value: snapshot("Old disk copy", 20), updatedAt: 20 }]);
    assert.equal(local.getItem(key), current);
  }
});

test("durable deletion removes stale copies but keeps later edits", () => {
  const local = storage([[key, snapshot("Deleted copy", 10)]]);
  restoreRecoveryRecords(local, owner, [{ key, value: null, updatedAt: 10 }]);
  assert.equal(local.getItem(key), null);
  const later = snapshot("Typed after removal", 30);
  local.setItem(key, later);
  restoreRecoveryRecords(local, owner, [{ key, value: null, updatedAt: 20 }]);
  assert.equal(local.getItem(key), later);
});

test("malformed local bytes stay available for raw recovery", () => {
  const raw = '{"source":"Unfinished JSON';
  const local = storage([[key, raw]]);
  restoreRecoveryRecords(local, owner, [{ key, value: snapshot("Previous value", 20), updatedAt: 20 }]);
  assert.equal(local.getItem(key), raw);
  restoreRecoveryRecords(local, owner, [{ key, value: null, updatedAt: 30 }]);
  assert.equal(local.getItem(key), raw);
});

test("recovery ignores other owners and invalid journal records", () => {
  const local = storage();
  restoreRecoveryRecords(local, owner, [
    { key: "plypost-editor-v3:someone%40example.test:tab", value: snapshot("Private", 20), updatedAt: 20 },
    { key, value: {}, updatedAt: 20 }, { key, value: "text", updatedAt: Infinity }, null,
  ]);
  assert.equal(local.length, 0);
  restoreRecoveryRecords(local, "MAKER@example.test", [{ key, value: snapshot("Own text", 20), updatedAt: 20 }]);
  assert.equal(local.length, 1);
});

test("unavailable IndexedDB falls back to existing browser storage and reports the limitation", async () => {
  const local = storage([[key, snapshot("Existing text", 10)]]);
  let failures = 0;
  const result = await openEditorRecovery(local, undefined, owner, () => failures++);
  assert.equal(result.storage, local);
  assert.equal(failures, 1);
  assert.match(result.storage.getItem(key), /Existing text/);
  result.close();
});
