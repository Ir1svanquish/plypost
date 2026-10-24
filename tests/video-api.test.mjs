import { after, test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase } from "../src/lib/server/db.ts";
import { createSession, SESSION_COOKIE } from "../src/lib/server/auth.ts";
import { addAssisted } from "../src/lib/server/workspace.ts";
import { GET as list, POST as upload } from "../src/app/api/videos/route.ts";
import { GET as download, DELETE as remove } from "../src/app/api/videos/[id]/route.ts";
import { POST as mutateWorkspace } from "../src/app/api/workspace/route.ts";

const temporary = mkdtempSync(join(tmpdir(), "plypost-video-api-"));
process.env.PLYPOST_DB_PATH = join(temporary, "video-api.sqlite");
process.env.PLYPOST_OWNER_EMAIL = "owner@example.test";
process.env.PLYPOST_OWNER_PASSWORD_HASH = "configured";
const cookie = `${SESSION_COOKIE}=${createSession("owner@example.test")}`;
const base = "http://localhost/api/videos";
const context = (id) => ({ params: Promise.resolve({ id }) });
const mp4 = readFileSync(join(import.meta.dirname, "fixtures/short-blue.mp4"));
after(() => { closeDatabase(); if (temporary.startsWith(tmpdir())) rmSync(temporary, { recursive: true, force: true }); });

function uploadRequest(bytes = mp4, { origin = "http://localhost", withCookie = true, type = "video/mp4" } = {}) {
  const form = new globalThis.FormData();
  form.append("file", new globalThis.Blob([new Uint8Array(bytes)], { type }), "launch.mp4");
  return new globalThis.Request(base, { method: "POST", headers: { origin, ...(withCookie ? { cookie } : {}) }, body: form });
}

test("video routes require owner and serve private playback ranges and attachment downloads", async () => {
  assert.equal((await list(new globalThis.Request(base))).status, 401);
  assert.equal((await upload(uploadRequest(mp4, { withCookie: false }))).status, 401);
  assert.equal((await upload(uploadRequest(mp4, { origin: "https://evil.example" }))).status, 403);
  assert.equal((await upload(uploadRequest(Buffer.from("not-video")))).status, 400);
  const created = await upload(uploadRequest());
  assert.equal(created.status, 201);
  const { video } = await created.json();
  assert.equal((await list(new globalThis.Request(base, { headers: { cookie } }))).status, 200);
  assert.equal((await download(new globalThis.Request(`${base}/${video.id}`), context(video.id))).status, 401);
  const file = await download(new globalThis.Request(`${base}/${video.id}`, { headers: { cookie } }), context(video.id));
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("content-type"), "video/mp4");
  assert.match(file.headers.get("content-disposition"), /attachment; filename\*=UTF-8''launch\.mp4/);
  assert.match(file.headers.get("cache-control"), /private, no-store/);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), mp4);
  const previewUrl = `${base}/${video.id}?preview=1`;
  assert.equal((await download(new globalThis.Request(previewUrl), context(video.id))).status, 401);
  const preview = await download(new globalThis.Request(previewUrl, { headers: { cookie } }), context(video.id));
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get("content-disposition"), "inline");
  assert.equal(preview.headers.get("accept-ranges"), "bytes");
  assert.match(preview.headers.get("cache-control"), /private, no-store/);
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()), mp4);
  const range = await download(new globalThis.Request(previewUrl, { headers: { cookie, range: "bytes=8-31" } }), context(video.id));
  assert.equal(range.status, 206);
  assert.equal(range.headers.get("content-range"), `bytes 8-31/${mp4.length}`);
  assert.equal(range.headers.get("content-length"), "24");
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), mp4.subarray(8, 32));
  const suffix = await download(new globalThis.Request(previewUrl, { headers: { cookie, range: "bytes=-12" } }), context(video.id));
  assert.equal(suffix.status, 206);
  assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), mp4.subarray(-12));
  for (const invalid of ["bytes=", `bytes=${mp4.length}-`, "bytes=20-10", "bytes=0-2,4-6"]) {
    const rejected = await download(new globalThis.Request(previewUrl, { headers: { cookie, range: invalid } }), context(video.id));
    assert.equal(rejected.status, 416);
    assert.equal(rejected.headers.get("content-range"), `bytes */${mp4.length}`);
  }
  assert.equal((await remove(new globalThis.Request(`${base}/${video.id}`, { method: "DELETE", headers: { cookie, origin: "https://evil.example" } }), context(video.id))).status, 403);
  assert.equal((await remove(new globalThis.Request(`${base}/${video.id}`, { method: "DELETE", headers: { cookie, origin: "http://localhost" } }), context(video.id))).status, 200);
  assert.equal((await download(new globalThis.Request(`${base}/${video.id}`, { headers: { cookie } }), context(video.id))).status, 404);
});

test("video upload rejects oversized requests before multipart parsing", async () => {
  const oversized = new globalThis.Request(base, { method: "POST", headers: { cookie, origin: "http://localhost", "content-type": "multipart/form-data; boundary=x", "content-length": String(33 * 1024 * 1024) }, body: new Uint8Array([1]) });
  assert.equal((await upload(oversized)).status, 413);
});

test("handoff video edit route requires owner and origin, and rejects a stale replacement", async () => {
  const first = (await (await upload(uploadRequest())).json()).video;
  const second = (await (await upload(uploadRequest(Buffer.concat([mp4, Buffer.from([1])])))).json()).video;
  const now = new Date().toISOString();
  const handoff = addAssisted("owner@example.test", { id: randomUUID(), title: "Video post", destination: "youtube",
    text: "A caption", videoId: first.id, scheduledFor: now, createdAt: now, status: "queued" });
  const payload = { action: "update-assisted-video", id: handoff.id, expectedVideoId: first.id, videoId: second.id };
  const request = (headers) => new globalThis.Request("http://localhost/api/workspace", { method: "POST",
    headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(payload) });
  assert.equal((await mutateWorkspace(request({ origin: "http://localhost" }))).status, 401);
  assert.equal((await mutateWorkspace(request({ origin: "https://evil.example", cookie }))).status, 403);
  const edited = await mutateWorkspace(request({ origin: "http://localhost", cookie }));
  assert.equal(edited.status, 200);
  assert.equal((await edited.json()).assisted.find((item) => item.id === handoff.id).videoId, second.id);
  const stale = await mutateWorkspace(request({ origin: "http://localhost", cookie }));
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, "ASSISTED_CONFLICT");
});
