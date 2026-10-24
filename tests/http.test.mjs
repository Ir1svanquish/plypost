import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { passwordHash } from "../src/lib/server/auth.ts";
import { randomUUID } from "node:crypto";

let server;
let baseUrl;
let serverOutput = "";
const temporary = mkdtempSync(join(tmpdir(), "plypost-http-"));
const dbPath = join(temporary, "test.sqlite");
const ownerEmail = "owner@example.test";
const ownerPassword = "correct horse battery staple";
let cookie = "";
let loginFailure = "";

function post(path, body, authenticated = true) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl, ...(authenticated ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  const port = address.port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], {
    cwd: process.cwd(),
    env: { ...process.env, NVIDIA_API_KEY: "", NEBIUS_API_KEY: "", NEBIUS_MODEL: "", PLYPOST_OWNER_EMAIL: ownerEmail, PLYPOST_OWNER_PASSWORD_HASH: passwordHash(ownerPassword), PLYPOST_DB_PATH: dbPath },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
  server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });

  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Server exited early:\n${serverOutput}`);
    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        const login = await post("/api/auth/login", { email: ownerEmail, password: ownerPassword }, false);
        if (login.status === 200) {
          cookie = login.headers.get("set-cookie").split(";")[0];
          return;
        }
        loginFailure = `${login.status}: ${await login.text()}`;
      }
    } catch { /* wait for startup */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Server did not start or login failed (${loginFailure}):\n${serverOutput}`);
});

after(async () => {
  server?.kill();
  await new Promise((resolve) => { if (!server || server.exitCode !== null) resolve(); else server.once("exit", resolve); });
  if (temporary.startsWith(tmpdir())) rmSync(temporary, { recursive: true, force: true });
});

