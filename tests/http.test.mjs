import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

let server;
let baseUrl;
let serverOutput = "";

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
    env: { ...process.env, NVIDIA_API_KEY: "", NEBIUS_API_KEY: "", NEBIUS_MODEL: "" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
  server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });

  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Server exited early:\n${serverOutput}`);
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch { /* wait for startup */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Server did not start:\n${serverOutput}`);
});

after(() => { server?.kill(); });

test("serves the composer", async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Make every post feel native/);
  assert.match(html, /Simulation mode/);
});

test("publishes only simulated receipts for selected destinations", async () => {
  const response = await fetch(`${baseUrl}/api/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ posts: { bluesky: "Hello Bluesky", linkedin: "Hello LinkedIn" } }),
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.mode, "simulation");
  assert.deepEqual(data.results.map((result) => result.platform), ["bluesky", "linkedin"]);
  assert.ok(data.results.every((result) => result.status === "simulated" && result.id.startsWith("sim_")));
});

test("rejects unknown and over-limit destinations", async () => {
  for (const posts of [{ unknown: "Hello" }, { bluesky: "x".repeat(301) }]) {
    const response = await fetch(`${baseUrl}/api/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posts }),
    });
    assert.equal(response.status, 400);
  }
});

test("AI endpoint explains missing server key without exposing one", async () => {
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "A new product idea", provider: "nvidia" }),
  });
  assert.equal(response.status, 503);
  const data = await response.json();
  assert.match(data.error, /NVIDIA_API_KEY/);
  assert.doesNotMatch(JSON.stringify(data), /Bearer /);
});
