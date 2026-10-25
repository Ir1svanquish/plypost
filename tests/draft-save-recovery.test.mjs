import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inspectPendingDraftSave, parsePendingDraftSave, sameDraftPayload } from "../src/lib/draft-save-recovery.ts";

function draft() {
  const now = new Date().toISOString();
  return { id: randomUUID(), title: "Launch", source: "Doors open at 2", selected: ["bluesky"],
    variants: { bluesky: "Doors open at 2" }, mediaIds: [], mediaAlt: [], createdAt: now, updatedAt: now };
}

test("reconciles a save whose response was lost without creating a second draft", () => {
  const submitted = draft();
  const pending = { snapshot: submitted, expectedUpdatedAt: null, asCopy: false };
  const committed = { ...submitted, updatedAt: new Date(Date.now() + 1000).toISOString() };
  assert.equal(inspectPendingDraftSave(pending, committed), "committed");
  assert.equal(inspectPendingDraftSave(pending, undefined), "not-committed");
  assert.equal(inspectPendingDraftSave(pending, { ...committed, source: "Changed in another tab" }), "conflict");
});

test("retries an unchanged saved draft version but protects a newer edit", () => {
  const original = draft();
  const submitted = { ...original, source: "Doors open at 3" };
  const pending = { snapshot: submitted, expectedUpdatedAt: original.updatedAt, asCopy: false };
  assert.equal(inspectPendingDraftSave(pending, original), "not-committed");
  assert.equal(inspectPendingDraftSave(pending, { ...submitted, updatedAt: new Date(Date.now() + 1000).toISOString() }), "committed");
  assert.equal(inspectPendingDraftSave(pending, { ...original, source: "Different change", updatedAt: new Date(Date.now() + 2000).toISOString() }), "conflict");
  assert.equal(inspectPendingDraftSave(pending, undefined), "conflict");
});

test("comparison covers destinations and attachments, while ignoring server timestamps", () => {
  const saved = draft();
  assert.equal(sameDraftPayload(saved, { ...saved, updatedAt: new Date(Date.now() + 1000).toISOString() }), true);
  assert.equal(sameDraftPayload(saved, { ...saved, mediaIds: [randomUUID()], mediaAlt: ["photo"] }), false);
  assert.equal(sameDraftPayload(saved, { ...saved, selected: ["threads"] }), false);
  assert.equal(sameDraftPayload({ ...saved, selected: ["threads", "bluesky"] },
    { ...saved, selected: ["bluesky", "threads"] }), false);
});

test("restores only a valid pending draft from the local editor cache", () => {
  const saved = draft();
  const pending = { snapshot: saved, expectedUpdatedAt: null, asCopy: false };
  assert.deepEqual(parsePendingDraftSave(pending), pending);
  assert.equal(parsePendingDraftSave({ ...pending, snapshot: { ...saved, id: "not-an-id" } }), null);
  assert.equal(parsePendingDraftSave({ ...pending, asCopy: "yes" }), null);
});
