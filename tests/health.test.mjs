import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { GET } from "../src/app/api/health/route.ts";
import { closeDatabase } from "../src/lib/server/db.ts";

const temporary = mkdtempSync(join(tmpdir(), "plypost-health-test-"));
const previousDbPath = process.env.PLYPOST_DB_PATH;
after(() => {
  closeDatabase();
  if (previousDbPath === undefined) delete process.env.PLYPOST_DB_PATH;
  else process.env.PLYPOST_DB_PATH = previousDbPath;
  if (resolve(temporary).startsWith(resolve(tmpdir()) + "\\")) rmSync(temporary, { recursive: true, force: true });
});

test("health reports storage readiness without exposing credentials", async () => {
  process.env.PLYPOST_DB_PATH = join(temporary, "ready.sqlite");
  const healthy = await GET();
  assert.equal(healthy.status, 200);
  assert.equal(healthy.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await healthy.json(), { status: "ok" });

  closeDatabase();
  process.env.PLYPOST_DB_PATH = temporary;
  const unavailable = await GET();
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { status: "unavailable" });
});
