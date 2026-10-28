import { after, test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { closeDatabase, database } from "../src/lib/server/db.ts";
import { createSession, SESSION_COOKIE } from "../src/lib/server/auth.ts";
import { createMedia } from "../src/lib/server/media.ts";
import { createVideo } from "../src/lib/server/video.ts";
import { addAssisted, deleteAssisted, listWorkspace, prepareAssistedBatch, saveDraft, setAssistedStatus, updateAssistedImages, updateAssistedMediaAlt, updateAssistedText, updateAssistedVideo } from "../src/lib/server/workspace.ts";
import { defaultHandoffImageIds, imageLimitForDestination, imageLimitWarning } from "../src/lib/media-policy.ts";
import { assistedContentSnapshot, assistedDeletionSnapshot, assistedState, hasManualReminder, parseWorkspace } from "../src/lib/workspace.ts";
import { buildPlanAgenda } from "../src/lib/plan-agenda.ts";
import { POST as workspacePost } from "../src/app/api/workspace/route.ts";

const temporary = mkdtempSync(join(tmpdir(), "plypost-batch-"));
process.env.PLYPOST_DB_PATH = join(temporary, "batch.sqlite");
process.env.PLYPOST_OWNER_EMAIL = "owner@example.test";
process.env.PLYPOST_OWNER_PASSWORD_HASH = "test-only-placeholder";
const owner = "owner@example.test";
const other = "other@example.test";
after(() => { closeDatabase(); if (temporary.startsWith(tmpdir())) rmSync(temporary, { recursive: true, force: true }); });

function draft(source = "Saved source", selected = ["bluesky", "linkedin"], variants = { bluesky: "Edited Bluesky text" }, mediaIds) {
  const now = new Date().toISOString();
  return { id: randomUUID(), title: "Reviewed idea", source, selected, variants,
    ...(mediaIds ? { mediaIds } : {}), createdAt: now, updatedAt: now };
}
function handoffs() {
  return [
    { destination: "bluesky", scheduledFor: new Date(Date.now() + 60_000).toISOString() },
    { destination: "linkedin", scheduledFor: new Date(Date.now() + 120_000).toISOString() },
  ];
}

test("batch handoffs snapshot saved platform versions and media, while repeat requests return originals", async () => {
  const image = (await createMedia(owner, {
    name: "cover.png", type: "image/png",
    bytes: await sharp({ create: { width: 4, height: 4, channels: 3, background: "#3366cc" } }).png().toBuffer(),
  })).media;
  const saved = saveDraft(owner, { ...draft("Saved source", undefined, undefined, [image.id]), mediaAlt: ["Blue cover image"], placeLabel: "Central, Hong Kong" });
  const batchId = randomUUID();
  const items = handoffs();
  const first = prepareAssistedBatch(owner, saved.id, batchId, items);
  assert.equal(first.length, 2);
  assert.deepEqual(first.map((item) => item.text), ["Edited Bluesky text", "Saved source"]);
  assert.deepEqual(first.map((item) => item.destination), ["bluesky", "linkedin"]);
  assert.ok(first.every((item) => item.sourceDraftId === saved.id && item.batchId === batchId && item.status === "queued"));
  assert.ok(first.every((item) => item.title === saved.title && item.mediaIds[0] === image.id && item.mediaAlt[0] === "Blue cover image"));
  assert.ok(first.every((item) => item.placeLabel === "Central, Hong Kong"));
  assert.equal(listWorkspace(owner).log.find((entry) => entry.action === "assisted.batch_prepared").detail, "2 manual handoffs");
  closeDatabase();
  assert.deepEqual(prepareAssistedBatch(owner, saved.id, batchId, [...items].reverse()), [...first].reverse());
  assert.equal(listWorkspace(owner).assisted.length, 2);
  assert.deepEqual(listWorkspace(other).assisted, []);
  assert.throws(() => prepareAssistedBatch(other, saved.id, randomUUID(), items), /Saved draft not found/);

  saveDraft(owner, { ...saved, source: "New source", variants: { bluesky: "New version" }, mediaAlt: ["Changed description"] }, saved.updatedAt);
  assert.deepEqual(prepareAssistedBatch(owner, saved.id, batchId, items).map((item) => item.text), first.map((item) => item.text));
  assert.deepEqual(prepareAssistedBatch(owner, saved.id, batchId, items).map((item) => item.mediaAlt), first.map((item) => item.mediaAlt));
  assert.throws(() => prepareAssistedBatch(owner, saved.id, batchId, items.slice(0, 1)), /different or partial/);
  assert.throws(() => prepareAssistedBatch(owner, saved.id, batchId, [items[0], { ...items[1], scheduledFor: new Date(Date.now() + 180_000).toISOString() }]), /different or partial/);
  assert.throws(() => prepareAssistedBatch(owner, randomUUID(), batchId, items), /different or partial/);
  assert.equal(listWorkspace(owner).assisted.length, 2);
  assert.equal(deleteAssisted(owner, first[0].id, assistedDeletionSnapshot(first[0])), true);
  assert.throws(() => prepareAssistedBatch(owner, saved.id, batchId, items), /different or partial/);
  assert.throws(() => prepareAssistedBatch(owner, saved.id, batchId, [items[1]]), /different or partial/);
  assert.equal(deleteAssisted(owner, first[1].id, assistedDeletionSnapshot(first[1])), true);
  assert.throws(() => prepareAssistedBatch(owner, saved.id, batchId, items), /handoffs were removed/);
});

test("each platform receives only its reviewed image subset, order and matching descriptions", async () => {
  const images = [];
  for (let index = 0; index < 6; index++) {
    images.push((await createMedia(owner, {
      name: `batch-${index}.png`, type: "image/png",
      bytes: await sharp({ create: { width: 4, height: 4, channels: 3,
        background: { r: index * 30, g: 80, b: 180 } } }).png().toBuffer(),
    })).media);
  }
  const ids = images.map((image) => image.id);
  const saved = saveDraft(owner, { ...draft("Photo set", undefined, undefined, ids),
    mediaAlt: ids.map((_, index) => `Photo ${index + 1}`) });
  const [skyTime, linkedTime] = handoffs();
  const items = [
    { ...skyTime, mediaIds: [ids[5], ids[1], ids[0], ids[3]] },
    { ...linkedTime, mediaIds: [ids[2], ids[4], ids[3], ids[0], ids[1], ids[5]] },
  ];
  const batchId = randomUUID();
  const [sky, linked] = prepareAssistedBatch(owner, saved.id, batchId, items);
  assert.deepEqual(sky.mediaIds, items[0].mediaIds);
  assert.deepEqual(sky.mediaAlt, ["Photo 6", "Photo 2", "Photo 1", "Photo 4"]);
  assert.deepEqual(linked.mediaIds, items[1].mediaIds);
  assert.deepEqual(linked.mediaAlt, ["Photo 3", "Photo 5", "Photo 4", "Photo 1", "Photo 2", "Photo 6"]);
  assert.deepEqual(listWorkspace(owner).drafts.find((item) => item.id === saved.id).mediaIds, ids);
  assert.deepEqual(prepareAssistedBatch(owner, saved.id, batchId, [...items].reverse()), [linked, sky]);
  assert.throws(() => prepareAssistedBatch(owner, saved.id, batchId,
    [{ ...items[0], mediaIds: [...items[0].mediaIds].reverse() }, items[1]]), /different or partial/);
  const before = listWorkspace(owner).assisted.length;
  assert.throws(() => prepareAssistedBatch(owner, saved.id, randomUUID(),
    [{ ...skyTime, mediaIds: ids.slice(0, 5) }]), /valid text and UTC timestamps/);
  assert.throws(() => prepareAssistedBatch(owner, saved.id, randomUUID(),
    [{ ...skyTime, mediaIds: [ids[0], ids[0]] }]), /valid text and UTC timestamps/);
  assert.throws(() => prepareAssistedBatch(owner, saved.id, randomUUID(),
    [{ ...skyTime, mediaIds: [randomUUID()] }]), /this saved draft only/);
  assert.throws(() => updateAssistedImages(owner, sky.id, sky.mediaIds, sky.mediaAlt,
    ids.slice(0, 5), ids.slice(0, 5).map(() => "")), /fewer images/);
  assert.throws(() => addAssisted(owner, {
    id: randomUUID(), title: "Too many", destination: "bluesky", text: "Image set",
    mediaIds: ids.slice(0, 5), mediaAlt: ids.slice(0, 5).map(() => ""),
    scheduledFor: new Date(Date.now() + 60_000).toISOString(), createdAt: new Date().toISOString(), status: "queued",
  }), /fewer images/);
  assert.equal(listWorkspace(owner).assisted.length, before);
  const [textOnly] = prepareAssistedBatch(owner, saved.id, randomUUID(), [{ ...skyTime, mediaIds: [] }]);
  assert.deepEqual(textOnly.mediaIds, []);
  assert.deepEqual(textOnly.mediaAlt, []);

  const pinterest = { destination: "pinterest", scheduledFor: new Date(Date.now() + 60_000).toISOString(), text: "One image Pin" };
  const [pin] = prepareAssistedBatch(owner, saved.id, randomUUID(), [pinterest]);
  assert.deepEqual(pin.mediaIds, [ids[0]]);
  assert.deepEqual(pin.mediaAlt, ["Photo 1"]);
  assert.throws(() => prepareAssistedBatch(owner, saved.id, randomUUID(), [{ ...pinterest, mediaIds: ids.slice(0, 2) }]), /valid text and UTC timestamps/);
  assert.throws(() => updateAssistedImages(owner, pin.id, pin.mediaIds, pin.mediaAlt, ids.slice(0, 2), ["", ""]), /fewer images/);
  assert.throws(() => addAssisted(owner, {
    id: randomUUID(), title: "Two images in one Pin", destination: "pinterest", text: "One image Pin",
    mediaIds: ids.slice(0, 2), mediaAlt: ["", ""],
    scheduledFor: pinterest.scheduledFor, createdAt: new Date().toISOString(), status: "queued",
  }), /fewer images/);
});

test("X counts a saved video toward its four media items in every handoff path", async () => {
  const ids = [];
  for (let index = 0; index < 4; index++) {
    ids.push((await createMedia(owner, {
      name: `x-media-${index}.png`, type: "image/png",
      bytes: await sharp({ create: { width: 4, height: 4, channels: 3,
        background: { r: 40 + index * 20, g: 90, b: 150 } } }).png().toBuffer(),
    })).media.id);
  }
  const clip = createVideo(owner, { name: "x-media.mp4", type: "video/mp4",
    bytes: readFileSync(join(import.meta.dirname, "fixtures/short-blue.mp4")) }).video;
  const saved = saveDraft(owner, { ...draft("X media review", ["bluesky"], {}, ids),
    mediaAlt: ids.map((_, index) => `Photo ${index + 1}`), videoId: clip.id });
  const time = new Date(Date.now() + 60_000).toISOString();
  const x = { destination: "x", text: "Reviewed X copy", scheduledFor: time };

  assert.equal(imageLimitForDestination("x"), 4);
  assert.equal(imageLimitForDestination("x", true), 3);
  assert.match(imageLimitWarning("x", 4, true), /4 media items/);
  assert.equal(imageLimitWarning("linkedin", 4, true), null);
  const [mixed] = prepareAssistedBatch(owner, saved.id, randomUUID(), [{ ...x, videoId: clip.id }]);
  assert.deepEqual(mixed.mediaIds, ids.slice(0, 3));
  assert.deepEqual(mixed.mediaAlt, ["Photo 1", "Photo 2", "Photo 3"]);
  assert.equal(mixed.videoId, clip.id);
  assert.throws(() => prepareAssistedBatch(owner, saved.id, randomUUID(),
    [{ ...x, mediaIds: ids, videoId: clip.id }]), /valid text and UTC timestamps/);
  assert.throws(() => updateAssistedImages(owner, mixed.id, mixed.mediaIds, mixed.mediaAlt,
    ids, ids.map(() => "")), /fewer images/);

  const [photos] = prepareAssistedBatch(owner, saved.id, randomUUID(), [{ ...x, mediaIds: ids }]);
  assert.deepEqual(photos.mediaIds, ids);
  assert.equal(photos.videoId, undefined);
  assert.throws(() => updateAssistedVideo(owner, photos.id, null, clip.id), /fewer images/);
  assert.equal(updateAssistedImages(owner, photos.id, photos.mediaIds, photos.mediaAlt,
    ids.slice(0, 3), ["", "", ""]), true);
  assert.equal(updateAssistedVideo(owner, photos.id, null, clip.id), true);
  assert.throws(() => addAssisted(owner, { id: randomUUID(), title: "Too much media",
    ...x, mediaIds: ids, mediaAlt: ids.map(() => ""), videoId: clip.id,
    createdAt: new Date().toISOString(), status: "queued" }), /fewer images/);
  assert.equal(addAssisted(owner, { id: randomUUID(), title: "Four photos",
    ...x, mediaIds: ids, mediaAlt: ids.map(() => ""),
    createdAt: new Date().toISOString(), status: "queued" }).mediaIds.length, 4);
});

test("Threads counts a video within its twenty carousel media items", async () => {
  const ids = [];
  for (let index = 0; index < 20; index++) {
    ids.push((await createMedia(owner, {
      name: `threads-media-${index}.png`, type: "image/png",
      bytes: await sharp({ create: { width: 4, height: 4, channels: 3,
        background: { r: 30 + index * 5, g: 90, b: 150 } } }).png().toBuffer(),
    })).media.id);
  }
  const clip = createVideo(owner, { name: "threads-clip.mp4", type: "video/mp4",
    bytes: readFileSync(join(import.meta.dirname, "fixtures/short-blue.mp4")) }).video;
  const saved = saveDraft(owner, { ...draft("Threads carousel", ["threads"], { threads: "Reviewed copy" }, ids),
    mediaAlt: ids.map((_, index) => `Photo ${index + 1}`), videoId: clip.id });
  const request = { destination: "threads", scheduledFor: new Date(Date.now() + 60_000).toISOString() };

  assert.equal(imageLimitForDestination("threads"), 20);
  assert.equal(imageLimitForDestination("threads", true), 19);
  assert.deepEqual(defaultHandoffImageIds("threads", ids, true), ids.slice(0, 19));
  assert.match(imageLimitWarning("threads", 20, true), /20 media items/);
  const [mixed] = prepareAssistedBatch(owner, saved.id, randomUUID(), [{ ...request, videoId: clip.id }]);
  assert.deepEqual(mixed.mediaIds, ids.slice(0, 19));
  assert.equal(mixed.videoId, clip.id);
  assert.throws(() => prepareAssistedBatch(owner, saved.id, randomUUID(),
    [{ ...request, mediaIds: ids, videoId: clip.id }]), /valid text and UTC timestamps/);
  assert.throws(() => updateAssistedImages(owner, mixed.id, mixed.mediaIds, mixed.mediaAlt,
    ids, ids.map(() => "")), /fewer images/);
  const [photos] = prepareAssistedBatch(owner, saved.id, randomUUID(), [request]);
  assert.deepEqual(photos.mediaIds, ids);
  assert.throws(() => updateAssistedVideo(owner, photos.id, null, clip.id), /fewer images/);
});

test("Bluesky handoffs use either video or images without losing older mixed items", async () => {
  const ids = [];
  for (let index = 0; index < 2; index++) {
    ids.push((await createMedia(owner, {
      name: `bluesky-media-${index}.png`, type: "image/png",
      bytes: await sharp({ create: { width: 4, height: 4, channels: 3,
        background: { r: 70, g: 90 + index * 40, b: 150 } } }).png().toBuffer(),
    })).media.id);
  }
  const clip = createVideo(owner, { name: "bluesky-clip.mp4", type: "video/mp4",
    bytes: readFileSync(join(import.meta.dirname, "fixtures/short-blue.mp4")) }).video;
  const saved = saveDraft(owner, { ...draft("Bluesky media", ["bluesky"], {}, ids),
    mediaAlt: ["First image", "Second image"], videoId: clip.id });
  const request = { destination: "bluesky", scheduledFor: new Date(Date.now() + 60_000).toISOString() };

  assert.equal(imageLimitForDestination("bluesky", true), 0);
  assert.deepEqual(defaultHandoffImageIds("bluesky", ids, true), []);
  assert.match(imageLimitWarning("bluesky", 1, true), /video or images/);
  const [videoOnly] = prepareAssistedBatch(owner, saved.id, randomUUID(), [{ ...request, videoId: clip.id }]);
  assert.deepEqual(videoOnly.mediaIds, []);
  assert.deepEqual(videoOnly.mediaAlt, []);
  assert.equal(videoOnly.videoId, clip.id);
  const [imagesOnly] = prepareAssistedBatch(owner, saved.id, randomUUID(), [request]);
  assert.deepEqual(imagesOnly.mediaIds, ids);
  assert.equal(imagesOnly.videoId, undefined);

  assert.throws(() => prepareAssistedBatch(owner, saved.id, randomUUID(),
    [{ ...request, mediaIds: [ids[0]], videoId: clip.id }]), /valid text and UTC timestamps/);
  assert.throws(() => updateAssistedImages(owner, videoOnly.id, [], [], [ids[0]], ["First image"]), /fewer images/);
  assert.throws(() => updateAssistedVideo(owner, imagesOnly.id, null, clip.id), /fewer images/);
  assert.throws(() => addAssisted(owner, {
    id: randomUUID(), title: "Mixed", destination: "bluesky", text: "Mixed media",
    mediaIds: [ids[0]], mediaAlt: ["First image"], videoId: clip.id,
    scheduledFor: request.scheduledFor, createdAt: new Date().toISOString(), status: "queued",
  }), /fewer images/);

  // Previously saved handoffs are still readable so the owner can correct them.
  const legacy = { ...videoOnly, mediaIds: [ids[0]], mediaAlt: ["First image"] };
  assert.deepEqual(parseWorkspace({ version: 3, drafts: [], schedule: [], assisted: [legacy] })?.assisted, [legacy]);
});

test("YouTube video handoffs do not silently carry draft photos as video media", async () => {
  const ids = [];
  for (let index = 0; index < 2; index++) {
    ids.push((await createMedia(owner, {
      name: `youtube-image-${index}.png`, type: "image/png",
      bytes: await sharp({ create: { width: 4, height: 4, channels: 3,
        background: { r: 60, g: 80 + index * 40, b: 160 } } }).png().toBuffer(),
    })).media.id);
  }
  const clip = createVideo(owner, { name: "youtube-clip.mp4", type: "video/mp4",
    bytes: readFileSync(join(import.meta.dirname, "fixtures/short-blue.mp4")) }).video;
  const saved = saveDraft(owner, { ...draft("Video post", ["bluesky"], {}, ids),
    mediaAlt: ["First image", "Second image"], videoId: clip.id });
  const time = new Date(Date.now() + 60_000).toISOString();
  const request = { destination: "youtube", text: "Watch this clip", scheduledFor: time, videoId: clip.id };

  assert.deepEqual(defaultHandoffImageIds("youtube", ids, true), []);
  assert.equal(imageLimitForDestination("youtube", true), 1);
  assert.match(imageLimitWarning("youtube", 2, true), /one optional custom thumbnail/);
  const [videoOnly] = prepareAssistedBatch(owner, saved.id, randomUUID(), [request]);
  assert.deepEqual(videoOnly.mediaIds, []);
  assert.deepEqual(videoOnly.mediaAlt, []);
  assert.equal(videoOnly.videoId, clip.id);

  const [thumbnail] = prepareAssistedBatch(owner, saved.id, randomUUID(), [{ ...request, mediaIds: [ids[1]] }]);
  assert.deepEqual(thumbnail.mediaIds, [ids[1]]);
  assert.deepEqual(thumbnail.mediaAlt, ["Second image"]);
  assert.throws(() => prepareAssistedBatch(owner, saved.id, randomUUID(),
    [{ ...request, mediaIds: ids }]), /valid text and UTC timestamps/);
  assert.throws(() => updateAssistedImages(owner, thumbnail.id, thumbnail.mediaIds, thumbnail.mediaAlt,
    ids, ["", ""]), /fewer images/);
});

test("unmodified platform text uses the same adaptation shown in Create", () => {
  const saved = saveDraft(owner, draft("First line\nSecond line", ["bluesky", "linkedin"], {}));
  const prepared = prepareAssistedBatch(owner, saved.id, randomUUID(), handoffs());
  assert.equal(prepared.find((item) => item.destination === "bluesky").text, "First line Second line");
  assert.equal(prepared.find((item) => item.destination === "linkedin").text, "First line\nSecond line");
});

test("one saved clip can be reused across a batch without allowing foreign or changed video references", () => {
  const bytes = readFileSync(join(import.meta.dirname, "fixtures/short-blue.mp4"));
  const clip = createVideo(owner, { name: "launch.mp4", type: "video/mp4", bytes }).video;
  const secondClip = createVideo(owner, { name: "alternate.mp4", type: "video/mp4", bytes: Buffer.concat([bytes, Buffer.from([1])]) }).video;
  const foreignClip = createVideo(other, { name: "foreign.mp4", type: "video/mp4", bytes }).video;
  const saved = saveDraft(owner, draft("Video announcement", ["bluesky", "linkedin"], {}));
  const batchId = randomUUID();
  const items = handoffs().map((item) => ({ ...item, videoId: clip.id }));
  const prepared = prepareAssistedBatch(owner, saved.id, batchId, items, false, saved.updatedAt);
  assert.equal(prepared.length, 2);
  assert.ok(prepared.every((item) => item.videoId === clip.id && item.sourceDraftId === saved.id));
  assert.deepEqual(prepareAssistedBatch(owner, saved.id, batchId, [...items].reverse(), false, saved.updatedAt).map((item) => item.id),
    [...prepared].reverse().map((item) => item.id));
  assert.throws(() => prepareAssistedBatch(owner, saved.id, batchId,
    [{ ...items[0], videoId: secondClip.id }, items[1]], false, saved.updatedAt), /different or partial/);
  const before = listWorkspace(owner).assisted.length;
  assert.throws(() => prepareAssistedBatch(owner, saved.id, randomUUID(),
    [{ ...items[0], videoId: foreignClip.id }], false, saved.updatedAt), /missing from your private library/);
  assert.throws(() => prepareAssistedBatch(owner, saved.id, randomUUID(),
    [{ ...items[0], videoId: randomUUID() }], false, saved.updatedAt), /missing from your private library/);
  assert.equal(listWorkspace(owner).assisted.length, before);
});

test("each reviewed handoff can omit a draft video without changing the other platform", () => {
  const bytes = readFileSync(join(import.meta.dirname, "fixtures/short-blue.mp4"));
  const clip = createVideo(owner, { name: "mixed-media.mp4", type: "video/mp4", bytes }).video;
  const saved = saveDraft(owner, { ...draft("Two platform choices"), videoId: clip.id });
  const [sky, linked] = handoffs();
  const prepared = prepareAssistedBatch(owner, saved.id, randomUUID(), [
    { ...sky, videoId: clip.id }, linked,
  ], false, saved.updatedAt);
  assert.equal(prepared.find((item) => item.destination === "bluesky").videoId, clip.id);
  assert.equal(prepared.find((item) => item.destination === "linkedin").videoId, undefined);
  assert.equal(listWorkspace(owner).drafts.find((item) => item.id === saved.id).videoId, clip.id);
});

test("reviewed handoffs cover every assisted destination without changing the saved draft", () => {
  const saved = saveDraft(owner, draft("Source for manual posts", ["bluesky", "mastodon", "linkedin", "threads"], { bluesky: "Saved Bluesky" }));
  const limited = saveDraft(owner, draft("Limited", ["bluesky", "linkedin"], {}));
  const batchId = randomUUID();
  const ids = ["bluesky", "linkedin", "x", "facebook", "instagram", "tiktok", "youtube", "pinterest", "reddit", "mastodon", "threads"];
  assert.throws(() => prepareAssistedBatch(owner, limited.id, randomUUID(), [
    { destination: "mastodon", scheduledFor: new Date().toISOString() },
  ], false, limited.updatedAt), /Review text for every platform added/);
  const [added] = prepareAssistedBatch(owner, limited.id, randomUUID(), [
    { destination: "mastodon", scheduledFor: new Date().toISOString(), text: "Reviewed Mastodon copy" },
  ], false, limited.updatedAt);
  assert.equal(added.text, "Reviewed Mastodon copy");
  assert.deepEqual(listWorkspace(owner).drafts.find((item) => item.id === limited.id).selected, ["bluesky", "linkedin"]);
  const items = ids.map((destination, index) => ({
    destination, scheduledFor: new Date(Date.now() + 60_000 + index * 60_000).toISOString(),
    text: `Reviewed for ${destination}`,
  }));
  const prepared = prepareAssistedBatch(owner, saved.id, batchId, items, false, saved.updatedAt);
  assert.equal(prepared.length, 11);
  assert.deepEqual(prepared.map((item) => item.text), items.map((item) => item.text));
  assert.ok(prepared.every((item) => item.sourceDraftId === saved.id && item.batchId === batchId));
  assert.equal(listWorkspace(owner).drafts.find((item) => item.id === saved.id).variants.bluesky, "Saved Bluesky");
  assert.deepEqual(prepareAssistedBatch(owner, saved.id, batchId, [...items].reverse(), false, saved.updatedAt).map((item) => item.id),
    [...prepared].reverse().map((item) => item.id));
  assert.throws(() => prepareAssistedBatch(owner, saved.id, batchId,
    [{ ...items[0], text: "Different review" }, ...items.slice(1)], false, saved.updatedAt), /different or partial/);
  assert.throws(() => prepareAssistedBatch(owner, saved.id, randomUUID(),
    [{ ...items[0], text: " " }], false, saved.updatedAt), /valid text/);
  assert.throws(() => prepareAssistedBatch(owner, saved.id, randomUUID(),
    [{ destination: "x", scheduledFor: items[0].scheduledFor, text: "x".repeat(5001) }], false, saved.updatedAt), /valid text/);
  assert.throws(() => prepareAssistedBatch(owner, saved.id, randomUUID(),
    [{ destination: "bluesky", scheduledFor: items[0].scheduledFor, text: "x".repeat(301) }], false, saved.updatedAt), /Fix the bluesky text/);
  const changed = saveDraft(owner, { ...saved, source: "Changed elsewhere" }, saved.updatedAt);
  assert.throws(() => prepareAssistedBatch(owner, saved.id, randomUUID(),
    [{ ...items[0] }], false, saved.updatedAt), /changed or was deleted/);
  assert.equal(prepareAssistedBatch(owner, saved.id, batchId, items, false, saved.updatedAt).length, 11);
  assert.notEqual(changed.updatedAt, saved.updatedAt);
});

test("custom reminders can be confirmed without weekly slots for manual-only platforms", () => {
  const saved = saveDraft(owner, draft("Manual copy", ["bluesky"], {}));
  const [prepared] = prepareAssistedBatch(owner, saved.id, randomUUID(), [
    { destination: "x", scheduledFor: new Date(Date.now() + 60_000).toISOString(), text: "X copy" },
  ], true, saved.updatedAt);
  assert.equal(prepared.destination, "x");
  assert.equal(prepared.text, "X copy");
});

test("queued handoff descriptions can be corrected without changing the draft or sibling", async () => {
  const image = (await createMedia(owner, {
    name: "detail.png", type: "image/png",
    bytes: await sharp({ create: { width: 4, height: 4, channels: 3, background: "#aabbcc" } }).png().toBuffer(),
  })).media;
  const saved = saveDraft(owner, { ...draft("Image note", undefined, undefined, [image.id]), mediaAlt: ["Original description"] });
  const [first, sibling] = prepareAssistedBatch(owner, saved.id, randomUUID(), handoffs());
  assert.equal(updateAssistedMediaAlt(owner, first.id, [image.id], ["Original description"], ["Corrected description"]), true);
  const current = listWorkspace(owner);
  assert.deepEqual(current.assisted.find((item) => item.id === first.id).mediaAlt, ["Corrected description"]);
  assert.deepEqual(current.assisted.find((item) => item.id === sibling.id).mediaAlt, ["Original description"]);
  assert.deepEqual(current.drafts.find((item) => item.id === saved.id).mediaAlt, ["Original description"]);
  assert.equal(current.assisted.find((item) => item.id === first.id).scheduledFor, first.scheduledFor);
  assert.throws(() => updateAssistedMediaAlt(owner, first.id, [image.id], ["Original description"], ["Overwritten"]), /changed/);
  assert.throws(() => updateAssistedMediaAlt(other, first.id, [image.id], ["Corrected description"], ["Other owner"]), /no longer available/);
  assert.throws(() => updateAssistedMediaAlt(owner, first.id, [image.id], ["Corrected description"], ["x".repeat(501)]), /up to 500/);

  const token = createSession(owner);
  const request = (cookie, origin = "http://localhost:3000") => new globalThis.Request("http://localhost:3000/api/workspace", {
    method: "POST", headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ action: "update-assisted-media-alt", id: first.id,
      expectedMediaIds: [image.id], expectedMediaAlt: ["Corrected description"], mediaAlt: ["Final description"] }),
  });
  assert.equal((await workspacePost(request())).status, 401);
  assert.equal((await workspacePost(request(`${SESSION_COOKIE}=${token}`, "https://other.example"))).status, 403);
  assert.equal((await workspacePost(request(`${SESSION_COOKIE}=${token}`))).status, 200);
  assert.deepEqual(listWorkspace(owner).assisted.find((item) => item.id === first.id).mediaAlt, ["Final description"]);
  const staleClient = await workspacePost(new globalThis.Request("http://localhost:3000/api/workspace", {
    method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
    body: JSON.stringify({ action: "update-assisted-media-alt", id: first.id,
      expectedMediaAlt: ["Final description"], mediaAlt: ["Legacy change"] }),
  }));
  assert.equal(staleClient.status, 409);
  assert.match((await staleClient.json()).error, /Reload the page/);
  assert.equal(setAssistedStatus(owner, first.id, "posted", undefined,
    assistedContentSnapshot(listWorkspace(owner).assisted.find((item) => item.id === first.id))), true);
  assert.throws(() => updateAssistedMediaAlt(owner, first.id, [image.id], ["Final description"], ["After posting"]), /marked posted/);

  const legacyDraft = saveDraft(owner, draft("Older image note", ["bluesky"], {}, [image.id]));
  const [legacyHandoff] = prepareAssistedBatch(owner, legacyDraft.id, randomUUID(), [handoffs()[0]]);
  assert.equal(legacyHandoff.mediaAlt, undefined);
  assert.equal(updateAssistedMediaAlt(owner, legacyHandoff.id, [image.id], [""], ["Added later"]), true);
  assert.deepEqual(listWorkspace(owner).assisted.find((item) => item.id === legacyHandoff.id).mediaAlt, ["Added later"]);
});

