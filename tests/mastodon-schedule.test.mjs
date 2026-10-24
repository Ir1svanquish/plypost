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
  listMastodonSchedules, mastodonWorkerLastSeen, processOneDueMastodonSchedule, reconcileMastodonSchedules,
  resolveMastodonSchedule, rescheduleMastodonSchedule,
  touchMastodonWorker,
} from "../src/lib/server/mastodon-schedule.ts";
import { disconnectMastodon, publishMastodonText } from "../src/lib/server/mastodon.ts";
import { GET, PATCH, POST } from "../src/app/api/mastodon/schedule/route.ts";

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

test("authenticated, same-origin owner can confirm one real schedule without dispatching it in the route", async () => {
  fresh();
  const session = createSession(user);
  const cookie = `plypost_session=${session}`;
  const get = await GET(routeRequest("GET", cookie));
  assert.equal(get.status, 200);
  assert.deepEqual(await get.json(), { items: [], executionEnabled: true, mastodonWorkerLastSeen: null });
  const intent = plan("Only dispatch after the due time");
  const post = await POST(routeRequest("POST", cookie, intent));
  assert.equal(post.status, 201);
  assert.equal((await post.json()).item.clientRequestId, intent.clientRequestId);
  const confirmed = database().prepare("SELECT status,dispatch_authorized FROM mastodon_scheduled_posts WHERE client_request_id=?")
    .get(intent.clientRequestId);
  assert.equal(confirmed.status, "queued");
  assert.equal(confirmed.dispatch_authorized, 1);
  const replay = await POST(routeRequest("POST", cookie, intent));
  assert.equal(replay.status, 200);
  assert.equal(database().prepare("SELECT COUNT(*) AS count FROM mastodon_scheduled_posts").get().count, 1);
  assert.equal((await GET(routeRequest("GET"))).status, 401);
  assert.equal((await POST(routeRequest("POST", "", plan("Unauthenticated")))).status, 401);
  const crossOrigin = new globalThis.Request(`${origin}/api/mastodon/schedule`, {
    method: "POST", headers: { origin: "https://other.example", cookie, "Content-Type": "application/json" },
    body: JSON.stringify(plan("Cross-origin")),
  });
  assert.equal((await POST(crossOrigin)).status, 403);
});

test("an owner-confirmed time change keeps the exact intent and moves worker eligibility", async () => {
  fresh();
  const session = createSession(user);
  const cookie = `plypost_session=${session}`;
  const original = plan("Keep this exact account and text", new Date(Date.now() + 60_000).toISOString());
  createMastodonSchedule(user, original);
  const moved = new Date(Date.now() + 180_000).toISOString();
  const change = { clientRequestId: original.clientRequestId,
    expectedScheduledFor: original.scheduledFor, scheduledFor: moved };
  assert.equal((await PATCH(routeRequest("PATCH", "", change))).status, 401);
  const crossOrigin = new globalThis.Request(`${origin}/api/mastodon/schedule`, {
    method: "PATCH", headers: { origin: "https://other.example", cookie,
      "Content-Type": "application/json" }, body: JSON.stringify(change),
  });
  assert.equal((await PATCH(crossOrigin)).status, 403);
  const response = await PATCH(routeRequest("PATCH", cookie, change));
  assert.equal(response.status, 200);
  const item = (await response.json()).item;
  assert.equal(item.clientRequestId, original.clientRequestId);
  assert.equal(item.text, original.text);
  assert.equal(item.account.id, accountId);
  assert.equal(item.scheduledFor, moved);
  assert.equal(item.status, "queued");
  const row = database().prepare("SELECT text,account_id,scheduled_for,dispatch_authorized,status FROM mastodon_scheduled_posts WHERE client_request_id=?")
    .get(original.clientRequestId);
  assert.equal(row.dispatch_authorized, 1);
  assert.equal(row.scheduled_for, moved);
  assert.equal(row.text, original.text);
  assert.equal(row.account_id, accountId);
  assert.equal(claimDueMastodonSchedule(new Date(Date.parse(original.scheduledFor) + 1)), null);
  const stale = await PATCH(routeRequest("PATCH", cookie, change));
  assert.equal(stale.status, 409);
  assert.equal(claimDueMastodonSchedule(new Date(Date.parse(moved) + 1))?.client_request_id, original.clientRequestId);
  assert.throws(() => rescheduleMastodonSchedule(user, { ...change, expectedScheduledFor: moved,
    scheduledFor: new Date(Date.now() + 240_000).toISOString() }), /publishing has started/);
});

