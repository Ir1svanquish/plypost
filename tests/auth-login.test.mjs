import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POST } from "../src/app/api/auth/login/route.ts";
import { currentUser, loginFailureKey, passwordHash, SESSION_COOKIE } from "../src/lib/server/auth.ts";
import { closeDatabase, database } from "../src/lib/server/db.ts";

const temporary = mkdtempSync(join(tmpdir(), "plypost-login-"));
process.env.PLYPOST_DB_PATH = join(temporary, "workspace.sqlite");
process.env.PLYPOST_OWNER_EMAIL = "owner@example.test";
process.env.PLYPOST_OWNER_PASSWORD_HASH = passwordHash("a-long-test-password");
process.env.RENDER = "true";
after(() => {
  closeDatabase();
  delete process.env.PLYPOST_DB_PATH;
  delete process.env.PLYPOST_OWNER_EMAIL;
  delete process.env.PLYPOST_OWNER_PASSWORD_HASH;
  delete process.env.RENDER;
  if (temporary.startsWith(tmpdir())) rmSync(temporary, { recursive: true, force: true });
});

function loginRequest(ip, password = "wrong-password", body, forwardedFor = "192.0.2.123") {
  return new globalThis.Request("https://plypost.example/api/auth/login", {
    method: "POST",
    headers: { origin: "https://plypost.example", "content-type": "application/json", "cf-connecting-ip": ip, "x-forwarded-for": forwardedFor },
    body: body ?? JSON.stringify({ email: "owner@example.test", password }),
  });
}

test("login failures throttle one visitor without locking out another", async () => {
  const firstIp = "198.51.100.14";
  const secondIp = "203.0.113.27";
  const firstKey = loginFailureKey(loginRequest(firstIp));
  assert.equal(firstKey, loginFailureKey(loginRequest(firstIp, undefined, undefined, "10.0.0.1, 10.0.0.2")));
  assert.notEqual(firstKey, loginFailureKey(loginRequest(secondIp)));
  assert.equal(firstKey.includes(firstIp), false);

  for (let index = 0; index < 5; index++) assert.equal((await POST(loginRequest(firstIp))).status, 401);
  assert.equal((await POST(loginRequest(firstIp, "a-long-test-password"))).status, 429);
  const other = await POST(loginRequest(secondIp, "a-long-test-password"));
  assert.equal(other.status, 200);
  assert.match(other.headers.get("set-cookie") ?? "", /plypost_session=/);
  assert.equal(database().prepare("SELECT COUNT(*) AS count FROM login_attempts WHERE key=?").get(firstKey).count, 5);
});

test("oversized login JSON is rejected before parsing or recording a failure", async () => {
  const ip = "192.0.2.44";
  const oversized = JSON.stringify({ email: "owner@example.test", password: "x".repeat(5_000) });
  const response = await POST(loginRequest(ip, undefined, oversized));
  assert.equal(response.status, 413);
  assert.equal(database().prepare("SELECT COUNT(*) AS count FROM login_attempts WHERE key=?")
    .get(loginFailureKey(loginRequest(ip))).count, 0);
});

test("changing the owner password invalidates earlier sessions", async () => {
  const email = "owner@example.test";
  const oldHash = process.env.PLYPOST_OWNER_PASSWORD_HASH;
  const login = await POST(loginRequest("203.0.113.91", "a-long-test-password"));
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  assert.match(cookie ?? "", new RegExp(`^${SESSION_COOKIE}=`));
  const sessionRequest = new globalThis.Request("https://plypost.example/api/auth/session", { headers: { cookie } });
  assert.equal(currentUser(sessionRequest), email);
  try {
    process.env.PLYPOST_OWNER_PASSWORD_HASH = passwordHash("a-different-long-password");
    assert.equal(currentUser(sessionRequest), null);
    assert.equal((await POST(loginRequest("203.0.113.91", "a-long-test-password"))).status, 401);
    assert.equal((await POST(loginRequest("203.0.113.91", "a-different-long-password"))).status, 200);
  } finally {
    process.env.PLYPOST_OWNER_PASSWORD_HASH = oldHash;
  }
});
