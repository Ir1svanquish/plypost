import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { addSchedule, deleteSchedule, importLibrary, listWorkspace, rescheduleSchedule, retrySchedule } from "../src/lib/server/workspace.ts";
import { claimDue, processOneDue } from "../src/lib/server/jobs.ts";
import { closeDatabase, database } from "../src/lib/server/db.ts";

const temporary = mkdtempSync(join(tmpdir(), "plypost-jobs-"));
process.env.PLYPOST_DB_PATH = join(temporary, "jobs.sqlite");
const user = "worker@example.test";
const currentJob = (id) => listWorkspace(user).schedule.find((item) => item.id === id);

after(() => { closeDatabase(); if (temporary.startsWith(tmpdir())) rmSync(temporary, { recursive: true, force: true }); });

test("worker retries unfinished platforms, records receipts once, and survives another tick", async () => {
  const due = new Date(Date.now() + 20_000);
  const post = { id: randomUUID(), title: "Retry test", source: "One idea", posts: { bluesky: "Blue", mastodon: "Masto" }, scheduledFor: due.toISOString(), createdAt: new Date().toISOString(), status: "queued" };
  addSchedule(user, post, "Asia/Hong_Kong");
  const observed = [];
  let failOnce = true;
  const publisher = async (platform, content) => {
    observed.push(platform);
    if (platform === "mastodon" && failOnce) { failOnce = false; throw new Error("Temporary failure"); }
    return { platform, content, status: "simulated", id: `sim_${randomUUID()}`, publishedAt: new Date().toISOString() };
  };
  assert.equal(await processOneDue(new Date(due.getTime() + 1), publisher), true);
  let item = listWorkspace(user).schedule[0];
  assert.equal(item.status, "queued");
  assert.equal(item.receipts.length, 1);
  assert.match(item.lastError, /Temporary failure/);
  closeDatabase();
  assert.equal(await processOneDue(new Date(Date.now() + 120_000), publisher), true);
  item = listWorkspace(user).schedule[0];
  assert.equal(item.status, "simulated");
  assert.deepEqual(observed, ["bluesky", "mastodon", "mastodon"]);
  assert.equal(item.receipts.length, 2);
  assert.equal(await processOneDue(new Date(Date.now() + 300_000), publisher), false);
  const receipt = item.receipts[0];
  importLibrary(user, { version: 3, drafts: [], schedule: [item], assisted: [] });
  assert.equal(listWorkspace(user).schedule[0].receipts[0].id, receipt.id);
});

test("expired running lease is reclaimed after database reopen", async () => {
  const due = new Date(Date.now() + 20_000);
  const post = { id: randomUUID(), title: "Restart test", source: "Hello", posts: { threads: "Hello" }, scheduledFor: due.toISOString(), createdAt: new Date().toISOString(), status: "queued" };
  addSchedule(user, post, "UTC");
  assert.equal(claimDue(new Date(due.getTime() + 1))?.id, post.id);
  closeDatabase();
  assert.equal(await processOneDue(new Date(due.getTime() + 5 * 60_000 + 1)), true);
  const item = listWorkspace(user).schedule.find((job) => job.id === post.id);
  assert.equal(item.status, "simulated");
  assert.equal(item.attempts, 2);
});

test("queued jobs can move to another future UTC instant without firing at the old time", () => {
  const original = new Date(Date.now() + 60_000);
  const moved = new Date(Date.now() + 180_000);
  const post = { id: randomUUID(), title: "Move me", source: "Hello", posts: { bluesky: "Hello" }, scheduledFor: original.toISOString(), createdAt: new Date().toISOString(), status: "queued" };
  addSchedule(user, post, "UTC");
  assert.equal(rescheduleSchedule(user, post.id, moved.toISOString(), "Asia/Hong_Kong", currentJob(post.id).revision), true);
  const item = listWorkspace(user).schedule.find((job) => job.id === post.id);
  assert.equal(item.scheduledFor, moved.toISOString());
  assert.equal(item.nextAttemptAt, moved.toISOString());
  assert.equal(item.attempts, 0);
  assert.deepEqual(item.receipts, []);
  const row = database().prepare("SELECT timezone,scheduled_for,next_attempt_at FROM jobs WHERE id=?").get(post.id);
  assert.equal(row.timezone, "Asia/Hong_Kong");
  assert.equal(row.scheduled_for, moved.toISOString());
  assert.equal(row.next_attempt_at, moved.toISOString());
  assert.equal(claimDue(new Date(original.getTime() + 1)), null);
  assert.equal(claimDue(new Date(moved.getTime() + 1))?.id, post.id);
  database().prepare("DELETE FROM jobs WHERE id=?").run(post.id);
});

