"use client";

import { useState, type FormEvent } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, RotateCcw, Trash2 } from "lucide-react";
import { assistedState, localDateTimeValue, scheduleState, type AssistedPost, type ScheduledPost } from "@/lib/workspace";
import { platformDisplayIds, platforms } from "@/lib/platforms";
import { agendaForMonth, buildPlanAgenda, localAgendaDay, matchesPlanAgendaFilter, realMastodonNeedsAttention, type PlanAgendaFilter, type PlanAgendaItem, type RealMastodonSchedule } from "@/lib/plan-agenda";
import { assistedDestinations } from "@/lib/assisted";
import { formatLocalDateTime, isValidLocalDateTime, LocalDateTimeField } from "@/components/local-date-time-field";
import { MediaHandoff } from "@/components/media-handoff";

type Props = {
  schedule: ScheduledPost[]; assisted: AssistedPost[]; realMastodon: RealMastodonSchedule[]; showRealMastodon: boolean; realQueueError: string | null; value: string; now: number; canSchedule: boolean;
  runningId: string | null; onValueChange: (value: string) => void; onAdd: () => void;
  onLoad: (post: ScheduledPost) => void; onRun: (post: ScheduledPost) => void; onRemove: (id: string) => void;
  onReschedule: (post: ScheduledPost, scheduledForIso: string) => Promise<void>;
  onRescheduleAssisted: (post: AssistedPost, scheduledForIso: string) => Promise<void>;
  onOpenAssisted: (item: AssistedPost) => void;
  onOpenRealMastodon: (item: RealMastodonSchedule) => void;
  onPrepareManual: (localTime: string) => void;
};

type Month = { year: number; index: number };
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const filters: { value: PlanAgendaFilter; label: string }[] = [
  { value: "all", label: "All activity" },
  { value: "manual-pending", label: "Manual · pending" },
  { value: "manual-posted", label: "Manual · marked posted" },
  { value: "simulation-queued", label: "Simulation · queued" },
  { value: "simulation-running", label: "Simulation · running" },
  { value: "simulation-failed", label: "Simulation · needs attention" },
  { value: "simulation-complete", label: "Simulation · complete" },
  { value: "real-all", label: "Real Mastodon · all" },
  { value: "real-queued", label: "Real Mastodon · queued" },
  { value: "real-inflight", label: "Real Mastodon · publishing" },
  { value: "real-posted", label: "Real Mastodon · posted" },
  { value: "real-unknown", label: "Real Mastodon · unknown" },
  { value: "real-rejected", label: "Real Mastodon · rejected" },
  { value: "real-cancelled", label: "Real Mastodon · cancelled" },
];

