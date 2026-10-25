import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { closeDatabase } from "../src/lib/server/db.ts";
import { createSession, SESSION_COOKIE } from "../src/lib/server/auth.ts";
import { POST as workspacePost } from "../src/app/api/workspace/route.ts";
import { POST as publishPost } from "../src/app/api/publish/route.ts";

const temporary = mkdtempSync(join(tmpdir(), "plypost-request-limits-"));
process.env.PLYPOST_DB_PATH = join(temporary, "limits.sqlite");
process.env.PLYPOST_OWNER_EMAIL = "limits@example.test";
process.env.PLYPOST_OWNER_PASSWORD_HASH = "configured";
const cookie = `${SESSION_COOKIE}=${createSession("limits@example.test")}`;

after(() => {
  closeDatabase();
  const resolved = realpathSync(temporary);
  if (!resolved.startsWith(realpathSync(tmpdir()) + sep)) throw new Error("Unsafe test directory");
  rmSync(resolved, { recursive: true, force: true });
});

function streamedRequest(path, chunks, chunkSize) {
  let remaining = chunks;
  const body = new globalThis.ReadableStream({
    pull(controller) {
      if (!remaining--) { controller.close(); return; }
      controller.enqueue(new Uint8Array(chunkSize));
    },
  });
  return new globalThis.Request(`http://localhost${path}`, {
    method: "POST", body, duplex: "half",
    headers: { cookie, origin: "http://localhost", "content-type": "application/json" },
  });
}

test("oversized streamed workspace and publishing requests fail before JSON parsing", async () => {
  const workspace = await workspacePost(streamedRequest("/api/workspace", 17, 1024 * 1024));
  assert.equal(workspace.status, 413);
  assert.match((await workspace.json()).error, /too large/i);

  const publish = await publishPost(streamedRequest("/api/publish", 4, 16 * 1024));
  assert.equal(publish.status, 413);
  assert.match((await publish.json()).error, /too large/i);
});
