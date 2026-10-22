import { test } from "node:test";
import assert from "node:assert/strict";
import { assistedState, draftTitle, emptyWorkspace, localDateTimeValue, parseWorkspace, scheduleState } from "../src/lib/workspace.ts";

const stamp = "2026-10-22T12:00:00.000Z";

test("existing v2 backups migrate without losing drafts or scheduled posts", () => {
  const backup = {
    version: 2,
    drafts: [{ id: "d1", title: "Launch", source: "Launch update", selected: ["bluesky", "threads"], variants: { bluesky: "Short update" }, createdAt: stamp, updatedAt: stamp }],
    schedule: [{ id: "s1", title: "Launch", source: "Launch update", posts: { bluesky: "Short update" }, scheduledFor: stamp, createdAt: stamp, status: "queued" }],
  };
  assert.deepEqual(parseWorkspace(JSON.parse(JSON.stringify(backup))), { ...backup, version: 3, assisted: [] });
  assert.deepEqual(parseWorkspace(emptyWorkspace()), emptyWorkspace());
});

test("backup parser rejects wrong versions and skips invalid content", () => {
  assert.equal(parseWorkspace({ version: 1, drafts: [], schedule: [] }), null);
  const parsed = parseWorkspace({
    version: 2,
    drafts: [{ id: "d1", title: "Good", source: "Text", selected: ["bluesky", "unknown"], variants: { bluesky: "Okay", unknown: "Ignored" }, createdAt: stamp, updatedAt: stamp }, { bad: true }],
    schedule: [{ id: "s1", title: "Too long", source: "Text", posts: { bluesky: "x".repeat(301) }, scheduledFor: stamp, createdAt: stamp, status: "queued" }],
  });
  assert.deepEqual(parsed.drafts[0].selected, ["bluesky"]);
  assert.deepEqual(parsed.drafts[0].variants, { bluesky: "Okay" });
  assert.equal(parsed.drafts.length, 1);
  assert.equal(parsed.schedule.length, 0);
  assert.deepEqual(parsed.assisted, []);
});

test("assisted posts round trip and invalid destinations are skipped", () => {
  const post = { id: "a1", title: "Launch", destination: "x", text: "Hello X", scheduledFor: stamp, createdAt: stamp, status: "queued" };
  const backup = { version: 3, drafts: [], schedule: [], assisted: [post, { ...post, id: "a2", destination: "unknown" }] };
  assert.deepEqual(parseWorkspace(backup), { ...backup, assisted: [post] });
  assert.equal(parseWorkspace({ version: 3, drafts: [], schedule: [] }), null);
  const dueAt = Date.parse(stamp);
  assert.equal(assistedState(post, dueAt - 1), "upcoming");
  assert.equal(assistedState(post, dueAt), "due");
  assert.equal(assistedState({ ...post, status: "posted" }, dueAt + 1), "posted");
});

test("plan items become due only at their local instant and remain simulated", () => {
  const post = { id: "s1", title: "Post", source: "Post", posts: { bluesky: "Post" }, scheduledFor: stamp, createdAt: stamp, status: "queued" };
  const dueAt = Date.parse(stamp);
  assert.equal(scheduleState(post, dueAt - 1), "upcoming");
  assert.equal(scheduleState(post, dueAt), "due");
  assert.equal(scheduleState({ ...post, status: "simulated" }, dueAt + 1), "simulated");
  assert.match(localDateTimeValue(new Date(2026, 9, 22, 9, 5)), /^2026-10-22T09:05$/);
  assert.equal(draftTitle("", "First line\nsecond line"), "First line");
});