function monthLabel(month: Month): string {
  return new Date(month.year, month.index, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function realStatusLabel(post: RealMastodonSchedule, now: number): string {
  switch (post.status) {
    case "queued": return Date.parse(post.scheduledFor) <= now ? "Real Mastodon · due, waiting for worker" : "Real Mastodon · queued";
    case "inflight": return "Real Mastodon · publishing";
    case "posted": return "Real Mastodon · posted, platform confirmed";
    case "unknown": return post.resolution === "found" ? "Real Mastodon · you marked found, unverified" : post.resolution === "absent" ? "Real Mastodon · you marked absent, unverified" : "Real Mastodon · result unknown, check account";
    case "rejected": return "Real Mastodon · rejected, not posted";
    case "cancelled": return "Real Mastodon · cancelled";
  }
}

function attentionPriority(item: PlanAgendaItem): number {
  if (item.kind === "real-mastodon") return item.post.status === "unknown" ? 0 : item.post.status === "rejected" ? 1 : 4;
  if (item.kind === "manual") return 3;
  return item.post.status === "failed" ? 2 : 5;
}

function nextManualTimeOnDay(day: string, now: number): string | null {
  const morning = new Date(`${day}T09:00`);
  if (!Number.isFinite(morning.getTime()) || localAgendaDay(morning) !== day) return null;
  if (morning.getTime() > now + 60_000) return localDateTimeValue(morning);
  const nextQuarter = new Date(Math.ceil((now + 15 * 60_000) / (15 * 60_000)) * 15 * 60_000);
  return localAgendaDay(nextQuarter) === day ? localDateTimeValue(nextQuarter) : null;
}

export function ServerSchedulePanel({ schedule, assisted, realMastodon, showRealMastodon, realQueueError, value, now, canSchedule, runningId, onValueChange, onAdd, onLoad, onRun, onRemove, onReschedule, onRescheduleAssisted, onOpenAssisted, onOpenRealMastodon, onPrepareManual }: Props) {
  const [month, setMonth] = useState<Month>(() => {
    const today = new Date(now || Date.now());
    return { year: today.getFullYear(), index: today.getMonth() };
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showAllDates, setShowAllDates] = useState(false);
  const [showAllAttention, setShowAllAttention] = useState(false);
  const [filter, setFilter] = useState<PlanAgendaFilter>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editError, setEditError] = useState("");
  const [saving, setSaving] = useState(false);
  const queuedCount = schedule.filter((post) => post.status === "queued").length;
  const manualPendingCount = assisted.filter((post) => post.status === "queued").length;
  const realQueuedCount = realMastodon.filter((post) => post.status === "queued").length;
  const hasRealMastodon = showRealMastodon || realMastodon.length > 0;
  const visibleFilters = hasRealMastodon ? filters : filters.filter((option) => !option.value.startsWith("real-"));
  const effectiveFilter = !hasRealMastodon && filter.startsWith("real-") ? "all" : filter;
  const allItems = buildPlanAgenda(schedule, assisted, realMastodon);
  const attentionItems = allItems.filter((item) => {
    if (item.kind === "real-mastodon") return realMastodonNeedsAttention(item.post, now);
    if (item.kind === "manual") return assistedState(item.post, now) === "due";
    const state = scheduleState(item.post, now);
    return state === "failed" || state === "due";
  }).sort((left, right) => attentionPriority(left) - attentionPriority(right) || Date.parse(left.scheduledFor) - Date.parse(right.scheduledFor));
  const visibleAttention = showAllAttention ? attentionItems : attentionItems.slice(0, 4);
  const readyManualCount = attentionItems.filter((item) => item.kind === "manual").length;
  const failedSimulationCount = attentionItems.filter((item) => item.kind === "simulation" && item.post.status === "failed").length;
  const realAttentionCount = attentionItems.filter((item) => item.kind === "real-mastodon").length;
  const waitingSimulationCount = attentionItems.length - readyManualCount - failedSimulationCount - realAttentionCount;
  const filtered = allItems.filter((item) => matchesPlanAgendaFilter(item, effectiveFilter));
  const monthItems = agendaForMonth(filtered, month.year, month.index);
  const agenda = showAllDates ? filtered : monthItems.filter((item) => !selectedDay || localAgendaDay(item.scheduledFor) === selectedDay);
  const today = new Date(now || Date.now());
  const todayKey = localAgendaDay(today);
  const selectedManualTime = selectedDay && !showAllDates ? nextManualTimeOnDay(selectedDay, now) : null;
  const firstWeekday = (new Date(month.year, month.index, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(month.year, month.index + 1, 0).getDate();
  const cells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const dayCounts = new Map<string, { simulation: number; manual: number; real: number; simulationFailed: boolean; manualDue: boolean; realAttention: boolean }>();
  for (const item of monthItems) {
    const key = localAgendaDay(item.scheduledFor);
    const count = dayCounts.get(key) ?? { simulation: 0, manual: 0, real: 0, simulationFailed: false, manualDue: false, realAttention: false };
    if (item.kind === "simulation") {
      count.simulation += 1;
      count.simulationFailed ||= item.post.status === "failed";
    } else if (item.kind === "manual") {
      count.manual += 1;
      count.manualDue ||= item.post.status === "queued" && Date.parse(item.scheduledFor) <= now;
    } else {
      count.real += 1;
      count.realAttention ||= realMastodonNeedsAttention(item.post, now);
    }
    dayCounts.set(key, count);
  }

  function changeMonth(offset: number) {
    setMonth((current) => {
      const next = new Date(current.year, current.index + offset, 1);
      return { year: next.getFullYear(), index: next.getMonth() };
    });
    setSelectedDay(null);
    setShowAllDates(false);
  }

  function beginReschedule(post: ScheduledPost) {
    setEditingId(post.id);
    setEditValue(localDateTimeValue(new Date(post.scheduledFor)));
    setEditError("");
  }

  function beginManualReschedule(post: AssistedPost) {
    setEditingId(`manual:${post.id}`);
    setEditValue(localDateTimeValue(new Date(post.scheduledFor)));
    setEditError("");
  }

  async function saveReschedule(event: FormEvent<HTMLFormElement>, post: ScheduledPost) {
    event.preventDefault();
    if (!isValidLocalDateTime(editValue, Date.now() + 10_000)) {
      setEditError("Choose a local date and time at least 10 seconds from now.");
      return;
    }
    setSaving(true);
    setEditError("");
    try {
      await onReschedule(post, new Date(editValue).toISOString());
      setEditingId(null);
    } catch (cause) {
      setEditError(cause instanceof Error ? cause.message : "Could not move this item. Please try again.");
    } finally {
      setSaving(false);
    }
  }
  async function saveManualReschedule(event: FormEvent<HTMLFormElement>, post: AssistedPost) {
    event.preventDefault();
    if (!isValidLocalDateTime(editValue, Date.now() + 10_000)) {
      setEditError("Choose a local date and time at least 10 seconds from now.");
      return;
    }
    setSaving(true);
    setEditError("");
    try {
      const next = new Date(editValue);
      await onRescheduleAssisted(post, next.toISOString());
      setEditingId(null);
      setMonth({ year: next.getFullYear(), index: next.getMonth() });
      setSelectedDay(localAgendaDay(next));
      setShowAllDates(false);
    } catch (cause) {
      setEditError(cause instanceof Error ? cause.message : "Could not move this reminder. Please try again.");
    } finally {
      setSaving(false);
    }
  }
  return <section id="schedule" className="section-anchor panel-border soft-shadow mt-8 overflow-hidden rounded-[18px] bg-[var(--surface)]" aria-labelledby="schedule-heading">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] px-6 py-5 sm:px-7">
      <div><h2 id="schedule-heading" className="text-[17px] font-bold">Publishing plan</h2><p className="mt-1 text-[13px] text-[var(--text-muted)]">{hasRealMastodon ? "See real Mastodon posts, simulated jobs and manual reminders in one calendar." : "See simulated jobs and manual reminders in one calendar."}</p></div>
      <div className="flex flex-wrap gap-2">{hasRealMastodon && <span className="rounded-full bg-[var(--positive-soft)] px-2.5 py-1 text-[12px] font-semibold text-[var(--positive)]">{realQueuedCount} real Mastodon queued</span>}<span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[12px] font-semibold text-[var(--accent-text)]">{queuedCount} simulated queued</span><span className="rounded-full bg-[var(--warning-soft)] px-2.5 py-1 text-[12px] font-semibold text-[var(--warning)]">{manualPendingCount} manual pending</span></div>
    </div>
    <div className="p-6 sm:p-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1"><LocalDateTimeField id="schedule-time" label="Simulation time" value={value} minTimestamp={now + 10_000} onChange={onValueChange} /></div>
        <button type="button" onClick={onAdd} disabled={!canSchedule || !isValidLocalDateTime(value, now + 10_000)} className="gradient-button inline-flex h-[43px] items-center justify-center gap-2 rounded-xl px-4 text-[13px] font-bold text-white disabled:opacity-50 sm:mb-[22px]"><CalendarClock size={15} /> Add simulation</button>
      </div>
      <p className="mt-3 text-[12px] leading-5 text-[var(--text-soft)]">{hasRealMastodon ? <>Only individually confirmed real Mastodon items can reach a social platform. Simulation and manual items never post through the worker. Keep <code>npm run worker</code> running on this computer for due real and simulated tasks.</> : <>Simulations create demo receipts only. Keep <code>npm run worker</code> running on this computer to process due simulations. Manual handoffs are published by you on the platform.</>}</p>
      {hasRealMastodon && realQueueError && <p role="alert" className="mt-3 rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-[12px] leading-5 text-[var(--warning)]">The real Mastodon queue could not refresh. Its calendar counts and statuses may be out of date. Use Refresh status in Mastodon auto-publish below.</p>}
    </div>
    {attentionItems.length > 0 && <div className="border-t border-[var(--line)] bg-[var(--surface-muted)] px-6 py-5 sm:px-7" aria-labelledby="plan-attention-heading">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h3 id="plan-attention-heading" className="text-[15px] font-bold text-[var(--text)]">Needs attention</h3><p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">Across all dates · {hasRealMastodon && <>{realAttentionCount} real Mastodon, </>}{readyManualCount} manual ready, {failedSimulationCount} simulation failed{waitingSimulationCount ? `, ${waitingSimulationCount} simulation waiting for worker` : ""}.</p></div>
        <span className="rounded-full bg-[var(--warning-soft)] px-2.5 py-1 text-[11px] font-bold text-[var(--warning)]">{attentionItems.length} to review</span>
      </div>
      <div className="mt-4 divide-y divide-[var(--line)] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]">
        {visibleAttention.map((item) => {
          if (item.kind === "real-mastodon") return <div key={`attention-real-${item.post.clientRequestId}`} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0"><p className="line-clamp-2 break-words text-[12px] font-bold text-[var(--text-secondary)]">{item.post.text}</p><p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{item.post.account.username} · {formatLocalDateTime(item.post.scheduledFor)} · {realStatusLabel(item.post, now)}</p>{item.post.status === "unknown" && <p className="mt-1 text-[11px] text-[var(--warning)]">Check the connected account before attempting the same post again. Plypost will not retry it automatically.</p>}</div>
            <button type="button" onClick={() => onOpenRealMastodon(item.post)} className="self-start shrink-0 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-1.5 text-[12px] font-bold text-[var(--accent-text)]">Review real queue</button>
          </div>;
          if (item.kind === "manual") return <div key={`attention-manual-${item.post.id}`} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0"><p className="break-words text-[12px] font-bold text-[var(--text-secondary)]">{item.post.title}</p><p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{assistedDestinations[item.post.destination].name} · {formatLocalDateTime(item.post.scheduledFor)} · manual posting due</p></div>
            <button type="button" onClick={() => onOpenAssisted(item.post)} className="self-start shrink-0 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-1.5 text-[12px] font-bold text-[var(--accent-text)]">Open handoff</button>
          </div>;
          const failed = item.post.status === "failed";
          return <div key={`attention-simulation-${item.post.id}`} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0"><p className="break-words text-[12px] font-bold text-[var(--text-secondary)]">{item.post.title}</p><p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{formatLocalDateTime(item.post.scheduledFor)} · {failed ? "simulation failed" : "simulation due, waiting for worker"} · no platform post</p></div>
            <div className="flex shrink-0 gap-2"><button type="button" onClick={() => onLoad(item.post)} className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-[12px] font-semibold text-[var(--text-secondary)]">Open</button>{failed && <button type="button" onClick={() => onRun(item.post)} disabled={runningId !== null} className="rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-1.5 text-[12px] font-bold text-[var(--accent-text)] disabled:opacity-45">Retry simulation</button>}</div>
          </div>;
        })}
      </div>
      {attentionItems.length > 4 && <button type="button" onClick={() => setShowAllAttention((current) => !current)} aria-expanded={showAllAttention} className="mt-3 text-[12px] font-semibold text-[var(--accent-text)] underline underline-offset-2">{showAllAttention ? "Show fewer" : `Show all ${attentionItems.length} items`}</button>}
    </div>}
    <div className="border-t border-[var(--line)] px-4 py-5 sm:px-7 sm:py-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><h3 className="text-[15px] font-bold text-[var(--text)]">Calendar</h3><p className="mt-1 text-[12px] text-[var(--text-muted)]">Your local time · select a day to inspect its items. {hasRealMastodon && "R = real Mastodon, "}S = simulation, M = manual handoff.</p></div>
        <label htmlFor="schedule-status-filter" className="flex items-center gap-2 text-[12px] font-semibold text-[var(--text-secondary)]">Status
          <select id="schedule-status-filter" value={effectiveFilter} onChange={(event) => setFilter(event.target.value as PlanAgendaFilter)} aria-label="Filter planned items by status and publishing method" className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[12px] text-[var(--text)] sm:flex-none">
            {visibleFilters.map((option) => <option key={option.value} value={option.value}>{option.label} ({allItems.filter((item) => matchesPlanAgendaFilter(item, option.value)).length})</option>)}
          </select>
        </label>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1" role="group" aria-label="Calendar month navigation">
          <button type="button" onClick={() => changeMonth(-1)} aria-label="Previous month" className="rounded-lg p-2 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"><ChevronLeft size={17} /></button>
          <span aria-live="polite" className="min-w-32 text-center text-[14px] font-bold text-[var(--text)]">{monthLabel(month)}</span>
          <button type="button" onClick={() => changeMonth(1)} aria-label="Next month" className="rounded-lg p-2 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"><ChevronRight size={17} /></button>
        </div>
        <button type="button" onClick={() => { setMonth({ year: today.getFullYear(), index: today.getMonth() }); setSelectedDay(todayKey); setShowAllDates(false); }} className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-[12px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">Today</button>
      </div>
      <div className="mt-3 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--line)]">
        <div className="grid grid-cols-7 gap-px text-center">
          {weekdays.map((day) => <div key={day} className="bg-[var(--surface-muted)] py-2 text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] sm:text-[11px]">{day}</div>)}
          {Array.from({ length: cells }, (_, index) => {
            const dayNumber = index - firstWeekday + 1;
            if (dayNumber < 1 || dayNumber > daysInMonth) return <div key={`blank-${index}`} aria-hidden="true" className="min-h-14 bg-[var(--surface-muted)] sm:min-h-20" />;
            const date = new Date(month.year, month.index, dayNumber);
            const key = localAgendaDay(date);
            const summary = dayCounts.get(key);
            const dateLabel = date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
            return <button key={key} type="button" onClick={() => { setSelectedDay(key); setShowAllDates(false); }} aria-label={`${dateLabel}, ${hasRealMastodon ? `${summary?.real ?? 0} real Mastodon, ` : ""}${summary?.simulation ?? 0} simulated, ${summary?.manual ?? 0} manual${summary?.realAttention ? ", real Mastodon needs attention" : ""}${summary?.simulationFailed ? ", simulation needs attention" : ""}${summary?.manualDue ? ", manual publishing due" : ""}`} aria-pressed={!showAllDates && selectedDay === key} className={`flex min-h-14 flex-col items-center gap-1 px-0.5 py-2 text-center sm:min-h-20 sm:items-start sm:px-2.5 ${!showAllDates && selectedDay === key ? "bg-[var(--accent-soft)] text-[var(--accent-text)] hover:bg-[var(--accent-soft)]" : "bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"}`}>
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${key === todayKey ? "bg-[var(--accent)] text-white" : ""}`}>{dayNumber}</span>
              {summary && <span aria-hidden="true" className="flex flex-wrap justify-center gap-0.5 sm:justify-start">
                {summary.real > 0 && <span className={`rounded-md px-1 text-[9px] font-bold sm:px-1.5 sm:py-0.5 sm:text-[10px] ${summary.realAttention ? "bg-[var(--warning-soft)] text-[var(--warning)]" : "bg-[var(--positive-soft)] text-[var(--positive)]"}`}>R {summary.real}</span>}
                {summary.simulation > 0 && <span className={`rounded-md px-1 text-[9px] font-bold sm:px-1.5 sm:py-0.5 sm:text-[10px] ${summary.simulationFailed ? "bg-[var(--warning-soft)] text-[var(--warning)]" : "bg-[var(--accent-soft)] text-[var(--accent-text)]"}`}>S {summary.simulation}</span>}
                {summary.manual > 0 && <span className={`rounded-md px-1 text-[9px] font-bold sm:px-1.5 sm:py-0.5 sm:text-[10px] ${summary.manualDue ? "bg-[var(--warning-soft)] text-[var(--warning)]" : "bg-[var(--field)] text-[var(--text-secondary)]"}`}>M {summary.manual}</span>}
              </span>}
            </button>;
          })}
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-3">
        <div><h3 className="text-[15px] font-bold text-[var(--text)]">{showAllDates ? "All dates" : selectedDay ? new Date(`${selectedDay}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : monthLabel(month)} agenda</h3><p className="mt-0.5 text-[12px] text-[var(--text-muted)]">{agenda.length} {agenda.length === 1 ? "item" : "items"} shown · {hasRealMastodon ? "real, simulated and manual" : "simulated and manual"}</p></div>
        <div className="flex flex-wrap items-center gap-2">{selectedManualTime && <button type="button" onClick={() => onPrepareManual(selectedManualTime)} className="rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-1.5 text-[12px] font-semibold text-[var(--accent-text)] hover:bg-[var(--surface-hover)]">Prepare manual post for this day</button>}{selectedDay && !showAllDates && <button type="button" onClick={() => setSelectedDay(null)} className="rounded-lg px-2 py-1.5 text-[12px] font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-soft)]">Show month</button>}<button type="button" onClick={() => { setShowAllDates((current) => !current); setSelectedDay(null); }} aria-pressed={showAllDates} className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold ${showAllDates ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]" : "border-[var(--line)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"}`}>{showAllDates ? "This month" : "All dates"}</button></div>
      </div>
      {agenda.length === 0 ? <div className="py-10 text-center text-[13px] text-[var(--text-muted)]">{allItems.length === 0 ? hasRealMastodon ? "Nothing on your plan yet. Add a simulation, manual handoff or reviewed real Mastodon schedule to get started." : "Nothing on your plan yet. Add a simulation or manual handoff to get started." : "No items match this date and status. Choose another day, month, or filter."}</div> :
      <div className="divide-y divide-[var(--line)]">{agenda.map((item) => {
        if (item.kind === "real-mastodon") {
          const real = item.post;
          const attention = realMastodonNeedsAttention(real, now);
          return <article key={`real-${real.clientRequestId}`} className="py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><h4 className="break-words text-[13px] font-bold text-[var(--text-secondary)]">Mastodon · {real.account.username}</h4><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${attention ? "bg-[var(--warning-soft)] text-[var(--warning)]" : real.status === "posted" ? "bg-[var(--positive-soft)] text-[var(--positive)]" : "bg-[var(--field)] text-[var(--text-secondary)]"}`}>{realStatusLabel(real, now)}</span></div>
                <p className="mt-1 text-[12px] text-[var(--text-muted)]">{formatLocalDateTime(real.scheduledFor)} · {real.instance} · real post</p>
                <p className="mt-2 line-clamp-2 whitespace-pre-wrap break-words text-[12px] text-[var(--text-secondary)]">{real.text}</p>
                {real.error && <p className="mt-1 text-[11px] text-[var(--warning)]">{real.error}</p>}
                {real.status === "unknown" && !real.resolution && <p className="mt-1 text-[11px] text-[var(--warning)]">Check Mastodon before posting the same text again. This result will not retry automatically.</p>}
              </div>
              <button type="button" onClick={() => onOpenRealMastodon(real)} className="self-start rounded-lg border border-[var(--line)] px-3 py-2 text-[12px] font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-soft)]">Review real queue</button>
            </div>
          </article>;
        }
        if (item.kind === "manual") {
          const manual = item.post;
          const state = assistedState(manual, now);
          const label = state === "posted" ? "Marked posted by you · unverified" : state === "due" ? "Manual · ready to post" : "Manual · upcoming";
          return <article key={`manual-${manual.id}`} className="py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><h4 className="break-words text-[13px] font-bold text-[var(--text-secondary)]">{manual.title}</h4><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${state === "due" ? "bg-[var(--warning-soft)] text-[var(--warning)]" : state === "posted" ? "bg-[var(--positive-soft)] text-[var(--positive)]" : "bg-[var(--field)] text-[var(--text-secondary)]"}`}>{label}</span></div>
                <p className="mt-1 text-[12px] text-[var(--text-muted)]">{formatLocalDateTime(manual.scheduledFor)} · {assistedDestinations[manual.destination].name} · manual handoff</p>
                <p className="mt-1 text-[11px] text-[var(--text-soft)]">Plypost did not send or verify this post.</p>
              </div>
              <div className="flex flex-wrap gap-2"><button type="button" onClick={() => onOpenAssisted(manual)} className="self-start rounded-lg border border-[var(--line)] px-3 py-2 text-[12px] font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-soft)]">Open handoff</button>{manual.status === "queued" && <button type="button" onClick={() => beginManualReschedule(manual)} disabled={saving} aria-expanded={editingId === `manual:${manual.id}`} className="rounded-lg border border-[var(--line)] px-3 py-2 text-[12px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-45">Move reminder</button>}</div>
            </div>
            {editingId === `manual:${manual.id}` && <form onSubmit={(event) => void saveManualReschedule(event, manual)} className="mt-4 rounded-xl border border-[var(--accent-border)] bg-[var(--surface-muted)] p-4">
              <LocalDateTimeField id={`move-manual-${manual.id}`} label="New manual reminder time" value={editValue} minTimestamp={now + 10_000} onChange={(next) => { setEditValue(next); setEditError(""); }} />
              <p className="mt-2 text-[11px] leading-5 text-[var(--text-muted)]">This only changes your manual reminder. The saved text, images and destination stay the same.</p>
              {editError && <p role="alert" className="mt-2 text-[12px] text-[var(--danger)]">{editError}</p>}
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2"><button type="button" onClick={() => setEditingId(null)} disabled={saving} className="rounded-lg px-3 py-2 text-[12px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50">Cancel</button><button type="submit" disabled={saving || !isValidLocalDateTime(editValue, now + 10_000)} className="gradient-button rounded-lg px-3 py-2 text-[12px] font-bold text-white disabled:opacity-50">{saving ? "Moving..." : "Save new time"}</button></div>
            </form>}
            <MediaHandoff mediaIds={manual.mediaIds} mediaAlt={manual.mediaAlt} />
          </article>;
        }
        const post = item.post;
        const state = scheduleState(post, now);
        const retryPending = post.status === "queued" && Boolean(post.attempts && post.nextAttemptAt && Date.parse(post.nextAttemptAt) > Date.parse(post.scheduledFor));
        const label = state === "due" ? "Simulation · due, waiting for worker" : state === "running" ? "Simulation · running" : state === "failed" ? "Simulation · needs attention" : state === "simulated" ? "Simulated · no platform post" : retryPending ? "Simulation · retry scheduled" : "Simulation · upcoming";
        return <article key={post.id} className="py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><h4 className="break-words text-[13px] font-bold text-[var(--text-secondary)]">{post.title}</h4><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${state === "failed" || state === "due" ? "bg-[var(--warning-soft)] text-[var(--warning)]" : state === "simulated" ? "bg-[var(--positive-soft)] text-[var(--positive)]" : "bg-[var(--accent-soft)] text-[var(--accent-text)]"}`}>{label}</span></div>
              <p className="mt-1 text-[12px] text-[var(--text-muted)]">{formatLocalDateTime(post.scheduledFor)} · {platformDisplayIds.filter((id) => post.posts[id] !== undefined).map((id) => platforms[id].name).join(", ")}</p>
              {retryPending && post.nextAttemptAt && <p className="mt-1 text-[12px] text-[var(--warning)]">Next automatic retry: {formatLocalDateTime(post.nextAttemptAt)}</p>}
              {post.lastError && <p className="mt-1 text-[12px] text-[var(--danger)]">Attempt {post.attempts ?? 0}/3: {post.lastError}</p>}
              {!!post.receipts?.length && <p className="mt-1 text-[11px] text-[var(--text-soft)]">Already simulated: {post.receipts.map((receipt) => platforms[receipt.platform as keyof typeof platforms]?.name ?? receipt.platform).join(", ")}</p>}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
              <button type="button" onClick={() => onLoad(post)} className="rounded-lg px-2 py-1.5 text-[12px] font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-soft)]">Open</button>
              {(post.status === "queued" || post.status === "failed") && <button type="button" onClick={() => beginReschedule(post)} disabled={saving || runningId === post.id} aria-expanded={editingId === post.id} className="rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-[12px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-45">Move</button>}
              {state === "failed" && <button type="button" onClick={() => onRun(post)} disabled={runningId !== null || saving} className="inline-flex items-center gap-1 rounded-lg bg-[var(--accent-soft)] px-2.5 py-1.5 text-[12px] font-bold text-[var(--accent-text)] disabled:opacity-45"><RotateCcw size={12} /> Retry</button>}
              <button type="button" disabled={state === "running" || saving} aria-label={`Remove ${post.title} from plan`} onClick={() => onRemove(post.id)} className="rounded-lg p-1.5 text-[var(--text-soft)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:opacity-40"><Trash2 size={14} /></button>
            </div>
          </div>
          <MediaHandoff mediaIds={post.mediaIds} mediaAlt={post.mediaAlt} />
          {editingId === post.id && <form onSubmit={(event) => void saveReschedule(event, post)} className="mt-4 rounded-xl border border-[var(--accent-border)] bg-[var(--surface-muted)] p-4">
            <LocalDateTimeField id={`move-${post.id}`} label="New simulation time" value={editValue} minTimestamp={now + 10_000} onChange={(next) => { setEditValue(next); setEditError(""); }} />
            {!!post.receipts?.length && <p className="mt-2 text-[12px] leading-5 text-[var(--warning)]">Existing simulated receipts stay recorded; only remaining destinations are queued for the new time.</p>}
            {editError && <p role="alert" className="mt-2 text-[12px] text-[var(--danger)]">{editError}</p>}
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2"><button type="button" onClick={() => setEditingId(null)} disabled={saving} className="rounded-lg px-3 py-2 text-[12px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50">Cancel</button><button type="submit" disabled={saving || !isValidLocalDateTime(editValue, now + 10_000)} className="gradient-button rounded-lg px-3 py-2 text-[12px] font-bold text-white disabled:opacity-50">{saving ? "Moving..." : "Save new time"}</button></div>
          </form>}
        </article>;
      })}</div>}
    </div>
  </section>;
}
