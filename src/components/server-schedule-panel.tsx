"use client";

import { CalendarClock, RotateCcw, Trash2 } from "lucide-react";
import { localDateTimeValue, scheduleState, type ScheduledPost } from "@/lib/workspace";
import { platformIds, platforms } from "@/lib/platforms";

type Props = {
  schedule: ScheduledPost[]; value: string; now: number; canSchedule: boolean;
  runningId: string | null; onValueChange: (value: string) => void; onAdd: () => void;
  onLoad: (post: ScheduledPost) => void; onRun: (post: ScheduledPost) => void; onRemove: (id: string) => void;
};

export function ServerSchedulePanel({ schedule, value, now, canSchedule, runningId, onValueChange, onAdd, onLoad, onRun, onRemove }: Props) {
  const queuedCount = schedule.filter((post) => post.status === "queued").length;
  return <section id="schedule" className="section-anchor panel-border soft-shadow mt-8 overflow-hidden rounded-[18px] bg-[var(--surface)]" aria-labelledby="schedule-heading">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] px-6 py-5 sm:px-7">
      <div><h2 id="schedule-heading" className="text-[17px] font-bold">Publishing plan</h2><p className="mt-1 text-[13px] text-[var(--text-muted)]">Scheduled snapshots run through the simulation worker.</p></div>
      <span className="rounded-full bg-[var(--field)] px-2.5 py-1 text-[12px] font-semibold text-[var(--text-muted)]">{queuedCount} queued</span>
    </div>
    <div className="p-6 sm:p-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1"><label htmlFor="schedule-time" className="mb-2 block text-[12px] font-bold text-[var(--text-secondary)]">Local date and time</label><input id="schedule-time" type="datetime-local" value={value} min={now ? localDateTimeValue(new Date(now)) : undefined} onChange={(event) => onValueChange(event.target.value)} className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-[14px] outline-none focus:border-[var(--accent-border)]" /></div>
        <button type="button" onClick={onAdd} disabled={!canSchedule} className="gradient-button inline-flex h-[45px] items-center justify-center gap-2 rounded-xl px-4 text-[13px] font-bold text-white disabled:opacity-50"><CalendarClock size={15} /> Add to plan</button>
      </div>
      <p className="mt-3 text-[12px] leading-5 text-[var(--text-soft)]">Keep <code>npm run worker</code> running on this computer. It simulates due items even after this browser closes. No social platform is contacted.</p>
    </div>
    {schedule.length === 0 ? <div className="border-t border-[var(--line)] px-6 py-9 text-center text-[13px] text-[var(--text-muted)]">Nothing on your plan yet.</div> :
      <div className="divide-y divide-[var(--line)] border-t border-[var(--line)]">{schedule.map((post) => {
        const state = scheduleState(post, now);
        const label = state === "due" ? "Due · waiting for worker" : state === "running" ? "Running" : state === "failed" ? "Needs attention" : state === "simulated" ? "Simulated" : "Upcoming";
        return <article key={post.id} className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:px-7">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-[13px] font-bold text-[var(--text-secondary)]">{post.title}</h3><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${state === "failed" || state === "due" ? "bg-[var(--warning-soft)] text-[var(--warning)]" : state === "simulated" ? "bg-[var(--positive-soft)] text-[var(--positive)]" : "bg-[var(--accent-soft)] text-[var(--accent-text)]"}`}>{label}</span></div>
            <p className="mt-1 text-[12px] text-[var(--text-muted)]">{new Date(post.scheduledFor).toLocaleString()} · {platformIds.filter((id) => post.posts[id] !== undefined).map((id) => platforms[id].name).join(", ")}</p>
            {post.lastError && <p className="mt-1 text-[12px] text-[var(--danger)]">Attempt {post.attempts}/3: {post.lastError}</p>}
            {!!post.receipts?.length && <p className="mt-1 text-[11px] text-[var(--text-soft)]">Receipts: {post.receipts.map((receipt) => platforms[receipt.platform as keyof typeof platforms]?.name ?? receipt.platform).join(", ")}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-3"><button type="button" onClick={() => onLoad(post)} className="text-[12px] font-semibold text-[var(--accent-text)]">Open</button>{state === "failed" && <button type="button" onClick={() => onRun(post)} disabled={runningId !== null} className="inline-flex items-center gap-1 rounded-lg bg-[var(--accent-soft)] px-2.5 py-1.5 text-[12px] font-bold text-[var(--accent-text)] disabled:opacity-45"><RotateCcw size={12} /> Retry</button>}<button type="button" disabled={state === "running"} aria-label={`Remove ${post.title} from plan`} onClick={() => onRemove(post.id)} className="rounded-lg p-1.5 text-[var(--text-soft)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:opacity-40"><Trash2 size={14} /></button></div>
        </article>;
      })}</div>}
  </section>;
}
