import { test } from "node:test";
import assert from "node:assert/strict";
import { agendaForMonth, buildPlanAgenda, localAgendaDay, matchesPlanAgendaFilter } from "../src/lib/plan-agenda.ts";

const localInstant = (day, hour) => new Date(2026, 9, day, hour).toISOString();
const scheduled = (id, day, hour, status) => ({
  id, title: id, source: "Text", posts: { bluesky: "Text" }, scheduledFor: localInstant(day, hour),
  createdAt: localInstant(20, 8), status,
});
const manual = (id, day, hour, status) => ({
  id, title: id, destination: "instagram", text: "Text", scheduledFor: localInstant(day, hour),
  createdAt: localInstant(20, 8), status,
});

test("plan agenda interleaves simulation and manual handoff by local scheduled time", () => {
  const items = buildPlanAgenda(
    [scheduled("simulation-later", 22, 16, "queued"), scheduled("simulation-first", 21, 10, "simulated")],
    [manual("manual-middle", 22, 9, "queued"), { ...manual("manual-next-month", 22, 9, "posted"), scheduledFor: new Date(2026, 10, 1, 9).toISOString() }],
  );
  assert.deepEqual(items.map((item) => [item.kind, item.post.id]), [
    ["simulation", "simulation-first"], ["manual", "manual-middle"],
    ["simulation", "simulation-later"], ["manual", "manual-next-month"],
  ]);
  assert.deepEqual(agendaForMonth(items, 2026, 9).map((item) => item.post.id),
    ["simulation-first", "manual-middle", "simulation-later"]);
  assert.equal(localAgendaDay(localInstant(22, 9)), "2026-10-22");
});

test("manual self-reported completion never appears as a simulated receipt", () => {
  const items = buildPlanAgenda(
    [scheduled("queued", 22, 10, "queued"), scheduled("done", 22, 11, "simulated"), scheduled("failed", 22, 12, "failed")],
    [manual("pending", 22, 13, "queued"), manual("self-reported", 22, 14, "posted")],
  );
  const names = (filter) => items.filter((item) => matchesPlanAgendaFilter(item, filter)).map((item) => item.post.id);
  assert.deepEqual(names("manual-pending"), ["pending"]);
  assert.deepEqual(names("manual-posted"), ["self-reported"]);
  assert.deepEqual(names("simulation-queued"), ["queued"]);
  assert.deepEqual(names("simulation-failed"), ["failed"]);
  assert.deepEqual(names("simulation-complete"), ["done"]);
  assert.equal(names("all").length, 5);
});
