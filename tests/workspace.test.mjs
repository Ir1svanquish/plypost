import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assistedState, draftTitle, emptyWorkspace, followAutoTitle, hasDraftContent, localDateTimeValue, normalizePublicPostUrl, parseWorkspace, scheduleState, validCalendarDate } from "../src/lib/workspace.ts";

const stamp = "2026-10-22T12:00:00.000Z";

test("generated draft names follow edited text while custom names remain fixed", () => {
  assert.equal(followAutoTitle("First line", "First line\nMore detail", "Revised opening\nMore detail"), "Revised opening");
  assert.equal(followAutoTitle("Untitled draft", "", "New caption"), "New caption");
  assert.equal(followAutoTitle("First line", "First line", ""), "");
  assert.equal(followAutoTitle("Campaign name", "First line", "Revised opening"), "Campaign name");
  assert.equal(followAutoTitle("", "", "New caption"), "");
});

test("a generated title keeps complete emoji at the character limit", () => {
  const opening = "a".repeat(119) + "😀" + " later";
  assert.equal(draftTitle("", opening), "a".repeat(119) + "😀");
  assert.equal(Array.from(draftTitle("", opening)).length, 120);
  assert.equal(draftTitle("😀".repeat(121), ""), "😀".repeat(120));
});

test("a draft target is a real calendar day and does not become a publishing job", () => {
  const draft = { id: "dated-draft", title: "Launch idea", source: "Later", selected: [], variants: {},
    plannedDate: "2028-02-29", createdAt: stamp, updatedAt: stamp };
  const backup = { version: 3, drafts: [draft], schedule: [], assisted: [] };
  assert.equal(validCalendarDate(draft.plannedDate), true);
  assert.deepEqual(parseWorkspace(backup), backup);
  for (const date of ["2027-02-29", "2026-04-31", "2026-13-01", "2026-10-1", "2026-10-25T12:00:00Z"]) {
    assert.equal(validCalendarDate(date), false);
    assert.deepEqual(parseWorkspace({ ...backup, drafts: [{ ...draft, plannedDate: date }] })?.drafts, []);
  }
});

test("a video-only idea is a valid draft, while malformed video references are rejected", () => {
  const draft = { id: "video-draft", title: "", source: "", selected: [], variants: {},
    videoId: "5be12631-17ee-4ec5-98f3-9756a0b3f57b", createdAt: stamp, updatedAt: stamp };
  const backup = { version: 3, drafts: [draft], schedule: [], assisted: [] };
  assert.equal(hasDraftContent(draft), true);
  assert.deepEqual(parseWorkspace(backup)?.drafts, [draft]);
  assert.deepEqual(parseWorkspace({ ...backup, drafts: [{ ...draft, videoId: "not-a-uuid" }] })?.drafts, []);
});

test("existing v2 backups migrate without losing drafts or scheduled posts", () => {
  const backup = {
    version: 2,
    drafts: [{ id: "d1", title: "Launch", source: "Launch update", selected: ["bluesky", "threads"], variants: { bluesky: "Short update" }, createdAt: stamp, updatedAt: stamp }],
    schedule: [{ id: "s1", title: "Launch", source: "Launch update", posts: { bluesky: "Short update" }, scheduledFor: stamp, createdAt: stamp, status: "queued" }],
  };
  assert.deepEqual(parseWorkspace(JSON.parse(JSON.stringify(backup))), { ...backup, version: 3, assisted: [] });
  assert.deepEqual(parseWorkspace(emptyWorkspace()), emptyWorkspace());
});

