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

test("stores assisted checklist actions behind the owner session", async () => {
  const stamp = new Date().toISOString();
  const assisted = { id: randomUUID(), title: "Share an update", destination: "x", text: "Hello X", scheduledFor: stamp, createdAt: stamp, status: "queued" };
  assert.equal((await post("/api/workspace", { action: "add-assisted", item: assisted }, false)).status, 401);
  const added = await post("/api/workspace", { action: "add-assisted", item: assisted });
  assert.equal(added.status, 200);
  assert.equal((await added.json()).assisted[0].id, assisted.id);
  const notified = await post("/api/workspace", { action: "mark-assisted-notified", ids: [assisted.id] });
  assert.ok((await notified.json()).assisted[0].notifiedAt);
  const posted = await post("/api/workspace", { action: "set-assisted-status", id: assisted.id, status: "posted" });
  assert.equal((await posted.json()).assisted[0].status, "posted");
  const migratedItem = { ...assisted, id: randomUUID() };
  const migration = await post("/api/workspace", { action: "migrate-assisted", items: [assisted, migratedItem] });
  const migrationData = await migration.json();
  assert.equal(migrationData.assistedMigration, "imported");
  assert.equal(migrationData.assisted.length, 2);
  assert.equal((await (await post("/api/workspace", { action: "migrate-assisted", items: [migratedItem] })).json()).assistedMigration, "skipped");
  const legacyImport = await post("/api/workspace", { action: "import-legacy", backup: { version: 3, drafts: [], schedule: [], assisted: [] } });
  assert.equal(legacyImport.status, 200);
  assert.equal((await legacyImport.json()).assisted.length, 2);
  assert.equal((await post("/api/workspace", { action: "delete-assisted", id: assisted.id })).status, 200);
  assert.equal((await post("/api/workspace", { action: "delete-assisted", id: migratedItem.id })).status, 200);
  assert.deepEqual((await (await fetch(`${baseUrl}/api/workspace`, { headers: { Cookie: cookie } })).json()).assisted, []);
});

test("rejects cross-origin changes and revokes logout session", async () => {
  const attack = await fetch(`${baseUrl}/api/workspace`, { method: "POST", headers: { Origin: "https://evil.example", Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ action: "unknown" }) });
  assert.equal(attack.status, 403);
  assert.equal((await post("/api/auth/logout", {})).status, 200);
  assert.equal((await fetch(`${baseUrl}/api/workspace`, { headers: { Cookie: cookie } })).status, 401);
});
