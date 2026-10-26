import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers";
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

test("a user read interrupted by a write waits for it and loads the final snapshot", async () => {
  const gate = new WorkspaceSnapshotGate();
  let finishFirstRead;
  let requests = 0;
  const reading = gate.read(() => {
    requests += 1;
    return requests === 1 ? new Promise((resolve) => { finishFirstRead = resolve; }) : Promise.resolve("saved draft");
  });
  const save = gate.beginWrite();
  finishFirstRead("old draft");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests, 1);
  gate.endWrite(save, true);
  assert.equal(await reading, "saved draft");
  assert.equal(requests, 2);
});

test("a user read superseded by a faster poll retries instead of reporting a load error", async () => {
  const gate = new WorkspaceSnapshotGate();
  let finishFirstRead;
  let requests = 0;
  const reading = gate.read(() => {
    requests += 1;
    return requests === 1 ? new Promise((resolve) => { finishFirstRead = resolve; }) : Promise.resolve("current draft");
  });
  assert.equal(await gate.read(() => Promise.resolve("current draft"), 1), "current draft");
  finishFirstRead("old draft");
  assert.equal(await reading, "current draft");
  assert.equal(requests, 2);
});

test("a superseded background poll does not retry", async () => {
  const gate = new WorkspaceSnapshotGate();
  let finishPoll;
  let requests = 0;
  const polling = gate.read(() => {
    requests += 1;
    return new Promise((resolve) => { finishPoll = resolve; });
  }, 1);
  const save = gate.beginWrite();
  gate.endWrite(save, true);
  finishPoll("old draft");
  await assert.rejects(polling, /Workspace changed while loading/);
  assert.equal(requests, 1);
});
