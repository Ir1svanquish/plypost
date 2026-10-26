import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, database } from "../src/lib/server/db.ts";
import { addAssisted, addSchedule, deleteAssisted, importLegacyLibrary, importLibrary, listWorkspace, markAssistedNotified, migrateAssisted, migrateLegacyBrowserWorkspace, rescheduleAssisted, saveDraft, setAssistedStatus, updateAssistedText } from "../src/lib/server/workspace.ts";
import { assistedContentSnapshot, assistedDeletionSnapshot, assistedReceiptSnapshot, assistedState, parseWorkspace } from "../src/lib/workspace.ts";

const temporary = mkdtempSync(join(tmpdir(), "plypost-assisted-"));
process.env.PLYPOST_DB_PATH = join(temporary, "assisted.sqlite");
const owner = "owner@example.test";
const other = "other@example.test";

after(() => { closeDatabase(); if (temporary.startsWith(tmpdir())) rmSync(temporary, { recursive: true, force: true }); });

function item(text = "A post to publish") {
  return {
    id: randomUUID(), title: "Launch", destination: "x", text,
    scheduledFor: new Date(Date.now() + 60_000).toISOString(),
    createdAt: new Date().toISOString(), status: "queued",
  };
}

function changePostedStatus(id, status, postUrl) {
  const current = listWorkspace(owner).assisted.find((entry) => entry.id === id);
  return setAssistedStatus(owner, id, status, postUrl, undefined, assistedReceiptSnapshot(current));
}

test("assisted items persist and status, notification, and deletion are scoped to the owner", () => {
  const post = item();
  post.scheduledFor = new Date(Date.now() - 1_000).toISOString();
  assert.deepEqual(addAssisted(owner, post), post);
  closeDatabase();
  assert.deepEqual(listWorkspace(owner).assisted, [post]);
  assert.deepEqual(listWorkspace(other).assisted, []);
  assert.equal(setAssistedStatus(other, post.id, "posted"), false);
  markAssistedNotified(other, [post.id]);
  assert.equal(deleteAssisted(other, post.id), false);
  assert.equal(listWorkspace(owner).assisted[0].notifiedAt, undefined);

  markAssistedNotified(owner, [post.id]);
  const notifiedAt = listWorkspace(owner).assisted[0].notifiedAt;
  assert.ok(notifiedAt);
  markAssistedNotified(owner, [post.id]);
  assert.equal(listWorkspace(owner).assisted[0].notifiedAt, notifiedAt);

  assert.equal(setAssistedStatus(owner, post.id, "posted", undefined, assistedContentSnapshot(post)), true);
  assert.equal(listWorkspace(owner).assisted[0].status, "posted");
  const postedAt = listWorkspace(owner).assisted[0].postedAt;
  assert.ok(postedAt);
  assert.equal(listWorkspace(owner).assisted[0].postUrl, undefined);
  const link = "https://social.example/creator/post/123";
  assert.equal(setAssistedStatus(other, post.id, "posted", link), false);
  assert.equal(changePostedStatus(post.id, "posted", link), true);
  assert.equal(listWorkspace(owner).assisted[0].postUrl, link);
  assert.equal(listWorkspace(owner).assisted[0].postedAt, postedAt);
  const corrected = "https://social.example/creator/post/456";
  assert.equal(changePostedStatus(post.id, "posted", corrected), true);
  assert.equal(listWorkspace(owner).assisted[0].postUrl, corrected);
  assert.equal(changePostedStatus(post.id, "posted"), true);
  assert.equal(listWorkspace(owner).assisted[0].postUrl, corrected);
  assert.equal(listWorkspace(owner).assisted[0].postedAt, postedAt);
  assert.throws(() => setAssistedStatus(owner, post.id, "posted", "https://user:password@social.example/post/123"), /public HTTPS/);
  assert.throws(() => setAssistedStatus(owner, post.id, "posted", ""), /public HTTPS/);
  assert.equal(listWorkspace(owner).assisted[0].postUrl, corrected);
  assert.equal(changePostedStatus(post.id, "posted", null), true);
  assert.equal(listWorkspace(owner).assisted[0].postUrl, undefined);
  assert.equal(listWorkspace(owner).assisted[0].status, "posted");
  assert.equal(listWorkspace(owner).assisted[0].postedAt, postedAt);
  assert.equal(changePostedStatus(post.id, "posted", null), true);
  assert.equal(listWorkspace(owner).assisted[0].postedAt, postedAt);
  assert.equal(changePostedStatus(post.id, "posted", link), true);
  assert.equal(listWorkspace(owner).assisted[0].postUrl, link);
  assert.equal(listWorkspace(owner).assisted[0].postedAt, postedAt);
  assert.equal(changePostedStatus(post.id, "queued"), true);
  assert.equal(listWorkspace(owner).assisted[0].postedAt, undefined);
  assert.equal(listWorkspace(owner).assisted[0].postUrl, undefined);
  assert.equal(deleteAssisted(owner, post.id, assistedDeletionSnapshot(listWorkspace(owner).assisted[0])), true);
  assert.deepEqual(listWorkspace(owner).assisted, []);
});

