import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, database } from "../src/lib/server/db.ts";
import { createSession } from "../src/lib/server/auth.ts";
import {
  cancelMastodonSchedule, claimDueMastodonSchedule, createMastodonSchedule,
  listMastodonSchedules, processOneDueMastodonSchedule, reconcileMastodonSchedules,
  resolveMastodonSchedule,
} from "../src/lib/server/mastodon-schedule.ts";
import { disconnectMastodon, publishMastodonText } from "../src/lib/server/mastodon.ts";
import { GET, POST } from "../src/app/api/mastodon/schedule/route.ts";

const temporary = mkdtempSync(join(tmpdir(), "plypost-mastodon-schedule-"));
const user = "schedule-owner@example.test";
const instance = "https://mastodon.example";
const origin = "http://127.0.0.1:3000";
const accountId = "account-42";
process.env.PLYPOST_OWNER_EMAIL = user;
process.env.PLYPOST_OWNER_PASSWORD_HASH = "configured-for-route-tests";
process.env.PLYPOST_MASTODON_INSTANCE = instance;
process.env.PLYPOST_PUBLIC_ORIGIN = origin;
process.env.PLYPOST_MASTODON_SECRET = "11".repeat(32);
after(() => { closeDatabase(); if (temporary.startsWith(tmpdir())) rmSync(temporary, { recursive: true, force: true }); });

