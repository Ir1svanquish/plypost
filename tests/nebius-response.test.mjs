import { test } from "node:test";
import assert from "node:assert/strict";
import { readNebiusContent } from "../src/lib/server/ai-provider.ts";

test("Nebius response reader returns the first text choice", async () => {
  const response = globalThis.Response.json({ choices: [{ message: { content: "A short draft." } }] });
  assert.equal(await readNebiusContent(response), "A short draft.");
});

test("Nebius response reader rejects oversized streamed output and cancels it", async () => {
  let cancelled = false;
  const response = new globalThis.Response(new globalThis.ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(130_000));
      controller.enqueue(new Uint8Array(130_000));
    },
    cancel() { cancelled = true; },
  }), { headers: { "Content-Type": "application/json" } });
  assert.equal(await readNebiusContent(response), null);
  assert.equal(cancelled, true);
});

test("Nebius response reader rejects an oversized declared length and malformed JSON", async () => {
  let cancelled = false;
  const declared = new globalThis.Response(new globalThis.ReadableStream({
    cancel() { cancelled = true; },
  }), { headers: { "Content-Length": "256001" } });
  assert.equal(await readNebiusContent(declared), null);
  assert.equal(cancelled, true);
  assert.equal(await readNebiusContent(new globalThis.Response("not json")), null);
});
