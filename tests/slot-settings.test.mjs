import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSlotSettings, slotCandidates, slotMinute } from "../src/lib/slot-settings.ts";

test("weekly slot settings reject invalid zones, duplicate rules and malformed times", () => {
  const valid = { timeZone: "America/New_York", rules: [{ platform: "bluesky", day: 0, time: "09:30" }] };
  assert.deepEqual(parseSlotSettings(valid), valid);
  assert.equal(parseSlotSettings({ ...valid, timeZone: "Nowhere/Fake" }), null);
  assert.equal(parseSlotSettings({ ...valid, rules: [...valid.rules, ...valid.rules] }), null);
  assert.equal(parseSlotSettings({ ...valid, rules: [{ ...valid.rules[0], time: "24:00" }] }), null);
});

test("slot calculation respects the stored time zone across daylight saving changes", () => {
  const settings = { timeZone: "America/New_York", rules: [{ platform: "bluesky", day: 0, time: "09:30" }] };
  const spring = slotCandidates(settings, "bluesky", Date.parse("2026-03-07T00:00:00.000Z"), 10);
  assert.equal(spring[0], "2026-03-08T13:30:00.000Z");
  assert.equal(spring[1], "2026-03-15T13:30:00.000Z");
  const autumn = slotCandidates(settings, "bluesky", Date.parse("2026-10-31T00:00:00.000Z"), 10);
  assert.equal(autumn[0], "2026-11-01T14:30:00.000Z");
  assert.equal(autumn[1], "2026-11-08T14:30:00.000Z");
});

test("nonexistent spring time is skipped and repeated fall time uses its first occurrence", () => {
  const zone = "America/New_York";
  const spring = slotCandidates({ timeZone: zone, rules: [{ platform: "mastodon", day: 0, time: "02:30" }] },
    "mastodon", Date.parse("2026-03-07T00:00:00.000Z"), 10);
  assert.deepEqual(spring, ["2026-03-15T06:30:00.000Z"]);
  const autumn = slotCandidates({ timeZone: zone, rules: [{ platform: "mastodon", day: 0, time: "01:30" }] },
    "mastodon", Date.parse("2026-10-31T00:00:00.000Z"), 10);
  assert.equal(autumn[0], "2026-11-01T05:30:00.000Z");
  assert.equal(autumn.filter((value) => value.startsWith("2026-11-01")).length, 1);
  assert.equal(slotMinute("2026-11-01T05:30:59.000Z"), slotMinute(autumn[0]));
});