test("description edits reject images reordered elsewhere even when their descriptions match", async () => {
  const ids = [];
  for (const color of ["#bb3344", "#3355bb"]) {
    const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: color } }).png().toBuffer();
    ids.push((await createMedia(owner, { name: `${color.slice(1)}.png`, type: "image/png", bytes })).media.id);
  }
  const descriptions = ["Same note", "Same note"];
  const saved = saveDraft(owner, { ...draft("Reordered photos", undefined, undefined, ids), mediaAlt: descriptions });
  const [handoff] = prepareAssistedBatch(owner, saved.id, randomUUID(), [handoffs()[0]]);
  assert.equal(updateAssistedImages(owner, handoff.id, ids, descriptions, [...ids].reverse(), descriptions), true);
  assert.throws(() => updateAssistedMediaAlt(owner, handoff.id, ids, descriptions, ["First", "Second"]), /images or descriptions changed/);
  const token = createSession(owner);
  const response = await workspacePost(new globalThis.Request("http://localhost:3000/api/workspace", {
    method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
    body: JSON.stringify({ action: "update-assisted-media-alt", id: handoff.id, expectedMediaIds: ids,
      expectedMediaAlt: descriptions, mediaAlt: ["First", "Second"] }),
  }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "ASSISTED_CONFLICT");
  assert.deepEqual(listWorkspace(owner).assisted.find((item) => item.id === handoff.id).mediaAlt, descriptions);
});