test("shows sign-in and rejects unauthenticated API access", async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Sign in/);
  assert.equal((await post("/api/publish", { posts: { bluesky: "hello" } }, false)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/workspace`)).status, 401);
});

test("publishes only simulated receipts for selected destinations", async () => {
  const response = await post("/api/publish", { posts: { bluesky: "Hello Bluesky", linkedin: "Hello LinkedIn" } });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.mode, "simulation");
  assert.deepEqual(data.results.map((result) => result.platform), ["bluesky", "linkedin"]);
  assert.ok(data.results.every((result) => result.status === "simulated" && result.id.startsWith("sim_")));
});

test("rejects unknown and over-limit destinations", async () => {
  for (const posts of [{ unknown: "Hello" }, { bluesky: "x".repeat(301) }]) {
    const response = await post("/api/publish", { posts });
    assert.equal(response.status, 400);
  }
});

test("Bluesky simulation and planning apply grapheme and UTF-8 byte limits consistently", async () => {
  const withinLimit = "a\u0301".repeat(300);
  assert.equal((await post("/api/publish", { posts: { bluesky: withinLimit } })).status, 200);
  const tooManyBytes = "👨‍👩‍👧‍👦".repeat(121);
  const rejected = await post("/api/publish", { posts: { bluesky: tooManyBytes } });
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /UTF-8 bytes/);
  const stamp = new Date().toISOString();
  const plan = { id: randomUUID(), title: "Byte limit", source: "Hello", posts: { bluesky: tooManyBytes }, scheduledFor: new Date(Date.now() + 60_000).toISOString(), createdAt: stamp, status: "queued" };
  assert.equal((await post("/api/workspace", { action: "add-schedule", item: plan, timezone: "UTC" })).status, 400);
});

test("AI endpoint explains missing server key without exposing one", async () => {
  const response = await post("/api/generate", { source: "A new product idea", provider: "nvidia" });
  assert.equal(response.status, 503);
  const data = await response.json();
  assert.match(data.error, /NVIDIA_API_KEY/);
  assert.doesNotMatch(JSON.stringify(data), /Bearer /);
});

test("stores account drafts and scheduled snapshots", async () => {
  const stamp = new Date().toISOString();
  const draft = { id: randomUUID(), title: "Test draft", source: "Hello", selected: ["bluesky"], variants: {}, createdAt: stamp, updatedAt: stamp };
  const saved = await post("/api/workspace", { action: "save-draft", item: draft });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).drafts[0].title, "Test draft");
  const plan = { id: randomUUID(), title: "Test plan", source: "Hello", posts: { bluesky: "Hello" }, scheduledFor: new Date(Date.now() + 60_000).toISOString(), createdAt: stamp, status: "queued" };
  const planned = await post("/api/workspace", { action: "add-schedule", item: plan, timezone: "Asia/Hong_Kong" });
  assert.equal(planned.status, 200);
  assert.equal((await planned.json()).schedule[0].status, "queued");
  const loaded = await fetch(`${baseUrl}/api/workspace`, { headers: { Cookie: cookie } });
  assert.equal(loaded.status, 200);
  assert.equal((await loaded.json()).drafts[0].id, draft.id);
});

test("stale draft saves return a conflict instead of overwriting newer content", async () => {
  const stamp = new Date().toISOString();
  const draft = { id: randomUUID(), title: "Concurrency", source: "Initial", selected: ["bluesky"], variants: {}, createdAt: stamp, updatedAt: stamp };
  const created = await post("/api/workspace", { action: "save-draft", item: draft, expectedUpdatedAt: null });
  assert.equal(created.status, 200);
  const createdBody = await created.json();
  const first = createdBody.drafts.find((item) => item.id === draft.id);
  assert.deepEqual(createdBody.savedDraft, first);
  const edited = await post("/api/workspace", { action: "save-draft", item: { ...first, source: "Newer" }, expectedUpdatedAt: first.updatedAt });
  assert.equal(edited.status, 200);
  const editedBody = await edited.json();
  const latest = editedBody.drafts.find((item) => item.id === draft.id);
  assert.deepEqual(editedBody.savedDraft, latest);
  assert.ok(latest.updatedAt > first.updatedAt);
  const stale = await post("/api/workspace", { action: "save-draft", item: { ...first, source: "Older" }, expectedUpdatedAt: first.updatedAt });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, "DRAFT_CONFLICT");
  const staleDelete = await post("/api/workspace", { action: "delete-draft", id: draft.id, expectedUpdatedAt: first.updatedAt });
  assert.equal(staleDelete.status, 409);
  assert.equal((await staleDelete.json()).code, "DRAFT_CONFLICT");
  const loaded = await fetch(`${baseUrl}/api/workspace`, { headers: { Cookie: cookie } });
  assert.equal((await loaded.json()).drafts.find((item) => item.id === draft.id).source, "Newer");
});

test("reschedule route requires the owner session and validates UTC time and timezone", async () => {
  const original = new Date(Date.now() + 60_000);
  const moved = new Date(Date.now() + 180_000);
  const plan = { id: randomUUID(), title: "HTTP move", source: "Hello", posts: { bluesky: "Hello" }, scheduledFor: original.toISOString(), createdAt: new Date().toISOString(), status: "queued" };
  assert.equal((await post("/api/workspace", { action: "add-schedule", item: plan, timezone: "UTC" })).status, 200);
  const request = { action: "reschedule-schedule", id: plan.id, scheduledFor: moved.toISOString(), timezone: "Asia/Hong_Kong" };
  assert.equal((await post("/api/workspace", request, false)).status, 401);
  assert.equal((await post("/api/workspace", { ...request, scheduledFor: "2026-02-30T12:00:00.000Z" })).status, 400);
  assert.equal((await post("/api/workspace", { ...request, timezone: "Mars/Olympus" })).status, 400);
  const changed = await post("/api/workspace", request);
  assert.equal(changed.status, 200);
  const item = (await changed.json()).schedule.find((scheduled) => scheduled.id === plan.id);
  assert.equal(item.scheduledFor, moved.toISOString());
  assert.equal(item.nextAttemptAt, moved.toISOString());
  assert.deepEqual(item.receipts, []);
});

test("stores assisted checklist actions behind the owner session", async () => {
  const stamp = new Date().toISOString();
  const assisted = { id: randomUUID(), title: "Share an update", destination: "x", text: "Hello X", scheduledFor: stamp, createdAt: stamp, status: "queued" };
  assert.equal((await post("/api/workspace", { action: "add-assisted", item: assisted }, false)).status, 401);
  const added = await post("/api/workspace", { action: "add-assisted", item: assisted });
  assert.equal(added.status, 200);
  assert.equal((await added.json()).assisted[0].id, assisted.id);
  const notified = await post("/api/workspace", { action: "mark-assisted-notified", ids: [assisted.id] });
  assert.ok((await notified.json()).assisted[0].notifiedAt);
  const movedTime = new Date(Date.now() + 86_400_000).toISOString();
  const moveRequest = { action: "reschedule-assisted", id: assisted.id, expectedScheduledFor: stamp, scheduledFor: movedTime };
  assert.equal((await post("/api/workspace", moveRequest, false)).status, 401);
  const movedResponse = await post("/api/workspace", moveRequest);
  assert.equal(movedResponse.status, 200);
  const movedItem = (await movedResponse.json()).assisted[0];
  assert.equal(movedItem.scheduledFor, movedTime);
  assert.equal(movedItem.notifiedAt, undefined);
  const staleMove = await post("/api/workspace", moveRequest);
  assert.equal(staleMove.status, 409);
  assert.equal((await staleMove.json()).code, "ASSISTED_CONFLICT");
  const editRequest = { action: "update-assisted-text", id: assisted.id, expectedText: assisted.text, text: "Corrected X" };
  assert.equal((await post("/api/workspace", editRequest, false)).status, 401);
  const edited = await post("/api/workspace", editRequest);
  assert.equal(edited.status, 200);
  assert.equal((await edited.json()).assisted[0].text, "Corrected X");
  const staleEdit = await post("/api/workspace", editRequest);
  assert.equal(staleEdit.status, 409);
  assert.equal((await staleEdit.json()).code, "ASSISTED_CONFLICT");
  const postUrl = "https://social.example/creator/post/42";
  assert.equal((await post("/api/workspace", { action: "set-assisted-status", id: assisted.id, status: "posted", postUrl }, false)).status, 401);
  for (const invalidUrl of ["javascript:alert(1)", "http://social.example/post/42", "https://user:pass@social.example/post/42"]) {
    assert.equal((await post("/api/workspace", { action: "set-assisted-status", id: assisted.id, status: "posted", postUrl: invalidUrl })).status, 400);
  }
  const posted = await post("/api/workspace", { action: "set-assisted-status", id: assisted.id, status: "posted", postUrl });
  const postedItem = (await posted.json()).assisted[0];
  assert.equal(postedItem.status, "posted");
  assert.equal(postedItem.postUrl, postUrl);
  assert.ok(postedItem.postedAt);
  const migratedItem = { ...assisted, id: randomUUID() };
  const migration = await post("/api/workspace", { action: "migrate-assisted", items: [assisted, migratedItem] });
  const migrationData = await migration.json();
  assert.equal(migrationData.assistedMigration, "imported");
  assert.equal(migrationData.assisted.length, 2);
  assert.equal((await (await post("/api/workspace", { action: "migrate-assisted", items: [migratedItem] })).json()).assistedMigration, "skipped");
  const legacyImport = await post("/api/workspace", { action: "import-legacy", backup: { version: 3, drafts: [], schedule: [], assisted: [] } });
  assert.equal(legacyImport.status, 200);
  assert.equal((await legacyImport.json()).assisted.length, 2);
  const reviewedItem = { ...assisted, id: randomUUID() };
  const reviewedMigration = await post("/api/workspace", { action: "migrate-browser-workspace", backup: { version: 3, drafts: [], schedule: [], assisted: [reviewedItem] } });
  assert.equal(reviewedMigration.status, 200);
  assert.equal((await reviewedMigration.json()).assisted.length, 3);
  assert.equal((await post("/api/workspace", { action: "delete-assisted", id: assisted.id })).status, 200);
  assert.equal((await post("/api/workspace", { action: "delete-assisted", id: migratedItem.id })).status, 200);
  assert.equal((await post("/api/workspace", { action: "delete-assisted", id: reviewedItem.id })).status, 200);
  assert.deepEqual((await (await fetch(`${baseUrl}/api/workspace`, { headers: { Cookie: cookie } })).json()).assisted, []);
});

test("rejects cross-origin changes and revokes logout session", async () => {
  const attack = await fetch(`${baseUrl}/api/workspace`, { method: "POST", headers: { Origin: "https://evil.example", Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ action: "unknown" }) });
  assert.equal(attack.status, 403);
  assert.equal((await post("/api/auth/logout", {})).status, 200);
  assert.equal((await fetch(`${baseUrl}/api/workspace`, { headers: { Cookie: cookie } })).status, 401);
});
