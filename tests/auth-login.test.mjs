import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POST } from "../src/app/api/auth/login/route.ts";
import { currentUser, passwordHash, SESSION_COOKIE } from "../src/lib/server/auth.ts";
import { closeDatabase } from "../src/lib/server/db.ts";

const temporary = mkdtempSync(join(tmpdir(), "plypost-login-"));
process.env.PLYPOST_DB_PATH = join(temporary, "workspace.sqlite");
process.env.PLYPOST_OWNER_EMAIL = "owner@example.test";
process.env.PLYPOST_OWNER_PASSWORD_HASH = passwordHash("a-long-test-password");
after(() => {
  closeDatabase();
  delete process.env.PLYPOST_DB_PATH;
  delete process.env.PLYPOST_OWNER_EMAIL;
  delete process.env.PLYPOST_OWNER_PASSWORD_HASH;
  if (temporary.startsWith(tmpdir())) rmSync(temporary, { recursive: true, force: true });
});

function loginRequest(password = "wrong-password", body) {
  return new globalThis.Request("https://plypost.example/api/auth/login", {
    method: "POST",
    headers: { origin: "https://plypost.example", "content-type": "application/json" },
    body: body ?? JSON.stringify({ email: "owner@example.test", password }),
  });
}

test("wrong passwords do not lock the owner out", async () => {
  for (let index = 0; index < 6; index++) assert.equal((await POST(loginRequest())).status, 401);
  const correct = await POST(loginRequest("a-long-test-password"));
  assert.equal(correct.status, 200);
  assert.match(correct.headers.get("set-cookie") ?? "", /plypost_session=/);
});

test("oversized login JSON is rejected before parsing", async () => {
  const oversized = JSON.stringify({ email: "owner@example.test", password: "x".repeat(5_000) });
  const response = await POST(loginRequest(undefined, oversized));
  assert.equal(response.status, 413);
});

test("changing the owner password invalidates earlier sessions", async () => {
  const email = "owner@example.test";
  const oldHash = process.env.PLYPOST_OWNER_PASSWORD_HASH;
  const login = await POST(loginRequest("a-long-test-password"));
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  assert.match(cookie ?? "", new RegExp(`^${SESSION_COOKIE}=`));
  const sessionRequest = new globalThis.Request("https://plypost.example/api/auth/session", { headers: { cookie } });
  assert.equal(currentUser(sessionRequest), email);
  try {
    process.env.PLYPOST_OWNER_PASSWORD_HASH = passwordHash("a-different-long-password");
    assert.equal(currentUser(sessionRequest), null);
    assert.equal((await POST(loginRequest("a-long-test-password"))).status, 401);
    assert.equal((await POST(loginRequest("a-different-long-password"))).status, 200);
  } finally {
    process.env.PLYPOST_OWNER_PASSWORD_HASH = oldHash;
  }
});
