import { test } from "node:test";
import assert from "node:assert/strict";
import { accountFetch } from "../src/lib/account-fetch.ts";
import { readOwnerEditorCache, writeOwnerEditorCache } from "../src/lib/editor-cache.ts";

test("workspace requests carry displayed identity; external requests never receive it", async () => {
  const calls = [];
  const scoped = accountFetch(async (input, init) => { calls.push({ input, init }); return new globalThis.Response(); }, "alice@test.test", "https://plypost.test");
  await scoped("/api/workspace", { method: "POST", headers: { "content-type": "application/json" } });
  assert.equal(calls[0].init.headers.get("x-plypost-account"), "alice@test.test");
  assert.equal(calls[0].init.headers.get("content-type"), "application/json");
  await scoped("https://external.test/api/data");
  assert.equal(calls[1].init, undefined);
});

test("new accounts cannot claim or delete an old unowned browser draft", () => {
  const items = new Map([["socialflow-mvp", "private old draft"]]);
  const storage = { get length() { return items.size; }, key: (i) => [...items.keys()][i], getItem: (k) => items.get(k) ?? null, setItem: (k,v) => items.set(k,v), removeItem: (k) => items.delete(k) };
  assert.equal(readOwnerEditorCache(storage, "new@test.test", "tab", false), null);
  writeOwnerEditorCache(storage, "new@test.test", "tab", "new draft", false);
  assert.equal(items.get("socialflow-mvp"), "private old draft");
});
