import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL, URLSearchParams } from "node:url";
import { closeDatabase, database } from "../src/lib/server/db.ts";
import { createSession, SESSION_COOKIE } from "../src/lib/server/auth.ts";
import {
  beginBlueskyConnect, blueskyConnection, blueskyStores, completeBlueskyConnect,
  disconnectBluesky, listBlueskyPublications, publishBlueskyText, resolveBlueskyPublication,
} from "../src/lib/server/bluesky.ts";
import { GET as connectionRoute } from "../src/app/api/bluesky/connection/route.ts";
import { POST as connectRoute } from "../src/app/api/bluesky/connect/route.ts";
import { POST as publishRoute } from "../src/app/api/bluesky/publish/route.ts";
import { POST as resolveRoute } from "../src/app/api/bluesky/publications/resolve/route.ts";

const temporary = mkdtempSync(join(tmpdir(), "plypost-bluesky-"));
const origin = "http://127.0.0.1:3199";
const owner = "owner@example.test";
const did = `did:plc:${"a".repeat(24)}`;
process.env.PLYPOST_DB_PATH = join(temporary, "bluesky.sqlite");
process.env.PLYPOST_OWNER_EMAIL = owner;
process.env.PLYPOST_OWNER_PASSWORD_HASH = "configured";
const token = createSession(owner);
const cookie = `${SESSION_COOKIE}=${token}`;

after(() => {
  closeDatabase();
  delete process.env.PLYPOST_BLUESKY_ORIGIN;
  delete process.env.PLYPOST_BLUESKY_SECRET;
  if (temporary.startsWith(tmpdir())) rmSync(temporary, { recursive: true, force: true });
});

