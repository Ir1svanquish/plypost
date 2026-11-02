import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { POST as register } from "../src/app/api/auth/register/route.ts";
import { POST as recover } from "../src/app/api/auth/recover/route.ts";
import { POST as login } from "../src/app/api/auth/login/route.ts";
import { POST as account } from "../src/app/api/auth/account/route.ts";
import { GET as workspace } from "../src/app/api/workspace/route.ts";
import { GET as mediaRead } from "../src/app/api/media/[id]/route.ts";
import { POST as mediaUpload } from "../src/app/api/media/route.ts";
import { closeDatabase, database } from "../src/lib/server/db.ts";
import { currentUser, createSession, passwordHash } from "../src/lib/server/auth.ts";
import { saveDraft, reserveAiRequest } from "../src/lib/server/workspace.ts";

const dir = mkdtempSync(join(tmpdir(), "plypost-accounts-"));
process.env.PLYPOST_DB_PATH = join(dir, "test.sqlite");
process.env.PLYPOST_OWNER_EMAIL = "judge@plypost.test";
process.env.PLYPOST_OWNER_PASSWORD_HASH = passwordHash("original-owner-password");
const base = "http://localhost";
const pass = "private-test-password";
function request(path, body, cookie, origin = base) {
  return new globalThis.Request(base + path, { method: "POST", headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
}
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
const read = (cookie) => new globalThis.Request(base, { headers: { cookie } });
async function signup(email) {
  const response = await register(request("/api/auth/register", { email, password: pass }));
  assert.equal(response.status, 200);
  return { cookie: cookieOf(response), ...await response.json() };
}
after(() => { closeDatabase(); if (dir.startsWith(tmpdir())) rmSync(dir, { recursive: true, force: true }); });

test("registration normalizes email, hashes credentials, and refuses duplicate/owner accounts", async () => {
  const a = await signup("  Writer@One.test  ");
  assert.equal(a.email, "writer@one.test");
  assert.equal(currentUser(read(a.cookie)), a.email);
  const row = database().prepare("SELECT * FROM accounts WHERE email=?").get(a.email);
  assert.match(row.password_hash, /^scrypt:/);
  assert.notEqual(row.recovery_hash, a.recoveryCode);
  assert.equal((await register(request("/api/auth/register", { email: a.email.toUpperCase(), password: pass }))).status, 409);
  assert.equal((await register(request("/api/auth/register", { email: "judge@plypost.test", password: pass }))).status, 409);
});

test("registration rejects bad origin, weak passwords, oversized bodies and closed registration", async () => {
  assert.equal((await register(request("/api/auth/register", { email: "a@b.test", password: pass }, null, "https://foreign.test"))).status, 403);
  assert.equal((await register(request("/api/auth/register", { email: "a@b.test", password: "short" }))).status, 400);
  assert.equal((await register(request("/api/auth/register", { email: "a@b.test", password: "x".repeat(5000) }))).status, 413);
  process.env.PLYPOST_REGISTRATION_ENABLED = "false";
  try { assert.equal((await register(request("/api/auth/register", { email: "a@b.test", password: pass }))).status, 403); }
  finally { delete process.env.PLYPOST_REGISTRATION_ENABLED; }
});

test("two real accounts cannot read or overwrite each other's drafts and media", async () => {
  const a = await signup("alice@isolation.test"), b = await signup("bob@isolation.test");
  const stamp = new Date().toISOString();
  const draft = saveDraft(a.email, { id: randomUUID(), title: "Private draft", source: "Only Alice", selected: [], variants: {}, createdAt: stamp, updatedAt: stamp });
  assert.equal((await (await workspace(read(a.cookie))).json()).drafts.length, 1);
  assert.equal((await (await workspace(read(b.cookie))).json()).drafts.length, 0);
  assert.throws(() => saveDraft(b.email, draft, draft.updatedAt), /not found/);
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#334455" } }).png().toBuffer();
  const form = new globalThis.FormData(); form.append("file", new globalThis.Blob([bytes], { type: "image/png" }), "private.png");
  const uploaded = await mediaUpload(new globalThis.Request(base + "/api/media", { method: "POST", headers: { origin: base, cookie: a.cookie }, body: form }));
  assert.equal(uploaded.status, 201);
  const { media } = await uploaded.json();
  assert.equal((await mediaRead(read(a.cookie), { params: Promise.resolve({ id: media.id }) })).status, 200);
  assert.equal((await mediaRead(read(b.cookie), { params: Promise.resolve({ id: media.id }) })).status, 404);
});

test("password change requires current password, rotates recovery code and invalidates old sessions", async () => {
  const a = await signup("change@password.test");
  const body = { action: "password", currentPassword: "wrong", password: "replacement-password" };
  assert.equal((await account(request("/api/auth/account", body, a.cookie))).status, 401);
  const changed = await account(request("/api/auth/account", { ...body, currentPassword: pass }, a.cookie));
  assert.equal(changed.status, 200);
  assert.equal(currentUser(read(a.cookie)), null);
  assert.equal(currentUser(read(cookieOf(changed))), a.email);
  assert.equal((await login(request("/api/auth/login", { email: a.email, password: pass }))).status, 401);
  assert.equal((await login(request("/api/auth/login", { email: a.email, password: body.password }))).status, 200);
  assert.equal((await recover(request("/api/auth/recover", { email: a.email, recoveryCode: a.recoveryCode, password: pass }))).status, 401);
});

test("recovery is single use even with concurrent requests and ends earlier sessions", async () => {
  const a = await signup("recover@password.test");
  const body = { email: a.email, recoveryCode: a.recoveryCode, password: "recovered-password" };
  const results = await Promise.all([recover(request("/api/auth/recover", body)), recover(request("/api/auth/recover", body))]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(currentUser(read(a.cookie)), null);
  assert.equal((await recover(request("/api/auth/recover", body))).status, 401);
});

test("revoking other sessions keeps this session and other users signed in", async () => {
  const a = await signup("session@password.test");
  const other = `plypost_session=${createSession(a.email)}`;
  const b = `plypost_session=${createSession("bob@isolation.test")}`;
  assert.equal((await account(request("/api/auth/account", { action: "sessions" }, a.cookie))).status, 200);
  assert.equal(currentUser(read(a.cookie)), a.email);
  assert.equal(currentUser(read(other)), null);
  assert.equal(currentUser(read(b)), "bob@isolation.test");
});

test("owner can change password in UI while a later environment change remains an administrative reset", async () => {
  const email = process.env.PLYPOST_OWNER_EMAIL;
  const old = `plypost_session=${createSession(email)}`;
  const changed = await account(request("/api/auth/account", { action: "password", currentPassword: "original-owner-password", password: "changed-owner-password" }, old));
  assert.equal(changed.status, 200);
  assert.equal((await login(request("/api/auth/login", { email, password: "changed-owner-password" }))).status, 200);
  process.env.PLYPOST_OWNER_PASSWORD_HASH = passwordHash("environment-reset-password");
  assert.equal(currentUser(read(cookieOf(changed))), null);
  assert.equal((await login(request("/api/auth/login", { email, password: "environment-reset-password" }))).status, 200);
});

test("AI usage is counted per user with a separate site-wide ceiling", () => {
  process.env.PLYPOST_AI_DAILY_LIMIT = "1";
  process.env.PLYPOST_AI_GLOBAL_DAILY_LIMIT = "2";
  try {
    assert.equal(reserveAiRequest("alice@isolation.test").allowed, true);
    assert.equal(reserveAiRequest("alice@isolation.test").allowed, false);
    assert.equal(reserveAiRequest("bob@isolation.test").allowed, true);
    assert.match(reserveAiRequest("third@test.test").error, /site/);
  } finally { delete process.env.PLYPOST_AI_DAILY_LIMIT; delete process.env.PLYPOST_AI_GLOBAL_DAILY_LIMIT; }
});


test("a stale tab cannot use another account's cookie to save its contents", async () => {
  const cookie = `plypost_session=${createSession("bob@isolation.test")}`;
  const req = new globalThis.Request(base + "/api/workspace", { headers: { cookie, "x-plypost-account": "alice@isolation.test" } });
  assert.equal(currentUser(req), null);
  assert.equal((await workspace(req)).status, 401);
});
