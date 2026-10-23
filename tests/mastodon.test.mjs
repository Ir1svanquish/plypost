import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL, URLSearchParams } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { closeDatabase, database } from "../src/lib/server/db.ts";
import { createSession, deleteSession, SESSION_COOKIE } from "../src/lib/server/auth.ts";
import { GET as connection } from "../src/app/api/mastodon/connection/route.ts";
import { POST as connect } from "../src/app/api/mastodon/connect/route.ts";
import { GET as callback } from "../src/app/api/mastodon/callback/route.ts";
import { POST as disconnect } from "../src/app/api/mastodon/disconnect/route.ts";
import { GET as publications } from "../src/app/api/mastodon/publications/route.ts";
import { POST as resolvePublication } from "../src/app/api/mastodon/publications/resolve/route.ts";
import { POST as publish } from "../src/app/api/mastodon/publish/route.ts";

const temporary = mkdtempSync(join(tmpdir(), "plypost-mastodon-"));
const appOrigin = "http://127.0.0.1:3187";
const mastodonOrigin = "https://social.example";
const owner = "owner@example.test";
process.env.PLYPOST_DB_PATH = join(temporary, "mastodon.sqlite");
process.env.PLYPOST_OWNER_EMAIL = owner;
process.env.PLYPOST_OWNER_PASSWORD_HASH = "configured";
const sessionCookie = `${SESSION_COOKIE}=${createSession(owner)}`;
const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
  closeDatabase();
  delete process.env.PLYPOST_MASTODON_INSTANCE;
  delete process.env.PLYPOST_MASTODON_SECRET;
  delete process.env.PLYPOST_PUBLIC_ORIGIN;
  if (temporary.startsWith(tmpdir())) rmSync(temporary, { recursive: true, force: true });
});