function fresh() {
  closeDatabase();
  process.env.PLYPOST_DB_PATH = join(temporary, `${randomUUID()}.sqlite`);
  const db = database();
  db.prepare(`INSERT INTO mastodon_connections
    (user_id,instance,account_id,username,account_url,access_token_cipher,client_id_cipher,client_secret_cipher,connected_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(user, instance, accountId, "writer", `${instance}/@writer`,
      "not-a-real-token", "not-a-real-client", "not-a-real-secret", new Date().toISOString());
  return db;
}

function plan(text, when = new Date(Date.now() + 30_000).toISOString(), id = randomUUID()) {
  return { clientRequestId: id, text, scheduledFor: when, accountId };
}

function routeRequest(method, cookie = "", body) {
  return new globalThis.Request(`${origin}/api/mastodon/schedule`, {
    method, headers: { origin, cookie, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("Mastodon scheduled live backend is inert by default while history remains readable", async () => {
  fresh();
  const session = createSession(user);
  const cookie = `plypost_session=${session}`;
  const get = await GET(routeRequest("GET", cookie));
  assert.equal(get.status, 200);
  assert.deepEqual(await get.json(), { items: [], executionEnabled: false });
  const post = await POST(routeRequest("POST", cookie, plan("Never dispatch from this test")));
  assert.equal(post.status, 503);
  assert.match((await post.json()).error, /not enabled/);
  assert.equal(database().prepare("SELECT COUNT(*) AS count FROM mastodon_scheduled_posts").get().count, 0);
  assert.equal((await GET(routeRequest("GET"))).status, 401);
});

test("intent stores exact account and text snapshot, replays one ID, and rejects accidental same-slot duplicates", () => {
  const db = fresh();
  const input = plan("A scheduled post");
  const first = createMastodonSchedule(user, input);
  assert.equal(first.created, true);
  assert.equal(first.item.status, "queued");
  assert.equal(first.item.account.id, accountId);
  assert.equal(first.item.text, input.text);
  assert.equal(createMastodonSchedule(user, input).created, false);
  assert.equal(listMastodonSchedules(user).length, 1);
  assert.throws(() => createMastodonSchedule(user, { ...input, clientRequestId: randomUUID() }), /already queued/);
  const anotherTime = new Date(Date.parse(input.scheduledFor) + 60_000).toISOString();
  assert.equal(createMastodonSchedule(user, plan(input.text, anotherTime)).created, true);
  assert.throws(() => createMastodonSchedule(user, { ...input, text: "Changed" }), /already been used/);
  assert.throws(() => createMastodonSchedule("other@example.test", input), /already been used/);
  assert.throws(() => createMastodonSchedule(user, { ...input, accountId: "wrong" }), /already been used/);
  db.prepare("UPDATE mastodon_connections SET disconnecting=1 WHERE user_id=?").run(user);
  assert.throws(() => createMastodonSchedule(user, plan("During disconnect")), /being removed/);
});

test("queued exact text blocks immediate live send and cancellation releases a slot", async () => {
  fresh();
  const input = plan("Save this for later");
  createMastodonSchedule(user, input);
  await assert.rejects(() => publishMastodonText(user, { text: input.text, clientRequestId: input.clientRequestId }),
    /belongs to a scheduled post/);
  await assert.rejects(() => publishMastodonText(user, { text: input.text, clientRequestId: randomUUID() }),
    /already scheduled/);
  assert.equal(database().prepare("SELECT COUNT(*) AS count FROM mastodon_publish_attempts").get().count, 0);
  assert.equal(cancelMastodonSchedule(user, { clientRequestId: input.clientRequestId }).status, "cancelled");
  assert.equal(cancelMastodonSchedule(user, { clientRequestId: input.clientRequestId }).status, "cancelled");
  assert.equal(createMastodonSchedule(user, plan(input.text, input.scheduledFor)).created, true);
});

test("crash after claim leaves unknown without any automatic resend", async () => {
  fresh();
  const input = plan("Crash window");
  createMastodonSchedule(user, input);
  const due = new Date(Date.parse(input.scheduledFor) + 1);
  assert.equal(claimDueMastodonSchedule(due)?.client_request_id, input.clientRequestId);
  reconcileMastodonSchedules(new Date(due.getTime() + 2 * 60_000 + 1));
  assert.equal(listMastodonSchedules(user)[0].status, "unknown");
  let calls = 0;
  assert.equal(await processOneDueMastodonSchedule(new Date(due.getTime() + 5 * 60_000), async () => {
    calls += 1; return { status: "posted", id: "should-not-be-used" };
  }), false);
  assert.equal(calls, 0);
  assert.throws(() => createMastodonSchedule(user, plan(input.text, new Date(Date.now() + 120_000).toISOString())),
    /needs a result check/);
  const checked = resolveMastodonSchedule(user, { clientRequestId: input.clientRequestId, resolution: "absent" });
  assert.equal(checked.status, "unknown");
  assert.equal(checked.resolution, "absent");
  assert.equal(createMastodonSchedule(user, plan(input.text, new Date(Date.now() + 120_000).toISOString())).created, true);
});

test("timeout result is quarantined and a durable posted attempt is reconciled after a crash", async () => {
  const db = fresh();
  const input = plan("Network timeout");
  createMastodonSchedule(user, input);
  const due = new Date(Date.parse(input.scheduledFor) + 1);
  let calls = 0;
  assert.equal(await processOneDueMastodonSchedule(due, async () => {
    calls += 1; return { status: "unknown" };
  }), true);
  assert.equal(listMastodonSchedules(user)[0].status, "unknown");
  assert.equal(await processOneDueMastodonSchedule(new Date(due.getTime() + 10 * 60_000), async () => {
    calls += 1; return { status: "posted", id: "duplicate" };
  }), false);
  assert.equal(calls, 1);
  const stamp = new Date().toISOString();
  db.prepare(`INSERT INTO mastodon_publish_attempts
    (client_request_id,user_id,instance,account_id,content_hash,status,remote_id,remote_url,created_at,updated_at)
    VALUES (?,?,?,?,?,'posted',?,?,?,?)`).run(input.clientRequestId, user, instance, accountId,
      database().prepare("SELECT content_hash FROM mastodon_scheduled_posts WHERE client_request_id=?")
        .get(input.clientRequestId).content_hash, "remote-1", `${instance}/@writer/remote-1`, stamp, stamp);
  reconcileMastodonSchedules();
  assert.equal(listMastodonSchedules(user)[0].status, "posted");
  assert.equal(listMastodonSchedules(user)[0].id, "remote-1");
});

test("unknown result check syncs the matching live attempt and a live request ID cannot be reused", () => {
  const db = fresh();
  const input = plan("Check this account");
  createMastodonSchedule(user, input);
  claimDueMastodonSchedule(new Date(Date.parse(input.scheduledFor) + 1));
  const stamp = new Date().toISOString();
  const contentHash = db.prepare("SELECT content_hash FROM mastodon_scheduled_posts WHERE client_request_id=?")
    .get(input.clientRequestId).content_hash;
  db.prepare(`INSERT INTO mastodon_publish_attempts
    (client_request_id,user_id,instance,account_id,content_hash,status,created_at,updated_at)
    VALUES (?,?,?,?,?,'unknown',?,?)`).run(input.clientRequestId, user, instance, accountId, contentHash, stamp, stamp);
  reconcileMastodonSchedules();
  assert.equal(listMastodonSchedules(user)[0].status, "unknown");
  resolveMastodonSchedule(user, { clientRequestId: input.clientRequestId, resolution: "absent" });
  assert.equal(db.prepare("SELECT resolution FROM mastodon_publish_attempts WHERE client_request_id=?")
    .get(input.clientRequestId).resolution, "absent");
  assert.throws(() => createMastodonSchedule(user, { ...plan("Another post"), clientRequestId: input.clientRequestId }),
    /already been used/);
  const oldManualId = randomUUID();
  db.prepare(`INSERT INTO mastodon_publish_attempts
    (client_request_id,user_id,instance,account_id,content_hash,status,created_at,updated_at)
    VALUES (?,?,?,?,?,'posted',?,?)`).run(oldManualId, user, instance, accountId, "other-hash", stamp, stamp);
  assert.throws(() => createMastodonSchedule(user, plan("New post", new Date(Date.now() + 90_000).toISOString(), oldManualId)),
    /already used for a live/);
});

test("disconnect cancels queued intents, refuses a live claim, and changed account cannot receive old text", async () => {
  const db = fresh();
  const queued = plan("Cancel on disconnect");
  createMastodonSchedule(user, queued);
  const active = plan("Already claimed", new Date(Date.now() + 40_000).toISOString());
  createMastodonSchedule(user, active);
  const due = new Date(Date.parse(active.scheduledFor) + 1);
  assert.equal(claimDueMastodonSchedule(due)?.client_request_id, queued.clientRequestId);
  await assert.rejects(() => disconnectMastodon(user), /scheduled Mastodon post to finish/);
  assert.equal(listMastodonSchedules(user).find((item) => item.clientRequestId === queued.clientRequestId).status, "inflight");
  reconcileMastodonSchedules(new Date(due.getTime() + 2 * 60_000 + 1));
  const result = await disconnectMastodon(user);
  assert.equal(result.revoked, false);
  assert.equal(listMastodonSchedules(user).find((item) => item.clientRequestId === active.clientRequestId).status, "cancelled");
  assert.equal(listMastodonSchedules(user).find((item) => item.clientRequestId === queued.clientRequestId).status, "unknown");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM mastodon_connections").get().count, 0);

  const changed = fresh();
  const staleAccount = plan("Do not send to another account");
  createMastodonSchedule(user, staleAccount);
  changed.prepare("UPDATE mastodon_connections SET account_id='different-account' WHERE user_id=?").run(user);
  let sends = 0;
  await processOneDueMastodonSchedule(new Date(Date.parse(staleAccount.scheduledFor) + 1), async () => {
    sends += 1; return { status: "posted", id: "bad" };
  });
  assert.equal(sends, 0);
  assert.equal(listMastodonSchedules(user)[0].status, "rejected");
});

test("old unresolved items remain listed beyond recent terminal history", () => {
  const db = fresh();
  const input = plan("Old uncertain item");
  createMastodonSchedule(user, input);
  db.prepare("UPDATE mastodon_scheduled_posts SET status='unknown',scheduled_for='2000-01-01T00:00:00.000Z',created_at='2000-01-01T00:00:00.000Z' WHERE client_request_id=?")
    .run(input.clientRequestId);
  const insert = db.prepare(`INSERT INTO mastodon_scheduled_posts
    (client_request_id,user_id,instance,account_id,account_username,account_url,text,content_hash,
     scheduled_for,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'cancelled',?,?)`);
  for (let index = 0; index < 110; index += 1) {
    const time = new Date(Date.UTC(2020, 0, 1, 0, 0, index)).toISOString();
    insert.run(randomUUID(), user, instance, accountId, "writer", `${instance}/@writer`, "Old", `hash-${index}`,
      time, time, time);
  }
  const items = listMastodonSchedules(user);
  assert.equal(items.find((item) => item.clientRequestId === input.clientRequestId)?.status, "unknown");
  assert.ok(items.length > 100);
});
