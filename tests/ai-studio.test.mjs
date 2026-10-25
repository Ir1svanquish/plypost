import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { closeDatabase, database } from "../src/lib/server/db.ts";
import { createSession, SESSION_COOKIE } from "../src/lib/server/auth.ts";
import { createMedia } from "../src/lib/server/media.ts";
import { GET, POST, PATCH, DELETE } from "../src/app/api/ai-studio/route.ts";
import { POST as adaptPost } from "../src/app/api/generate/route.ts";
import { exportPortableBackup, importPortableBackup } from "../src/lib/server/portable-backup.ts";
import { loadVoiceProfile, saveVoiceProfile } from "../src/lib/server/voice-profile.ts";
import { isStandaloneQuestion, parseDraftFromNotesResponse } from "../src/lib/ai-studio.ts";

const temporary = mkdtempSync(join(tmpdir(), "plypost-ai-studio-"));
process.env.PLYPOST_DB_PATH = join(temporary, "workspace.sqlite");
after(() => { closeDatabase(); if (temporary.startsWith(tmpdir())) rmSync(temporary, { recursive: true, force: true }); });

function request(path, token, body, method = "POST") {
  return new globalThis.Request(`http://localhost:3000${path}`, {
    method, headers: { origin: "http://localhost:3000", cookie: `${SESSION_COOKIE}=${token}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("selected posts and an owned image use Nebius only after explicit actions", async () => {
  const owner = "studio@example.test";
  process.env.PLYPOST_OWNER_EMAIL = owner;
  process.env.PLYPOST_OWNER_PASSWORD_HASH = "test-only-placeholder";
  process.env.NEBIUS_API_KEY = "test-only-nebius-key";
  const token = createSession(owner);
  const bytes = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#7799bb" } }).png().toBuffer();
  const image = (await createMedia(owner, { name: "sample.png", type: "image/png", bytes })).media;
  const foreignImage = (await createMedia("another-owner@example.test", { name: "other.png", type: "image/png", bytes })).media;
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    const content = body.model === "nvidia/Nemotron-3.5-Super-VL"
      ? { observations: "A blue rectangular illustration is visible.", caption: "A simple blue visual for today's update." }
      : calls.length === 1 ? { guide: "Short openings, plain verbs, and one closing question." }
        : { bluesky: "A simple update", mastodon: "A simple update", linkedin: "A simple update", threads: "A simple update" };
    return globalThis.Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
  };
  try {
    assert.equal((await GET(request("/api/ai-studio", token, null, "GET"))).status, 200);
    assert.equal(calls.length, 0);
    const rejected = await POST(request("/api/ai-studio", token, { action: "caption-image", mediaId: foreignImage.id }));
    assert.equal(rejected.status, 400);
    const retiredAction = await POST(request("/api/ai-studio", token, { action: "analyze-references", examples: ["one", "two"] }));
    assert.equal(retiredAction.status, 400);
    const retiredGuide = await adaptPost(request("/api/generate", token, { source: "A draft", referenceGuide: "Old guide" }));
    assert.equal(retiredGuide.status, 400);
    assert.equal(calls.length, 0);

    const samples = ["I keep these words private.", "A second private old post.", "One more old post." ];
    const analyzed = await POST(request("/api/ai-studio", token, { action: "analyze-style", examples: samples }));
    assert.equal(analyzed.status, 200);
    assert.match((await analyzed.json()).voiceProfile.guide, /Short openings/);
    assert.equal(calls[0].body.model, "nvidia/nemotron-3-super-120b-a12b");
    assert.equal(calls[0].body.messages[1].content.includes(samples[0]), true);
    assert.equal(database().prepare("SELECT guide FROM voice_profiles WHERE user_id=?").get(owner).guide.includes(samples[0]), false);
    const edited = await PATCH(request("/api/ai-studio", token, { guide: "Short openings and direct sentences." }, "PATCH"));
    assert.equal(edited.status, 200);
    assert.equal(loadVoiceProfile(owner).guide, "Short openings and direct sentences.");
    assert.equal(calls.length, 1);

    assert.equal(database().prepare("SELECT COUNT(*) AS count FROM voice_profiles").get().count, 1);

    const caption = await POST(request("/api/ai-studio", token, {
      action: "caption-image", mediaId: image.id, context: "This is a sample visual.", useVoice: true,
    }));
    assert.equal(caption.status, 200);
    assert.match((await caption.json()).caption, /blue visual/);
    assert.equal(calls[1].body.model, "nvidia/Nemotron-3.5-Super-VL");
    assert.equal(calls[1].body.messages[1].content[1].type, "image_url");
    assert.match(calls[1].body.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);
    assert.equal(calls[1].body.messages[1].content[0].text.includes("direct sentences"), true);

    const adapted = await adaptPost(request("/api/generate", token, { source: "A simple update.", useVoice: true }));
    assert.equal(adapted.status, 200);
    const guided = JSON.parse(calls[2].body.messages[1].content);
    assert.equal(guided.draft, "A simple update.");
    assert.equal(guided.voiceGuide, loadVoiceProfile(owner).guide);
    assert.equal("referencePattern" in guided, false);
    assert.equal(calls.every((call) => call.url === "https://api.tokenfactory.nebius.com/v1/chat/completions"), true);

    assert.equal((await DELETE(request("/api/ai-studio", token, null, "DELETE"))).status, 200);
    assert.equal(loadVoiceProfile(owner), null);
    const staleVoice = await POST(request("/api/ai-studio", token, { action: "caption-image", mediaId: image.id, useVoice: true }));
    assert.equal(staleVoice.status, 400);
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.PLYPOST_OWNER_EMAIL;
    delete process.env.PLYPOST_OWNER_PASSWORD_HASH;
    delete process.env.NEBIUS_API_KEY;
  }
});

test("a guide that repeats a long passage from a sample post is not saved", async () => {
  const owner = "quoted-style@example.test";
  process.env.PLYPOST_OWNER_EMAIL = owner;
  process.env.PLYPOST_OWNER_PASSWORD_HASH = "test-only-placeholder";
  process.env.NEBIUS_API_KEY = "test-only-nebius-key";
  const token = createSession(owner);
  const originalFetch = globalThis.fetch;
  const quoted = "A distinctive sentence that should stay only in the sample post.";
  globalThis.fetch = async () => globalThis.Response.json({ choices: [{ message: { content: JSON.stringify({ guide: `Use short lines. ${quoted}` }) } }] });
  try {
    const response = await POST(request("/api/ai-studio", token, {
      action: "analyze-style", examples: [quoted, "A second sample post.", "A third sample post."],
    }));
    assert.equal(response.status, 502);
    assert.equal(loadVoiceProfile(owner), null);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.PLYPOST_OWNER_EMAIL;
    delete process.env.PLYPOST_OWNER_PASSWORD_HASH;
    delete process.env.NEBIUS_API_KEY;
  }
});

test("drafting from notes sends only the selected notes and optional style guide", async () => {
  const owner = "notes@example.test";
  process.env.PLYPOST_OWNER_EMAIL = owner;
  process.env.PLYPOST_OWNER_PASSWORD_HASH = "test-only-placeholder";
  process.env.NEBIUS_API_KEY = "test-only-nebius-key";
  const token = createSession(owner);
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return globalThis.Response.json({ choices: [{ message: { content: JSON.stringify({ draft: "Workshop Saturday at 2 p.m. Bring a laptop." }) } }] });
  };
  try {
    for (const invalid of [
      { action: "draft-from-notes", notes: "" },
      { action: "draft-from-notes", notes: "a".repeat(3001) },
      { action: "draft-from-notes", notes: "Workshop", useVoice: "yes" },
      { action: "draft-from-notes", notes: "Workshop", useVoice: true },
      { action: "draft-from-notes", notes: "Workshop", style: "viral" },
    ]) {
      assert.equal((await POST(request("/api/ai-studio", token, invalid))).status, 400);
    }
    assert.equal(calls.length, 0);
    saveVoiceProfile(owner, "Short, plain sentences.");
    const notes = "Workshop Saturday 2 p.m. Bring laptop.";
    const response = await POST(request("/api/ai-studio", token, {
      action: "draft-from-notes", notes, useVoice: true, mediaId: "should-not-be-sent",
    }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).draft, "Workshop Saturday at 2 p.m. Bring a laptop.");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, "nvidia/nemotron-3-super-120b-a12b");
    assert.deepEqual(JSON.parse(calls[0].messages[1].content), { notes, voiceGuide: "Short, plain sentences." });
    assert.equal(database().prepare("SELECT COUNT(*) AS count FROM drafts WHERE user_id=?").get(owner).count, 0);
    const conversational = await POST(request("/api/ai-studio", token, {
      action: "draft-from-notes", notes, style: "conversation",
    }));
    assert.equal(conversational.status, 200);
    assert.match(calls[1].messages[0].content, /one specific, relevant question/);
    assert.deepEqual(JSON.parse(calls[1].messages[1].content), { notes });
    assert.equal(parseDraftFromNotesResponse('{"draft":"  A short post.  "}'), "A short post.");
    assert.equal(parseDraftFromNotesResponse('{"draft":"' + "a".repeat(3001) + '"}'), null);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.PLYPOST_OWNER_EMAIL;
    delete process.env.PLYPOST_OWNER_PASSWORD_HASH;
    delete process.env.NEBIUS_API_KEY;
  }
});

test("a question alone cannot become a fabricated personal anecdote", async () => {
  assert.equal(isStandaloneQuestion("What changed your workflow?"), true);
  assert.equal(isStandaloneQuestion("你最近改进了什么？"), true);
  assert.equal(isStandaloneQuestion("We changed our workflow. What about you?"), false);
  const owner = "question@example.test";
  process.env.PLYPOST_OWNER_EMAIL = owner;
  process.env.PLYPOST_OWNER_PASSWORD_HASH = "test-only-placeholder";
  process.env.NEBIUS_API_KEY = "test-only-nebius-key";
  const token = createSession(owner);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => globalThis.Response.json({ choices: [{ message: { content: JSON.stringify({
    draft: "I streamlined my work with a new keyboard shortcut. What helped you?",
  }) } }] });
  try {
    const response = await POST(request("/api/ai-studio", token, {
      action: "draft-from-notes", notes: "What changed your workflow?", style: "practical",
    }));
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /unsupported answer/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.PLYPOST_OWNER_EMAIL;
    delete process.env.PLYPOST_OWNER_PASSWORD_HASH;
    delete process.env.NEBIUS_API_KEY;
  }
});

test("portable backup carries the derived guide without retaining source posts", async () => {
  const owner = "backup-style@example.test";
  saveVoiceProfile(owner, "Plain language and short paragraphs.");
  const archive = JSON.parse(exportPortableBackup(owner));
  assert.equal(archive.version, 5);
  assert.equal(archive.voiceProfile.guide, "Plain language and short paragraphs.");
  assert.equal(JSON.stringify(archive).includes("private old post"), false);
  const target = "restored-style@example.test";
  await importPortableBackup(target, archive);
  assert.equal(loadVoiceProfile(target).guide, "Plain language and short paragraphs.");
});
