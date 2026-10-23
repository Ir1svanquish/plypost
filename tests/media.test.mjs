import { after, test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { closeDatabase, database } from "../src/lib/server/db.ts";
import { assertOwnedMedia, createMedia, deleteMedia, getMedia, listMedia, MAX_IMAGE_BYTES, MAX_OWNER_MEDIA_BYTES } from "../src/lib/server/media.ts";
import { importLibrary, saveDraft } from "../src/lib/server/workspace.ts";

const temporary = mkdtempSync(join(tmpdir(), "plypost-media-"));
process.env.PLYPOST_DB_PATH = join(temporary, "media.sqlite");
const owner = "owner@example.test";
const other = "other@example.test";

after(() => { closeDatabase(); if (temporary.startsWith(tmpdir())) rmSync(temporary, { recursive: true, force: true }); });

test("private image storage strips metadata, deduplicates, and scopes reads and deletes to its owner", async () => {
  const original = await sharp({ create: { width: 12, height: 8, channels: 3, background: "#ab1234" } })
    .jpeg().withExif({ IFD0: { Artist: "Private name" } }).toBuffer();
  assert.ok((await sharp(original).metadata()).exif);
  const stored = await createMedia(owner, { name: "../private/location.jpg", type: "image/jpeg", bytes: original });
  assert.equal(stored.created, true);
  assert.equal(stored.media.name, "location.jpg");
  assert.equal(stored.media.mimeType, "image/jpeg");
  assert.equal(stored.media.width, 12);
  assert.equal(stored.media.height, 8);
  assert.equal(listMedia(other).length, 0);
  assert.equal(getMedia(other, stored.media.id), null);
  assert.equal(deleteMedia(other, stored.media.id), false);
  const loaded = getMedia(owner, stored.media.id);
  assert.ok(loaded);
  assert.equal((await sharp(loaded.bytes).metadata()).exif, undefined);
  closeDatabase();
  assert.equal(listMedia(owner)[0].id, stored.media.id);
  const duplicate = await createMedia(owner, { name: "another.jpg", type: "image/jpeg", bytes: original });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.media.id, stored.media.id);
  assert.equal(listMedia(owner).length, 1);
  assert.equal(deleteMedia(owner, stored.media.id), true);
  assert.equal(getMedia(owner, stored.media.id), null);
});

test("rejects unsupported, mismatched, corrupt, oversized, and over-pixel-budget images", async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#123456" } }).png().toBuffer();
  await assert.rejects(createMedia(owner, { name: "wrong.png", type: "image/jpeg", bytes: png }), /does not match/);
  await assert.rejects(createMedia(owner, { name: "bad.png", type: "image/png", bytes: Buffer.from("not an image") }), /could not be decoded/);
  await assert.rejects(createMedia(owner, { name: "huge.jpg", type: "image/jpeg", bytes: Buffer.alloc(MAX_IMAGE_BYTES + 1) }), /no larger than 5 MiB/);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"></svg>');
  await assert.rejects(createMedia(owner, { name: "image.svg", type: "image/svg+xml", bytes: svg }), /JPEG, PNG, or WebP/);
  const massive = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: "#abcdef" } }).jpeg({ quality: 2 }).toBuffer();
  await assert.rejects(createMedia(owner, { name: "too-large.jpg", type: "image/jpeg", bytes: massive }), /could not be decoded|unsupported/);
  assert.deepEqual(listMedia(owner), []);
});

test("media quota is checked atomically before an image is stored", async () => {
  const first = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#abcdef" } }).webp().toBuffer();
  const saved = await createMedia(other, { name: "first.webp", type: "image/webp", bytes: first });
  database().prepare("UPDATE media SET byte_size=? WHERE id=? AND user_id=?")
    .run(MAX_OWNER_MEDIA_BYTES, saved.media.id, other);
  const second = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#123456" } }).webp().toBuffer();
  await assert.rejects(createMedia(other, { name: "second.webp", type: "image/webp", bytes: second }), /64 MiB storage limit/);
  assert.equal(listMedia(other).length, 1);
  assert.equal(getMedia(other, randomUUID()), null);
});

test("draft attachment ownership and deletion conflict are enforced in the database", async () => {
  const png = await sharp({ create: { width: 3, height: 3, channels: 3, background: "#9348ba" } }).png().toBuffer();
  const ownerImage = (await createMedia(owner, { name: "draft.png", type: "image/png", bytes: png })).media;
  assert.doesNotThrow(() => assertOwnedMedia(owner, [ownerImage.id]));
  assert.throws(() => assertOwnedMedia(other, [ownerImage.id]), /missing from your media library/);
  assert.throws(() => assertOwnedMedia(owner, [ownerImage.id, ownerImage.id]), /four distinct images/);
  assert.throws(() => assertOwnedMedia(owner, [randomUUID()]), /missing from your media library/);
  const draftId = randomUUID();
  database().prepare("INSERT INTO drafts(id,user_id,payload,updated_at) VALUES (?,?,?,?)")
    .run(draftId, owner, JSON.stringify({ id: draftId, mediaIds: [ownerImage.id] }), new Date().toISOString());
  assert.throws(() => deleteMedia(owner, ownerImage.id), /Remove this image from saved drafts/);
  assert.ok(getMedia(owner, ownerImage.id));
  database().prepare("DELETE FROM drafts WHERE id=? AND user_id=?").run(draftId, owner);
  assert.equal(deleteMedia(owner, ownerImage.id), true);
});

test("saved drafts and imports reject image IDs that the account does not own", async () => {
  const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#4398ad" } }).png().toBuffer();
  const image = (await createMedia(owner, { name: "owned.png", type: "image/png", bytes })).media;
  const stamp = new Date().toISOString();
  const draft = { id: randomUUID(), title: "Illustrated", source: "Text", selected: ["bluesky"], variants: {}, mediaIds: [image.id], createdAt: stamp, updatedAt: stamp };
  assert.equal(saveDraft(owner, draft).mediaIds[0], image.id);
  assert.throws(() => saveDraft(other, { ...draft, id: randomUUID() }), /missing from your media library/);
  const before = database().prepare("SELECT COUNT(*) AS count FROM drafts WHERE user_id=?").get(other).count;
  assert.throws(() => importLibrary(other, { version: 3, drafts: [{ ...draft, id: randomUUID() }], schedule: [], assisted: [] }), /missing from your media library/);
  assert.equal(database().prepare("SELECT COUNT(*) AS count FROM drafts WHERE user_id=?").get(other).count, before);
  assert.throws(() => deleteMedia(owner, image.id), /Remove this image from saved drafts/);
});
