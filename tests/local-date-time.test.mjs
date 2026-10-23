import test from "node:test";
import assert from "node:assert/strict";
import { isValidLocalDateTime } from "../src/components/local-date-time-field.tsx";

test("local scheduling rejects impossible, incomplete and past times", () => {
  assert.equal(isValidLocalDateTime("2099-02-28T14:30", Date.now()), true);
  assert.equal(isValidLocalDateTime("2099-02-30T14:30", Date.now()), false);
  assert.equal(isValidLocalDateTime("2099-02-28T", Date.now()), false);
  assert.equal(isValidLocalDateTime("2099-02-28T25:30", Date.now()), false);
  assert.equal(isValidLocalDateTime("2001-01-01T09:00", Date.now()), false);
});
