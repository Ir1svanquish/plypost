import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, database } from "../src/lib/server/db.ts";
import { createSession, SESSION_COOKIE } from "../src/lib/server/auth.ts";
import { getSlotSettings, saveSlotSettings, suggestWeeklySlots } from "../src/lib/server/slots.ts";
import { prepareAssistedBatch, saveDraft } from "../src/lib/server/workspace.ts";
import { GET, POST } from "../src/app/api/slots/route.ts";

const temporary = mkdtempSync(join(tmpdir(), "plypost-slots-"));
process.env.PLYPOST_DB_PATH = join(temporary, "slots.sqlite");
process.env.PLYPOST_OWNER_EMAIL = "owner@example.test";
process.env.PLYPOST_OWNER_PASSWORD_HASH = "test-placeholder";
const owner = "owner@example.test";
after(() => { closeDatabase(); if (temporary.startsWith(tmpdir())) rmSync(temporary, { recursive: true, force: true }); });

const utcRules = { timeZone: "UTC", rules: [
  { platform: "bluesky", day: 0, time: "10:00" },
  { platform: "mastodon", day: 0, time: "10:00" },
] };

test("suggestions skip occupied manual, simulated and real Mastodon minutes for the same platform", () => {
  saveSlotSettings(owner, utcRules);
  assert.equal(getSlotSettings("another@example.test"), null);
  const db = database();
  const manual = { id: randomUUID(), title: "Manual", destination: "bluesky", text: "Text",
    scheduledFor: "2026-10-25T10:00:20.000Z", createdAt: "2026-10-24T00:00:00.000Z", status: "queued" };
  db.prepare("INSERT INTO assisted(id,user_id,payload,scheduled_for,updated_at) VALUES (?,?,?,?,?)")
    .run(manual.id, owner, JSON.stringify(manual), manual.scheduledFor, manual.createdAt);
  const simulated = { id: randomUUID(), title: "Sim", source: "Text", posts: { bluesky: "Text" },
    scheduledFor: "2026-11-01T10:00:10.000Z", createdAt: "2026-10-24T00:00:00.000Z", status: "queued" };
  db.prepare("INSERT INTO jobs(id,user_id,payload,scheduled_for,timezone,status,next_attempt_at) VALUES (?,?,?,?,?,'queued',?)")
    .run(simulated.id, owner, JSON.stringify(simulated), simulated.scheduledFor, "UTC", simulated.scheduledFor);
  db.prepare(`INSERT INTO mastodon_scheduled_posts(client_request_id,user_id,instance,account_id,account_username,account_url,
    text,content_hash,scheduled_for,status,dispatch_authorized,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,'queued',1,?,?)`).run(randomUUID(), owner, "https://example.social", "1", "owner",
      "https://example.social/@owner", "Text", "hash", "2026-10-25T10:00:30.000Z", "2026-10-24T00:00:00.000Z", "2026-10-24T00:00:00.000Z");
  const result = suggestWeeklySlots(owner, ["bluesky", "mastodon"], Date.parse("2026-10-24T00:00:00.000Z"));
  assert.deepEqual(result.suggestions, [
    { platform: "bluesky", scheduledFor: "2026-11-08T10:00:00.000Z", skippedConflicts: 2 },
    { platform: "mastodon", scheduledFor: "2026-11-01T10:00:00.000Z", skippedConflicts: 1 },
  ]);
});

test("batch confirmation rejects a newly occupied suggested slot without creating partial handoffs", () => {
  const future = new Date(Date.now() + 2 * 86_400_000);
  future.setUTCHours(10, 0, 0, 0);
  const scheduledFor = future.toISOString();
  const draft = saveDraft(owner, { id: randomUUID(), title: "Slot test", source: "Text", selected: ["bluesky"],
    variants: { bluesky: "Text" }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const occupied = { id: randomUUID(), title: "Occupied", destination: "bluesky", text: "Other",
    scheduledFor: new Date(Date.parse(scheduledFor) + 20_000).toISOString(), createdAt: new Date().toISOString(), status: "queued" };
  database().prepare("INSERT INTO assisted(id,user_id,payload,scheduled_for,updated_at) VALUES (?,?,?,?,?)")
    .run(occupied.id, owner, JSON.stringify(occupied), occupied.scheduledFor, occupied.createdAt);
  const countBefore = database().prepare("SELECT COUNT(*) AS n FROM assisted WHERE user_id=?").get(owner).n;
  assert.throws(() => prepareAssistedBatch(owner, draft.id, randomUUID(),
    [{ destination: "bluesky", scheduledFor }], true), /now occupied/);
  assert.equal(database().prepare("SELECT COUNT(*) AS n FROM assisted WHERE user_id=?").get(owner).n, countBefore);
  // A deliberately chosen custom time keeps the existing manual workflow.
  const created = prepareAssistedBatch(owner, draft.id, randomUUID(), [{ destination: "bluesky", scheduledFor }], false);
  assert.equal(created.length, 1);
});

test("slots API requires the owner and same-origin writes", async () => {
  assert.equal((await GET(new globalThis.Request("http://localhost/api/slots"))).status, 401);
  const session = createSession(owner);
  const cookie = `${SESSION_COOKIE}=${session}`;
  const unauthorized = new globalThis.Request("http://localhost/api/slots", { method: "POST", headers: {
    cookie, origin: "https://evil.example", "content-type": "application/json" },
    body: JSON.stringify({ action: "save", settings: utcRules }) });
  assert.equal((await POST(unauthorized)).status, 403);
  const authorized = new globalThis.Request("http://localhost/api/slots", { method: "POST", headers: {
    cookie, origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ action: "save", settings: utcRules }) });
  const response = await POST(authorized);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).settings, utcRules);
  const read = await GET(new globalThis.Request("http://localhost/api/slots", { headers: { cookie } }));
  assert.equal(read.status, 200);
  assert.deepEqual((await read.json()).settings, utcRules);
});