test("moving a failed job keeps partial receipts and starts a fresh retry budget", async () => {
  const original = new Date(Date.now() + 60_000);
  const moved = new Date(Date.now() + 180_000);
  const post = { id: randomUUID(), title: "Partially complete", source: "Hello", posts: { bluesky: "Blue", mastodon: "Masto" }, scheduledFor: original.toISOString(), createdAt: new Date().toISOString(), status: "queued" };
  addSchedule(user, post, "UTC");
  const receipt = { platform: "bluesky", content: "Blue", status: "simulated", id: `sim_${randomUUID()}`, publishedAt: new Date().toISOString() };
  database().prepare("UPDATE jobs SET payload=?,status='failed',attempts=3,receipts=?,last_error='Service unavailable' WHERE id=?")
    .run(JSON.stringify({ ...post, status: "failed", lastError: "Stale payload error", nextAttemptAt: original.toISOString(), simulatedAt: original.toISOString() }), JSON.stringify([receipt]), post.id);
  assert.equal(rescheduleSchedule(user, post.id, moved.toISOString(), "UTC", currentJob(post.id).revision), true);
  const item = listWorkspace(user).schedule.find((job) => job.id === post.id);
  assert.equal(item.status, "queued");
  assert.equal(item.attempts, 0);
  assert.deepEqual(item.receipts, [receipt]);
  assert.equal(item.lastError, undefined);
  assert.equal(item.simulatedAt, undefined);
  assert.equal(item.nextAttemptAt, moved.toISOString());
  const stored = JSON.parse(database().prepare("SELECT payload FROM jobs WHERE id=?").get(post.id).payload);
  assert.equal(stored.lastError, undefined);
  assert.equal(stored.simulatedAt, undefined);
  assert.equal(stored.nextAttemptAt, undefined);
  assert.equal(claimDue(new Date(original.getTime() + 1)), null);
  const observed = [];
  assert.equal(await processOneDue(new Date(moved.getTime() + 1), async (platform) => {
    observed.push(platform);
    throw new Error("Temporary failure after move");
  }), true);
  assert.deepEqual(observed, ["mastodon"]);
  assert.equal(listWorkspace(user).schedule.find((job) => job.id === post.id).status, "queued");
  assert.equal(listWorkspace(user).schedule.find((job) => job.id === post.id).attempts, 1);
  assert.equal(await processOneDue(new Date(moved.getTime() + 120_000), async (platform, content) => {
    observed.push(platform);
    return { platform, content, status: "simulated", id: `sim_${randomUUID()}`, publishedAt: new Date().toISOString() };
  }), true);
  assert.deepEqual(observed, ["mastodon", "mastodon"]);
  assert.deepEqual(listWorkspace(user).schedule.find((job) => job.id === post.id).receipts.map((item) => item.id).slice(0, 1), [receipt.id]);
});

test("manual retry resets the automatic attempt budget", () => {
  const due = new Date(Date.now() + 60_000);
  const post = { id: randomUUID(), title: "Retry me", source: "Hello", posts: { threads: "Hello" }, scheduledFor: due.toISOString(), createdAt: new Date().toISOString(), status: "queued" };
  addSchedule(user, post, "UTC");
  database().prepare("UPDATE jobs SET status='failed',attempts=3,last_error='Service unavailable' WHERE id=?").run(post.id);
  assert.equal(retrySchedule(user, post.id, currentJob(post.id).revision), true);
  const item = listWorkspace(user).schedule.find((job) => job.id === post.id);
  assert.equal(item.status, "queued");
  assert.equal(item.attempts, 0);
  assert.equal(item.lastError, undefined);
});

