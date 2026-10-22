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
    <section id="drafts" className="panel-border soft-shadow mt-8 overflow-hidden rounded-[22px] bg-white" aria-labelledby="library-heading">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#eff0f4] px-6 py-5 sm:px-7">
        <div><h2 id="library-heading" className="text-[16px] font-bold tracking-[-0.025em]">Draft library</h2><p className="mt-1 text-[12px] text-[#989bad]">Save versions in this browser and pick them up later.</p></div>
        <span className="rounded-full bg-[#f4f4f8] px-2.5 py-1 text-[11px] font-semibold text-[#84889d]">{drafts.length} saved</span>
      </div>
      <div className="p-6 sm:p-7">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1"><label htmlFor="draft-title" className="mb-2 block text-[11px] font-bold text-[#676b7f]">Draft name</label><input id="draft-title" value={title} onChange={(event) => onTitleChange(event.target.value)} maxLength={120} placeholder="Optional — uses the first line of your draft" className="w-full rounded-xl border border-[#e5e6ee] bg-white px-4 py-3 text-[13px] outline-none focus:border-[#9488f4]" /></div>
          <div className="flex gap-2"><button type="button" onClick={onSave} className="gradient-button inline-flex h-[45px] flex-1 items-center justify-center gap-2 rounded-xl px-4 text-[12px] font-bold text-white sm:flex-none"><Save size={15} /> {currentDraftId ? "Update draft" : "Save draft"}</button><button type="button" onClick={onNew} className="inline-flex h-[45px] items-center justify-center gap-2 rounded-xl border border-[#e5e6ee] px-4 text-[12px] font-semibold text-[#62667c]"><FilePlus2 size={15} /> New</button></div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-[#f0f1f5] pt-4 text-[11px] text-[#969aab]"><span className="mr-auto">Saved only on this device. Export a backup before clearing browser data.</span><button type="button" onClick={onExport} className="inline-flex items-center gap-1 font-semibold text-[#7566d9]"><Download size={13} /> Export</button><label className="inline-flex cursor-pointer items-center gap-1 font-semibold text-[#7566d9]"><Upload size={13} /> Import<input type="file" accept="application/json,.json" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImport(file); event.target.value = ""; }} /></label></div>
      </div>
      {drafts.length === 0 ? <div className="flex flex-col items-center border-t border-[#f0f1f5] px-6 py-9 text-center"><FolderOpen size={22} className="text-[#a4a6ce]" /><p className="mt-2 text-[12px] font-semibold text-[#5e6074]">No saved drafts yet</p><p className="mt-1 text-[11px] text-[#a0a4b4]">Give this draft a name and save it here.</p></div> : <div className="grid gap-3 border-t border-[#f0f1f5] p-6 sm:grid-cols-2 sm:p-7">{drafts.map((draft) => <article key={draft.id} className={`rounded-2xl border p-4 ${currentDraftId === draft.id ? "border-[#beb4ff] bg-[#faf9ff]" : "border-[#e9eaf1]"}`}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="truncate text-[13px] font-bold text-[#3d4055]">{draft.title}</h3><p className="mt-1 text-[10px] text-[#a0a4b4]">Updated {new Date(draft.updatedAt).toLocaleString()}</p></div><button type="button" aria-label={`Delete ${draft.title}`} onClick={() => onDelete(draft.id)} className="rounded-lg p-1.5 text-[#abb0bd] hover:bg-[#fff0f0] hover:text-[#cc626a]"><Trash2 size={14} /></button></div><p className="mt-3 line-clamp-2 min-h-[36px] text-[11px] leading-[18px] text-[#787c8e]">{draft.source}</p><div className="mt-4 flex items-center justify-between gap-2"><span className="truncate text-[10px] text-[#a0a4b4]">{draft.selected.map((id) => platforms[id].name).join(" · ") || "No destinations"}</span><button type="button" onClick={() => onLoad(draft)} className="shrink-0 text-[11px] font-bold text-[#7060df]">Open draft →</button></div></article>)}</div>}
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
    <section id="schedule" className="panel-border soft-shadow mt-8 overflow-hidden rounded-[22px] bg-white" aria-labelledby="schedule-heading">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#eff0f4] px-6 py-5 sm:px-7"><div><h2 id="schedule-heading" className="text-[16px] font-bold tracking-[-0.025em]">Publishing plan</h2><p className="mt-1 text-[12px] text-[#989bad]">Keep a dated snapshot of the selected platform drafts.</p></div><span className="rounded-full bg-[#f4f4f8] px-2.5 py-1 text-[11px] font-semibold text-[#84889d]">{queuedCount} planned</span></div>
      <div className="p-6 sm:p-7"><div className="flex flex-col gap-3 sm:flex-row sm:items-end"><div className="min-w-0 flex-1"><label htmlFor="schedule-time" className="mb-2 block text-[11px] font-bold text-[#676b7f]">Local date and time</label><input id="schedule-time" type="datetime-local" value={value} min={now ? localDateTimeValue(new Date(now)) : undefined} onChange={(event) => onValueChange(event.target.value)} className="w-full rounded-xl border border-[#e5e6ee] bg-white px-4 py-3 text-[13px] outline-none focus:border-[#9488f4]" /></div><button type="button" onClick={onAdd} disabled={!canSchedule} className="gradient-button inline-flex h-[45px] items-center justify-center gap-2 rounded-xl px-4 text-[12px] font-bold text-white"><CalendarClock size={15} /> Add to plan</button></div><p className="mt-3 text-[11px] leading-5 text-[#a0a4b4]">Planning only. A due item needs you to open this app and click Run demo. It will not post automatically or contact a social platform.</p></div>
      {schedule.length === 0 ? <div className="flex flex-col items-center border-t border-[#f0f1f5] px-6 py-9 text-center"><CalendarClock size={22} className="text-[#a4a6ce]" /><p className="mt-2 text-[12px] font-semibold text-[#5e6074]">Nothing on your plan</p><p className="mt-1 text-[11px] text-[#a0a4b4]">Choose a future time for the drafts you have selected.</p></div> : <div className="divide-y divide-[#f0f1f5] border-t border-[#f0f1f5]">{schedule.map((post) => { const state = scheduleState(post, now); return <article key={post.id} className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:px-7"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-[12px] font-bold text-[#45485c]">{post.title}</h3><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${state === "due" ? "bg-[#fff3e4] text-[#a66b2a]" : state === "simulated" ? "bg-[#edf9f2] text-[#358860]" : "bg-[#f0edff] text-[#7464cf]"}`}>{state === "due" ? "Due · review now" : state === "simulated" ? "Simulated" : "Upcoming"}</span></div><p className="mt-1 text-[11px] text-[#8b8fa1]">{new Date(post.scheduledFor).toLocaleString()} · {platformIds.filter((id) => post.posts[id] !== undefined).map((id) => platforms[id].name).join(", ")}</p></div><div className="flex shrink-0 items-center gap-3"><button type="button" onClick={() => onLoad(post)} className="text-[11px] font-semibold text-[#7566d9]">Open</button>{post.status === "queued" && <button type="button" onClick={() => onRun(post)} disabled={state !== "due" || runningId !== null} className="rounded-lg bg-[#f0edff] px-2.5 py-1.5 text-[11px] font-bold text-[#705ee2] disabled:opacity-45">{runningId === post.id ? "Running..." : "Run demo"}</button>}<button type="button" aria-label={`Remove ${post.title} from plan`} onClick={() => onRemove(post.id)} className="rounded-lg p-1.5 text-[#abb0bd] hover:bg-[#fff0f0] hover:text-[#cc626a]"><Trash2 size={14} /></button></div></article>; })}</div>}
    </section>
  );
}
