import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGeneratedVariants } from "../src/lib/generated-variants.ts";

const valid = { bluesky: "Short update", mastodon: "A little more context", linkedin: "A professional update", threads: "A conversation starter" };

test("parses four usable drafts and ignores surrounding prose", () => {
  assert.deepEqual(parseGeneratedVariants(`Here are drafts: ${JSON.stringify(valid)}`), { variants: valid, overLimit: [] });
});

test("preserves an over-limit draft for editing and reports the exact platform", () => {
  const parsed = parseGeneratedVariants(JSON.stringify({ ...valid, bluesky: "a".repeat(301) }));
  assert.deepEqual(parsed?.overLimit, [{ platform: "bluesky", count: 301, limit: 300 }]);
  assert.equal(parsed?.variants.bluesky.length, 301);
});

test("rejects missing, empty, and unreasonably long model output", () => {
  assert.equal(parseGeneratedVariants(JSON.stringify({ ...valid, threads: "" })), null);
  assert.equal(parseGeneratedVariants(JSON.stringify({ ...valid, mastodon: "m".repeat(5001) })), null);
  assert.equal(parseGeneratedVariants("not JSON"), null);
});
