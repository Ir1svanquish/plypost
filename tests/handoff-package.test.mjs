import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import sharp from "sharp";
import { closeDatabase, database } from "../src/lib/server/db.ts";
import { createSession, SESSION_COOKIE } from "../src/lib/server/auth.ts";
import { createMedia, getMedia } from "../src/lib/server/media.ts";
import { createVideo } from "../src/lib/server/video.ts";
import { addAssisted } from "../src/lib/server/workspace.ts";
import { buildHandoffPackage } from "../src/lib/server/handoff-package.ts";
import { GET } from "../src/app/api/assisted/[id]/package/route.ts";

const temporary = mkdtempSync(join(tmpdir(), "plypost-handoff-package-"));
process.env.PLYPOST_DB_PATH = join(temporary, "handoff.sqlite");
process.env.PLYPOST_OWNER_EMAIL = "owner@example.test";
process.env.PLYPOST_OWNER_PASSWORD_HASH = "configured";
const owner = "owner@example.test";
const cookie = `${SESSION_COOKIE}=${createSession(owner)}`;
const base = "http://localhost/api/assisted";
const context = (id) => ({ params: Promise.resolve({ id }) });

after(() => { closeDatabase(); if (temporary.startsWith(tmpdir())) rmSync(temporary, { recursive: true, force: true }); });

function handoff(destination, mediaIds = [], mediaAlt = [], placeLabel) {
  const stamp = new Date().toISOString();
  return addAssisted(owner, {
    id: randomUUID(), title: "Autumn workshop", destination, text: "Doors open at 1:30.\nBring a laptop.",
    mediaIds, mediaAlt, ...(placeLabel ? { placeLabel } : {}), scheduledFor: stamp, createdAt: stamp, status: "queued",
  });
}

test("handoff ZIP includes exact caption, ordered images, descriptions, and private download headers", async () => {
  const firstBytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: "#eeaabb" } }).png().toBuffer();
  const secondBytes = await sharp({ create: { width: 4, height: 3, channels: 3, background: "#344556" } }).jpeg().toBuffer();
  const first = (await createMedia(owner, { name: "../private/flyer.png", type: "image/png", bytes: firstBytes })).media;
  const second = (await createMedia(owner, { name: "portrait.jpg", type: "image/jpeg", bytes: secondBytes })).media;
  const saved = handoff("instagram", [first.id, second.id], ["Event flyer", "Speaker portrait"], "Central, Hong Kong");
  const url = `${base}/${saved.id}/package`;

  assert.equal((await GET(new globalThis.Request(url), context(saved.id))).status, 401);
  assert.throws(() => buildHandoffPackage("other@example.test", saved.id), /not found/);
  const absentId = randomUUID();
  assert.equal((await GET(new globalThis.Request(`${base}/${absentId}/package`, { headers: { cookie } }), context(absentId))).status, 404);

  const response = await GET(new globalThis.Request(url, { headers: { cookie } }), context(saved.id));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/zip");
  assert.match(response.headers.get("content-disposition"), /^attachment; filename="plypost-instagram-[a-f0-9]{8}\.zip"$/);
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(Number(response.headers.get("content-length")), bytes.length);
  const files = unzipSync(bytes);
  assert.deepEqual(Object.keys(files).sort(), ["caption.txt", "handoff.txt", "images/01.png", "images/02.jpg"]);
  assert.equal(strFromU8(files["caption.txt"]), `${saved.text}\n`);
  assert.deepEqual(files["images/01.png"], new Uint8Array(getMedia(owner, first.id).bytes));
  assert.deepEqual(files["images/02.jpg"], new Uint8Array(getMedia(owner, second.id).bytes));
  const notes = strFromU8(files["handoff.txt"]);
  assert.match(notes, /Platform: Instagram/);
  assert.match(notes, /Place note: Central, Hong Kong/);
  assert.match(notes, /Image 1: images\/01\.png\nDescription: Event flyer/);
  assert.match(notes, /Image 2: images\/02\.jpg\nDescription: Speaker portrait/);
  assert.doesNotMatch(notes, /private\/flyer/);

  database().prepare("DELETE FROM media WHERE id=? AND user_id=?").run(first.id, owner);
  const missing = await GET(new globalThis.Request(url, { headers: { cookie } }), context(saved.id));
  assert.equal(missing.status, 409);
  assert.match((await missing.json()).error, /unavailable/);
});

test("video-first handoff keeps text export honest when no video is stored", async () => {
  const saved = handoff("youtube");
  const response = await GET(new globalThis.Request(`${base}/${saved.id}/package`, { headers: { cookie } }), context(saved.id));
  assert.equal(response.status, 200);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  assert.deepEqual(Object.keys(files).sort(), ["caption.txt", "handoff.txt"]);
  assert.match(strFromU8(files["handoff.txt"]), /No video is attached to this handoff/);
});

test("checklist package says no reminder instead of exporting its storage timestamp", () => {
  const stamp = new Date().toISOString();
  const saved = addAssisted(owner, { id: randomUUID(), title: "No date", destination: "facebook", text: "Post when ready",
    scheduledFor: stamp, reminderEnabled: false, createdAt: stamp, status: "queued" });
  const files = unzipSync(buildHandoffPackage(owner, saved.id).bytes);
  const notes = strFromU8(files["handoff.txt"]);
  assert.match(notes, /Reminder: none/);
  assert.doesNotMatch(notes, /Reminder \(UTC\)/);
});

test("video handoff ZIP contains exact saved clip and caption", async () => {
  const bytes = readFileSync(join(import.meta.dirname, "fixtures/short-blue.mp4"));
  const video = createVideo(owner, { name: "launch.mp4", type: "video/mp4", bytes }).video;
  const now = new Date().toISOString();
  const saved = addAssisted(owner, { id: randomUUID(), title: "Clip", destination: "youtube", text: "Watch this clip",
    videoId: video.id, scheduledFor: now, createdAt: now, status: "queued" });
  const response = await GET(new globalThis.Request(`${base}/${saved.id}/package`, { headers: { cookie } }), context(saved.id));
  assert.equal(response.status, 200);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  assert.deepEqual(Object.keys(files).sort(), ["caption.txt", "handoff.txt", "video/clip.mp4"]);
  assert.deepEqual(Buffer.from(files["video/clip.mp4"]), bytes);
  assert.equal(strFromU8(files["caption.txt"]), "Watch this clip\n");
  assert.match(strFromU8(files["handoff.txt"]), /Video: video\/clip\.mp4/);
});
