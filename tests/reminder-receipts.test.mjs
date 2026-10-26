import { test } from "node:test";
import assert from "node:assert/strict";
import { ShownReminderReceipts } from "../src/lib/reminder-receipts.ts";

test("a failed reminder receipt remains queued for retry without showing another notification", async () => {
  const receipts = new ShownReminderReceipts();
  receipts.markShown(["reminder-a"]);
  const sent = [];
  assert.equal(await receipts.flush(async (ids) => { sent.push(ids); throw new Error("offline"); }), "failed");
  assert.equal(receipts.has("reminder-a"), true);
  assert.equal(await receipts.flush(async (ids) => { sent.push(ids); }), "saved");
  assert.equal(receipts.has("reminder-a"), false);
  assert.deepEqual(sent, [["reminder-a"], ["reminder-a"]]);
});

test("a second flush does not duplicate an in-flight reminder receipt", async () => {
  const receipts = new ShownReminderReceipts();
  receipts.markShown(["reminder-a"]);
  let finish;
  const first = receipts.flush(() => new Promise((resolve) => { finish = resolve; }));
  assert.equal(await receipts.flush(() => { throw new Error("duplicate request"); }), "busy");
  finish();
  assert.equal(await first, "saved");
});

test("a newly shown reminder survives an older receipt response", async () => {
  const receipts = new ShownReminderReceipts();
  receipts.markShown(["reminder-a"]);
  let finish;
  const oldReceipt = receipts.flush(() => new Promise((resolve) => { finish = resolve; }));
  receipts.remove("reminder-a");
  receipts.markShown(["reminder-a"]);
  finish();
  assert.equal(await oldReceipt, "saved");
  assert.equal(receipts.has("reminder-a"), true);
});
