import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { buildManualReminderCalendar, upcomingManualReminders } from "../src/lib/calendar-export.ts";

const generatedAt = new Date("2026-10-24T10:00:00.000Z");
const post = (id, destination, scheduledFor, status = "queued") => ({
  id, title: "Private launch name", destination, text: "Secret draft text", mediaAlt: ["Private image description"],
  scheduledFor, createdAt: generatedAt.toISOString(), status,
});

test("calendar export includes only future manual reminders, without post content", () => {
  const first = post("11111111-1111-4111-8111-111111111111", "instagram", "2026-10-25T09:30:00.000Z");
  const second = post("22222222-2222-4222-8222-222222222222", "youtube", "2026-10-26T12:00:00.000Z");
  const past = post("33333333-3333-4333-8333-333333333333", "reddit", "2026-10-24T09:00:00.000Z");
  const posted = post("44444444-4444-4444-8444-444444444444", "pinterest", "2026-10-27T09:00:00.000Z", "posted");
  const input = [second, posted, past, first];
  assert.deepEqual(upcomingManualReminders(input, generatedAt.getTime()).map((item) => item.id), [first.id, second.id]);
  const calendar = buildManualReminderCalendar(input, generatedAt);
  const unfolded = calendar.replace(/\r\n[ \t]/g, "");
  assert.equal((unfolded.match(/BEGIN:VEVENT/g) ?? []).length, 2);
  assert.ok(unfolded.indexOf(first.id) < unfolded.indexOf(second.id));
  assert.match(unfolded, /DTSTART:20261025T093000Z/);
  assert.match(unfolded, /DTEND:20261025T094500Z/);
  assert.match(unfolded, /TRIGGER:-PT5M/);
  assert.match(unfolded, /CLASS:PRIVATE/);
  for (const privateValue of ["Secret draft text", "Private launch name", "Private image description", past.id, posted.id]) {
    assert.ok(!calendar.includes(privateValue), privateValue);
  }
  assert.ok(calendar.endsWith("\r\n"));
  assert.ok(!calendar.replaceAll("\r\n", "").includes("\n"));
  assert.ok(calendar.split("\r\n").every((line) => Buffer.byteLength(line, "utf8") <= 75));
});

test("a changed reminder keeps its event ID but exports the new time", () => {
  const original = post("55555555-5555-4555-8555-555555555555", "bluesky", "2026-10-25T09:30:00.000Z");
  const first = buildManualReminderCalendar([original], generatedAt);
  const moved = buildManualReminderCalendar([{ ...original, scheduledFor: "2026-10-25T11:00:00.000Z" }], generatedAt);
  assert.match(first, /UID:plypost-assisted-55555555-5555-4555-8555-555555555555@plypost.local/);
  assert.match(moved, /UID:plypost-assisted-55555555-5555-4555-8555-555555555555@plypost.local/);
  assert.match(moved, /DTSTART:20261025T110000Z/);
  assert.throws(() => buildManualReminderCalendar([original], new Date("2026-10-26T00:00:00.000Z")), /No future/);
  assert.throws(() => buildManualReminderCalendar([{ ...original, id: "bad\nBEGIN:VEVENT" }], generatedAt), /Invalid reminder ID/);
});