function request(path, method = "GET", body, { cookie = sessionCookie, origin = appOrigin } = {}) {
  return new globalThis.Request(`${appOrigin}${path}`, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("Mastodon OAuth, text publishing, unknown outcomes and revocation stay scoped and durable", async () => {
  assert.deepEqual(await (await connection(request("/api/mastodon/connection"))).json(), {
    configured: false, connected: false,
  });
  assert.equal((await connect(request("/api/mastodon/connect", "POST"))).status, 503);
  process.env.PLYPOST_MASTODON_INSTANCE = mastodonOrigin;
  process.env.PLYPOST_PUBLIC_ORIGIN = appOrigin;
  process.env.PLYPOST_MASTODON_SECRET = randomBytes(32).toString("base64");

  const providerCalls = [];
  let statusMode = "posted";
  let revokeMode = "success";
  let pkceSupported = true;
  let characterLimit = 500;
  let limitGate = null;
  let limitStarted = null;
  let revokeGate = null;
  let revokeStarted = null;
  globalThis.fetch = async (target, options = {}) => {
    const url = new URL(String(target));
    providerCalls.push({ url: url.href, options });
    assert.equal(url.origin, mastodonOrigin);
    assert.equal(options.redirect, "error");
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return globalThis.Response.json({ issuer: `${mastodonOrigin}/`, authorization_endpoint: `${mastodonOrigin}/oauth/authorize`,
        token_endpoint: `${mastodonOrigin}/oauth/token`, code_challenge_methods_supported: pkceSupported ? ["S256"] : [],
        scopes_supported: ["profile", "write:statuses"] });
    }
    if (url.pathname === "/api/v1/apps") {
      const data = JSON.parse(options.body);
      assert.equal(data.redirect_uris, `${appOrigin}/api/mastodon/callback`);
      assert.equal(data.scopes, "profile write:statuses");
      return globalThis.Response.json({ client_id: "client-test-id", client_secret: "client-test-secret" });
    }
    if (url.pathname === "/oauth/token") {
      const form = new URLSearchParams(options.body);
      assert.equal(form.get("code"), "authorized-code");
      assert.ok(form.get("code_verifier"));
      return globalThis.Response.json({ access_token: "secret-access-token", scope: "profile write:statuses" });
    }
    if (url.pathname === "/api/v1/accounts/verify_credentials") {
      assert.equal(options.headers.Authorization, "Bearer secret-access-token");
      return globalThis.Response.json({ id: "account-42", acct: "alice", url: `${mastodonOrigin}/@alice` });
    }
    if (url.pathname === "/api/v2/instance") {
      assert.equal(options.headers.Authorization, "Bearer secret-access-token");
      if (limitGate) { limitStarted?.(); await limitGate; }
      return globalThis.Response.json({ configuration: { statuses: { max_characters: characterLimit } } });
    }
    if (url.pathname === "/api/v1/statuses") {
      assert.equal(options.headers.Authorization, "Bearer secret-access-token");
      if (statusMode === "unknown") throw new Error("connection broke after request");
      if (statusMode === "rejected") return globalThis.Response.json({ error: "invalid" }, { status: 422 });
      if (statusMode === "rate-limited") return globalThis.Response.json({ error: "rate" }, { status: 429 });
      if (statusMode === "server-error") return globalThis.Response.json({ error: "failure" }, { status: 500 });
      if (statusMode === "ambiguous") return globalThis.Response.json({ id: "post-unknown", url: null });
      if (statusMode === "no-url") return globalThis.Response.json({ id: "post-private", url: null, account: { id: "account-42" } });
      return globalThis.Response.json({ id: "post-99", url: `${mastodonOrigin}/@alice/99`, account: { id: "account-42" } });
    }
    if (url.pathname === "/oauth/revoke") {
      if (revokeGate) { revokeStarted?.(); await revokeGate; }
      const form = new URLSearchParams(options.body);
      assert.equal(form.get("token"), "secret-access-token");
      return revokeMode === "success" ? globalThis.Response.json({}) : globalThis.Response.json({ error: "unavailable" }, { status: 503 });
    }
    throw new Error(`Unexpected provider path ${url.pathname}`);
  };

  assert.equal((await connect(request("/api/mastodon/connect", "POST", undefined, { cookie: "" }))).status, 401);
  assert.equal((await connect(request("/api/mastodon/connect", "POST", undefined, { origin: "https://evil.example" }))).status, 403);
  pkceSupported = false;
  assert.equal((await connect(request("/api/mastodon/connect", "POST"))).status, 400);
  assert.equal(providerCalls.some((call) => call.url.endsWith("/api/v1/apps")), false);
  pkceSupported = true;
  const start = await connect(request("/api/mastodon/connect", "POST"));
  assert.equal(start.status, 200);
  assert.match(start.headers.get("cache-control"), /no-store/);
  assert.match(start.headers.get("set-cookie"), /SameSite=lax/i);
  const nonceCookie = start.headers.get("set-cookie").split(";")[0];
  const { authorizeUrl } = await start.json();
  const authorization = new URL(authorizeUrl);
  assert.equal(authorization.origin, mastodonOrigin);
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorization.searchParams.get("scope"), "profile write:statuses");
  const state = authorization.searchParams.get("state");
  assert.ok(state);

  const callbackPath = `/api/mastodon/callback?state=${encodeURIComponent(state)}&code=authorized-code`;
  const badCallback = await callback(request(callbackPath, "GET", undefined, { cookie: "", origin: "" }));
  assert.equal(badCallback.status, 303);
  assert.match(badCallback.headers.get("location"), /mastodon=error/);
  assert.equal(providerCalls.some((call) => call.url.endsWith("/oauth/token")), false);
  const completed = await callback(request(callbackPath, "GET", undefined, { cookie: nonceCookie, origin: "" }));
  assert.equal(completed.status, 303);
  assert.equal(completed.headers.get("location"), `${appOrigin}/?mastodon=connected#account`);
  assert.equal(completed.headers.get("referrer-policy"), "no-referrer");
  assert.equal((await callback(request(callbackPath, "GET", undefined, { cookie: nonceCookie, origin: "" }))).headers.get("location"),
    `${appOrigin}/?mastodon=error#account`);

  const saved = database().prepare("SELECT * FROM mastodon_connections WHERE user_id=?").get(owner);
  assert.equal(saved.instance, mastodonOrigin);
  assert.doesNotMatch(JSON.stringify(saved), /secret-access-token|client-test-secret/);
  assert.equal((await connection(request("/api/mastodon/connection"))).status, 200);
  const linked = await (await connection(request("/api/mastodon/connection"))).json();
  assert.equal(linked.connected, true);
  assert.deepEqual(linked.account, { id: "account-42", username: "alice", url: `${mastodonOrigin}/@alice` });

  const firstId = randomUUID();
  const first = await publish(request("/api/mastodon/publish", "POST", { text: "Hello Mastodon", clientRequestId: firstId }));
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { status: "posted", id: "post-99", url: `${mastodonOrigin}/@alice/99` });
  const sent = providerCalls.filter((call) => call.url.endsWith("/api/v1/statuses"));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].options.headers["Idempotency-Key"], firstId);
  const same = await publish(request("/api/mastodon/publish", "POST", { text: "Hello Mastodon", clientRequestId: firstId }));
  assert.equal(same.status, 200);
  assert.equal(providerCalls.filter((call) => call.url.endsWith("/api/v1/statuses")).length, 1);

  statusMode = "no-url";
  const privateId = randomUUID();
  const privatePost = await publish(request("/api/mastodon/publish", "POST", { text: "Private post", clientRequestId: privateId }));
  assert.equal(privatePost.status, 200);
  assert.deepEqual(await privatePost.json(), { status: "posted", id: "post-private" });
  const privateRepeat = await publish(request("/api/mastodon/publish", "POST", { text: "Private post", clientRequestId: privateId }));
  assert.deepEqual(await privateRepeat.json(), { status: "posted", id: "post-private" });
  statusMode = "posted";

  characterLimit = 5;
  assert.equal((await publish(request("/api/mastodon/publish", "POST", { text: "long text", clientRequestId: randomUUID() }))).status, 400);
  characterLimit = 500;
  assert.equal((await publish(request("/api/mastodon/publish", "POST", { text: "Photo", clientRequestId: randomUUID(), mediaIds: [randomUUID()] }))).status, 400);
  assert.equal((await publish(request("/api/mastodon/publish", "POST", { text: "Unauthenticated", clientRequestId: randomUUID() }, { cookie: "" }))).status, 401);

  statusMode = "unknown";
  const unknownId = randomUUID();
  const uncertain = await publish(request("/api/mastodon/publish", "POST", { text: "Possible post", clientRequestId: unknownId }));
  assert.equal(uncertain.status, 202);
  assert.deepEqual(await uncertain.json(), { status: "unknown" });
  const statusCalls = providerCalls.filter((call) => call.url.endsWith("/api/v1/statuses")).length;
  assert.equal((await publish(request("/api/mastodon/publish", "POST", { text: "Possible post", clientRequestId: unknownId }))).status, 202);
  assert.equal((await publish(request("/api/mastodon/publish", "POST", { text: "Possible post", clientRequestId: randomUUID() }))).status, 409);
  assert.equal(providerCalls.filter((call) => call.url.endsWith("/api/v1/statuses")).length, statusCalls);
  const listed = await (await publications(request("/api/mastodon/publications"))).json();
  const unknownListed = listed.publications.find((item) => item.clientRequestId === unknownId);
  assert.equal(unknownListed.status, "unknown");
  assert.equal(unknownListed.excerpt, "Possible post");
  assert.equal(unknownListed.resolution, undefined);
  assert.equal(listed.publications.find((item) => item.clientRequestId === firstId).status, "posted");
  assert.doesNotMatch(JSON.stringify(listed), /secret-access-token|client-test-secret/);
  assert.equal((await resolvePublication(request("/api/mastodon/publications/resolve", "POST",
    { clientRequestId: unknownId, resolution: "absent" }, { cookie: "" }))).status, 401);
  assert.equal((await resolvePublication(request("/api/mastodon/publications/resolve", "POST",
    { clientRequestId: unknownId, resolution: "absent" }, { origin: "https://evil.example" }))).status, 403);
  assert.equal((await resolvePublication(request("/api/mastodon/publications/resolve", "POST",
    { clientRequestId: unknownId, resolution: "guess" }))).status, 400);
  assert.equal((await resolvePublication(request("/api/mastodon/publications/resolve", "POST",
    { clientRequestId: randomUUID(), resolution: "absent" }))).status, 404);
  const foreignId = randomUUID();
  const foreignNow = new Date().toISOString();
  database().prepare(`INSERT INTO mastodon_publish_attempts
    (client_request_id,user_id,instance,account_id,content_hash,text_excerpt,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'unknown',?,?)`).run(foreignId, "someone@example.test", mastodonOrigin,
      "other-account", "foreign-hash", "Other owner's post", foreignNow, foreignNow);
  assert.equal((await resolvePublication(request("/api/mastodon/publications/resolve", "POST",
    { clientRequestId: foreignId, resolution: "absent" }))).status, 404);
  assert.equal((await resolvePublication(request("/api/mastodon/publications/resolve", "POST",
    { clientRequestId: firstId, resolution: "found" }))).status, 409);
  const callsBeforeResolve = providerCalls.length;
  const absent = await resolvePublication(request("/api/mastodon/publications/resolve", "POST",
    { clientRequestId: unknownId, resolution: "absent" }));
  assert.equal(absent.status, 200);
  assert.deepEqual(await absent.json(), { ok: true });
  assert.equal(providerCalls.length, callsBeforeResolve);
  assert.equal((await resolvePublication(request("/api/mastodon/publications/resolve", "POST",
    { clientRequestId: unknownId, resolution: "found" }))).status, 409);
  const resolvedUnknown = (await (await publications(request("/api/mastodon/publications"))).json())
    .publications.find((item) => item.clientRequestId === unknownId);
  assert.equal(resolvedUnknown.status, "unknown");
  assert.equal(resolvedUnknown.resolution, "absent");
  assert.ok(Date.parse(resolvedUnknown.resolvedAt) > 0);
  assert.equal((await publish(request("/api/mastodon/publish", "POST", { text: "Possible post", clientRequestId: unknownId }))).status, 202);
  statusMode = "posted";
  assert.equal((await publish(request("/api/mastodon/publish", "POST", { text: "Possible post", clientRequestId: randomUUID() }))).status, 200);

  statusMode = "rejected";
  const rejectedId = randomUUID();
  assert.equal((await publish(request("/api/mastodon/publish", "POST", { text: "Rejected post", clientRequestId: rejectedId }))).status, 400);
  assert.equal((await publish(request("/api/mastodon/publish", "POST", { text: "Rejected post", clientRequestId: rejectedId }))).status, 409);
  statusMode = "rate-limited";
  assert.equal((await publish(request("/api/mastodon/publish", "POST", { text: "Rate limited", clientRequestId: randomUUID() }))).status, 429);
  statusMode = "server-error";
  assert.equal((await publish(request("/api/mastodon/publish", "POST", { text: "Server error", clientRequestId: randomUUID() }))).status, 202);
  statusMode = "ambiguous";
  const ambiguousId = randomUUID();
  assert.equal((await publish(request("/api/mastodon/publish", "POST", { text: "A".repeat(180), clientRequestId: ambiguousId }))).status, 202);
  const ambiguousListed = (await (await publications(request("/api/mastodon/publications"))).json())
    .publications.find((item) => item.clientRequestId === ambiguousId);
  assert.equal(ambiguousListed.excerpt.length, 160);
  assert.equal((await resolvePublication(request("/api/mastodon/publications/resolve", "POST",
    { clientRequestId: ambiguousId, resolution: "found" }))).status, 200);
  assert.equal((await (await publications(request("/api/mastodon/publications"))).json())
    .publications.find((item) => item.clientRequestId === ambiguousId).resolution, "found");
  const callsBeforeFoundRetry = providerCalls.length;
  assert.equal((await publish(request("/api/mastodon/publish", "POST", { text: "A".repeat(180), clientRequestId: randomUUID() }))).status, 409);
  assert.equal(providerCalls.length, callsBeforeFoundRetry);
  assert.equal((await publications(request("/api/mastodon/publications", "GET", undefined, { cookie: "" }))).status, 401);

  const buriedId = randomUUID();
  const archiveDate = "2000-01-01T00:00:00.000Z";
  database().prepare(`INSERT INTO mastodon_publish_attempts
    (client_request_id,user_id,instance,account_id,content_hash,text_excerpt,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'unknown',?,?)`).run(buriedId, owner, mastodonOrigin,
      "account-42", "buried-hash", "Older uncertain post", archiveDate, archiveDate);
  const insertHistorical = database().prepare(`INSERT INTO mastodon_publish_attempts
    (client_request_id,user_id,instance,account_id,content_hash,status,created_at,updated_at)
    VALUES (?,?,?,?,?,'posted',?,?)`);
  for (let index = 0; index < 31; index += 1) {
    const date = new Date(Date.UTC(2020, 0, 1, 0, 0, index)).toISOString();
    insertHistorical.run(randomUUID(), owner, mastodonOrigin, "account-42", `historical-${index}`, date, date);
  }
  const archivedList = (await (await publications(request("/api/mastodon/publications"))).json()).publications;
  assert.ok(archivedList.length > 30);
  assert.equal(archivedList.find((item) => item.clientRequestId === buriedId).excerpt, "Older uncertain post");
  assert.equal((await resolvePublication(request("/api/mastodon/publications/resolve", "POST",
    { clientRequestId: buriedId, resolution: "absent" }))).status, 200);

  const staleText = "Stale inflight post";
  const staleId = randomUUID();
  database().prepare(`INSERT INTO mastodon_publish_attempts
    (client_request_id,user_id,instance,account_id,content_hash,status,created_at,updated_at)
    VALUES (?,?,?,?,?,'inflight',?,?)`).run(staleId, owner, mastodonOrigin, "account-42",
      createHash("sha256").update(staleText).digest("hex"), archiveDate, archiveDate);
  assert.equal((await publish(request("/api/mastodon/publish", "POST",
    { text: staleText, clientRequestId: randomUUID() }))).status, 409);
  assert.equal(database().prepare("SELECT status FROM mastodon_publish_attempts WHERE client_request_id=?").get(staleId).status, "unknown");
  assert.equal((await resolvePublication(request("/api/mastodon/publications/resolve", "POST",
    { clientRequestId: staleId, resolution: "absent" }))).status, 200);

  statusMode = "posted";
  let signalLimit;
  let releaseLimit;
  const limitEntered = new Promise((resolve) => { signalLimit = resolve; });
  limitGate = new Promise((resolve) => { releaseLimit = resolve; });
  limitStarted = signalLimit;
  const pendingId = randomUUID();
  const pendingPost = publish(request("/api/mastodon/publish", "POST", { text: "Post while disconnecting", clientRequestId: pendingId }));
  await limitEntered;
  assert.equal(database().prepare("SELECT status FROM mastodon_publish_attempts WHERE content_hash IS NOT NULL AND status='inflight' LIMIT 1").get().status, "inflight");
  assert.equal((await resolvePublication(request("/api/mastodon/publications/resolve", "POST",
    { clientRequestId: pendingId, resolution: "absent" }))).status, 409);
  assert.equal((await disconnect(request("/api/mastodon/disconnect", "POST"))).status, 409);
  limitGate = null;
  releaseLimit();
  assert.equal((await pendingPost).status, 200);

  assert.equal((await disconnect(request("/api/mastodon/disconnect", "POST", undefined, { origin: "https://evil.example" }))).status, 403);
  let signalRevoke;
  let releaseRevoke;
  const revokeEntered = new Promise((resolve) => { signalRevoke = resolve; });
  revokeGate = new Promise((resolve) => { releaseRevoke = resolve; });
  revokeStarted = signalRevoke;
  const pendingDisconnect = disconnect(request("/api/mastodon/disconnect", "POST"));
  await revokeEntered;
  assert.equal(database().prepare("SELECT disconnecting FROM mastodon_connections WHERE user_id=?").get(owner).disconnecting, 1);
  assert.equal((await publish(request("/api/mastodon/publish", "POST", { text: "After disconnect started", clientRequestId: randomUUID() }))).status, 409);
  revokeGate = null;
  releaseRevoke();
  const disconnected = await pendingDisconnect;
  assert.deepEqual(await disconnected.json(), { ok: true, revoked: true });
  assert.equal(database().prepare("SELECT 1 FROM mastodon_connections WHERE user_id=?").get(owner), undefined);
  assert.equal((await publish(request("/api/mastodon/publish", "POST", { text: "After disconnect", clientRequestId: randomUUID() }))).status, 409);

  const reconnect = await connect(request("/api/mastodon/connect", "POST"));
  const reconnectState = new URL((await reconnect.json()).authorizeUrl).searchParams.get("state");
  const reconnectNonce = reconnect.headers.get("set-cookie").split(";")[0];
  assert.equal((await callback(request(`/api/mastodon/callback?state=${reconnectState}&code=authorized-code`, "GET", undefined,
    { cookie: reconnectNonce, origin: "" }))).headers.get("location"), `${appOrigin}/?mastodon=connected#account`);
  revokeMode = "fail";
  database().prepare("UPDATE mastodon_connections SET disconnecting=1,disconnect_started_at=? WHERE user_id=?")
    .run(new Date(Date.now() - 60_000).toISOString(), owner);
  const notRevoked = await disconnect(request("/api/mastodon/disconnect", "POST"));
  assert.deepEqual(await notRevoked.json(), { ok: true, revoked: false });
  assert.equal(database().prepare("SELECT 1 FROM mastodon_connections WHERE user_id=?").get(owner), undefined);

  const logoutStart = await connect(request("/api/mastodon/connect", "POST"));
  const logoutState = new URL((await logoutStart.json()).authorizeUrl).searchParams.get("state");
  const logoutNonce = logoutStart.headers.get("set-cookie").split(";")[0];
  const tokenExchangesBeforeLogout = providerCalls.filter((call) => call.url.endsWith("/oauth/token")).length;
  deleteSession(sessionCookie.split("=")[1]);
  const loggedOutCallback = await callback(request(`/api/mastodon/callback?state=${logoutState}&code=authorized-code`, "GET", undefined,
    { cookie: logoutNonce, origin: "" }));
  assert.equal(loggedOutCallback.headers.get("location"), `${appOrigin}/?mastodon=error#account`);
  assert.equal(providerCalls.filter((call) => call.url.endsWith("/oauth/token")).length, tokenExchangesBeforeLogout);

  closeDatabase();
  const legacyPath = join(temporary, "legacy-mastodon.sqlite");
  const legacy = new DatabaseSync(legacyPath);
  legacy.exec(`
    CREATE TABLE mastodon_oauth_states (
      state_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,instance TEXT NOT NULL,redirect_uri TEXT NOT NULL,
      client_id_cipher TEXT NOT NULL,client_secret_cipher TEXT NOT NULL,verifier_cipher TEXT NOT NULL,
      nonce_hash TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL
    );
    CREATE TABLE mastodon_connections (
      user_id TEXT PRIMARY KEY,instance TEXT NOT NULL,account_id TEXT NOT NULL,username TEXT NOT NULL,
      account_url TEXT NOT NULL,access_token_cipher TEXT NOT NULL,client_id_cipher TEXT NOT NULL,
      client_secret_cipher TEXT NOT NULL,connected_at TEXT NOT NULL
    );
    CREATE TABLE mastodon_publish_attempts (
      client_request_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,instance TEXT NOT NULL,
      account_id TEXT NOT NULL,content_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('inflight','posted','unknown','rejected')),
      remote_id TEXT,remote_url TEXT,last_error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX mastodon_attempts_unresolved_content
      ON mastodon_publish_attempts(user_id,instance,account_id,content_hash)
      WHERE status IN ('inflight','unknown');
  `);
  const legacyId = randomUUID();
  legacy.prepare(`INSERT INTO mastodon_publish_attempts
    (client_request_id,user_id,instance,account_id,content_hash,status,created_at,updated_at)
    VALUES (?,?,?,?,?,'unknown',?,?)`).run(legacyId, owner, mastodonOrigin, "account-42", "legacy-hash", foreignNow, foreignNow);
  legacy.close();
  process.env.PLYPOST_DB_PATH = legacyPath;
  const upgraded = database();
  assert.equal(upgraded.prepare("SELECT resolution,text_excerpt FROM mastodon_publish_attempts WHERE client_request_id=?")
    .get(legacyId).resolution, null);
  assert.ok(upgraded.prepare("PRAGMA table_info(mastodon_oauth_states)").all().some((column) => column.name === "session_hash"));
  assert.ok(upgraded.prepare("PRAGMA table_info(mastodon_connections)").all().some((column) => column.name === "disconnecting"));
  upgraded.prepare("UPDATE mastodon_publish_attempts SET resolution='absent' WHERE client_request_id=?").run(legacyId);
  upgraded.prepare(`INSERT INTO mastodon_publish_attempts
    (client_request_id,user_id,instance,account_id,content_hash,status,created_at,updated_at)
    VALUES (?,?,?,?,?,'unknown',?,?)`).run(randomUUID(), owner, mastodonOrigin, "account-42", "legacy-hash", foreignNow, foreignNow);
  assert.throws(() => upgraded.prepare(`INSERT INTO mastodon_publish_attempts
    (client_request_id,user_id,instance,account_id,content_hash,status,created_at,updated_at)
    VALUES (?,?,?,?,?,'unknown',?,?)`).run(randomUUID(), owner, mastodonOrigin, "account-42", "legacy-hash", foreignNow, foreignNow));
});
