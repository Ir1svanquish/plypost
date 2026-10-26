import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { closeDatabase, database } from "../src/lib/server/db.ts";
import { createMedia, getMedia, listMedia } from "../src/lib/server/media.ts";
import { createVideo, getVideo, listVideos } from "../src/lib/server/video.ts";
import { addAssisted, addSchedule, deleteDraft, listWorkspace, prepareAssistedBatch, saveDraft, setAssistedStatus } from "../src/lib/server/workspace.ts";
import { createSession, SESSION_COOKIE } from "../src/lib/server/auth.ts";
import { exportPortableBackup, importPortableBackup, streamPortableBackup } from "../src/lib/server/portable-backup.ts";
import { approveStrategyIdea, createWeeklyPlan, listStrategy, saveBrandBrief } from "../src/lib/server/strategy.ts";
import { getSlotSettings, saveSlotSettings } from "../src/lib/server/slots.ts";
import { GET, POST } from "../src/app/api/backup/route.ts";

const temporary = mkdtempSync(join(tmpdir(), "plypost-portable-"));
process.env.PLYPOST_DB_PATH = join(temporary, "primary.sqlite");
process.env.PLYPOST_OWNER_EMAIL = "owner@example.test";
process.env.PLYPOST_OWNER_PASSWORD_HASH = "configured";
const owner = "owner@example.test";
const other = "other@example.test";
const base = "http://localhost/api/backup";

after(() => { closeDatabase(); if (temporary.startsWith(tmpdir())) rmSync(temporary, { recursive: true, force: true }); });