test("a stale window cannot delete a handoff changed elsewhere", () => {
  const post = item("Original handoff");
  addAssisted(owner, post);
  const reviewed = assistedDeletionSnapshot(post);
  assert.equal(updateAssistedText(owner, post.id, post.text, "Updated in another window"), true);
  assert.throws(() => deleteAssisted(owner, post.id, reviewed), /changed/);
  assert.equal(listWorkspace(owner).assisted.find((entry) => entry.id === post.id).text, "Updated in another window");
  const revised = listWorkspace(owner).assisted.find((entry) => entry.id === post.id);
  const beforePosting = assistedDeletionSnapshot(revised);
  assert.equal(setAssistedStatus(owner, post.id, "posted", undefined, assistedContentSnapshot(revised)), true);
  assert.throws(() => deleteAssisted(owner, post.id, beforePosting), /changed/);
  assert.equal(listWorkspace(owner).assisted.find((entry) => entry.id === post.id).status, "posted");
  assert.equal(deleteAssisted(owner, post.id, assistedDeletionSnapshot(listWorkspace(owner).assisted.find((entry) => entry.id === post.id))), true);
});

test("moving a pending manual reminder keeps its content, resets notification, and rejects stale edits", () => {
  const post = item("Reviewed text and images remain attached");
  post.scheduledFor = new Date(Date.now() - 1_000).toISOString();
  addAssisted(owner, post);
  markAssistedNotified(owner, [post.id]);
  const moved = new Date(Date.now() + 86_400_000).toISOString();
  assert.throws(() => rescheduleAssisted(other, post.id, post.scheduledFor, moved), /changed or is no longer queued/);
  assert.equal(rescheduleAssisted(owner, post.id, post.scheduledFor, moved), true);
  const current = listWorkspace(owner).assisted.find((entry) => entry.id === post.id);
  assert.equal(current.scheduledFor, moved);
  assert.equal(database().prepare("SELECT scheduled_for FROM assisted WHERE id=? AND user_id=?").get(post.id, owner).scheduled_for, moved);
  assert.equal(current.text, post.text);
  assert.equal(current.destination, post.destination);
  assert.equal(current.notifiedAt, undefined);
  markAssistedNotified(owner, [post.id]);
  assert.equal(listWorkspace(owner).assisted.find((entry) => entry.id === post.id).notifiedAt, undefined);
  assert.throws(() => rescheduleAssisted(owner, post.id, post.scheduledFor, new Date(Date.now() + 172_800_000).toISOString()), /changed or is no longer queued/);
  for (const invalid of ["2026-02-30T09:00:00.000Z", new Date(Date.now() - 60_000).toISOString(), "not-a-date"]) {
    assert.throws(() => rescheduleAssisted(owner, post.id, moved, invalid), /future UTC reminder/);
  }
  assert.equal(setAssistedStatus(owner, post.id, "posted", undefined, assistedContentSnapshot(current)), true);
  assert.throws(() => rescheduleAssisted(owner, post.id, moved, new Date(Date.now() + 172_800_000).toISOString()), /changed or is no longer queued/);
  assert.equal(listWorkspace(owner).assisted.find((entry) => entry.id === post.id).scheduledFor, moved);
});

test("a checklist handoff has no due reminder until one is set, and removing it keeps the handoff", () => {
  const checklist = { ...item("Post when ready"), scheduledFor: new Date().toISOString(), reminderEnabled: false };
  addAssisted(owner, checklist);
  const now = Date.now();
  assert.equal(assistedState(checklist, now), "unscheduled");
  markAssistedNotified(owner, [checklist.id]);
  assert.equal(listWorkspace(owner).assisted.find((entry) => entry.id === checklist.id).notifiedAt, undefined);
  assert.equal(parseWorkspace({ version: 3, drafts: [], schedule: [], assisted: [checklist] }).assisted[0].reminderEnabled, false);
  assert.equal(parseWorkspace({ version: 3, drafts: [], schedule: [], assisted: [{ ...checklist, reminderEnabled: "no" }] }).assisted.length, 0);

  const reminder = new Date(Date.now() + 86_400_000).toISOString();
  assert.equal(rescheduleAssisted(owner, checklist.id, checklist.scheduledFor, reminder), true);
  let saved = listWorkspace(owner).assisted.find((entry) => entry.id === checklist.id);
  assert.equal(saved.reminderEnabled, true);
  assert.equal(assistedState(saved, now), "upcoming");
  assert.equal(saved.text, checklist.text);
  assert.throws(() => rescheduleAssisted(owner, checklist.id, checklist.scheduledFor, null), /changed or is no longer queued/);

  assert.equal(rescheduleAssisted(owner, checklist.id, reminder, null), true);
  saved = listWorkspace(owner).assisted.find((entry) => entry.id === checklist.id);
  assert.equal(saved.reminderEnabled, false);
  assert.equal(assistedState(saved, Date.now() + 90_000_000), "unscheduled");
  markAssistedNotified(owner, [checklist.id]);
  assert.equal(listWorkspace(owner).assisted.find((entry) => entry.id === checklist.id).notifiedAt, undefined);
  assert.equal(saved.text, checklist.text);
  assert.equal(saved.destination, checklist.destination);
});

