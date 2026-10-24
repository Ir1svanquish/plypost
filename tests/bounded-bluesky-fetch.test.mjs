import { test } from "node:test";
import assert from "node:assert/strict";
import { NodeOAuthClient } from "@atproto/oauth-client-node";
import { limitBlueskyResponseBytes, MAX_BLUESKY_RESPONSE_BYTES } from "../src/lib/server/bounded-bluesky-fetch.ts";

test("small OAuth responses keep status, headers and final URL", async () => {
  const url = "data:application/json,%7B%22ok%22%3Atrue%7D";
  const bounded = limitBlueskyResponseBytes(globalThis.fetch, 1024);
  const response = await bounded(url);
  assert.equal(response.status, 200);
  assert.equal(response.url, url);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.deepEqual(await response.json(), { ok: true });
});

test("declared oversized responses are rejected before schema parsing", async () => {
  const bounded = limitBlueskyResponseBytes(async () => new globalThis.Response("{}", {
    headers: { "content-type": "application/json", "content-length": String(MAX_BLUESKY_RESPONSE_BYTES + 1) },
  }));
  await assert.rejects(bounded("https://example.test/oauth/metadata"), /exceeded the allowed size/);
});

test("streamed oversized responses are rejected even when length is missing or false", async () => {
  for (const headers of [{}, { "content-length": "1" }]) {
    const bounded = limitBlueskyResponseBytes(async () => new globalThis.Response(new globalThis.ReadableStream({
      start(controller) {
        controller.enqueue(new globalThis.TextEncoder().encode('{"data":"'));
        controller.enqueue(new globalThis.TextEncoder().encode("x".repeat(300)));
        controller.enqueue(new globalThis.TextEncoder().encode('"}'));
        controller.close();
      },
    }), { headers }), 128);
    const response = await bounded("https://example.test/oauth/metadata");
    await assert.rejects(response.json(), /exceeded the allowed size/);
  }
});

test("the official OAuth metadata parser receives the bounded response", async () => {
  const bounded = limitBlueskyResponseBytes(async () => new globalThis.Response(JSON.stringify({
    redirect_uris: Array.from({ length: 500 }, () => "https://example.test/redirect"),
  }), { headers: { "content-type": "application/json" } }), 128);
  await assert.rejects(NodeOAuthClient.fetchMetadata({
    clientId: "https://example.test/client-metadata.json", fetch: bounded,
  }), /exceeded the allowed size/);
});

test("empty responses pass through and invalid limits fail closed", async () => {
  const original = new globalThis.Response(null, { status: 204 });
  const bounded = limitBlueskyResponseBytes(async () => original);
  assert.equal(await bounded("https://example.test/empty"), original);
  assert.throws(() => limitBlueskyResponseBytes(globalThis.fetch, 0), /Invalid Bluesky response limit/);
});
