import { test } from "node:test";
import assert from "node:assert/strict";
import { WorkspaceSnapshotGate } from "../src/lib/workspace-snapshot-gate.ts";

test("a late polling response cannot replace a draft that was just saved", () => {
  const gate = new WorkspaceSnapshotGate();
  const oldPoll = gate.beginRead();
  const save = gate.beginWrite();
  assert.deepEqual(gate.endWrite(save, true), { apply: true, refresh: false });
  assert.equal(gate.acceptRead(oldPoll), false);
  assert.equal(gate.acceptRead(gate.beginRead()), true);
});

test("a read started during a save stays stale even if it returns after the save", () => {
  const gate = new WorkspaceSnapshotGate();
  const save = gate.beginWrite();
  const duringSave = gate.beginRead();
  assert.equal(gate.acceptRead(duringSave), false);
  gate.endWrite(save, true);
  assert.equal(gate.acceptRead(duringSave), false);
});

test("slower older polls cannot roll back a newer workspace snapshot", () => {
  const gate = new WorkspaceSnapshotGate();
  const earlier = gate.beginRead();
  const later = gate.beginRead();
  assert.equal(gate.acceptRead(later), true);
  assert.equal(gate.acceptRead(earlier), false);
});

test("a failed write still invalidates reads that overlapped it", () => {
  const gate = new WorkspaceSnapshotGate();
  const before = gate.beginRead();
  const save = gate.beginWrite();
  gate.endWrite(save, false);
  assert.equal(gate.acceptRead(before), false);
  assert.equal(gate.acceptRead(gate.beginRead()), true);
});

test("a late older write response cannot roll back a newer one", () => {
  const gate = new WorkspaceSnapshotGate();
  const notification = gate.beginWrite();
  const draftSave = gate.beginWrite();
  assert.deepEqual(gate.endWrite(draftSave, true), { apply: true, refresh: false });
  assert.deepEqual(gate.endWrite(notification, true), { apply: false, refresh: true });
  assert.equal(gate.acceptRead(gate.beginRead()), true);
});

test("overlapping writes reconcile even when responses arrive in request order", () => {
  const gate = new WorkspaceSnapshotGate();
  const notification = gate.beginWrite();
  const draftSave = gate.beginWrite();
  assert.deepEqual(gate.endWrite(notification, true), { apply: true, refresh: false });
  assert.deepEqual(gate.endWrite(draftSave, true), { apply: true, refresh: true });
});