test("marking a manual handoff posted rejects a stale content review", async () => {
  const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#77aacc" } }).png().toBuffer();
  const image = (await createMedia(owner, { name: "review.png", type: "image/png", bytes })).media;
  const saved = saveDraft(owner, { ...draft("Reviewed before publishing", undefined, undefined, [image.id]), mediaAlt: ["Original image note"] });
  const [handoff] = prepareAssistedBatch(owner, saved.id, randomUUID(), [handoffs()[0]]);
  const reviewed = { destination: handoff.destination, text: handoff.text, mediaIds: handoff.mediaIds,
    mediaAlt: handoff.mediaAlt, videoId: handoff.videoId ?? null, placeLabel: handoff.placeLabel ?? null };
  assert.equal(updateAssistedMediaAlt(owner, handoff.id, [image.id], ["Original image note"], ["New image note"]), true);
  assert.throws(() => setAssistedStatus(owner, handoff.id, "posted", undefined, reviewed), /content changed/);
  assert.equal(listWorkspace(owner).assisted.find((item) => item.id === handoff.id).status, "queued");

  const token = createSession(owner);
  const response = await workspacePost(new globalThis.Request("http://localhost:3000/api/workspace", {
    method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
    body: JSON.stringify({ action: "set-assisted-status", id: handoff.id, status: "posted", expectedContent: reviewed }),
  }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "ASSISTED_CONFLICT");
  assert.equal(listWorkspace(owner).assisted.find((item) => item.id === handoff.id).status, "queued");

  const afterImageEdit = listWorkspace(owner).assisted.find((item) => item.id === handoff.id);
  assert.equal(updateAssistedText(owner, handoff.id, afterImageEdit.text, "New reviewed text"), true);
  assert.throws(() => setAssistedStatus(owner, handoff.id, "posted", undefined,
    assistedContentSnapshot(afterImageEdit)), /content changed/);
  const latest = listWorkspace(owner).assisted.find((item) => item.id === handoff.id);
  assert.equal(setAssistedStatus(owner, handoff.id, "posted", undefined, assistedContentSnapshot(latest)), true);
  assert.equal(listWorkspace(owner).assisted.find((item) => item.id === handoff.id).status, "posted");
});

test("one queued handoff can replace and reorder images without changing its draft or sibling", async () => {
  const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#6688aa" } }).png().toBuffer();
  const firstImage = (await createMedia(owner, { name: "first.png", type: "image/png", bytes })).media;
  const secondImage = (await createMedia(owner, { name: "second.png", type: "image/png",
    bytes: await sharp({ create: { width: 4, height: 4, channels: 3, background: "#bb5533" } }).png().toBuffer() })).media;
  const foreignImage = (await createMedia(other, { name: "foreign.png", type: "image/png", bytes })).media;
  const saved = saveDraft(owner, { ...draft("Channel images", undefined, undefined, [firstImage.id]), mediaAlt: ["Original"] });
  const [first, sibling] = prepareAssistedBatch(owner, saved.id, randomUUID(), handoffs());
  assert.equal(updateAssistedImages(owner, first.id, [firstImage.id], ["Original"], [secondImage.id, firstImage.id], ["New cover", "Original"]), true);
  let workspace = listWorkspace(owner);
  assert.deepEqual(workspace.assisted.find((item) => item.id === first.id).mediaIds, [secondImage.id, firstImage.id]);
  assert.deepEqual(workspace.assisted.find((item) => item.id === first.id).mediaAlt, ["New cover", "Original"]);
  assert.deepEqual(workspace.assisted.find((item) => item.id === sibling.id).mediaIds, [firstImage.id]);
  assert.deepEqual(workspace.drafts.find((item) => item.id === saved.id).mediaIds, [firstImage.id]);
  assert.equal(workspace.assisted.find((item) => item.id === first.id).text, first.text);
  assert.equal(workspace.assisted.find((item) => item.id === first.id).scheduledFor, first.scheduledFor);
  assert.throws(() => updateAssistedImages(owner, first.id, [firstImage.id], ["Original"], [], []), /images changed/);
  assert.throws(() => updateAssistedImages(other, first.id, [secondImage.id, firstImage.id], ["New cover", "Original"], [], []), /no longer available/);
  assert.throws(() => updateAssistedImages(owner, first.id, [secondImage.id, firstImage.id], ["New cover", "Original"], [foreignImage.id], [""]), /missing from your media library/);
  assert.throws(() => updateAssistedImages(owner, first.id, [secondImage.id, firstImage.id], ["New cover", "Original"], [secondImage.id, secondImage.id], ["", ""]), /distinct images/);
  const token = createSession(owner);
  const request = (cookie, origin = "http://localhost:3000") => new globalThis.Request("http://localhost:3000/api/workspace", {
    method: "POST", headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ action: "update-assisted-images", id: first.id,
      expectedMediaIds: [secondImage.id, firstImage.id], expectedMediaAlt: ["New cover", "Original"],
      mediaIds: [firstImage.id], mediaAlt: ["Only image"] }),
  });
  assert.equal((await workspacePost(request())).status, 401);
  assert.equal((await workspacePost(request(`${SESSION_COOKIE}=${token}`, "https://other.example"))).status, 403);
  assert.equal((await workspacePost(request(`${SESSION_COOKIE}=${token}`))).status, 200);
  workspace = listWorkspace(owner);
  assert.deepEqual(workspace.assisted.find((item) => item.id === first.id).mediaIds, [firstImage.id]);
  assert.deepEqual(workspace.assisted.find((item) => item.id === first.id).mediaAlt, ["Only image"]);
  assert.equal(setAssistedStatus(owner, first.id, "posted", undefined,
    assistedContentSnapshot(workspace.assisted.find((item) => item.id === first.id))), true);
  assert.throws(() => updateAssistedImages(owner, first.id, [firstImage.id], ["Only image"], [], []), /marked posted/);
});

