import { test } from "node:test";
import assert from "node:assert/strict";
import { agendaForMonth, buildPlanAgenda, localAgendaDay, matchesPlanAgendaFilter, realMastodonNeedsAttention } from "../src/lib/plan-agenda.ts";

const localInstant = (day, hour) => new Date(2026, 9, day, hour).toISOString();
const scheduled = (id, day, hour, status) => ({
  id, title: id, source: "Text", posts: { bluesky: "Text" }, scheduledFor: localInstant(day, hour),
  createdAt: localInstant(20, 8), status,
});
const manual = (id, day, hour, status) => ({
  id, title: id, destination: "instagram", text: "Text", scheduledFor: localInstant(day, hour),
  createdAt: localInstant(20, 8), status,
});
const real = (id, day, hour, status, resolution) => ({
  clientRequestId: id, text: `Real ${id}`, scheduledFor: localInstant(day, hour),
  createdAt: localInstant(20, 8), instance: "https://example.social",
  account: { id: "owner", username: "@owner@example.social", url: "https://example.social/@owner" },
  status, ...(resolution ? { resolution } : {}),
});

test("dated drafts appear on their local target day without becoming reminders", () => {
  const draft = { id: "idea", title: "An idea", source: "Work in progress", selected: [], variants: {},
    plannedDate: "2026-10-22", createdAt: localInstant(20, 8), updatedAt: localInstant(20, 8) };
  const undated = { ...draft, id: "undated", plannedDate: undefined };
  const items = buildPlanAgenda([], [manual("handoff", 22, 15, "queued")], [], [draft, undated]);
  assert.deepEqual(items.map((item) => item.kind), ["draft", "manual"]);
  assert.equal(localAgendaDay(items[0].scheduledFor), "2026-10-22");
  assert.deepEqual(items.filter((item) => matchesPlanAgendaFilter(item, "draft-target")).map((item) => item.post.id), ["idea"]);
  assert.deepEqual(items.filter((item) => matchesPlanAgendaFilter(item, "manual-pending")).map((item) => item.post.id), ["handoff"]);
  assert.equal(agendaForMonth(items, 2026, 9).length, 2);
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

test("unscheduled checklist handoffs stay off the dated publishing calendar", () => {
  const dated = manual("with-reminder", 22, 13, "queued");
  const checklist = { ...manual("no-reminder", 22, 14, "queued"), reminderEnabled: false };
  const items = buildPlanAgenda([], [dated, checklist]);
  assert.deepEqual(items.map((item) => item.post.id), ["with-reminder"]);
});

test("real Mastodon statuses interleave by date and stay separate from simulated and manual filters", () => {
  const statuses = ["queued", "inflight", "posted", "unknown", "rejected", "cancelled"];
  const realPosts = statuses.map((status, index) => real(status, 21, 9 + index, status));
  const items = buildPlanAgenda(
    [scheduled("simulation", 21, 12, "simulated")],
    [manual("manual", 21, 8, "queued")],
    realPosts,
  );
  assert.deepEqual(items.map((item) => item.kind), [
    "manual", "real-mastodon", "real-mastodon", "real-mastodon", "simulation",
    "real-mastodon", "real-mastodon", "real-mastodon",
  ]);
  assert.deepEqual(items.filter((item) => matchesPlanAgendaFilter(item, "real-all")).map((item) => item.post.clientRequestId), statuses);
  for (const status of statuses) {
    assert.deepEqual(items.filter((item) => matchesPlanAgendaFilter(item, `real-${status}`)).map((item) => item.post.clientRequestId), [status]);
  }
  assert.deepEqual(items.filter((item) => matchesPlanAgendaFilter(item, "simulation-complete")).map((item) => item.post.id), ["simulation"]);
  assert.deepEqual(items.filter((item) => matchesPlanAgendaFilter(item, "manual-pending")).map((item) => item.post.id), ["manual"]);
  assert.equal(agendaForMonth(items, 2026, 9).length, 8);
});

test("real attention includes unresolved unknown, rejected and overdue queued without treating a checked result as verified", () => {
  const now = new Date(2026, 9, 22, 10).getTime();
  assert.equal(realMastodonNeedsAttention(real("unknown", 21, 9, "unknown"), now), true);
  assert.equal(realMastodonNeedsAttention(real("found", 21, 9, "unknown", "found"), now), false);
  assert.equal(realMastodonNeedsAttention(real("absent", 21, 9, "unknown", "absent"), now), false);
  assert.equal(realMastodonNeedsAttention(real("rejected", 21, 9, "rejected"), now), true);
  assert.equal(realMastodonNeedsAttention(real("overdue", 22, 9, "queued"), now), true);
  assert.equal(realMastodonNeedsAttention(real("upcoming", 22, 11, "queued"), now), false);
  assert.equal(realMastodonNeedsAttention(real("posted", 21, 9, "posted"), now), false);
  assert.equal(realMastodonNeedsAttention(real("inflight", 21, 9, "inflight"), now), false);
  assert.equal(realMastodonNeedsAttention(real("cancelled", 21, 9, "cancelled"), now), false);
});
