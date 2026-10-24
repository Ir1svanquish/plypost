import type { AssistedPost, ScheduledPost } from "./workspace.ts";

export type RealMastodonSchedule = {
  clientRequestId: string;
  status: "queued" | "inflight" | "posted" | "unknown" | "rejected" | "cancelled";
  text: string;
  scheduledFor: string;
  createdAt: string;
  instance: string;
  account: { id: string; username: string; url: string };
  postUrl?: string;
  id?: string;
  error?: string;
  resolution?: "found" | "absent";
  resolvedAt?: string;
};

export type PlanAgendaItem =
  | { kind: "simulation"; post: ScheduledPost; scheduledFor: string }
  | { kind: "manual"; post: AssistedPost; scheduledFor: string }
  | { kind: "real-mastodon"; post: RealMastodonSchedule; scheduledFor: string };

export type PlanAgendaFilter =
  | "all"
  | "manual-pending"
  | "manual-posted"
  | "simulation-queued"
  | "simulation-running"
  | "simulation-failed"
  | "simulation-complete"
  | "real-all"
  | "real-queued"
  | "real-inflight"
  | "real-posted"
  | "real-unknown"
  | "real-rejected"
  | "real-cancelled";

export function buildPlanAgenda(schedule: readonly ScheduledPost[], assisted: readonly AssistedPost[], realMastodon: readonly RealMastodonSchedule[] = []): PlanAgendaItem[] {
  return [
    ...schedule.map((post): PlanAgendaItem => ({ kind: "simulation", post, scheduledFor: post.scheduledFor })),
    ...assisted.map((post): PlanAgendaItem => ({ kind: "manual", post, scheduledFor: post.scheduledFor })),
    ...realMastodon.map((post): PlanAgendaItem => ({ kind: "real-mastodon", post, scheduledFor: post.scheduledFor })),
  ].sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor));
}

export function matchesPlanAgendaFilter(item: PlanAgendaItem, filter: PlanAgendaFilter): boolean {
  if (filter === "all") return true;
  if (item.kind === "manual") return filter === (item.post.status === "posted" ? "manual-posted" : "manual-pending");
  if (item.kind === "real-mastodon") return filter === "real-all" || filter === `real-${item.post.status}`;
  return filter === (item.post.status === "simulated" ? "simulation-complete" : `simulation-${item.post.status}`);
}

export function realMastodonNeedsAttention(post: RealMastodonSchedule, now: number): boolean {
  if (post.status === "unknown") return !post.resolution;
  if (post.status === "rejected") return true;
  return post.status === "queued" && Date.parse(post.scheduledFor) <= now;
}

export function localAgendaDay(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function agendaForMonth(items: readonly PlanAgendaItem[], year: number, monthIndex: number): PlanAgendaItem[] {
  return items.filter((item) => {
    const date = new Date(item.scheduledFor);
    return date.getFullYear() === year && date.getMonth() === monthIndex;
  });
}