test("editing queued handoff text preserves its reminder and rejects stale or posted edits", () => {
  const post = item("First version");
  post.title = post.text;
  addAssisted(owner, post);
  assert.throws(() => updateAssistedText(other, post.id, post.text, "Other owner's edit"), /no longer available/);
  assert.equal(updateAssistedText(owner, post.id, post.text, "Corrected version"), true);
  const revised = listWorkspace(owner).assisted.find((entry) => entry.id === post.id);
  assert.equal(revised.text, "Corrected version");
  assert.equal(revised.title, "Corrected version");
  assert.equal(revised.scheduledFor, post.scheduledFor);
  assert.equal(revised.destination, post.destination);
  assert.match(revised.contentEditedAt, /^\d{4}-\d\d-\d\dT/);
  assert.throws(() => updateAssistedText(owner, post.id, post.text, "Stale overwrite"), /text changed/);
  for (const invalid of ["  ", "x".repeat(5001)]) {
    assert.throws(() => updateAssistedText(owner, post.id, revised.text, invalid), /up to 5,000/);
  }
  assert.equal(listWorkspace(owner).assisted.find((entry) => entry.id === post.id).text, revised.text);
  setAssistedStatus(owner, post.id, "posted", undefined, assistedContentSnapshot(revised));
  assert.throws(() => updateAssistedText(owner, post.id, revised.text, "Too late"), /marked posted/);
});

test("browser migration merges missing IDs idempotently and enforces the list cap atomically", () => {
  const posts = [item("One"), item("Two")];
  assert.throws(() => migrateAssisted(other, [posts[0], { ...posts[1], destination: "unknown" }]), /Invalid assisted migration/);
  assert.deepEqual(listWorkspace(other).assisted, []);
  assert.throws(() => migrateAssisted(other, [posts[0], posts[0]]), /Invalid assisted migration/);
  assert.equal(migrateAssisted(other, posts), "imported");
  assert.deepEqual(listWorkspace(other).assisted.map((post) => post.id).sort(), posts.map((post) => post.id).sort());
  const third = item("Third");
  assert.equal(migrateAssisted(other, [posts[0], third]), "imported");
  assert.equal(migrateAssisted(other, [posts[0], third]), "skipped");
  assert.equal(listWorkspace(other).assisted.length, 3);
  const fill = Array.from({ length: 97 }, (_, index) => item(`Fill ${index}`));
  assert.equal(migrateAssisted(other, fill), "imported");
  const overflow = item("Overflow");
  assert.throws(() => migrateAssisted(other, [posts[0], overflow]), /list is full/);
  assert.equal(listWorkspace(other).assisted.length, 100);
  assert.equal(listWorkspace(other).assisted.some((post) => post.id === overflow.id), false);
});

test("workspace backup replaces assisted items with the saved snapshot", () => {
  const replacement = { ...item("Backed up"), status: "posted", postedAt: new Date().toISOString(), postUrl: "https://social.example/post/789" };
  importLibrary(owner, { version: 3, drafts: [], schedule: [], assisted: [replacement] });
  assert.deepEqual(listWorkspace(owner).assisted, [replacement]);
  assert.deepEqual(listWorkspace(other).assisted.length, 100);
  assert.throws(() => importLibrary(owner, { version: 3, drafts: [], schedule: [], assisted: [replacement, { ...replacement, id: randomUUID(), destination: "bad" }] }), /Invalid workspace backup/);
  assert.deepEqual(listWorkspace(owner).assisted, [replacement]);
});