test("a revised handoff stays separate from its source draft and sibling destination", () => {
  const saved = saveDraft(owner, draft("Original source", ["bluesky", "linkedin"], { bluesky: "Original Bluesky" }));
  const batchId = randomUUID();
  const slots = handoffs();
  const [bluesky, linkedin] = prepareAssistedBatch(owner, saved.id, batchId, slots);
  assert.throws(() => updateAssistedText(owner, bluesky.id, bluesky.text, "x".repeat(301)), /destination's text limit/);
  updateAssistedText(owner, bluesky.id, bluesky.text, "Revised Bluesky");
  const current = listWorkspace(owner);
  const edited = current.assisted.find((item) => item.id === bluesky.id);
  assert.equal(edited.text, "Revised Bluesky");
  assert.equal(edited.sourceDraftId, saved.id);
  assert.equal(edited.batchId, batchId);
  assert.equal(edited.scheduledFor, bluesky.scheduledFor);
  assert.deepEqual(edited.mediaIds, bluesky.mediaIds);
  assert.equal(current.assisted.find((item) => item.id === linkedin.id).text, linkedin.text);
  assert.equal(current.drafts.find((item) => item.id === saved.id).variants.bluesky, "Original Bluesky");
  assert.equal(prepareAssistedBatch(owner, saved.id, batchId, slots)[0].text, "Revised Bluesky");
});

test("ready-now batch handoffs suppress duplicate browser alerts while future reminders remain pending", () => {
  const saved = saveDraft(owner, draft());
  const prepared = prepareAssistedBatch(owner, saved.id, randomUUID(), [
    { destination: "bluesky", scheduledFor: new Date(Date.now() - 1_000).toISOString() },
    { destination: "linkedin", scheduledFor: new Date(Date.now() + 60_000).toISOString() },
  ]);
  assert.equal(prepared[0].notifiedAt, prepared[0].createdAt);
  assert.equal(prepared[1].notifiedAt, undefined);
  const persisted = listWorkspace(owner).assisted.filter((item) => prepared.some((post) => post.id === item.id));
  assert.equal(persisted.find((item) => item.destination === "bluesky").notifiedAt, prepared[0].createdAt);
  assert.equal(persisted.find((item) => item.destination === "linkedin").notifiedAt, undefined);
});

test("batch handoffs without reminders stay on the checklist and off the dated calendar", () => {
  const saved = saveDraft(owner, draft());
  const batchId = randomUUID();
  const items = [{ destination: "bluesky", scheduledFor: new Date().toISOString(), reminderEnabled: false }];
  const [prepared] = prepareAssistedBatch(owner, saved.id, batchId, items, true);
  assert.equal(prepared.reminderEnabled, false);
  assert.equal(prepared.notifiedAt, undefined);
  assert.equal(hasManualReminder(prepared), false);
  assert.equal(assistedState(prepared, Date.now() + 60_000), "unscheduled");
  const persisted = listWorkspace(owner).assisted.filter((post) => post.batchId === batchId);
  assert.deepEqual(buildPlanAgenda([], persisted), []);
  assert.deepEqual(prepareAssistedBatch(owner, saved.id, batchId, items), [prepared]);
  assert.throws(() => prepareAssistedBatch(owner, saved.id, batchId,
    [{ ...items[0], reminderEnabled: true }]), /different or partial/);
});

test("invalid member, duplicates, missing media, and list-cap overflow roll back the entire batch", () => {
  const tooLong = saveDraft(other, draft("Normal source", ["bluesky", "linkedin"], { bluesky: "x".repeat(301) }));
  const items = handoffs();
  assert.throws(() => prepareAssistedBatch(other, tooLong.id, randomUUID(), items), /Fix the saved bluesky text/);
  assert.deepEqual(listWorkspace(other).assisted, []);
  assert.throws(() => prepareAssistedBatch(other, tooLong.id, randomUUID(), [items[0], items[0]]), /only once/);
  assert.throws(() => prepareAssistedBatch(other, tooLong.id, randomUUID(), [{ destination: "threads", scheduledFor: items[0].scheduledFor }]), /Review text for every platform added/);
  assert.throws(() => prepareAssistedBatch(other, tooLong.id, randomUUID(), [{ ...items[0], scheduledFor: "2026-02-30T12:00:00.000Z" }]), /UTC timestamps/);
  const missingMedia = saveDraft(other, draft("Okay", ["bluesky"], {}, []));
  database().prepare("UPDATE drafts SET payload=? WHERE id=? AND user_id=?")
    .run(JSON.stringify({ ...missingMedia, mediaIds: [randomUUID()] }), missingMedia.id, other);
  assert.throws(() => prepareAssistedBatch(other, missingMedia.id, randomUUID(), [items[0]]), /attached image is missing/);
  assert.deepEqual(listWorkspace(other).assisted, []);

  const ready = saveDraft(other, draft());
  const now = new Date().toISOString();
  const insert = database().prepare("INSERT INTO assisted(id,user_id,payload,scheduled_for,updated_at) VALUES (?,?,?,?,?)");
  for (let index = 0; index < 99; index++) {
    const post = { id: randomUUID(), title: `Existing ${index}`, destination: "x", text: "Existing", scheduledFor: now, createdAt: now, status: "queued" };
    insert.run(post.id, other, JSON.stringify(post), now, now);
  }
  assert.throws(() => prepareAssistedBatch(other, ready.id, randomUUID(), items), /list is full/);
  assert.equal(listWorkspace(other).assisted.length, 99);
});

test("provenance is a valid UUID pair, and manual action cannot forge draft-linked batch items", () => {
  const post = { id: randomUUID(), title: "Post", destination: "bluesky", text: "Text",
    scheduledFor: new Date().toISOString(), createdAt: new Date().toISOString(), status: "queued",
    sourceDraftId: randomUUID(), batchId: randomUUID() };
  const read = (item) => parseWorkspace({ version: 3, drafts: [], schedule: [], assisted: [item] })?.assisted;
  assert.deepEqual(read(post), [post]);
  for (const invalid of [{ ...post, sourceDraftId: undefined }, { ...post, batchId: undefined },
    { ...post, batchId: "bad" }, { ...post, destination: "unknown" }]) {
    assert.deepEqual(read(invalid), []);
  }
  assert.deepEqual(read({ ...post, destination: "x" }), [{ ...post, destination: "x" }]);
  assert.throws(() => addAssisted(owner, post), /Use batch preparation/);
});

test("batch route requires owner sign-in and same origin; response includes persisted handoffs", async () => {
  const saved = saveDraft(owner, draft("Route source", ["bluesky"], {}));
  const clip = createVideo(owner, { name: "route.mp4", type: "video/mp4",
    bytes: readFileSync(join(import.meta.dirname, "fixtures/short-blue.mp4")) }).video;
  const body = { action: "prepare-assisted-batch", draftId: saved.id, expectedUpdatedAt: saved.updatedAt, batchId: randomUUID(),
    items: [{ destination: "bluesky", scheduledFor: new Date(Date.now() + 60_000).toISOString(), text: "Reviewed route copy", videoId: clip.id }] };
  const request = (cookie, origin = "http://localhost:3000") => new globalThis.Request("http://localhost:3000/api/workspace", {
    method: "POST", headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
  });
  assert.equal((await workspacePost(request())).status, 401);
  const token = createSession(owner);
  const cookie = `${SESSION_COOKIE}=${token}`;
  assert.equal((await workspacePost(request(cookie, "https://evil.example"))).status, 403);
  const response = await workspacePost(request(cookie));
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.ok(state.assisted.some((post) => post.batchId === body.batchId && post.sourceDraftId === saved.id));
  assert.equal((await workspacePost(request(cookie))).status, 200);
  assert.equal(listWorkspace(owner).assisted.filter((post) => post.batchId === body.batchId).length, 1);
  assert.equal(listWorkspace(owner).assisted.find((post) => post.batchId === body.batchId).text, "Reviewed route copy");
  assert.equal(listWorkspace(owner).assisted.find((post) => post.batchId === body.batchId).videoId, clip.id);
  saveDraft(owner, { ...saved, source: "Changed in another window" }, saved.updatedAt);
  const stale = { ...body, batchId: randomUUID() };
  const staleResponse = await workspacePost(new globalThis.Request("http://localhost:3000/api/workspace", {
    method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json", cookie }, body: JSON.stringify(stale),
  }));
  assert.equal(staleResponse.status, 409);
  assert.equal((await staleResponse.json()).code, "DRAFT_CONFLICT");
});