test("real time changes reject invalid, duplicate, paused and disconnected intents", () => {
  const db = fresh();
  const original = plan("Same text, two dates", new Date(Date.now() + 60_000).toISOString());
  createMastodonSchedule(user, original);
  const occupied = new Date(Date.now() + 180_000).toISOString();
  createMastodonSchedule(user, plan(original.text, occupied));
  const request = { clientRequestId: original.clientRequestId,
    expectedScheduledFor: original.scheduledFor, scheduledFor: occupied };
  assert.throws(() => rescheduleMastodonSchedule(user, request), /already queued at that time/);
  for (const scheduledFor of ["2026-02-30T12:00:00.000Z", new Date(Date.now() - 1000).toISOString()]) {
    assert.throws(() => rescheduleMastodonSchedule(user, { ...request, scheduledFor }), /UTC time|at least 10 seconds/);
  }
  process.env.PLYPOST_MASTODON_SCHEDULE_ENABLED = "false";
  try { assert.throws(() => rescheduleMastodonSchedule(user, request), /paused/); }
  finally { delete process.env.PLYPOST_MASTODON_SCHEDULE_ENABLED; }
  db.prepare("UPDATE mastodon_connections SET account_id='other-account' WHERE user_id=?").run(user);
  assert.throws(() => rescheduleMastodonSchedule(user, { ...request,
    scheduledFor: new Date(Date.now() + 240_000).toISOString() }), /no longer connected/);
  assert.equal(database().prepare("SELECT scheduled_for FROM mastodon_scheduled_posts WHERE client_request_id=?")
    .get(original.clientRequestId).scheduled_for, original.scheduledFor);
});

test("real worker heartbeat is separate from simulation heartbeat and a paused installation cannot queue or claim", async () => {
  const db = fresh();
  db.prepare("INSERT INTO worker_heartbeat(id,seen_at) VALUES (1,?)").run(new Date().toISOString());
  assert.equal(mastodonWorkerLastSeen(), null);
  touchMastodonWorker();
  assert.ok(mastodonWorkerLastSeen());
  const intent = plan("Pause before dispatch");
  createMastodonSchedule(user, intent);
  process.env.PLYPOST_MASTODON_SCHEDULE_ENABLED = "false";
  try {
    const session = createSession(user);
    const get = await GET(routeRequest("GET", `plypost_session=${session}`));
    const status = await get.json();
    assert.equal(status.executionEnabled, false);
    assert.equal(status.mastodonWorkerLastSeen, mastodonWorkerLastSeen());
    const post = await POST(routeRequest("POST", `plypost_session=${session}`, plan("No new real post")));
    assert.equal(post.status, 503);
    assert.throws(() => createMastodonSchedule(user, plan("No internal bypass")), /paused/);
    assert.equal(claimDueMastodonSchedule(new Date(Date.parse(intent.scheduledFor) + 1)), null);
    assert.equal(database().prepare("SELECT status FROM mastodon_scheduled_posts WHERE client_request_id=?")
      .get(intent.clientRequestId).status, "queued");
  } finally {
    delete process.env.PLYPOST_MASTODON_SCHEDULE_ENABLED;
  }
});

test("only newly authorized schedules are claimable; legacy queued rows become cancelled on upgrade", async () => {
  const db = fresh();
  const legacy = plan("An old unapproved schedule");
  createMastodonSchedule(user, legacy);
  db.prepare("UPDATE mastodon_scheduled_posts SET dispatch_authorized=0 WHERE client_request_id=?")
    .run(legacy.clientRequestId);
  const due = new Date(Date.parse(legacy.scheduledFor) + 1);
  assert.equal(claimDueMastodonSchedule(due), null);
  closeDatabase();
  const reopened = database();
  const oldRow = reopened.prepare("SELECT status,dispatch_authorized FROM mastodon_scheduled_posts WHERE client_request_id=?")
    .get(legacy.clientRequestId);
  assert.equal(oldRow.status, "cancelled");
  assert.equal(oldRow.dispatch_authorized, 0);
  assert.match(listMastodonSchedules(user)[0].error, /predates authorized/);
  let sends = 0;
  assert.equal(await processOneDueMastodonSchedule(due, async () => {
    sends += 1; return { status: "posted", id: "unexpected" };
  }), false);
  assert.equal(sends, 0);
});

test("schema upgrade defaults pre-existing queued rows to unauthorized and cancels them", () => {
  const old = fresh();
  const legacy = plan("Pre-upgrade text");
  createMastodonSchedule(user, legacy);
  old.exec("ALTER TABLE mastodon_scheduled_posts DROP COLUMN dispatch_authorized");
  closeDatabase();
  const upgraded = database();
  const record = upgraded.prepare("SELECT status,dispatch_authorized,last_error FROM mastodon_scheduled_posts WHERE client_request_id=?")
    .get(legacy.clientRequestId);
  assert.equal(record.dispatch_authorized, 0);
  assert.equal(record.status, "cancelled");
  assert.match(record.last_error, /predates authorized/);
});

test("a route-confirmed due intent is dispatched at most once", async () => {
  fresh();
  const session = createSession(user);
  const intent = plan("Once at the agreed time");
  const response = await POST(routeRequest("POST", `plypost_session=${session}`, intent));
  assert.equal(response.status, 201);
  const due = new Date(Date.parse(intent.scheduledFor) + 1);
  let sends = 0;
  assert.equal(await processOneDueMastodonSchedule(due, async () => {
    sends += 1; return { status: "posted", id: "remote-confirmed", url: `${instance}/@writer/remote-confirmed` };
  }), true);
  assert.equal(await processOneDueMastodonSchedule(due, async () => {
    sends += 1; return { status: "posted", id: "duplicate" };
  }), false);
  assert.equal(sends, 1);
  assert.equal(listMastodonSchedules(user)[0].status, "posted");
  assert.equal(listMastodonSchedules(user)[0].id, "remote-confirmed");
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