function stamp() { return new Date().toISOString(); }
function draft(id, mediaIds = []) {
  return { id, title: "Illustrated idea", source: "A saved idea", selected: ["bluesky"], variants: { bluesky: "A saved idea" },
    mediaIds, createdAt: stamp(), updatedAt: stamp() };
}
async function png(color = "#cc3388") {
  return sharp({ create: { width: 8, height: 6, channels: 3, background: color } }).png().toBuffer();
}
function backupRequest(body, { cookie, origin = "http://localhost", contentType = "application/json" } = {}) {
  return new globalThis.Request(base, {
    method: "POST",
    headers: { origin, "content-type": contentType, ...(cookie ? { cookie } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("portable backup restores image pixels and saved records in a fresh database", async () => {
  const image = (await createMedia(owner, { name: "cover.png", type: "image/png", bytes: await png() })).media;
  const originalPixels = await sharp(getMedia(owner, image.id).bytes).raw().toBuffer();
  const saved = saveDraft(owner, { ...draft(randomUUID(), [image.id]), mediaAlt: ["Pink cover image"], plannedDate: "2026-11-02" });
  const plan = { id: randomUUID(), title: "Planned", source: "A saved idea", posts: { bluesky: "A saved idea" }, mediaIds: [image.id], mediaAlt: ["Pink cover image"],
    scheduledFor: new Date(Date.now() + 3_600_000).toISOString(), createdAt: stamp(), status: "queued" };
  addSchedule(owner, plan, "Asia/Hong_Kong");
  const assisted = { id: randomUUID(), title: "Manual", destination: "x", text: "A saved idea", mediaIds: [image.id], mediaAlt: ["Pink cover image"],
    scheduledFor: new Date(Date.now() + 7_200_000).toISOString(), createdAt: stamp(), status: "queued" };
  database().prepare("INSERT INTO assisted(id,user_id,payload,scheduled_for,updated_at) VALUES (?,?,?,?,?)")
    .run(assisted.id, owner, JSON.stringify(assisted), assisted.scheduledFor, stamp());
  const postUrl = "https://social.example/creator/post/2026";
  assert.equal(setAssistedStatus(owner, assisted.id, "posted", postUrl), true);
  const weeklySlots = saveSlotSettings(owner, { timeZone: "Asia/Hong_Kong", rules: [
    { platform: "bluesky", day: 1, time: "09:00" },
    { platform: "linkedin", day: 4, time: "16:30" },
  ] });

  const exported = exportPortableBackup(owner);
  const archive = JSON.parse(exported);
  assert.equal(archive.format, "plypost-portable");
  assert.equal(archive.version, 5);
  assert.deepEqual(archive.videos, []);
  assert.deepEqual(archive.slotSettings, weeklySlots);
  assert.equal(archive.brandBrief, null);
  assert.deepEqual(archive.weeklyPlans, []);
  assert.equal(archive.media.length, 1);
  assert.equal(archive.drafts[0].mediaIds[0], image.id);
  assert.deepEqual(archive.drafts[0].mediaAlt, ["Pink cover image"]);
  assert.equal(archive.drafts[0].plannedDate, "2026-11-02");
  assert.equal(archive.jobs[0].timezone, "Asia/Hong_Kong");
  assert.equal(archive.assisted[0].postUrl, postUrl);
  assert.ok(archive.assisted[0].postedAt);
  assert.ok(!exported.includes("configured"));

  closeDatabase();
  process.env.PLYPOST_DB_PATH = join(temporary, "restored.sqlite");
  const brokenSlots = globalThis.structuredClone(archive);
  brokenSlots.slotSettings.rules[0].time = "25:00";
  await assert.rejects(importPortableBackup(owner, brokenSlots), /invalid weekly slots/);
  assert.equal(getSlotSettings(owner), null);
  const result = await importPortableBackup(owner, archive);
  assert.deepEqual(result, { drafts: 1, jobs: 1, assisted: 1, media: 1, videos: 0 });
  const restored = listWorkspace(owner);
  assert.notEqual(restored.drafts[0].id, saved.id);
  assert.equal(restored.drafts[0].plannedDate, "2026-11-02");
  assert.notEqual(restored.drafts[0].mediaIds[0], image.id);
  assert.equal(restored.schedule[0].status, "queued");
  assert.equal(restored.schedule[0].scheduledFor, plan.scheduledFor);
  assert.deepEqual(restored.schedule[0].mediaIds, restored.drafts[0].mediaIds);
  assert.deepEqual(restored.schedule[0].mediaAlt, restored.drafts[0].mediaAlt);
  assert.equal(restored.assisted[0].text, assisted.text);
  assert.equal(restored.assisted[0].postUrl, postUrl);
  assert.equal(restored.assisted[0].postedAt, archive.assisted[0].postedAt);
  assert.deepEqual(restored.assisted[0].mediaIds, restored.drafts[0].mediaIds);
  assert.deepEqual(restored.assisted[0].mediaAlt, restored.drafts[0].mediaAlt);
  assert.deepEqual(getSlotSettings(owner), weeklySlots);
  const restoredImage = getMedia(owner, restored.drafts[0].mediaIds[0]);
  assert.ok(restoredImage);
  assert.equal((await sharp(restoredImage.bytes).metadata()).width, 8);
  assert.deepEqual(await sharp(restoredImage.bytes).raw().toBuffer(), originalPixels);
  assert.equal(database().prepare("SELECT timezone FROM jobs WHERE id=?").get(restored.schedule[0].id).timezone, "Asia/Hong_Kong");
});

test("tampered or incomplete archives fail without changing saved work", async () => {
  const original = JSON.parse(exportPortableBackup(owner));
  const baseline = listWorkspace(owner);
  const badHash = globalThis.structuredClone(original);
  badHash.media[0].sha256 = "0".repeat(64);
  await assert.rejects(importPortableBackup(owner, badHash), /checksum/);
  const missing = globalThis.structuredClone(original);
  missing.media = [];
  await assert.rejects(importPortableBackup(owner, missing), /missing from the archive/);
  const duplicateId = globalThis.structuredClone(original);
  duplicateId.media[0].id = duplicateId.drafts[0].id;
  await assert.rejects(importPortableBackup(owner, duplicateId), /duplicate IDs/);
  const badSize = globalThis.structuredClone(original);
  badSize.media[0].sizeBytes += 1;
  await assert.rejects(importPortableBackup(owner, badSize), /size or checksum/);
  const badMime = globalThis.structuredClone(original);
  badMime.media[0].mimeType = "image/jpeg";
  await assert.rejects(importPortableBackup(owner, badMime), /format or dimensions/);
  const nonCanonical = globalThis.structuredClone(original);
  nonCanonical.media[0].base64 += "\n";
  await assert.rejects(importPortableBackup(owner, nonCanonical), /invalid image data/);
  const unknownDestination = globalThis.structuredClone(original);
  unknownDestination.drafts[0].selected.push("unknown");
  await assert.rejects(importPortableBackup(owner, unknownDestination), /draft destinations/);
  const droppedVariant = globalThis.structuredClone(original);
  droppedVariant.drafts[0].variants.threads = "x".repeat(5001);
  await assert.rejects(importPortableBackup(owner, droppedVariant), /platform versions/);
  const badDraftDate = globalThis.structuredClone(original);
  badDraftDate.drafts[0].plannedDate = "2026-11-31";
  await assert.rejects(importPortableBackup(owner, badDraftDate), /invalid drafts/);
  const droppedHistory = globalThis.structuredClone(original);
  droppedHistory.assisted[0].postedAt = "not-a-date";
  await assert.rejects(importPortableBackup(owner, droppedHistory), /assisted item history/);
  const unsafePostUrl = globalThis.structuredClone(original);
  unsafePostUrl.assisted[0].postUrl = "javascript:alert(1)";
  await assert.rejects(importPortableBackup(owner, unsafePostUrl), /invalid assisted items/);
  const missingPlannedImage = globalThis.structuredClone(original);
  missingPlannedImage.jobs[0].post.mediaIds = [randomUUID()];
  await assert.rejects(importPortableBackup(owner, missingPlannedImage), /missing from the archive/);
  const missingAssistedImage = globalThis.structuredClone(original);
  missingAssistedImage.assisted[0].mediaIds = [randomUUID()];
  await assert.rejects(importPortableBackup(owner, missingAssistedImage), /missing from the archive/);
  const misalignedDescription = globalThis.structuredClone(original);
  misalignedDescription.drafts[0].mediaAlt = [];
  await assert.rejects(importPortableBackup(owner, misalignedDescription), /invalid drafts/);
  assert.deepEqual(listWorkspace(owner).drafts, baseline.drafts);
  assert.deepEqual(listMedia(owner).map((item) => item.id), original.media.map((item) => item.id));
});

test("cancelled restore does not replace saved work after asset preparation begins", async () => {
  const archive = JSON.parse(exportPortableBackup(owner));
  const beforeDrafts = listWorkspace(owner).drafts;
  const beforeMediaIds = listMedia(owner).map((item) => item.id);
  const controller = new globalThis.AbortController();
  const restoring = importPortableBackup(owner, archive, controller.signal);
  globalThis.queueMicrotask(() => controller.abort());
  await assert.rejects(restoring, /Backup restore was cancelled/);
  assert.deepEqual(listWorkspace(owner).drafts, beforeDrafts);
  assert.deepEqual(listMedia(owner).map((item) => item.id), beforeMediaIds);
});

test("owner restore remaps all IDs without overwriting another owner's matching records", async () => {
  const source = JSON.parse(exportPortableBackup(owner));
  const before = listWorkspace(owner);
  const restored = await importPortableBackup(other, source);
  assert.equal(restored.media, 1);
  const otherState = listWorkspace(other);
  assert.notEqual(otherState.drafts[0].id, source.drafts[0].id);
  assert.notEqual(otherState.schedule[0].id, source.jobs[0].post.id);
  assert.notEqual(otherState.assisted[0].id, source.assisted[0].id);
  assert.notEqual(otherState.drafts[0].mediaIds[0], source.media[0].id);
  assert.deepEqual(otherState.schedule[0].mediaIds, otherState.drafts[0].mediaIds);
  assert.deepEqual(otherState.assisted[0].mediaIds, otherState.drafts[0].mediaIds);
  assert.deepEqual(listWorkspace(owner).drafts, before.drafts);
  assert.ok(getMedia(owner, source.media[0].id));
  assert.ok(getMedia(other, otherState.drafts[0].mediaIds[0]));
});

test("running plans block export and import without mutating saved state", async () => {
  const archive = JSON.parse(exportPortableBackup(owner));
  const targetId = listWorkspace(owner).schedule[0].id;
  database().prepare("UPDATE jobs SET status='running',lease_until=? WHERE id=? AND user_id=?")
    .run(new Date(Date.now() + 60_000).toISOString(), targetId, owner);
  assert.throws(() => exportPortableBackup(owner), /Wait for running/);
  await assert.rejects(importPortableBackup(owner, archive), /Wait for running/);
  assert.equal(listWorkspace(owner).schedule[0].status, "running");
  database().prepare("UPDATE jobs SET status='queued',lease_until=NULL WHERE id=? AND user_id=?").run(targetId, owner);
});

test("portable backup route enforces owner session, origin, type, and private response headers", async () => {
  const anonymous = await GET(new globalThis.Request(base));
  assert.equal(anonymous.status, 401);
  assert.equal((await POST(backupRequest({}))).status, 401);
  const token = createSession(owner);
  const cookie = `${SESSION_COOKIE}=${token}`;
  const download = await GET(new globalThis.Request(base, { headers: { cookie } }));
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition"), /plypost-portable/);
  assert.match(download.headers.get("cache-control"), /no-store/);
  assert.equal((await GET(new globalThis.Request(base, { headers: { cookie } }))).status, 409);
  assert.equal((await POST(backupRequest({}, { cookie }))).status, 409);
  const archive = await download.json();
  const cancelled = await GET(new globalThis.Request(base, { headers: { cookie } }));
  assert.equal(cancelled.status, 200);
  await cancelled.body.cancel();
  const expected = JSON.parse(exportPortableBackup(owner));
  expected.exportedAt = archive.exportedAt;
  assert.deepEqual(archive, expected);
  assert.equal((await POST(backupRequest(archive, { cookie, origin: "https://evil.example" }))).status, 403);
  assert.equal((await POST(backupRequest(archive, { cookie, contentType: "text/plain" }))).status, 415);
  assert.equal((await POST(backupRequest("not-json", { cookie }))).status, 400);
  const tooLarge = new globalThis.Request(base, { method: "POST", headers: { cookie, origin: "http://localhost", "content-type": "application/json", "content-length": String(193 * 1024 * 1024) }, body: "{}" });
  assert.equal((await POST(tooLarge)).status, 413);
  const imported = await POST(backupRequest(archive, { cookie }));
  assert.equal(imported.status, 200);
  assert.deepEqual((await imported.json()).restored, { drafts: 1, jobs: 1, assisted: 1, media: 1, videos: 0 });
});

test("an unfinished restore keeps another backup request from doubling memory use", async () => {
  const cookie = `${SESSION_COOKIE}=${createSession(owner)}`;
  let finish;
  const body = new globalThis.ReadableStream({ start(controller) {
    finish = () => { controller.enqueue(Buffer.from("{}")); controller.close(); };
  } });
  const pending = POST(new globalThis.Request(base, { method: "POST", duplex: "half",
    headers: { origin: "http://localhost", "content-type": "application/json", cookie }, body }));
  assert.equal((await GET(new globalThis.Request(base, { headers: { cookie } }))).status, 409);
  assert.equal((await POST(backupRequest({}, { cookie }))).status, 409);
  finish();
  assert.equal((await pending).status, 400);
  const available = await GET(new globalThis.Request(base, { headers: { cookie } }));
  assert.equal(available.status, 200);
  await available.body.cancel();
});

test("backup upload accepts fragmented UTF-8 and rejects malformed streams without replacing work", async () => {
  const cookie = `${SESSION_COOKIE}=${createSession(owner)}`;
  const archive = JSON.parse(exportPortableBackup(owner));
  archive.media[0].name = "封面🙂.png";
  const bytes = Buffer.from(JSON.stringify(archive));
  let offset = 0;
  const fragmented = new globalThis.ReadableStream({ pull(controller) {
    if (offset >= bytes.length) { controller.close(); return; }
    controller.enqueue(bytes.subarray(offset, offset + 7));
    offset += 7;
  } });
  const uploaded = await POST(new globalThis.Request(base, { method: "POST", duplex: "half",
    headers: { origin: "http://localhost", "content-type": "application/json", cookie }, body: fragmented }));
  assert.equal(uploaded.status, 200);
  assert.equal(listMedia(owner)[0].name, "封面🙂.png");
  const before = listWorkspace(owner);

  const noncanonical = JSON.parse(exportPortableBackup(owner));
  noncanonical.media[0].base64 += "=";
  assert.equal((await POST(backupRequest(noncanonical, { cookie }))).status, 400);
  const duplicate = JSON.stringify(noncanonical).replace('"format":"plypost-portable"',
    '"format":"plypost-portable","format":"plypost-portable"');
  assert.equal((await POST(backupRequest(duplicate, { cookie }))).status, 400);
  const invalidUtf8 = new globalThis.Request(base, { method: "POST",
    headers: { origin: "http://localhost", "content-type": "application/json", cookie },
    body: Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]) });
  assert.equal((await POST(invalidUtf8)).status, 400);
  let sent = 0;
  const oversized = new globalThis.ReadableStream({ pull(controller) {
    if (sent++ < 193) controller.enqueue(Buffer.alloc(1024 * 1024, 0x20));
    else controller.close();
  } });
  const unclaimedLength = new globalThis.Request(base, { method: "POST", duplex: "half",
    headers: { origin: "http://localhost", "content-type": "application/json", cookie }, body: oversized });
  assert.equal((await POST(unclaimedLength)).status, 413);
  assert.deepEqual(listWorkspace(owner), before);
});

test("backup import rejects an image whose bytes do not match its declared checksum", async () => {
  const archive = JSON.parse(exportPortableBackup(owner));
  archive.media[0].base64 = Buffer.from("not a real image").toString("base64");
  archive.media[0].sizeBytes = Buffer.from("not a real image").length;
  archive.media[0].sha256 = createHash("sha256").update("not a real image").digest("hex");
  await assert.rejects(importPortableBackup(owner, archive), /undecodable image/);
});

test("full backup restores video bytes and remaps draft and handoff references", async () => {
  const sourceOwner = "video-source@example.test";
  const destinationOwner = "video-restored@example.test";
  const bytes = readFileSync(join(import.meta.dirname, "fixtures/short-blue.mp4"));
  const video = createVideo(sourceOwner, { name: "launch.mp4", type: "video/mp4", bytes }).video;
  const createdAt = stamp();
  const saved = saveDraft(sourceOwner, { id: randomUUID(), title: "Video idea", source: "Watch this", selected: [], variants: {},
    videoId: video.id, createdAt, updatedAt: createdAt });
  const handoff = addAssisted(sourceOwner, { id: randomUUID(), title: "Video launch", destination: "youtube",
    text: "Watch this", videoId: video.id, scheduledFor: createdAt, createdAt, status: "queued" });
  const archive = JSON.parse(exportPortableBackup(sourceOwner));
  const streamed = JSON.parse(await new globalThis.Response(streamPortableBackup(sourceOwner)).text());
  archive.exportedAt = streamed.exportedAt;
  assert.deepEqual(streamed, archive);
  assert.equal(archive.videos.length, 1);
  assert.equal(archive.drafts[0].videoId, video.id);
  assert.equal(archive.assisted[0].videoId, video.id);
  const corrupt = globalThis.structuredClone(archive);
  corrupt.videos[0].base64 = Buffer.from("not-video-bytes").toString("base64");
  await assert.rejects(importPortableBackup(destinationOwner, corrupt), /video format, size or checksum/);
  assert.deepEqual(listWorkspace(destinationOwner).assisted, []);
  assert.deepEqual(listVideos(destinationOwner), []);
  const missing = globalThis.structuredClone(archive);
  missing.videos = [];
  await assert.rejects(importPortableBackup(destinationOwner, missing), /video that is missing from the archive/);
  assert.deepEqual(listWorkspace(destinationOwner).drafts, []);
  const result = await importPortableBackup(destinationOwner, archive);
  assert.equal(result.videos, 1);
  const restored = listWorkspace(destinationOwner).assisted[0];
  const restoredDraft = listWorkspace(destinationOwner).drafts[0];
  assert.notEqual(restoredDraft.id, saved.id);
  assert.equal(restoredDraft.videoId, restored.videoId);
  assert.notEqual(restored.id, handoff.id);
  assert.notEqual(restored.videoId, video.id);
  assert.deepEqual(getVideo(destinationOwner, restored.videoId).bytes, bytes);
  const legacy = globalThis.structuredClone(archive);
  legacy.version = 3;
  delete legacy.videos;
  await assert.rejects(importPortableBackup(destinationOwner, legacy), /references videos without including/);
});

test("restore rejects concurrent account edits instead of overwriting them", async () => {
  const archive = JSON.parse(exportPortableBackup(owner));
  const pending = importPortableBackup(owner, archive);
  const newId = randomUUID();
  saveDraft(owner, draft(newId));
  await assert.rejects(pending, /Saved work changed while the backup/);
  assert.ok(listWorkspace(owner).drafts.some((item) => item.id === newId));
});

test("portable backup restores a valid image larger than four MiB", async () => {
  const pixels = randomBytes(1200 * 1200 * 3);
  const largePng = await sharp(pixels, { raw: { width: 1200, height: 1200, channels: 3 } })
    .png({ compressionLevel: 0 }).toBuffer();
  assert.ok(largePng.length > 4 * 1024 * 1024 && largePng.length < 5 * 1024 * 1024);
  const uploaded = (await createMedia(owner, { name: "large.png", type: "image/png", bytes: largePng })).media;
  const archive = JSON.parse(exportPortableBackup(owner));
  const encoded = archive.media.find((item) => item.id === uploaded.id);
  assert.ok(encoded.base64.length > 5_000_000);
  await importPortableBackup(owner, archive);
  const restored = listMedia(owner).find((item) => item.name === "large.png");
  assert.ok(restored);
  assert.equal((await sharp(getMedia(owner, restored.id).bytes).metadata()).width, 1200);
});

test("failed and completed plan states, receipts, and timezones survive restore", async () => {
  const failedId = listWorkspace(owner).schedule[0].id;
  const retryAt = new Date(Date.now() + 300_000).toISOString();
  database().prepare("UPDATE jobs SET status='failed',attempts=3,next_attempt_at=?,last_error=? WHERE id=? AND user_id=?")
    .run(retryAt, "Temporary simulated failure", failedId, owner);
  const completed = { id: randomUUID(), title: "Completed example", source: "Done", posts: { bluesky: "Done" },
    scheduledFor: new Date(Date.now() + 600_000).toISOString(), createdAt: stamp(), status: "queued" };
  addSchedule(owner, completed, "UTC");
  const finishedAt = stamp();
  const receipt = { platform: "bluesky", id: "sim_restored", status: "simulated", publishedAt: finishedAt, content: "Done" };
  database().prepare("UPDATE jobs SET status='simulated',attempts=1,completed_at=?,receipts=? WHERE id=? AND user_id=?")
    .run(finishedAt, JSON.stringify([receipt]), completed.id, owner);

  const archive = JSON.parse(exportPortableBackup(owner));
  assert.equal(archive.jobs.find((job) => job.post.title === "Planned").status, "failed");
  assert.equal(archive.jobs.find((job) => job.post.title === "Completed example").status, "simulated");
  await importPortableBackup(owner, archive);
  const state = listWorkspace(owner);
  const failed = state.schedule.find((job) => job.title === "Planned");
  const simulated = state.schedule.find((job) => job.title === "Completed example");
  assert.equal(failed.status, "failed");
  assert.equal(failed.attempts, 3);
  assert.equal(failed.lastError, "Temporary simulated failure");
  assert.equal(simulated.status, "simulated");
  assert.equal(simulated.simulatedAt, finishedAt);
  assert.deepEqual(simulated.receipts, [receipt]);
  assert.equal(database().prepare("SELECT timezone FROM jobs WHERE id=?").get(failed.id).timezone, "Asia/Hong_Kong");
});

test("full backup preserves brand details, reviewed ideas, and their remapped draft links", async () => {
  const sourceOwner = "strategy-source@example.test";
  const destinationOwner = "strategy-restored@example.test";
  const brief = saveBrandBrief(sourceOwner, {
    brandName: "Plypost", description: "A social publishing workspace", audience: "Solo creators",
    goal: "Explain the product", voice: "Plain and useful", facts: "The app is local-first.",
    contentPillars: ["Product notes"], platforms: ["bluesky", "linkedin"],
  });
  const plan = createWeeklyPlan(sourceOwner, brief, "nvidia", "2026-10-26", [{
    title: "Share an update", angle: "Explain one improvement", rationale: "Readers can see a concrete change",
    seed: "Plypost added a clearer publishing plan.", platforms: ["bluesky", "linkedin"],
  }]);
  const originalDraft = approveStrategyIdea(sourceOwner, plan.id, plan.ideas[0].id);
  const archive = JSON.parse(exportPortableBackup(sourceOwner));
  assert.equal(archive.version, 5);
  assert.equal(archive.brandBrief.brandName, "Plypost");
  assert.equal(archive.weeklyPlans[0].ideas[0].draftId, originalDraft.id);

  const broken = globalThis.structuredClone(archive);
  broken.weeklyPlans[0].ideas[0].status = "proposed";
  await assert.rejects(importPortableBackup(destinationOwner, broken), /invalid weekly plans/);
  assert.deepEqual(listStrategy(destinationOwner).plans, []);

  await importPortableBackup(destinationOwner, archive);
  const restoredState = listStrategy(destinationOwner);
  const restoredDraft = listWorkspace(destinationOwner).drafts[0];
  assert.equal(restoredState.brief.brandName, brief.brandName);
  assert.notEqual(restoredState.plans[0].id, plan.id);
  assert.notEqual(restoredDraft.id, originalDraft.id);
  assert.equal(restoredState.plans[0].ideas[0].draftId, restoredDraft.id);
  assert.equal(restoredState.plans[0].ideas[0].seed, plan.ideas[0].seed);

  const previous = globalThis.structuredClone(archive);
  previous.version = 2;
  delete previous.slotSettings;
  await importPortableBackup(destinationOwner, previous);
  assert.equal(listStrategy(destinationOwner).brief.brandName, brief.brandName);
  assert.equal(getSlotSettings(destinationOwner), null);

  const legacy = globalThis.structuredClone(archive);
  legacy.version = 1;
  delete legacy.brandBrief;
  delete legacy.weeklyPlans;
  delete legacy.slotSettings;
  await importPortableBackup(destinationOwner, legacy);
  assert.deepEqual(listStrategy(destinationOwner), { brief: null, plans: [] });
  assert.equal(getSlotSettings(destinationOwner), null);
});

test("full backup remaps batch handoff origins while preserving snapshots from deleted drafts", async () => {
  const sourceOwner = "batch-source@example.test";
  const destinationOwner = "batch-restored@example.test";
  const saved = saveDraft(sourceOwner, {
    ...draft(randomUUID()), selected: ["bluesky", "linkedin"],
    variants: { bluesky: "Reviewed Bluesky", linkedin: "Reviewed LinkedIn" },
  });
  const batchId = randomUUID();
  const items = [
    { destination: "bluesky", scheduledFor: new Date(Date.now() + 60_000).toISOString() },
    { destination: "linkedin", scheduledFor: new Date(Date.now() + 120_000).toISOString() },
    { destination: "x", scheduledFor: new Date(Date.now() + 180_000).toISOString(), text: "Reviewed X copy" },
  ];
  const original = prepareAssistedBatch(sourceOwner, saved.id, batchId, items);
  const deleted = saveDraft(sourceOwner, draft(randomUUID()));
  const orphanBatchId = randomUUID();
  const orphan = prepareAssistedBatch(sourceOwner, deleted.id, orphanBatchId, [items[0]])[0];
  assert.equal(deleteDraft(sourceOwner, deleted.id, deleted.updatedAt), true);

  const archive = JSON.parse(exportPortableBackup(sourceOwner));
  const altered = globalThis.structuredClone(archive);
  altered.assisted.find((item) => item.id === original[1].id).sourceDraftId = randomUUID();
  await assert.rejects(importPortableBackup(destinationOwner, altered), /inconsistent assisted batch provenance/);
  assert.deepEqual(listWorkspace(destinationOwner).assisted, []);

  await importPortableBackup(destinationOwner, archive);
  const restored = listWorkspace(destinationOwner);
  const linked = restored.assisted.filter((item) => item.batchId === batchId);
  const restoredOrphan = restored.assisted.find((item) => item.batchId === orphanBatchId);
  assert.equal(linked.length, 3);
  assert.ok(linked.every((item) => item.sourceDraftId === restored.drafts[0].id));
  assert.notEqual(restored.drafts[0].id, saved.id);
  assert.deepEqual(linked.map((item) => item.text).sort(), original.map((item) => item.text).sort());
  assert.equal(restoredOrphan.text, orphan.text);
  assert.equal(restoredOrphan.sourceDraftId, deleted.id);
  assert.equal(restored.drafts.some((item) => item.id === deleted.id), false);
});
