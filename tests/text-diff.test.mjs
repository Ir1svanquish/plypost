import { test } from "node:test";
import assert from "node:assert/strict";
import { compareText } from "../src/lib/text-diff.ts";

test("marks separate word changes while preserving the full drafts", () => {
  const before = "Post today. Share a short update tomorrow.";
  const after = "Post now. Share a clear update tomorrow.";
  const result = compareText(before, after);
  assert.equal(result.changed, true);
  assert.equal(result.before.map((part) => part.text).join(""), before);
  assert.equal(result.after.map((part) => part.text).join(""), after);
  assert.equal(result.before.filter((part) => part.changed).map((part) => part.text).join(""), "todayshort");
  assert.equal(result.after.filter((part) => part.changed).map((part) => part.text).join(""), "nowclear");
  assert.ok(result.after.some((part) => !part.changed && part.text.includes("Share a ")));
});

test("handles unchanged drafts and Chinese edits", () => {
  assert.deepEqual(compareText("同一篇文案", "同一篇文案"), {
    changed: false,
    before: [{ text: "同一篇文案", changed: false }],
    after: [{ text: "同一篇文案", changed: false }],
  });
  const result = compareText("今天发帖，明天复盘。", "今天发帖，周五复盘。");
  assert.equal(result.after.map((part) => part.text).join(""), "今天发帖，周五复盘。");
  assert.ok(result.after.some((part) => part.changed && part.text.includes("周五")));
});

test("bounds work for long drafts while keeping the exact text", () => {
  const before = `${"word ".repeat(450)}old ending`;
  const after = `${"word ".repeat(450)}new ending`;
  const result = compareText(before, after);
  assert.equal(result.changed, true);
  assert.equal(result.before.map((part) => part.text).join(""), before);
  assert.equal(result.after.map((part) => part.text).join(""), after);
  assert.ok(result.after.some((part) => part.changed && part.text.includes("new")));
});
