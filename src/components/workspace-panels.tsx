"use client";

import { CalendarClock, Download, FilePlus2, FolderOpen, Save, Trash2, Upload } from "lucide-react";
import { platformIds, platforms } from "@/lib/platforms";
import { localDateTimeValue, scheduleState, type SavedDraft, type ScheduledPost } from "@/lib/workspace";

type DraftLibraryProps = {
  drafts: SavedDraft[];
  title: string;
  currentDraftId: string | null;
  onTitleChange: (title: string) => void;
  onSave: () => void;
  onNew: () => void;
  onLoad: (draft: SavedDraft) => void;
  onDelete: (id: string) => void;
  onExport: () => void;
  onImport: (file: File) => void;
};

export function DraftLibraryPanel({ drafts, title, currentDraftId, onTitleChange, onSave, onNew, onLoad, onDelete, onExport, onImport }: DraftLibraryProps) {
  return (
    <section id="drafts" className="section-anchor panel-border soft-shadow mt-8 overflow-hidden rounded-[18px] bg-[var(--surface)]" aria-labelledby="library-heading">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] px-6 py-5 sm:px-7">
        <div><h2 id="library-heading" className="text-[17px] font-bold tracking-[-0.025em]">Draft library</h2><p className="mt-1 text-[13px] text-[var(--text-muted)]">Save versions in this browser and pick them up later.</p></div>
        <span className="rounded-full bg-[var(--field)] px-2.5 py-1 text-[12px] font-semibold text-[var(--text-muted)]">{drafts.length} saved</span>
      </div>
      <div className="p-6 sm:p-7">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1"><label htmlFor="draft-title" className="mb-2 block text-[12px] font-bold text-[var(--text-secondary)]">Draft name</label><input id="draft-title" value={title} onChange={(event) => onTitleChange(event.target.value)} maxLength={120} placeholder="Optional — uses the first line of your draft" className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-[14px] outline-none focus:border-[var(--accent-border)]" /></div>
          <div className="flex gap-2"><button type="button" onClick={onSave} className="gradient-button inline-flex h-[45px] flex-1 items-center justify-center gap-2 rounded-xl px-4 text-[13px] font-bold text-white sm:flex-none"><Save size={15} /> {currentDraftId ? "Update draft" : "Save draft"}</button><button type="button" onClick={onNew} className="inline-flex h-[45px] items-center justify-center gap-2 rounded-xl border border-[var(--line)] px-4 text-[13px] font-semibold text-[var(--text-secondary)]"><FilePlus2 size={15} /> New</button></div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-4 text-[12px] text-[var(--text-muted)]"><span className="mr-auto">Saved only on this device. Export a backup before clearing browser data.</span><button type="button" onClick={onExport} className="inline-flex items-center gap-1 font-semibold text-[var(--accent-text)]"><Download size={13} /> Export</button><label className="inline-flex cursor-pointer items-center gap-1 font-semibold text-[var(--accent-text)]"><Upload size={13} /> Import<input type="file" accept="application/json,.json" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImport(file); event.target.value = ""; }} /></label></div>
      </div>
      {drafts.length === 0 ? <div className="flex flex-col items-center border-t border-[var(--line)] px-6 py-9 text-center"><FolderOpen size={22} className="text-[var(--accent-text)]" /><p className="mt-2 text-[13px] font-semibold text-[var(--text-secondary)]">No saved drafts yet</p><p className="mt-1 text-[12px] text-[var(--text-soft)]">Give this draft a name and save it here.</p></div> : <div className="grid gap-3 border-t border-[var(--line)] p-6 sm:grid-cols-2 sm:p-7">{drafts.map((draft) => <article key={draft.id} className={`rounded-2xl border p-4 ${currentDraftId === draft.id ? "border-[var(--accent-border)] bg-[var(--accent-soft)]" : "border-[var(--line)]"}`}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="truncate text-[14px] font-bold text-[var(--text)]">{draft.title}</h3><p className="mt-1 text-[11px] text-[var(--text-soft)]">Updated {new Date(draft.updatedAt).toLocaleString()}</p></div><button type="button" aria-label={`Delete ${draft.title}`} onClick={() => onDelete(draft.id)} className="rounded-lg p-1.5 text-[var(--text-soft)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"><Trash2 size={14} /></button></div><p className="mt-3 line-clamp-2 min-h-[36px] text-[12px] leading-[18px] text-[var(--text-muted)]">{draft.source}</p><div className="mt-4 flex items-center justify-between gap-2"><span className="truncate text-[11px] text-[var(--text-soft)]">{draft.selected.map((id) => platforms[id].name).join(" · ") || "No destinations"}</span><button type="button" onClick={() => onLoad(draft)} className="shrink-0 text-[12px] font-bold text-[var(--accent-text)]">Open draft →</button></div></article>)}</div>}
    </section>
  );
}

