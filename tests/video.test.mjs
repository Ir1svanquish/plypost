import { after, test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { closeDatabase } from "../src/lib/server/db.ts";
import { buildHandoffPackage } from "../src/lib/server/handoff-package.ts";
import { addAssisted, deleteAssisted, deleteDraft, listWorkspace, prepareAssistedBatch, saveDraft, setAssistedStatus, updateAssistedVideo } from "../src/lib/server/workspace.ts";
import { assistedContentSnapshot, assistedDeletionSnapshot } from "../src/lib/workspace.ts";
import { assertOwnedVideo, createVideo, deleteVideo, getVideo, getVideoMetadata, listVideos, MAX_VIDEO_BYTES } from "../src/lib/server/video.ts";

const temporary = mkdtempSync(join(tmpdir(), "plypost-video-"));
process.env.PLYPOST_DB_PATH = join(temporary, "video.sqlite");
const owner = "video-owner@example.test";
const other = "video-other@example.test";
after(() => { closeDatabase(); if (temporary.startsWith(tmpdir())) rmSync(temporary, { recursive: true, force: true }); });

const mp4 = readFileSync(join(import.meta.dirname, "fixtures/short-blue.mp4"));

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
  assert.throws(() => deleteVideo(owner, stored.video.id), /Detach this video from saved drafts and handoffs/);
  assert.equal(deleteAssisted(owner, handoff.id, assistedDeletionSnapshot(handoff)), true);
  assert.equal(deleteVideo(owner, stored.video.id), true);
  assert.equal(getVideo(owner, stored.video.id), null);
});

test("video storage rejects mismatched and oversized uploads", () => {
  assert.throws(() => createVideo(owner, { name: "fake.mp4", type: "video/mp4", bytes: Buffer.from("not a video") }), /valid MP4/);
  assert.throws(() => createVideo(owner, { name: "wrong.mov", type: "video/quicktime", bytes: mp4 }), /valid MP4/);
  assert.throws(() => createVideo(owner, { name: "huge.mp4", type: "video/mp4", bytes: Buffer.alloc(MAX_VIDEO_BYTES + 1) }), /no larger than 32 MiB/);
});

test("private video slices preserve byte boundaries and ownership", () => {
  const video = createVideo(owner, { name: "range.mp4", type: "video/mp4", bytes: mp4 }).video;
  assert.equal(getVideoMetadata(owner, video.id)?.sizeBytes, mp4.length);
  assert.equal(getVideoMetadata(other, video.id), null);
  assert.equal(getVideo(other, video.id, { start: 0, end: 0 }), null);
  for (const [start, end] of [[0, 0], [8, 31], [mp4.length - 1, mp4.length - 1]]) {
    const slice = getVideo(owner, video.id, { start, end });
    assert.equal(slice.video.sizeBytes, mp4.length);
    assert.deepEqual(slice.bytes, mp4.subarray(start, end + 1));
  }
  for (const range of [{ start: -1, end: 1 }, { start: 2, end: 1 }, { start: 0.5, end: 1 }, { start: 0, end: MAX_VIDEO_BYTES }]) {
    assert.equal(getVideo(owner, video.id, range), null);
  }
  assert.equal(deleteVideo(owner, video.id), true);
  assert.equal(getVideoMetadata(owner, video.id), null);
  assert.equal(getVideo(owner, video.id, { start: 0, end: 0 }), null);
});

test("queued handoff can replace and detach its clip without losing text or another window's edit", () => {
  const first = createVideo(owner, { name: "first.mp4", type: "video/mp4", bytes: mp4 }).video;
  const second = createVideo(owner, { name: "second.mp4", type: "video/mp4", bytes: Buffer.concat([mp4, Buffer.from([1])]) }).video;
  const foreign = createVideo(other, { name: "foreign.mp4", type: "video/mp4", bytes: Buffer.concat([mp4, Buffer.from([2])]) }).video;
  const now = new Date().toISOString();
  const handoff = addAssisted(owner, { id: randomUUID(), title: "Launch", destination: "youtube", text: "Keep this caption",
    videoId: first.id, scheduledFor: now, createdAt: now, status: "queued" });
  assert.throws(() => updateAssistedVideo(other, handoff.id, first.id, foreign.id), /no longer available/);
  assert.throws(() => updateAssistedVideo(owner, handoff.id, first.id, foreign.id), /missing from your private library/);
  assert.equal(updateAssistedVideo(owner, handoff.id, first.id, second.id), true);
  const replaced = listWorkspace(owner).assisted.find((item) => item.id === handoff.id);
  assert.equal(replaced.videoId, second.id);
  assert.equal(replaced.text, handoff.text);
  assert.equal(replaced.scheduledFor, handoff.scheduledFor);
  const replacedPackage = unzipSync(buildHandoffPackage(owner, handoff.id).bytes);
  assert.deepEqual(Buffer.from(replacedPackage["video/clip.mp4"]), getVideo(owner, second.id).bytes);
  assert.throws(() => updateAssistedVideo(owner, handoff.id, first.id, null), /video changed/);
  assert.equal(deleteVideo(owner, first.id), true);
  assert.throws(() => deleteVideo(owner, second.id), /saved drafts and handoffs/);
  assert.equal(updateAssistedVideo(owner, handoff.id, second.id, null), true);
  assert.equal(listWorkspace(owner).assisted.find((item) => item.id === handoff.id).videoId, undefined);
  assert.equal(unzipSync(buildHandoffPackage(owner, handoff.id).bytes)["video/clip.mp4"], undefined);
  assert.equal(deleteVideo(owner, second.id), true);
  assert.equal(setAssistedStatus(owner, handoff.id, "posted", undefined,
    assistedContentSnapshot(listWorkspace(owner).assisted.find((item) => item.id === handoff.id))), true);
  assert.throws(() => updateAssistedVideo(owner, handoff.id, null, foreign.id), /marked posted/);
  assert.throws(() => updateAssistedVideo(owner, handoff.id, null, "not-an-id"), /Choose a saved video/);
});

test("a saved video draft retains its clip through batch handoff and blocks premature deletion", () => {
  const video = createVideo(owner, { name: "draft.mp4", type: "video/mp4", bytes: mp4 }).video;
  const foreign = createVideo(other, { name: "foreign-draft.mp4", type: "video/mp4", bytes: Buffer.concat([mp4, Buffer.from([3])]) }).video;
  const now = new Date().toISOString();
  const idea = { id: randomUUID(), title: "", source: "", selected: [], variants: {},
    videoId: video.id, createdAt: now, updatedAt: now };
  assert.throws(() => saveDraft(owner, { ...idea, id: randomUUID(), videoId: foreign.id }), /missing from your private library/);
  const saved = saveDraft(owner, idea);
  assert.equal(saved.videoId, video.id);
  assert.equal(listWorkspace(owner).drafts.find((item) => item.id === saved.id).videoId, video.id);
  assert.throws(() => deleteVideo(owner, video.id), /saved drafts and handoffs/);
  const [handoff] = prepareAssistedBatch(owner, saved.id, randomUUID(), [
    { destination: "youtube", text: "Watch this clip", videoId: video.id, scheduledFor: now },
  ], false, saved.updatedAt);
  assert.equal(handoff.videoId, video.id);
  assert.equal(deleteDraft(owner, saved.id, saved.updatedAt), true);
  assert.throws(() => deleteVideo(owner, video.id), /saved drafts and handoffs/);
  assert.equal(deleteAssisted(owner, handoff.id, assistedDeletionSnapshot(handoff)), true);
  assert.equal(deleteVideo(owner, video.id), true);
});
