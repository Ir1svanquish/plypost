import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, database } from "../src/lib/server/db.ts";
import { createSession, SESSION_COOKIE } from "../src/lib/server/auth.ts";
import { POST } from "../src/app/api/ai-handoff/route.ts";
import { parseManualHandoffSuggestion } from "../src/lib/ai-handoff.ts";

const temporary = mkdtempSync(join(tmpdir(), "plypost-ai-handoff-"));
process.env.PLYPOST_DB_PATH = join(temporary, "workspace.sqlite");
after(() => { closeDatabase(); if (temporary.startsWith(tmpdir())) rmSync(temporary, { recursive: true, force: true }); });

test("manual AI handoff sends only clicked text to Nebius and returns a reviewable suggestion", async () => {
  const owner = "manual-ai@example.test";
  process.env.PLYPOST_OWNER_EMAIL = owner;
  process.env.PLYPOST_OWNER_PASSWORD_HASH = "test-only-placeholder";
  process.env.NEBIUS_API_KEY = "test-only-nebius-key";
  const token = createSession(owner);
  const headers = { origin: "http://localhost:3000", cookie: `${SESSION_COOKIE}=${token}`, "content-type": "application/json" };
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return globalThis.Response.json({ choices: [{ message: { content: JSON.stringify({ text: "A short caption for the workshop." }) } }] });
  };
  try {
    const missingSession = await POST(new globalThis.Request("http://localhost:3000/api/ai-handoff", {
      method: "POST", headers: { origin: headers.origin, "content-type": "application/json" }, body: JSON.stringify({ destination: "instagram", source: "Workshop on Saturday" }),
    }));
    assert.equal(missingSession.status, 401);
    const badOrigin = await POST(new globalThis.Request("http://localhost:3000/api/ai-handoff", {
      method: "POST", headers: { ...headers, origin: "https://other.example" }, body: JSON.stringify({ destination: "instagram", source: "Workshop on Saturday" }),
    }));
    assert.equal(badOrigin.status, 403);
    for (const destination of ["linkedin", "unknown", null]) {
      const invalid = await POST(new globalThis.Request("http://localhost:3000/api/ai-handoff", {
        method: "POST", headers, body: JSON.stringify({ destination, source: "Workshop on Saturday" }),
      }));
      assert.equal(invalid.status, 400);
    }
    assert.equal(calls.length, 0);
    const response = await POST(new globalThis.Request("http://localhost:3000/api/ai-handoff", {
      method: "POST", headers,
      body: JSON.stringify({ destination: "instagram", source: "Workshop on Saturday", mediaIds: ["private-image-id"], outcome: { views: 100 } }),
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { destination: "instagram", suggestion: "A short caption for the workshop." });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.tokenfactory.nebius.com/v1/chat/completions");
    assert.equal(calls[0].body.model, "nvidia/nemotron-3-super-120b-a12b");
    assert.deepEqual(calls[0].body.chat_template_kwargs, { enable_thinking: false });
    assert.deepEqual(JSON.parse(calls[0].body.messages[1].content), { draft: "Workshop on Saturday" });
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

test("manual AI response rejects unusable suggestions", () => {
  assert.equal(parseManualHandoffSuggestion("not JSON"), null);
  assert.equal(parseManualHandoffSuggestion('{"text":""}'), null);
  assert.equal(parseManualHandoffSuggestion(JSON.stringify({ text: "a".repeat(5001) })), null);
  assert.equal(parseManualHandoffSuggestion('{"text":"  Useful text  "}'), "Useful text");
});

test("manual platform rewrites cannot answer a standalone question with invented experience", async () => {
  const owner = "manual-question@example.test";
  process.env.PLYPOST_OWNER_EMAIL = owner;
  process.env.PLYPOST_OWNER_PASSWORD_HASH = "test-only-placeholder";
  process.env.NEBIUS_API_KEY = "test-only-nebius-key";
  const token = createSession(owner);
  const originalFetch = globalThis.fetch;
  const invented = "Last month, I started using voice-to-text for drafting ideas—it helped me capture thoughts faster without getting stuck on typing.";
  globalThis.fetch = async () => globalThis.Response.json({ choices: [{ message: { content: JSON.stringify({ text: invented }) } }] });
  try {
    for (const destination of ["instagram", "facebook", "x", "reddit", "pinterest", "youtube", "tiktok"]) {
      const response = await POST(new globalThis.Request("http://localhost:3000/api/ai-handoff", {
        method: "POST", headers: { origin: "http://localhost:3000", cookie: `${SESSION_COOKIE}=${token}`, "content-type": "application/json" },
        body: JSON.stringify({ destination, source: "What small change made your writing easier last month?" }),
      }));
      assert.equal(response.status, 502, destination);
      const body = await response.json();
      assert.match(body.error, /answered your question/);
      assert.equal(body.suggestion, undefined);
    }
    assert.equal(database().prepare("SELECT COUNT(*) AS count FROM assisted WHERE user_id=?").get(owner).count, 0);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.NEBIUS_API_KEY;
    delete process.env.PLYPOST_OWNER_PASSWORD_HASH;
    delete process.env.PLYPOST_OWNER_EMAIL;
  }
});

test("manual rewriting accepts English and Chinese questions and supplied first-person facts", async () => {
  const owner = "manual-question-valid@example.test";
  process.env.PLYPOST_OWNER_EMAIL = owner;
  process.env.PLYPOST_OWNER_PASSWORD_HASH = "test-only-placeholder";
  process.env.NEBIUS_API_KEY = "test-only-nebius-key";
  const token = createSession(owner);
  const originalFetch = globalThis.fetch;
  try {
    for (const [source, suggestion] of [
      ["What small change made your writing easier last month?", "What small change helped your writing last month?"],
      ["最近一个月，哪一步最拖慢你整理发帖素材的速度？", "最近一个月，整理发帖素材时哪一步最拖慢你的速度？"],
      ["I started using voice input last month. What changed for you?", "Last month I started using voice input. What changed for you?"],
    ]) {
      globalThis.fetch = async () => globalThis.Response.json({ choices: [{ message: { content: JSON.stringify({ text: suggestion }) } }] });
      const response = await POST(new globalThis.Request("http://localhost:3000/api/ai-handoff", {
        method: "POST", headers: { origin: "http://localhost:3000", cookie: `${SESSION_COOKIE}=${token}`, "content-type": "application/json" },
        body: JSON.stringify({ destination: "instagram", source }),
      }));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).suggestion, suggestion);
    }
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.NEBIUS_API_KEY;
    delete process.env.PLYPOST_OWNER_PASSWORD_HASH;
    delete process.env.PLYPOST_OWNER_EMAIL;
  }
});
