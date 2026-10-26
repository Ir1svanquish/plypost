import { test } from "node:test";
import assert from "node:assert/strict";
import { WorkspaceSnapshotGate } from "../src/lib/workspace-snapshot-gate.ts";

test("a late polling response cannot replace a draft that was just saved", () => {
  const gate = new WorkspaceSnapshotGate();
  const oldPoll = gate.beginRead();
  gate.beginWrite();
  gate.endWrite();
  assert.equal(gate.acceptRead(oldPoll), false);
  assert.equal(gate.acceptRead(gate.beginRead()), true);
});

test("a read started during a save stays stale even if it returns after the save", () => {
  const gate = new WorkspaceSnapshotGate();
  gate.beginWrite();
  const duringSave = gate.beginRead();
  assert.equal(gate.acceptRead(duringSave), false);
  gate.endWrite();
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
  gate.beginWrite();
  gate.endWrite();
  assert.equal(gate.acceptRead(before), false);
  assert.equal(gate.acceptRead(gate.beginRead()), true);
});
