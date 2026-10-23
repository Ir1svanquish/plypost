"use client";

import { useState, type FormEvent } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, RotateCcw, Trash2 } from "lucide-react";
import { localDateTimeValue, scheduleState, type ScheduledPost } from "@/lib/workspace";
import { platformIds, platforms } from "@/lib/platforms";
import { formatLocalDateTime, isValidLocalDateTime, LocalDateTimeField } from "@/components/local-date-time-field";

type Props = {
  schedule: ScheduledPost[]; value: string; now: number; canSchedule: boolean;
  runningId: string | null; onValueChange: (value: string) => void; onAdd: () => void;
  onLoad: (post: ScheduledPost) => void; onRun: (post: ScheduledPost) => void; onRemove: (id: string) => void;
  onReschedule: (post: ScheduledPost, scheduledForIso: string) => Promise<void>;
};

type StatusFilter = "all" | ScheduledPost["status"];
type Month = { year: number; index: number };
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const filters: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" }, { value: "queued", label: "Queued" },
  { value: "running", label: "Running" }, { value: "failed", label: "Needs attention" },
  { value: "simulated", label: "Simulated" },
];

function localDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthLabel(month: Month): string {
  return new Date(month.year, month.index, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function ServerSchedulePanel({ schedule, value, now, canSchedule, runningId, onValueChange, onAdd, onLoad, onRun, onRemove, onReschedule }: Props) {
  const [month, setMonth] = useState<Month>(() => {
    const today = new Date(now || Date.now());
    return { year: today.getFullYear(), index: today.getMonth() };
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showAllDates, setShowAllDates] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editError, setEditError] = useState("");
  const [saving, setSaving] = useState(false);
  const queuedCount = schedule.filter((post) => post.status === "queued").length;
  const filtered = schedule.filter((post) => filter === "all" || post.status === filter);
  const monthPosts = filtered.filter((post) => {
    const date = new Date(post.scheduledFor);
    return date.getFullYear() === month.year && date.getMonth() === month.index;
  });
  const agenda = (showAllDates ? filtered : monthPosts.filter((post) => !selectedDay || localDay(new Date(post.scheduledFor)) === selectedDay))
    .sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor));
  const today = new Date(now || Date.now());
  const todayKey = localDay(today);
  const firstWeekday = (new Date(month.year, month.index, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(month.year, month.index + 1, 0).getDate();
  const cells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const dayCounts = new Map<string, { total: number; needsAttention: boolean }>();
  for (const post of monthPosts) {
    const key = localDay(new Date(post.scheduledFor));
    const count = dayCounts.get(key) ?? { total: 0, needsAttention: false };
    count.total += 1;
    count.needsAttention ||= post.status === "failed";
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
  return <section id="schedule" className="section-anchor panel-border soft-shadow mt-8 overflow-hidden rounded-[18px] bg-[var(--surface)]" aria-labelledby="schedule-heading">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] px-6 py-5 sm:px-7">
      <div><h2 id="schedule-heading" className="text-[17px] font-bold">Publishing plan</h2><p className="mt-1 text-[13px] text-[var(--text-muted)]">Scheduled snapshots run through the simulation worker.</p></div>
      <span className="rounded-full bg-[var(--field)] px-2.5 py-1 text-[12px] font-semibold text-[var(--text-muted)]">{queuedCount} queued</span>
    </div>
    <div className="p-6 sm:p-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1"><LocalDateTimeField id="schedule-time" label="Publish at" value={value} minTimestamp={now + 10_000} onChange={onValueChange} /></div>
        <button type="button" onClick={onAdd} disabled={!canSchedule || !isValidLocalDateTime(value, now + 10_000)} className="gradient-button inline-flex h-[43px] items-center justify-center gap-2 rounded-xl px-4 text-[13px] font-bold text-white disabled:opacity-50 sm:mb-[22px]"><CalendarClock size={15} /> Add to plan</button>
      </div>
      <p className="mt-3 text-[12px] leading-5 text-[var(--text-soft)]">Keep <code>npm run worker</code> running on this computer. It simulates due items even after this browser closes. No social platform is contacted.</p>
    </div>
    <div className="border-t border-[var(--line)] px-4 py-5 sm:px-7 sm:py-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><h3 className="text-[15px] font-bold text-[var(--text)]">Calendar</h3><p className="mt-1 text-[12px] text-[var(--text-muted)]">Your local time · select a day to inspect its items.</p></div>
        <label htmlFor="schedule-status-filter" className="flex items-center gap-2 text-[12px] font-semibold text-[var(--text-secondary)]">Status
          <select id="schedule-status-filter" value={filter} onChange={(event) => setFilter(event.target.value as StatusFilter)} aria-label="Filter planned items by status" className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[12px] text-[var(--text)] sm:flex-none">
            {filters.map((option) => <option key={option.value} value={option.value}>{option.label} ({option.value === "all" ? schedule.length : schedule.filter((post) => post.status === option.value).length})</option>)}
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
            const key = localDay(date);
            const summary = dayCounts.get(key);
            const dateLabel = date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
            return <button key={key} type="button" onClick={() => { setSelectedDay(key); setShowAllDates(false); }} aria-label={`${dateLabel}, ${summary?.total ?? 0} planned ${summary?.total === 1 ? "item" : "items"}${summary?.needsAttention ? ", needs attention" : ""}`} aria-pressed={!showAllDates && selectedDay === key} className={`flex min-h-14 flex-col items-center gap-1 px-0.5 py-2 text-center sm:min-h-20 sm:items-start sm:px-2.5 ${!showAllDates && selectedDay === key ? "bg-[var(--accent-soft)] text-[var(--accent-text)] hover:bg-[var(--accent-soft)]" : "bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"}`}>
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${key === todayKey ? "bg-[var(--accent)] text-white" : ""}`}>{dayNumber}</span>
              {summary && <span aria-hidden="true" className={`flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold sm:h-auto sm:rounded-md sm:px-1.5 sm:py-0.5 sm:text-[10px] ${summary.needsAttention ? "bg-[var(--warning-soft)] text-[var(--warning)]" : "bg-[var(--accent-soft)] text-[var(--accent-text)]"}`}>{summary.total}</span>}
            </button>;
          })}
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-3">
        <div><h3 className="text-[15px] font-bold text-[var(--text)]">{showAllDates ? "All dates" : selectedDay ? new Date(`${selectedDay}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : monthLabel(month)} agenda</h3><p className="mt-0.5 text-[12px] text-[var(--text-muted)]">{agenda.length} {agenda.length === 1 ? "item" : "items"} shown · simulated publishing only</p></div>
        <div className="flex items-center gap-2">{selectedDay && !showAllDates && <button type="button" onClick={() => setSelectedDay(null)} className="rounded-lg px-2 py-1.5 text-[12px] font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-soft)]">Show month</button>}<button type="button" onClick={() => { setShowAllDates((current) => !current); setSelectedDay(null); }} aria-pressed={showAllDates} className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold ${showAllDates ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]" : "border-[var(--line)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"}`}>{showAllDates ? "This month" : "All dates"}</button></div>
      </div>
      {agenda.length === 0 ? <div className="py-10 text-center text-[13px] text-[var(--text-muted)]">{schedule.length === 0 ? "Nothing on your plan yet. Add a draft above to get started." : "No items match this date and status. Choose another day, month, or filter."}</div> :
      <div className="divide-y divide-[var(--line)]">{agenda.map((post) => {
        const state = scheduleState(post, now);
        const retryPending = post.status === "queued" && Boolean(post.attempts && post.nextAttemptAt && Date.parse(post.nextAttemptAt) > Date.parse(post.scheduledFor));
        const label = state === "due" ? "Due · waiting for worker" : state === "running" ? "Running" : state === "failed" ? "Needs attention" : state === "simulated" ? "Simulated" : retryPending ? "Retry scheduled" : "Upcoming";
        return <article key={post.id} className="py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><h4 className="break-words text-[13px] font-bold text-[var(--text-secondary)]">{post.title}</h4><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${state === "failed" || state === "due" ? "bg-[var(--warning-soft)] text-[var(--warning)]" : state === "simulated" ? "bg-[var(--positive-soft)] text-[var(--positive)]" : "bg-[var(--accent-soft)] text-[var(--accent-text)]"}`}>{label}</span></div>
              <p className="mt-1 text-[12px] text-[var(--text-muted)]">{formatLocalDateTime(post.scheduledFor)} · {platformIds.filter((id) => post.posts[id] !== undefined).map((id) => platforms[id].name).join(", ")}</p>
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
