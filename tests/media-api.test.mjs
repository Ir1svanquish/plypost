import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { closeDatabase, database } from "../src/lib/server/db.ts";
import { createSession, SESSION_COOKIE } from "../src/lib/server/auth.ts";
import { GET as list, POST as upload } from "../src/app/api/media/route.ts";
import { DELETE as remove, GET as read } from "../src/app/api/media/[id]/route.ts";

const temporary = mkdtempSync(join(tmpdir(), "plypost-media-api-"));
process.env.PLYPOST_DB_PATH = join(temporary, "media-api.sqlite");
process.env.PLYPOST_OWNER_EMAIL = "owner@example.test";
process.env.PLYPOST_OWNER_PASSWORD_HASH = "configured";
const cookie = `${SESSION_COOKIE}=${createSession("owner@example.test")}`;
const base = "http://localhost/api/media";
const routeContext = (id) => ({ params: Promise.resolve({ id }) });

after(() => { closeDatabase(); if (temporary.startsWith(tmpdir())) rmSync(temporary, { recursive: true, force: true }); });

function imageRequest(bytes, { withCookie = true, origin = "http://localhost", type = "image/png" } = {}) {
  const form = new globalThis.FormData();
  form.append("file", new globalThis.Blob([new Uint8Array(bytes)], { type }), "example.png");
  return new globalThis.Request(base, {
    method: "POST", headers: { origin, ...(withCookie ? { cookie } : {}) }, body: form,
  });
}

test("media routes require the owner session and same-origin uploads", async () => {
  const png = await sharp({ create: { width: 3, height: 4, channels: 3, background: "#ff3322" } }).png().toBuffer();
  assert.equal((await list(new globalThis.Request(base))).status, 401);
  assert.equal((await upload(imageRequest(png, { withCookie: false }))).status, 401);
  assert.equal((await upload(imageRequest(png, { origin: "https://evil.example" }))).status, 403);

  const created = await upload(imageRequest(png));
  assert.equal(created.status, 201);
  assert.match(created.headers.get("cache-control"), /no-store/);
  const { media } = await created.json();
  assert.equal(media.mimeType, "image/png");
  assert.equal(media.width, 3);
  assert.equal(media.height, 4);

  const listing = await list(new globalThis.Request(base, { headers: { cookie } }));
  assert.equal(listing.status, 200);
  assert.equal((await listing.json()).media[0].id, media.id);
  assert.equal((await read(new globalThis.Request(`${base}/${media.id}`), routeContext(media.id))).status, 401);
  assert.equal((await read(new globalThis.Request(`${base}/${media.id}?thumb=1`), routeContext(media.id))).status, 401);
  const image = await read(new globalThis.Request(`${base}/${media.id}`, { headers: { cookie } }), routeContext(media.id));
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.equal((await sharp(new Uint8Array(await image.arrayBuffer())).metadata()).width, 3);
  const thumbnail = await read(new globalThis.Request(`${base}/${media.id}?thumb=1`, { headers: { cookie } }), routeContext(media.id));
  assert.equal(thumbnail.status, 200);
  assert.equal(thumbnail.headers.get("content-type"), "image/webp");
  assert.match(thumbnail.headers.get("cache-control"), /private, no-store/);
  const thumbnailBytes = new Uint8Array(await thumbnail.arrayBuffer());
  assert.equal(Number(thumbnail.headers.get("content-length")), thumbnailBytes.length);
  const thumbnailDetails = await sharp(thumbnailBytes).metadata();
  assert.equal(thumbnailDetails.width, 3);
  assert.equal(thumbnailDetails.height, 4);
  const download = await read(new globalThis.Request(`${base}/${media.id}?download=1`, { headers: { cookie } }), routeContext(media.id));
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition"), /attachment; filename\*=UTF-8''example\.png/);
  assert.match(download.headers.get("cache-control"), /no-store/);
  const mixed = await read(new globalThis.Request(`${base}/${media.id}?thumb=1&download=1`, { headers: { cookie } }), routeContext(media.id));
  assert.equal(mixed.headers.get("content-type"), "image/png");

  assert.equal((await remove(new globalThis.Request(`${base}/${media.id}`, { method: "DELETE", headers: { cookie, origin: "https://evil.example" } }), routeContext(media.id))).status, 403);
  const draftId = randomUUID();
  database().prepare("INSERT INTO drafts(id,user_id,payload,updated_at) VALUES (?,?,?,?)")
    .run(draftId, "owner@example.test", JSON.stringify({ id: draftId, mediaIds: [media.id] }), new Date().toISOString());
  const protectedDelete = await remove(new globalThis.Request(`${base}/${media.id}`, { method: "DELETE", headers: { cookie, origin: "http://localhost" } }), routeContext(media.id));
  assert.equal(protectedDelete.status, 409);
  assert.match((await protectedDelete.json()).error, /saved drafts/);
  database().prepare("DELETE FROM drafts WHERE id=? AND user_id=?").run(draftId, "owner@example.test");
  assert.equal((await remove(new globalThis.Request(`${base}/${media.id}`, { method: "DELETE", headers: { cookie, origin: "http://localhost" } }), routeContext(media.id))).status, 200);
  assert.equal((await read(new globalThis.Request(`${base}/${media.id}`, { headers: { cookie } }), routeContext(media.id))).status, 404);
});

test("upload route bounds the raw body and checks the actual image content", async () => {
  const oversized = new globalThis.Request(base, {
    method: "POST", headers: { cookie, origin: "http://localhost", "content-type": "multipart/form-data; boundary=x" },
    body: new Uint8Array(6 * 1024 * 1024),
  });
  assert.equal((await upload(oversized)).status, 413);
  assert.equal((await upload(imageRequest(new Uint8Array([1, 2, 3]), { type: "image/png" }))).status, 400);
  assert.equal((await upload(imageRequest(new globalThis.TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), { type: "image/svg+xml" }))).status, 400);
});

test("private thumbnails shrink a larger image without changing its original download", async () => {
  const png = await sharp({ create: { width: 640, height: 400, channels: 3, background: "#5577aa" } }).png().toBuffer();
  const created = await upload(imageRequest(png));
  assert.equal(created.status, 201);
  const { media } = await created.json();
  const preview = await read(new globalThis.Request(`${base}/${media.id}?thumb=1`, { headers: { cookie } }), routeContext(media.id));
  const previewDetails = await sharp(new Uint8Array(await preview.arrayBuffer())).metadata();
  assert.equal(previewDetails.width, 256);
  assert.equal(previewDetails.height, 160);
  const original = await read(new globalThis.Request(`${base}/${media.id}?download=1`, { headers: { cookie } }), routeContext(media.id));
  const originalDetails = await sharp(new Uint8Array(await original.arrayBuffer())).metadata();
  assert.equal(originalDetails.width, 640);
  assert.equal(originalDetails.height, 400);
  assert.equal((await remove(new globalThis.Request(`${base}/${media.id}`, { method: "DELETE", headers: { cookie, origin: "http://localhost" } }), routeContext(media.id))).status, 200);
});