test("backup parser rejects wrong versions and skips invalid content", () => {
  assert.equal(parseWorkspace({ version: 1, drafts: [], schedule: [] }), null);
  const parsed = parseWorkspace({
    version: 2,
    drafts: [{ id: "d1", title: "Good", source: "Text", selected: ["bluesky", "unknown"], variants: { bluesky: "Okay", unknown: "Ignored" }, createdAt: stamp, updatedAt: stamp }, { bad: true }],
    schedule: [{ id: "s1", title: "Too long", source: "Text", posts: { bluesky: "x".repeat(301) }, scheduledFor: stamp, createdAt: stamp, status: "queued" }],
  });
  assert.deepEqual(parsed.drafts[0].selected, ["bluesky"]);
  assert.deepEqual(parsed.drafts[0].variants, { bluesky: "Okay" });
  assert.equal(parsed.drafts.length, 1);
  assert.equal(parsed.schedule.length, 0);
  assert.deepEqual(parsed.assisted, []);
});

test("assisted posts round trip and invalid destinations are skipped", () => {
  const post = { id: "a1", title: "Launch", destination: "x", text: "Hello X", scheduledFor: stamp, createdAt: stamp, status: "queued", contentEditedAt: stamp };
  const backup = { version: 3, drafts: [], schedule: [], assisted: [post, { ...post, id: "a2", destination: "unknown" }] };
  assert.deepEqual(parseWorkspace(backup), { ...backup, assisted: [post] });
  assert.deepEqual(parseWorkspace({ ...backup, assisted: [{ ...post, contentEditedAt: "not-a-date" }] })?.assisted, []);
  assert.equal(parseWorkspace({ version: 3, drafts: [], schedule: [] }), null);
  const dueAt = Date.parse(stamp);
  assert.equal(assistedState(post, dueAt - 1), "upcoming");
  assert.equal(assistedState(post, dueAt), "due");
  assert.equal(assistedState({ ...post, status: "posted" }, dueAt + 1), "posted");
});

test("assisted post links accept public HTTPS format while preserving legacy items", () => {
  const post = { id: "a-link", title: "Launch", destination: "mastodon", text: "Hello", scheduledFor: stamp,
    createdAt: stamp, status: "posted", postedAt: stamp, postUrl: "https://mastodon.social/@creator/12345" };
  const backup = { version: 3, drafts: [], schedule: [], assisted: [post] };
  assert.deepEqual(parseWorkspace(backup), backup);
  assert.equal(normalizePublicPostUrl("  https://bsky.app/profile/creator/post/abc  "), "https://bsky.app/profile/creator/post/abc");
  for (const url of ["javascript:alert(1)", "http://social.example/post/1", "https://user:secret@social.example/post/1",
    "https://localhost/post/1", "https://192.168.1.1/post/1", "https://social.example/", `https://social.example/post/${"x".repeat(2050)}`]) {
    assert.equal(normalizePublicPostUrl(url), null, url);
    assert.deepEqual(parseWorkspace({ ...backup, assisted: [{ ...post, postUrl: url }] })?.assisted, []);
  }
  assert.deepEqual(parseWorkspace({ ...backup, assisted: [{ ...post, status: "queued" }] })?.assisted, []);
  const legacy = { ...post };
  delete legacy.postUrl;
  assert.deepEqual(parseWorkspace({ ...backup, assisted: [legacy] })?.assisted, [legacy]);
});

