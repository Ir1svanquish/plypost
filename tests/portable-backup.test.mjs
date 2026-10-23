import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { closeDatabase, database } from "../src/lib/server/db.ts";
import { createMedia, getMedia, listMedia } from "../src/lib/server/media.ts";
import { addSchedule, listWorkspace, saveDraft, setAssistedStatus } from "../src/lib/server/workspace.ts";
import { createSession, SESSION_COOKIE } from "../src/lib/server/auth.ts";
import { exportPortableBackup, importPortableBackup } from "../src/lib/server/portable-backup.ts";
import { approveStrategyIdea, createWeeklyPlan, listStrategy, saveBrandBrief } from "../src/lib/server/strategy.ts";
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
  const saved = saveDraft(owner, draft(randomUUID(), [image.id]));
  const plan = { id: randomUUID(), title: "Planned", source: "A saved idea", posts: { bluesky: "A saved idea" }, mediaIds: [image.id],
    scheduledFor: new Date(Date.now() + 3_600_000).toISOString(), createdAt: stamp(), status: "queued" };
  addSchedule(owner, plan, "Asia/Hong_Kong");
  const assisted = { id: randomUUID(), title: "Manual", destination: "x", text: "A saved idea", mediaIds: [image.id],
    scheduledFor: new Date(Date.now() + 7_200_000).toISOString(), createdAt: stamp(), status: "queued" };
  database().prepare("INSERT INTO assisted(id,user_id,payload,scheduled_for,updated_at) VALUES (?,?,?,?,?)")
    .run(assisted.id, owner, JSON.stringify(assisted), assisted.scheduledFor, stamp());
  const postUrl = "https://social.example/creator/post/2026";
  assert.equal(setAssistedStatus(owner, assisted.id, "posted", postUrl), true);

  const exported = exportPortableBackup(owner);
  const archive = JSON.parse(exported);
  assert.equal(archive.format, "plypost-portable");
  assert.equal(archive.version, 2);
  assert.equal(archive.brandBrief, null);
  assert.deepEqual(archive.weeklyPlans, []);
  assert.equal(archive.media.length, 1);
  assert.equal(archive.drafts[0].mediaIds[0], image.id);
  assert.equal(archive.jobs[0].timezone, "Asia/Hong_Kong");
  assert.equal(archive.assisted[0].postUrl, postUrl);
  assert.ok(archive.assisted[0].postedAt);
  assert.ok(!exported.includes("configured"));

  closeDatabase();
  process.env.PLYPOST_DB_PATH = join(temporary, "restored.sqlite");
  const result = await importPortableBackup(owner, archive);
  assert.deepEqual(result, { drafts: 1, jobs: 1, assisted: 1, media: 1 });
  const restored = listWorkspace(owner);
  assert.notEqual(restored.drafts[0].id, saved.id);
  assert.notEqual(restored.drafts[0].mediaIds[0], image.id);
  assert.equal(restored.schedule[0].status, "queued");
  assert.equal(restored.schedule[0].scheduledFor, plan.scheduledFor);
  assert.deepEqual(restored.schedule[0].mediaIds, restored.drafts[0].mediaIds);
  assert.equal(restored.assisted[0].text, assisted.text);
  assert.equal(restored.assisted[0].postUrl, postUrl);
  assert.equal(restored.assisted[0].postedAt, archive.assisted[0].postedAt);
  assert.deepEqual(restored.assisted[0].mediaIds, restored.drafts[0].mediaIds);
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
  assert.deepEqual(listWorkspace(owner).drafts, baseline.drafts);
  assert.deepEqual(listMedia(owner).map((item) => item.id), original.media.map((item) => item.id));
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
  const archive = await download.json();
  assert.equal((await POST(backupRequest(archive, { cookie, origin: "https://evil.example" }))).status, 403);
  assert.equal((await POST(backupRequest(archive, { cookie, contentType: "text/plain" }))).status, 415);
  assert.equal((await POST(backupRequest("not-json", { cookie }))).status, 400);
  const tooLarge = new globalThis.Request(base, { method: "POST", headers: { cookie, origin: "http://localhost", "content-type": "application/json", "content-length": String(130 * 1024 * 1024) }, body: "{}" });
  assert.equal((await POST(tooLarge)).status, 413);
  const imported = await POST(backupRequest(archive, { cookie }));
  assert.equal(imported.status, 200);
  assert.deepEqual((await imported.json()).restored, { drafts: 1, jobs: 1, assisted: 1, media: 1 });
});

test("backup import rejects an image whose bytes do not match its declared checksum", async () => {
  const archive = JSON.parse(exportPortableBackup(owner));
  archive.media[0].base64 = Buffer.from("not a real image").toString("base64");
  archive.media[0].sizeBytes = Buffer.from("not a real image").length;
  archive.media[0].sha256 = createHash("sha256").update("not a real image").digest("hex");
  await assert.rejects(importPortableBackup(owner, archive), /undecodable image/);
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
  assert.equal(archive.version, 2);
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

  const legacy = globalThis.structuredClone(archive);
  legacy.version = 1;
  delete legacy.brandBrief;
  delete legacy.weeklyPlans;
  await importPortableBackup(destinationOwner, legacy);
  assert.deepEqual(listStrategy(destinationOwner), { brief: null, plans: [] });
});
