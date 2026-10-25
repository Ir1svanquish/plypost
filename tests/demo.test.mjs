import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDemoAt, demoEnvironment } from "../scripts/demo.ts";
import { verifyPassword } from "../src/lib/server/auth.ts";
import { closeDatabase, database } from "../src/lib/server/db.ts";
import { listWorkspace } from "../src/lib/server/workspace.ts";
import { listStrategy } from "../src/lib/server/strategy.ts";

const temporary = mkdtempSync(join(tmpdir(), "plypost-demo-test-"));
after(() => {
  closeDatabase();
  if (resolve(temporary).startsWith(resolve(tmpdir()) + "\\")) rmSync(temporary, { recursive: true, force: true });
});

test("demo creates isolated synthetic content and never overwrites an existing demo", () => {
  const directory = join(temporary, "demo");
  const previousDbPath = process.env.PLYPOST_DB_PATH;
  process.env.PLYPOST_DB_PATH = join(temporary, "real-data.sqlite");
  const config = createDemoAt(directory);
  assert.equal(process.env.PLYPOST_DB_PATH, join(temporary, "real-data.sqlite"));

  const login = readFileSync(join(directory, "login.txt"), "utf8");
  const password = login.match(/^Password: (.+)$/m)?.[1];
  assert.ok(password);
  assert.equal(verifyPassword(password, config.passwordHash), true);
  assert.equal(config.email, "demo@plypost.local");
  assert.throws(() => createDemoAt(directory), /already exists/);

  const env = demoEnvironment(directory, config);
  assert.equal(env.PLYPOST_DB_PATH, join(directory, "plypost.sqlite"));
  assert.equal(env.PLYPOST_MASTODON_SCHEDULE_ENABLED, "false");
  assert.equal(env.PLYPOST_BLUESKY_SECRET, "");
  assert.equal(env.PLYPOST_MASTODON_SECRET, "");
  assert.equal(env.NVIDIA_API_KEY, "");
  assert.equal(env.NEBIUS_MODEL, "nvidia/nemotron-3-super-120b-a12b");

  process.env.PLYPOST_DB_PATH = env.PLYPOST_DB_PATH;
  const workspace = listWorkspace(config.email);
  assert.equal(workspace.drafts.length, 2);
  assert.equal(workspace.assisted.length, 3);
  assert.equal(workspace.assisted.filter((item) => item.status === "posted").length, 1);
  assert.equal(workspace.assisted.filter((item) => item.reminderEnabled).length, 1);
  assert.equal(workspace.schedule.length, 1);
  assert.deepEqual(workspace.schedule[0].posts && Object.keys(workspace.schedule[0].posts), ["threads"]);
  assert.equal(listStrategy(config.email).brief?.brandName, "Northstar Notes (demo)");
  assert.deepEqual(listStrategy(config.email).plans, []);
  assert.equal(database().prepare("SELECT COUNT(*) AS count FROM mastodon_connections").get().count, 0);
  closeDatabase();
  if (previousDbPath === undefined) delete process.env.PLYPOST_DB_PATH;
  else process.env.PLYPOST_DB_PATH = previousDbPath;
});