test("plan and assisted image snapshots round trip while malformed references are rejected", () => {
  const imageId = "5be12631-17ee-4ec5-98f3-9756a0b3f57b";
  const description = "A person holding a blue poster.";
  const draft = { id: "d-images", title: "Illustrated", source: "Text", selected: ["bluesky"], variants: {}, mediaIds: [imageId], mediaAlt: [description], createdAt: stamp, updatedAt: stamp };
  const plan = { id: "s-images", title: "Illustrated", source: "Text", posts: { bluesky: "Text" }, mediaIds: [imageId], mediaAlt: [description], scheduledFor: stamp, createdAt: stamp, status: "queued" };
  const assisted = { id: "a-images", title: "Illustrated", destination: "instagram", text: "Text", mediaIds: [imageId], mediaAlt: [description], scheduledFor: stamp, createdAt: stamp, status: "queued" };
  const backup = { version: 3, drafts: [draft], schedule: [plan], assisted: [assisted] };
  assert.deepEqual(parseWorkspace(backup), backup);
  assert.deepEqual(parseWorkspace({ ...backup, drafts: [{ ...draft, mediaAlt: [] }] })?.drafts, []);
  assert.deepEqual(parseWorkspace({ ...backup, drafts: [{ ...draft, mediaAlt: ["  padded"] }] })?.drafts, []);
  assert.deepEqual(parseWorkspace({ ...backup, drafts: [{ ...draft, mediaAlt: ["x".repeat(501)] }] })?.drafts, []);
  assert.deepEqual(parseWorkspace({ ...backup, schedule: [{ ...plan, mediaAlt: ["line\nbreak"] }] })?.schedule, []);
  assert.deepEqual(parseWorkspace({ ...backup, assisted: [{ ...assisted, mediaAlt: [4] }] })?.assisted, []);
  assert.deepEqual(parseWorkspace({ ...backup, schedule: [{ ...plan, mediaIds: [imageId, imageId] }] })?.schedule, []);
  assert.deepEqual(parseWorkspace({ ...backup, assisted: [{ ...assisted, mediaIds: ["not-a-uuid"] }] })?.assisted, []);
  assert.deepEqual(parseWorkspace({ ...backup, assisted: [{ ...assisted, mediaIds: ["-".repeat(36)] }] })?.assisted, []);
  const twentyIds = Array.from({ length: 20 }, (_, index) => `${index.toString(16).padStart(8, "0")}-17ee-4ec5-98f3-9756a0b3f57b`);
  assert.equal(parseWorkspace({ ...backup, drafts: [{ ...draft, mediaIds: twentyIds, mediaAlt: twentyIds.map(() => "") }] })?.drafts[0].mediaIds?.length, 20);
  assert.deepEqual(parseWorkspace({ ...backup, schedule: [{ ...plan, mediaIds: [...twentyIds, randomUUID()] }] })?.schedule, []);
  assert.equal(parseWorkspace({ ...backup, drafts: [{ ...draft, placeLabel: "Central, Hong Kong" }] })?.drafts[0].placeLabel, "Central, Hong Kong");
  assert.deepEqual(parseWorkspace({ ...backup, assisted: [{ ...assisted, placeLabel: "bad\nplace" }] })?.assisted, []);
});

test("plan items become due only at their local instant and remain simulated", () => {
  const post = { id: "s1", title: "Post", source: "Post", posts: { bluesky: "Post" }, scheduledFor: stamp, createdAt: stamp, status: "queued" };
  const dueAt = Date.parse(stamp);
  assert.equal(scheduleState(post, dueAt - 1), "upcoming");
  assert.equal(scheduleState(post, dueAt), "due");
  assert.equal(scheduleState({ ...post, attempts: 1, nextAttemptAt: new Date(dueAt + 60_000).toISOString() }, dueAt + 1), "upcoming");
  assert.equal(scheduleState({ ...post, attempts: 1, nextAttemptAt: new Date(dueAt + 60_000).toISOString() }, dueAt + 60_000), "due");
  assert.equal(scheduleState({ ...post, status: "simulated" }, dueAt + 1), "simulated");
  assert.match(localDateTimeValue(new Date(2026, 9, 22, 9, 5)), /^2026-10-22T09:05$/);
  assert.equal(draftTitle("", "First line\nsecond line"), "First line");
});

test("parser never silently drops a requested destination or normalizes an impossible plan date", () => {
  const post = { id: "s1", title: "Partial", source: "Text", posts: { bluesky: "x".repeat(301), mastodon: "Keep me" }, scheduledFor: stamp, createdAt: stamp, status: "queued" };
  const backup = (item) => ({ version: 3, drafts: [], schedule: [item], assisted: [] });
  assert.deepEqual(parseWorkspace(backup(post))?.schedule, []);
  assert.deepEqual(parseWorkspace(backup({ ...post, posts: { mastodon: "Keep me", unknown: "Drop me" } }))?.schedule, []);
  assert.deepEqual(parseWorkspace(backup({ ...post, posts: { mastodon: "Keep me" }, scheduledFor: "2026-02-30T12:00:00.000Z" }))?.schedule, []);
});
