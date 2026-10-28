import assert from "node:assert/strict";
import test from "node:test";
import { compareAiLiterals } from "../src/lib/ai-literal-check.ts";

test("flags changed numbers, weekdays and time markers before using an AI draft", () => {
  const result = compareAiLiterals(
    "Workshop Saturday at 2 p.m. Bring 3 notebooks.",
    "Workshop Sunday at 3 a.m. Bring 4 notebooks.",
  );
  assert.deepEqual(result.missing, ["Saturday", "p.m.", "2"]);
  assert.deepEqual(result.added, ["Sunday", "a.m.", "4"]);
});

test("accepts harmless formatting of the same details", () => {
  assert.deepEqual(compareAiLiterals(
    "Sat at 02 p.m. Tickets: 1,000. See https://example.com/event.",
    "Saturday at 2pm. Tickets: 1000. See https://example.com/event!",
  ), { missing: [], added: [] });
  assert.deepEqual(compareAiLiterals("周一下午2点", "星期一2pm"), { missing: [], added: [] });
  assert.deepEqual(compareAiLiterals("Starts at 2 p.m.; doors open at 1:30.", "Starts at 2:00 p.m.; doors open at 01:30."), {
    missing: [], added: [],
  });
  assert.deepEqual(compareAiLiterals("Doors open at 1:30.", "Doors open at 1:45."), {
    missing: ["1:30"], added: ["1:45"],
  });
});

test("checks links, addresses and tags without treating digits inside them as separate facts", () => {
  const result = compareAiLiterals(
    "Visit https://example.com/v2 and write to team2@example.com. Tag @Host_2 #Meetup.",
    "Visit https://example.com/v3 and write to team2@example.com. Tag @Host_3 #Meetup.",
  );
  assert.deepEqual(result.missing, ["https://example.com/v2", "@Host_2"]);
  assert.deepEqual(result.added, ["https://example.com/v3", "@Host_3"]);
  assert.deepEqual(compareAiLiterals("See www.example.com/a1", "See www.example.com/a2"), {
    missing: ["www.example.com/a1"], added: ["www.example.com/a2"],
  });
});

test("wording changes alone do not pretend to be a factual check", () => {
  assert.deepEqual(compareAiLiterals("A useful lesson today.", "An amazing lesson today."), {
    missing: [], added: [],
  });
});