type ScheduleProps = {
  schedule: ScheduledPost[];
  value: string;
  now: number;
  canSchedule: boolean;
  runningId: string | null;
  onValueChange: (value: string) => void;
  onAdd: () => void;
  onLoad: (post: ScheduledPost) => void;
  onRun: (post: ScheduledPost) => void;
  onRemove: (id: string) => void;
};

export function SchedulePanel({ schedule, value, now, canSchedule, runningId, onValueChange, onAdd, onLoad, onRun, onRemove }: ScheduleProps) {
  const queuedCount = schedule.filter((post) => post.status === "queued").length;
  return (
    <section id="schedule" className="section-anchor panel-border soft-shadow mt-8 overflow-hidden rounded-[18px] bg-[var(--surface)]" aria-labelledby="schedule-heading">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] px-6 py-5 sm:px-7"><div><h2 id="schedule-heading" className="text-[17px] font-bold tracking-[-0.025em]">Publishing plan</h2><p className="mt-1 text-[13px] text-[var(--text-muted)]">Keep a dated snapshot of the selected platform drafts.</p></div><span className="rounded-full bg-[var(--field)] px-2.5 py-1 text-[12px] font-semibold text-[var(--text-muted)]">{queuedCount} planned</span></div>
      <div className="p-6 sm:p-7"><div className="flex flex-col gap-3 sm:flex-row sm:items-end"><div className="min-w-0 flex-1"><label htmlFor="schedule-time" className="mb-2 block text-[12px] font-bold text-[var(--text-secondary)]">Local date and time</label><input id="schedule-time" type="datetime-local" value={value} min={now ? localDateTimeValue(new Date(now)) : undefined} onChange={(event) => onValueChange(event.target.value)} className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-[14px] outline-none focus:border-[var(--accent-border)]" /></div><button type="button" onClick={onAdd} disabled={!canSchedule} className="gradient-button inline-flex h-[45px] items-center justify-center gap-2 rounded-xl px-4 text-[13px] font-bold text-white"><CalendarClock size={15} /> Add to plan</button></div><p className="mt-3 text-[12px] leading-5 text-[var(--text-soft)]">Planning only. A due item needs you to open this app and click Run demo. It will not post automatically or contact a social platform.</p></div>
      {schedule.length === 0 ? <div className="flex flex-col items-center border-t border-[var(--line)] px-6 py-9 text-center"><CalendarClock size={22} className="text-[var(--accent-text)]" /><p className="mt-2 text-[13px] font-semibold text-[var(--text-secondary)]">Nothing on your plan</p><p className="mt-1 text-[12px] text-[var(--text-soft)]">Choose a future time for the drafts you have selected.</p></div> : <div className="divide-y divide-[var(--line)] border-t border-[var(--line)]">{schedule.map((post) => { const state = scheduleState(post, now); return <article key={post.id} className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:px-7"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-[13px] font-bold text-[var(--text-secondary)]">{post.title}</h3><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${state === "due" ? "bg-[var(--warning-soft)] text-[var(--warning)]" : state === "simulated" ? "bg-[var(--positive-soft)] text-[var(--positive)]" : "bg-[var(--accent-soft)] text-[var(--accent-text)]"}`}>{state === "due" ? "Due · review now" : state === "simulated" ? "Simulated" : "Upcoming"}</span></div><p className="mt-1 text-[12px] text-[var(--text-muted)]">{new Date(post.scheduledFor).toLocaleString()} · {platformIds.filter((id) => post.posts[id] !== undefined).map((id) => platforms[id].name).join(", ")}</p></div><div className="flex shrink-0 items-center gap-3"><button type="button" onClick={() => onLoad(post)} className="text-[12px] font-semibold text-[var(--accent-text)]">Open</button>{post.status === "queued" && <button type="button" onClick={() => onRun(post)} disabled={state !== "due" || runningId !== null} className="rounded-lg bg-[var(--accent-soft)] px-2.5 py-1.5 text-[12px] font-bold text-[var(--accent-text)] disabled:opacity-45">{runningId === post.id ? "Running..." : "Run demo"}</button>}<button type="button" aria-label={`Remove ${post.title} from plan`} onClick={() => onRemove(post.id)} className="rounded-lg p-1.5 text-[var(--text-soft)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"><Trash2 size={14} /></button></div></article>; })}</div>}
    </section>
  );
}
