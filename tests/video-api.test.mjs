import { after, test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase } from "../src/lib/server/db.ts";
import { createSession, SESSION_COOKIE } from "../src/lib/server/auth.ts";
import { GET as list, POST as upload } from "../src/app/api/videos/route.ts";
import { GET as download, DELETE as remove } from "../src/app/api/videos/[id]/route.ts";

const temporary = mkdtempSync(join(tmpdir(), "plypost-video-api-"));
process.env.PLYPOST_DB_PATH = join(temporary, "video-api.sqlite");
process.env.PLYPOST_OWNER_EMAIL = "owner@example.test";
process.env.PLYPOST_OWNER_PASSWORD_HASH = "configured";
const cookie = `${SESSION_COOKIE}=${createSession("owner@example.test")}`;
const base = "http://localhost/api/videos";
const context = (id) => ({ params: Promise.resolve({ id }) });
const mp4 = Buffer.from([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
after(() => { closeDatabase(); if (temporary.startsWith(tmpdir())) rmSync(temporary, { recursive: true, force: true }); });

function uploadRequest(bytes = mp4, { origin = "http://localhost", withCookie = true, type = "video/mp4" } = {}) {
  const form = new globalThis.FormData();
  form.append("file", new globalThis.Blob([new Uint8Array(bytes)], { type }), "launch.mp4");
  return new globalThis.Request(base, { method: "POST", headers: { origin, ...(withCookie ? { cookie } : {}) }, body: form });
}

test("video routes require owner, check origin, and serve private attachment downloads", async () => {
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
  assert.equal((await remove(new globalThis.Request(`${base}/${video.id}`, { method: "DELETE", headers: { cookie, origin: "https://evil.example" } }), context(video.id))).status, 403);
  assert.equal((await remove(new globalThis.Request(`${base}/${video.id}`, { method: "DELETE", headers: { cookie, origin: "http://localhost" } }), context(video.id))).status, 200);
  assert.equal((await download(new globalThis.Request(`${base}/${video.id}`, { headers: { cookie } }), context(video.id))).status, 404);
});

test("video upload rejects oversized requests before multipart parsing", async () => {
  const oversized = new globalThis.Request(base, { method: "POST", headers: { cookie, origin: "http://localhost", "content-type": "multipart/form-data; boundary=x", "content-length": String(33 * 1024 * 1024) }, body: new Uint8Array([1]) });
  assert.equal((await upload(oversized)).status, 413);
});
