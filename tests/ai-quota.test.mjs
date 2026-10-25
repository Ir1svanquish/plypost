import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, database } from "../src/lib/server/db.ts";
import { reserveAiRequest } from "../src/lib/server/workspace.ts";

const temporary = mkdtempSync(join(tmpdir(), "plypost-ai-quota-"));
process.env.PLYPOST_DB_PATH = join(temporary, "quota.sqlite");
after(() => {
  closeDatabase();
  delete process.env.PLYPOST_AI_DAILY_LIMIT;
  if (temporary.startsWith(tmpdir())) rmSync(temporary, { recursive: true, force: true });
});

test("an optional 24-hour cap survives a database restart and expires on time", () => {
  process.env.PLYPOST_AI_DAILY_LIMIT = "2";
  const owner = "daily@example.test";
  const start = Date.UTC(2026, 9, 25, 0, 0, 0);
  assert.deepEqual(reserveAiRequest(owner, start), { allowed: true });
  assert.deepEqual(reserveAiRequest(owner, start + 60 * 60_000 + 1), { allowed: true });
  closeDatabase();
  const blocked = reserveAiRequest(owner, start + 2 * 60 * 60_000);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.status, 429);
  assert.match(blocked.error, /2 requests per 24 hours/);
  assert.equal(database().prepare("SELECT COUNT(*) AS count FROM ai_usage WHERE user_id=?").get(owner).count, 2);
  assert.deepEqual(reserveAiRequest(owner, start + 24 * 60 * 60_000 + 1), { allowed: true });
});

test("the existing hourly cap remains active without a daily cap", () => {
  delete process.env.PLYPOST_AI_DAILY_LIMIT;
  const owner = "hourly@example.test";
  const start = Date.UTC(2026, 9, 25, 0, 0, 0);
  for (let attempt = 0; attempt < 10; attempt++) assert.deepEqual(reserveAiRequest(owner, start), { allowed: true });
  const blocked = reserveAiRequest(owner, start);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.status, 429);
  assert.match(blocked.error, /10 requests per hour/);
  assert.deepEqual(reserveAiRequest(owner, start + 60 * 60_000 + 1), { allowed: true });
});

test("invalid daily limits fail closed without consuming a request", () => {
  const owner = "invalid@example.test";
  for (const value of ["0", "1.5", "abc", "241"]) {
    process.env.PLYPOST_AI_DAILY_LIMIT = value;
    const result = reserveAiRequest(owner);
    assert.equal(result.allowed, false);
    assert.equal(result.status, 503);
  }
  assert.equal(database().prepare("SELECT COUNT(*) AS count FROM ai_usage WHERE user_id=?").get(owner).count, 0);
});