test("an older plan view cannot move or delete a job changed in another window", () => {
  const original = new Date(Date.now() + 60_000).toISOString();
  const moved = new Date(Date.now() + 180_000).toISOString();
  const later = new Date(Date.now() + 300_000).toISOString();
  const post = { id: randomUUID(), title: "Two windows", source: "Hello", posts: { bluesky: "Hello" }, scheduledFor: original, createdAt: new Date().toISOString(), status: "queued" };
  addSchedule(user, post, "UTC");
  const stale = currentJob(post.id);
  assert.equal(rescheduleSchedule(user, post.id, moved, "UTC", stale.revision), true);
  assert.throws(() => rescheduleSchedule(user, post.id, later, "UTC", stale.revision), /changed in another window/);
  assert.throws(() => deleteSchedule(user, post.id, stale.revision), /changed in another window/);
  assert.equal(currentJob(post.id).scheduledFor, moved);
  assert.equal(deleteSchedule(user, post.id, currentJob(post.id).revision), true);
});

test("retry and delete reject a view from before job results changed", () => {
  const post = { id: randomUUID(), title: "Result changed", source: "Hello", posts: { bluesky: "Hello" }, scheduledFor: new Date(Date.now() + 60_000).toISOString(), createdAt: new Date().toISOString(), status: "queued" };
  addSchedule(user, post, "UTC");
  const stale = currentJob(post.id);
  database().prepare("UPDATE jobs SET status='failed',attempts=3,last_error='Temporary failure' WHERE id=?").run(post.id);
  assert.throws(() => retrySchedule(user, post.id, stale.revision), /changed in another window/);
  assert.throws(() => deleteSchedule(user, post.id, stale.revision), /changed in another window/);
  const failed = currentJob(post.id);
  assert.equal(retrySchedule(user, post.id, failed.revision), true);
  assert.equal(currentJob(post.id).status, "queued");
  assert.equal(deleteSchedule(user, post.id, currentJob(post.id).revision), true);
});

test("rescheduling rejects impossible, non-UTC, past and too-soon instants, unknown zones and unsafe states", () => {
  const original = new Date(Date.now() + 60_000);
  const moved = new Date(Date.now() + 180_000);
  const post = { id: randomUUID(), title: "Guarded", source: "Hello", posts: { threads: "Hello" }, scheduledFor: original.toISOString(), createdAt: new Date().toISOString(), status: "queued" };
  addSchedule(user, post, "UTC");
  for (const stamp of ["2026-02-30T12:00:00.000Z", "2026-01-01T24:00:00.000Z", "2026-01-01T12:00:00+08:00", new Date(Date.now() - 1000).toISOString(), new Date(Date.now() + 1000).toISOString()]) {
    assert.throws(() => rescheduleSchedule(user, post.id, stamp, "UTC", currentJob(post.id).revision), /valid UTC time/);
  }
  assert.throws(() => rescheduleSchedule(user, post.id, moved.toISOString(), "Mars/Olympus", currentJob(post.id).revision), /recognized timezone/);
  assert.equal(rescheduleSchedule("other@example.test", post.id, moved.toISOString(), "UTC", currentJob(post.id).revision), false);
  assert.equal(listWorkspace(user).schedule.find((job) => job.id === post.id).scheduledFor, original.toISOString());
  database().prepare("UPDATE jobs SET status='running',lease_until=? WHERE id=?").run(new Date(Date.now() + 300_000).toISOString(), post.id);
  assert.equal(rescheduleSchedule(user, post.id, moved.toISOString(), "UTC", currentJob(post.id).revision), false);
  database().prepare("UPDATE jobs SET status='simulated',lease_until=NULL WHERE id=?").run(post.id);
  assert.equal(rescheduleSchedule(user, post.id, moved.toISOString(), "UTC", currentJob(post.id).revision), false);
  assert.equal(listWorkspace(user).schedule.find((job) => job.id === post.id).scheduledFor, original.toISOString());
});
