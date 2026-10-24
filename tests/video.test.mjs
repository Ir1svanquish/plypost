import { after, test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase } from "../src/lib/server/db.ts";
import { addAssisted, deleteAssisted } from "../src/lib/server/workspace.ts";
import { assertOwnedVideo, createVideo, deleteVideo, getVideo, listVideos, MAX_VIDEO_BYTES } from "../src/lib/server/video.ts";

const temporary = mkdtempSync(join(tmpdir(), "plypost-video-"));
process.env.PLYPOST_DB_PATH = join(temporary, "video.sqlite");
const owner = "video-owner@example.test";
const other = "video-other@example.test";
after(() => { closeDatabase(); if (temporary.startsWith(tmpdir())) rmSync(temporary, { recursive: true, force: true }); });

// A tiny ftyp container tests private storage and handoff bytes; it is not a playback fixture.
const mp4 = Buffer.from([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);

test("private video library deduplicates, checks ownership, and protects referenced clips", () => {
  const stored = createVideo(owner, { name: "../private/launch.mp4", type: "video/mp4", bytes: mp4 });
  assert.equal(stored.created, true);
  assert.equal(stored.video.name, "launch.mp4");
  assert.equal(createVideo(owner, { name: "copy.mp4", type: "video/mp4", bytes: mp4 }).video.id, stored.video.id);
  assert.equal(listVideos(owner).length, 1);
  assert.deepEqual(listVideos(other), []);
  assert.equal(getVideo(other, stored.video.id), null);
  assert.equal(deleteVideo(other, stored.video.id), false);
  assert.throws(() => assertOwnedVideo(other, stored.video.id), /missing from your private library/);
  assert.deepEqual(getVideo(owner, stored.video.id).bytes, mp4);

  const now = new Date().toISOString();
  const handoff = { id: randomUUID(), title: "Launch", destination: "youtube", text: "New clip",
    videoId: stored.video.id, scheduledFor: now, createdAt: now, status: "queued" };
  assert.throws(() => addAssisted(other, { ...handoff, id: randomUUID() }), /missing from your private library/);
  assert.equal(addAssisted(owner, handoff).videoId, stored.video.id);
  assert.throws(() => deleteVideo(owner, stored.video.id), /Remove this video from saved handoffs/);
  assert.equal(deleteAssisted(owner, handoff.id), true);
  assert.equal(deleteVideo(owner, stored.video.id), true);
  assert.equal(getVideo(owner, stored.video.id), null);
});

test("video storage rejects mismatched and oversized uploads", () => {
  assert.throws(() => createVideo(owner, { name: "fake.mp4", type: "video/mp4", bytes: Buffer.from("not a video") }), /valid MP4/);
  assert.throws(() => createVideo(owner, { name: "wrong.mov", type: "video/quicktime", bytes: mp4 }), /valid MP4/);
  assert.throws(() => createVideo(owner, { name: "huge.mp4", type: "video/mp4", bytes: Buffer.alloc(MAX_VIDEO_BYTES + 1) }), /no larger than 32 MiB/);
});
