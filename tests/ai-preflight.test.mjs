import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, database } from "../src/lib/server/db.ts";
import { createSession, SESSION_COOKIE } from "../src/lib/server/auth.ts";
import { POST } from "../src/app/api/ai-preflight/route.ts";
import { parsePreflightReport } from "../src/lib/ai-preflight.ts";

const temporary = mkdtempSync(join(tmpdir(), "plypost-ai-preflight-"));
process.env.PLYPOST_DB_PATH = join(temporary, "workspace.sqlite");
after(() => { closeDatabase(); if (temporary.startsWith(tmpdir())) rmSync(temporary, { recursive: true, force: true }); });

test("AI preflight sends only the reviewed text and saved source after an authenticated click", async () => {
  const owner = "preflight@example.test";
  process.env.PLYPOST_OWNER_EMAIL = owner;
  process.env.PLYPOST_OWNER_PASSWORD_HASH = "test-only-placeholder";
  process.env.NEBIUS_API_KEY = "test-only-nebius-key";
  const token = createSession(owner);
  const headers = { origin: "http://localhost:3000", cookie: `${SESSION_COOKIE}=${token}`, "content-type": "application/json" };
  const source = "The workshop is on Saturday.";
  const text = "The workshop is on Sunday. Join us.";
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return globalThis.Response.json({ choices: [{ message: { content: JSON.stringify({
      findings: [{ kind: "source-drift", excerpt: "Sunday", question: "Is the workshop actually on Sunday rather than Saturday?" }],
    }) } }] });
  };
  try {
    const request = (body, requestHeaders = headers) => new globalThis.Request("http://localhost:3000/api/ai-preflight", {
      method: "POST", headers: requestHeaders, body: JSON.stringify(body),
    });
    assert.equal((await POST(request({ destination: "instagram", source, text }, { origin: headers.origin, "content-type": "application/json" }))).status, 401);
    assert.equal((await POST(request({ destination: "instagram", source, text }, { ...headers, origin: "https://other.example" }))).status, 403);
    assert.equal((await POST(request({ destination: "unknown", source, text }))).status, 400);
    assert.equal((await POST(request({ destination: "instagram", source, text: "" }))).status, 400);
    assert.equal(calls.length, 0);

    const response = await POST(request({ destination: "instagram", source, text, mediaIds: ["private-image-id"], outcome: { views: 100 } }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { destination: "instagram", report: {
      findings: [{ kind: "source-drift", excerpt: "Sunday", question: "Is the workshop actually on Sunday rather than Saturday?" }],
    } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.tokenfactory.nebius.com/v1/chat/completions");
    assert.equal(calls[0].body.model, "nvidia/nemotron-3-super-120b-a12b");
    assert.deepEqual(JSON.parse(calls[0].body.messages[1].content), { savedDraft: source, proposedPost: text });
    assert.equal(JSON.stringify(calls[0].body).includes("private-image-id"), false);
    assert.equal(JSON.stringify(calls[0].body).includes("views"), false);
    assert.equal(database().prepare("SELECT COUNT(*) AS count FROM ai_usage WHERE user_id=?").get(owner).count, 1);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.NEBIUS_API_KEY;
    delete process.env.PLYPOST_OWNER_PASSWORD_HASH;
    delete process.env.PLYPOST_OWNER_EMAIL;
  }
});

test("preflight parser accepts a clean report and rejects unsupported or fabricated excerpts", () => {
  assert.deepEqual(parsePreflightReport('{"findings":[]}', "Current post"), { findings: [] });
  assert.equal(parsePreflightReport("not JSON", "Current post"), null);
  assert.equal(parsePreflightReport('{"findings":[{"kind":"factual","excerpt":"Current","question":"Check?"}]}', "Current post"), null);
  assert.equal(parsePreflightReport('{"findings":[{"kind":"clarity","excerpt":"Not in text","question":"Check?"}]}', "Current post"), null);
  assert.equal(parsePreflightReport('{"findings":[{"kind":"clarity","excerpt":"Current","question":""}]}', "Current post"), null);
});
