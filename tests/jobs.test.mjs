import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { addSchedule, importLibrary, listWorkspace } from "../src/lib/server/workspace.ts";
import { claimDue, processOneDue } from "../src/lib/server/jobs.ts";
import { closeDatabase } from "../src/lib/server/db.ts";

const temporary = mkdtempSync(join(tmpdir(), "plypost-jobs-"));
process.env.PLYPOST_DB_PATH = join(temporary, "jobs.sqlite");
const user = "worker@example.test";

after(() => { closeDatabase(); if (temporary.startsWith(tmpdir())) rmSync(temporary, { recursive: true, force: true }); });

test("worker retries unfinished platforms, records receipts once, and survives another tick", async () => {
  const due = new Date(Date.now() + 1000);
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
  const due = new Date(Date.now() + 1000);
  const post = { id: randomUUID(), title: "Restart test", source: "Hello", posts: { threads: "Hello" }, scheduledFor: due.toISOString(), createdAt: new Date().toISOString(), status: "queued" };
  addSchedule(user, post, "UTC");
  assert.equal(claimDue(new Date(due.getTime() + 1))?.id, post.id);
  closeDatabase();
  assert.equal(await processOneDue(new Date(due.getTime() + 5 * 60_000 + 1)), true);
  const item = listWorkspace(user).schedule.find((job) => job.id === post.id);
  assert.equal(item.status, "simulated");
  assert.equal(item.attempts, 2);
});