function request(path, method = "GET", body, { originHeader = origin, cookieHeader = cookie } = {}) {
  return new globalThis.Request(`${origin}${path}`, { method,
    headers: { ...(originHeader ? { Origin: originHeader } : {}), ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("Bluesky OAuth state, session and one-shot text publishing remain owner-bound", async () => {
  assert.equal((await connectionRoute(request("/api/bluesky/connection"))).status, 200);
  assert.equal((await connectRoute(request("/api/bluesky/connect", "POST", { handle: "alice.bsky.social" }))).status, 400);
  assert.equal((await publishRoute(request("/api/bluesky/publish", "POST", { text: "Hi", clientRequestId: randomUUID(), accountDid: did }))).status, 503);

  process.env.PLYPOST_BLUESKY_ORIGIN = origin;
  process.env.PLYPOST_BLUESKY_SECRET = randomBytes(32).toString("hex");
  const stores = blueskyStores();
  const storedState = { dpopJwk: { kty: "EC", d: "private-state" }, marker: "state-secret" };
  await stores.stateStore.set("state-key", storedState);
  assert.deepEqual(await stores.stateStore.get("state-key"), storedState);
  const storedSession = { dpopJwk: { kty: "EC", d: "private-session" }, marker: "refresh-secret" };
  await stores.sessionStore.set(did, storedSession);
  assert.deepEqual(await stores.sessionStore.get(did), storedSession);
  const stateCipher = database().prepare("SELECT payload_cipher FROM bluesky_oauth_states").get().payload_cipher;
  const sessionCipher = database().prepare("SELECT payload_cipher FROM bluesky_sessions").get().payload_cipher;
  assert.ok(!stateCipher.includes("state-secret"));
  assert.ok(!sessionCipher.includes("refresh-secret"));
  await stores.stateStore.del("state-key");
  await stores.stateStore.set("abandoned-state", storedState);
  database().prepare("UPDATE bluesky_oauth_states SET created_at=? WHERE state_key='abandoned-state'")
    .run(new Date(Date.now() - 20 * 60_000).toISOString());

  assert.equal((await connectRoute(request("/api/bluesky/connect", "POST", { handle: "alice.bsky.social" },
    { originHeader: "https://evil.example" }))).status, 403);
  assert.equal((await connectRoute(request("/api/bluesky/connect", "POST", { handle: "alice.bsky.social" },
    { cookieHeader: "" }))).status, 401);
  assert.equal((await publishRoute(request("/api/bluesky/publish", "POST", { text: "Hi", clientRequestId: randomUUID(), accountDid: did },
    { originHeader: "https://evil.example" }))).status, 403);

  let appState;
  let callbackOverride = null;
  const revoked = [];
  const mockSession = {
    did,
    async getTokenInfo() { return { scope: "atproto repo:app.bsky.feed.post?action=create", sub: did }; },
    async fetchHandler(path, options) {
      assert.equal(path, "/xrpc/com.atproto.repo.createRecord");
      assert.equal(options.method, "POST");
      assert.equal(options.headers["Content-Type"], "application/json");
      const body = JSON.parse(options.body);
      assert.deepEqual(body.repo, did);
      assert.equal(body.collection, "app.bsky.feed.post");
      assert.equal(body.record.$type, "app.bsky.feed.post");
      assert.ok(body.record.createdAt);
      return globalThis.Response.json({ uri: `at://${did}/app.bsky.feed.post/3abc`, cid: "bafycid" });
    },
  };
  const mockClient = {
    async authorize(handle, options) {
      assert.equal(handle, "alice.bsky.social");
      assert.equal(options.scope, "atproto repo:app.bsky.feed.post?action=create");
      appState = options.state;
      return new URL("https://bsky.social/oauth/authorize?request_uri=urn%3Atest");
    },
    async callback(params, options) {
      assert.equal(params.get("code"), "test-code");
      assert.equal(options.redirect_uri, `${origin}/api/bluesky/callback`);
      await stores.sessionStore.set(did, storedSession);
      return { session: mockSession, state: callbackOverride ?? appState };
    },
    async restore(account) { assert.equal(account, did); return mockSession; },
    async revoke(account) { assert.equal(account, did); revoked.push(account); },
  };
  const started = await beginBlueskyConnect(owner, token, "@alice.bsky.social", mockClient);
  assert.match(started.authorizeUrl, /^https:/);
  assert.equal(blueskyConnection(owner).connected, false);
  assert.equal(database().prepare("SELECT COUNT(*) AS count FROM bluesky_oauth_states").get().count, 0);
  await assert.rejects(() => completeBlueskyConnect(new URLSearchParams({ state: "sdk-state", code: "test-code" }),
    "wrong-nonce", mockClient), /could not be verified/);
  callbackOverride = "incorrect-owner-state";
  await assert.rejects(() => completeBlueskyConnect(new URLSearchParams({ state: "sdk-state", code: "test-code" }),
    started.nonce, mockClient), /could not be verified/);
  assert.deepEqual(revoked, [did]);
  assert.equal(await stores.sessionStore.get(did), undefined);
  callbackOverride = null;
  const restarted = await beginBlueskyConnect(owner, token, "alice.bsky.social", mockClient);
  await completeBlueskyConnect(new URLSearchParams({ state: "sdk-state", code: "test-code" }), restarted.nonce, mockClient);
  assert.deepEqual(blueskyConnection(owner).account, { did });
  assert.equal(database().prepare("SELECT COUNT(*) AS count FROM bluesky_oauth_pending").get().count, 0);

  const id = randomUUID();
  const publish = (body, oauth = mockClient) => publishBlueskyText(owner, { accountDid: did, ...body }, oauth);
  const posted = await publish({ text: "Hello Bluesky", clientRequestId: id });
  assert.equal(posted.status, "posted");
  assert.equal(posted.uri, `at://${did}/app.bsky.feed.post/3abc`);
  assert.match(posted.url, /bsky\.app\/profile/);
  const replay = await publish({ text: "Hello Bluesky", clientRequestId: id },
    { ...mockClient, restore() { throw new Error("must not resend"); } });
  assert.deepEqual(replay, posted);
  await assert.rejects(() => publish({ text: "different", clientRequestId: id }), /already been used/);
  await assert.rejects(() => publish({ text: "x".repeat(301), clientRequestId: randomUUID() }), /Invalid Bluesky post text/);
  await assert.rejects(() => publishBlueskyText(owner, { text: "Wrong account", clientRequestId: randomUUID(), accountDid: `did:plc:${"b".repeat(24)}` }, mockClient), /account changed/);

  const uncertainId = randomUUID();
  const uncertain = await publish({ text: "uncertain text", clientRequestId: uncertainId },
    { ...mockClient, async restore() { return { ...mockSession, async fetchHandler() { throw new Error("network lost"); } }; } });
  assert.deepEqual(uncertain, { status: "unknown" });
  assert.deepEqual(await publish({ text: "uncertain text", clientRequestId: uncertainId }),
    { status: "unknown" });
  await assert.rejects(() => publish({ text: "uncertain text", clientRequestId: randomUUID() }),
    /unconfirmed result/);
  assert.equal((await resolveRoute(request("/api/bluesky/publications/resolve", "POST",
    { clientRequestId: uncertainId, resolution: "absent" }, { originHeader: "https://evil.example" }))).status, 403);
  assert.equal((await resolveRoute(request("/api/bluesky/publications/resolve", "POST",
    { clientRequestId: uncertainId, resolution: "absent" }, { cookieHeader: "" }))).status, 401);
  assert.deepEqual(resolveBlueskyPublication(owner, { clientRequestId: uncertainId, resolution: "absent" }), { ok: true });
  assert.equal(listBlueskyPublications(owner)[0].resolution, "absent");
  assert.throws(() => resolveBlueskyPublication(owner,
    { clientRequestId: uncertainId, resolution: "found" }), /unchecked unknown/);
  const fresh = await publish({ text: "uncertain text", clientRequestId: randomUUID() });
  assert.equal(fresh.status, "posted");
  assert.deepEqual(await publish({ text: "uncertain text", clientRequestId: uncertainId }),
    { status: "unknown" });
  const foundId = randomUUID();
  await publish({ text: "found text", clientRequestId: foundId },
    { ...mockClient, async restore() { return { ...mockSession, async fetchHandler() { throw new Error("network lost"); } }; } });
  resolveBlueskyPublication(owner, { clientRequestId: foundId, resolution: "found" });
  await assert.rejects(() => publish({ text: "found text", clientRequestId: randomUUID() }),
    /unconfirmed result/);
  assert.equal(listBlueskyPublications(owner).length, 4);
  assert.deepEqual(await disconnectBluesky(owner, mockClient), { ok: true, revoked: true });
  assert.equal(blueskyConnection(owner).connected, false);
  assert.equal(await stores.sessionStore.get(did), undefined);
  database().prepare("INSERT INTO bluesky_connections(user_id,did,connected_at) VALUES (?,?,?)")
    .run(owner, did, new Date().toISOString());
  await stores.sessionStore.set(did, storedSession);
  delete process.env.PLYPOST_BLUESKY_SECRET;
  assert.deepEqual(await disconnectBluesky(owner), { ok: true, revoked: false });
  assert.equal(blueskyConnection(owner).connected, false);
  assert.equal(database().prepare("SELECT COUNT(*) AS count FROM bluesky_sessions").get().count, 0);
});
