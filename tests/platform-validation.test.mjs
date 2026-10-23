import assert from "node:assert/strict";
import test from "node:test";
import { platformTextLength, validatePlatformText } from "../src/lib/platform-validation.ts";

test("Bluesky counts graphemes and independently checks UTF-8 bytes", () => {
  const combined = "a\u0301".repeat(300);
  assert.equal(platformTextLength("bluesky", combined), 300);
  assert.equal(validatePlatformText("bluesky", combined).valid, true);

  const tooMany = validatePlatformText("bluesky", combined + "a");
  assert.equal(tooMany.count, 301);
  assert.deepEqual(tooMany.issues.filter((issue) => issue.severity === "error").map((issue) => issue.code), ["over-character-limit"]);

  const family = "👨‍👩‍👧‍👦".repeat(121);
  const tooManyBytes = validatePlatformText("bluesky", family);
  assert.equal(tooManyBytes.count, 121);
  assert.equal(tooManyBytes.valid, false);
  assert.ok(tooManyBytes.byteCount > 3000);
  assert.ok(tooManyBytes.issues.some((issue) => issue.code === "over-bluesky-byte-limit"));
});

test("empty and over-limit posts are errors; ordinary text stays clear", () => {
  assert.deepEqual(validatePlatformText("linkedin", " \n ").issues.map((issue) => issue.code), ["empty"]);
  assert.equal(validatePlatformText("threads", "x".repeat(501)).valid, false);
  assert.deepEqual(validatePlatformText("threads", "A short update").issues, []);
});

test("Bluesky rich text and LinkedIn mention checks stay advisory", () => {
  const bluesky = validatePlatformText("bluesky", "Hi @friend.bsky.social — https://example.com");
  assert.equal(bluesky.valid, true);
  assert.ok(bluesky.issues.some((issue) => issue.code === "bluesky-rich-text" && issue.severity === "warning"));

  const linkedin = validatePlatformText("linkedin", "Thanks @friend for the help");
  assert.equal(linkedin.valid, true);
  assert.ok(linkedin.issues.some((issue) => issue.code === "linkedin-mention"));
  assert.ok(!validatePlatformText("linkedin", "mail@example.com").issues.some((issue) => issue.code === "linkedin-mention"));
});

test("Mastodon caveats and Threads topic warning are scoped to relevant text", () => {
  const mastodon = validatePlatformText("mastodon", "See www.example.com and https://example.com/very-long-link-for-this-post");
  assert.ok(mastodon.issues.some((issue) => issue.code === "mastodon-url-format"));
  assert.ok(mastodon.issues.some((issue) => issue.code === "mastodon-instance-limit"));
  assert.ok(!validatePlatformText("mastodon", "A short update").issues.some((issue) => issue.code === "mastodon-instance-limit"));
  const longMastodon = validatePlatformText("mastodon", "m".repeat(501));
  assert.equal(longMastodon.valid, true);
  assert.ok(longMastodon.issues.some((issue) => issue.code === "over-character-limit" && issue.severity === "warning"));

  const threads = validatePlatformText("threads", "#design and #product");
  assert.equal(threads.valid, true);
  assert.ok(threads.issues.some((issue) => issue.code === "threads-topic-tag"));
  assert.ok(!validatePlatformText("threads", "#design only").issues.some((issue) => issue.code === "threads-topic-tag"));
});
