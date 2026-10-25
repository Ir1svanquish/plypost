import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, database } from "../src/lib/server/db.ts";
import { createSession, SESSION_COOKIE } from "../src/lib/server/auth.ts";
import { POST as adaptPost } from "../src/app/api/generate/route.ts";
import { POST as strategyPost } from "../src/app/api/strategy/route.ts";
import { saveBrandBrief } from "../src/lib/server/strategy.ts";

const temporary = mkdtempSync(join(tmpdir(), "plypost-nebius-route-"));
process.env.PLYPOST_DB_PATH = join(temporary, "workspace.sqlite");
after(() => { closeDatabase(); if (temporary.startsWith(tmpdir())) rmSync(temporary, { recursive: true, force: true }); });

test("Nebius routes use Nemotron through Token Factory and keep planning input limited to the brand brief", async () => {
  const owner = "nebius-test@example.test";
  process.env.PLYPOST_OWNER_EMAIL = owner;
  process.env.PLYPOST_OWNER_PASSWORD_HASH = "test-only-placeholder";
  process.env.NEBIUS_API_KEY = "test-only-nebius-key";
  delete process.env.NEBIUS_MODEL;
  const token = createSession(owner);
  const originalFetch = globalThis.fetch;
  const calls = [];
  const variants = {
    bluesky: "Workshop Saturday at 2 p.m. Doors open at 1:30. Bring a laptop.",
    mastodon: "Our Saturday workshop starts at 2 p.m. Doors open at 1:30. Please bring a laptop.",
    linkedin: "Join our Saturday workshop at 2 p.m. Doors open at 1:30. Please bring a laptop.",
    threads: "Saturday workshop at 2 p.m. Doors open at 1:30. Bring a laptop.",
  };
  const brief = {
    brandName: "Workshop", description: "Small local classes", audience: "New learners",
    goal: "Share useful class ideas", voice: "Clear and friendly",
    facts: "Workshops are held on Saturdays.", contentPillars: ["Learning"],
    platforms: ["bluesky", "linkedin"],
  };
  const proposal = {
    title: "A workshop question", angle: "Invite discussion", rationale: "Useful to new learners",
    seed: "What would you like to learn next?", platforms: ["bluesky", "linkedin"],
  };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return globalThis.Response.json({ choices: [{ message: { content: JSON.stringify(calls.length === 1 ? variants : { ideas: [proposal] }) } }] });
  };
  try {
    const headers = { origin: "http://localhost:3000", cookie: `${SESSION_COOKIE}=${token}`, "content-type": "application/json" };
    const adapt = await adaptPost(new globalThis.Request("http://localhost:3000/api/generate", {
      method: "POST", headers,
      body: JSON.stringify({ provider: "nebius", source: "Our Saturday workshop starts at 2 p.m. Doors open at 1:30. Please bring a laptop." }),
    }));
    assert.equal(adapt.status, 200);
    assert.deepEqual((await adapt.json()).variants, variants);

    saveBrandBrief(owner, brief);
    const plan = await strategyPost(new globalThis.Request("http://localhost:3000/api/strategy", {
      method: "POST", headers,
      body: JSON.stringify({ action: "generate", provider: "nebius", weekStart: "2026-10-26" }),
    }));
    assert.equal(plan.status, 200);
    assert.equal((await plan.json()).plans[0].provider, "nebius");

    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(call.url, "https://api.tokenfactory.nebius.com/v1/chat/completions");
      assert.equal(call.options.headers.Authorization, "Bearer test-only-nebius-key");
      assert.equal(call.body.model, "nvidia/nemotron-3-super-120b-a12b");
      assert.deepEqual(call.body.chat_template_kwargs, { enable_thinking: false });
    }
    assert.equal(calls[0].body.messages[1].content, "Our Saturday workshop starts at 2 p.m. Doors open at 1:30. Please bring a laptop.");
    assert.deepEqual(JSON.parse(calls[1].body.messages[1].content), brief);
    assert.equal(JSON.stringify(calls[1].body).includes("weekStart"), false);
    assert.equal(database().prepare("SELECT COUNT(*) AS count FROM jobs WHERE user_id=?").get(owner).count, 0);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.PLYPOST_OWNER_EMAIL;
    delete process.env.PLYPOST_OWNER_PASSWORD_HASH;
    delete process.env.NEBIUS_API_KEY;
  }
});