test("legacy browser import replaces drafts and plans without replacing account assisted items", () => {
  const accountItem = listWorkspace(owner).assisted[0];
  const stamp = new Date().toISOString();
  const draft = { id: randomUUID(), title: "Legacy draft", source: "Hello", selected: ["bluesky"], variants: {}, createdAt: stamp, updatedAt: stamp };
  const schedule = { id: randomUUID(), title: "Legacy plan", source: "Hello", posts: { bluesky: "Hello" }, scheduledFor: new Date(Date.now() + 60_000).toISOString(), createdAt: stamp, status: "queued" };
  importLegacyLibrary(owner, { version: 3, drafts: [draft], schedule: [schedule], assisted: [item("Old browser item")] });
  const workspace = listWorkspace(owner);
  assert.equal(workspace.drafts[0].id, draft.id);
  assert.equal(workspace.schedule[0].id, schedule.id);
  assert.deepEqual(workspace.assisted, [accountItem]);
  assert.throws(() => importLegacyLibrary(owner, { version: 3, drafts: [{ ...draft, id: "invalid" }], schedule: [], assisted: [] }), /Backup has invalid IDs/);
  assert.deepEqual(listWorkspace(owner).assisted, [accountItem]);
  assert.equal(listWorkspace(owner).schedule[0].id, schedule.id);
});

test("reviewed browser migration preserves account work for assisted-only data and rolls back failures", () => {
  const migrationOwner = "migration@example.test";
  const stamp = new Date().toISOString();
  const accountDraft = saveDraft(migrationOwner, { id: randomUUID(), title: "Account draft", source: "Keep me", selected: ["bluesky"], variants: {}, createdAt: stamp, updatedAt: stamp });
  const accountPlan = addSchedule(migrationOwner, { id: randomUUID(), title: "Account plan", source: "Keep me", posts: { bluesky: "Keep me" }, scheduledFor: new Date(Date.now() + 120_000).toISOString(), createdAt: stamp, status: "queued" }, "UTC");
  const accountHandoff = addAssisted(migrationOwner, item("Existing handoff"));
  const oldHandoff = item("Older browser handoff");

  migrateLegacyBrowserWorkspace(migrationOwner, { version: 3, drafts: [], schedule: [], assisted: [oldHandoff] });
  let saved = listWorkspace(migrationOwner);
  assert.equal(saved.drafts[0].id, accountDraft.id);
  assert.equal(saved.schedule[0].id, accountPlan.id);
  assert.deepEqual(new Set(saved.assisted.map((post) => post.id)), new Set([accountHandoff.id, oldHandoff.id]));
  migrateLegacyBrowserWorkspace(migrationOwner, { version: 3, drafts: [], schedule: [], assisted: [oldHandoff] });
  assert.equal(listWorkspace(migrationOwner).assisted.length, 2);

  const oldDraft = { ...accountDraft, id: randomUUID(), title: "Older browser draft" };
  const oldPlan = { ...accountPlan, id: randomUUID(), title: "Older browser plan" };
  const nextHandoff = item("Another older handoff");
  migrateLegacyBrowserWorkspace(migrationOwner, { version: 3, drafts: [oldDraft], schedule: [oldPlan], assisted: [oldHandoff, nextHandoff] });
  saved = listWorkspace(migrationOwner);
  assert.deepEqual(saved.drafts.map((draft) => draft.id), [oldDraft.id]);
  assert.deepEqual(saved.schedule.map((post) => post.id), [oldPlan.id]);
  assert.deepEqual(new Set(saved.assisted.map((post) => post.id)), new Set([accountHandoff.id, oldHandoff.id, nextHandoff.id]));

  const invalid = { version: 3, drafts: [accountDraft], schedule: [], assisted: [{ ...item("Broken"), destination: "bad" }] };
  assert.throws(() => migrateLegacyBrowserWorkspace(migrationOwner, invalid), /Invalid workspace backup/);
  assert.throws(() => migrateLegacyBrowserWorkspace(migrationOwner, { version: 3, drafts: [accountDraft], schedule: [] }), /Invalid workspace backup/);
  assert.deepEqual(listWorkspace(migrationOwner).drafts.map((draft) => draft.id), [oldDraft.id]);
  assert.deepEqual(listWorkspace(migrationOwner).schedule.map((post) => post.id), [oldPlan.id]);
  assert.equal(listWorkspace(migrationOwner).assisted.length, 3);

  const fullOwner = "full-migration@example.test";
  migrateAssisted(fullOwner, Array.from({ length: 100 }, (_, index) => item(`Full ${index}`)));
  assert.throws(() => migrateLegacyBrowserWorkspace(fullOwner, { version: 3, drafts: [oldDraft], schedule: [], assisted: [item("Overflow")] }), /list is full/);
  assert.equal(listWorkspace(fullOwner).drafts.length, 0);
  assert.equal(listWorkspace(fullOwner).assisted.length, 100);
});

test("assisted publishing enforces known platform limits without restricting other destinations", () => {
  assert.throws(() => addAssisted(owner, { ...item("x".repeat(301)), destination: "bluesky" }), /Fix platform draft limits/);
  const elsewhere = item("x".repeat(301));
  assert.deepEqual(addAssisted(owner, elsewhere), elsewhere);
  assert.equal(deleteAssisted(owner, elsewhere.id, assistedDeletionSnapshot(elsewhere)), true);
});
