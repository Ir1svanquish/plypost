"use client";

import { Download, FilePlus2, FolderOpen, Trash2, Upload } from "lucide-react";
import { platforms } from "@/lib/platforms";
import { type SavedDraft } from "@/lib/workspace";

type DraftLibraryProps = {
  drafts: SavedDraft[];
  currentDraftId: string | null;
  onNew: () => void;
  onLoad: (draft: SavedDraft) => void;
  onDelete: (id: string) => void;
  onExport: () => void;
  onImport: (file: File) => void;
};

export function DraftLibraryPanel({ drafts, currentDraftId, onNew, onLoad, onDelete, onExport, onImport }: DraftLibraryProps) {
  return (
    <section id="drafts" className="section-anchor panel-border soft-shadow mt-8 overflow-hidden rounded-[18px] bg-[var(--surface)]" aria-labelledby="library-heading">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] px-6 py-5 sm:px-7">
        <div><h2 id="library-heading" className="text-[17px] font-bold tracking-[-0.025em]">Draft library</h2><p className="mt-1 text-[13px] text-[var(--text-muted)]">Open an idea to continue editing it.</p></div>
        <span className="rounded-full bg-[var(--field)] px-2.5 py-1 text-[12px] font-semibold text-[var(--text-muted)]">{drafts.length} saved</span>
      </div>
      <div className="flex flex-wrap items-center gap-4 p-6 sm:p-7">
        <button type="button" onClick={onNew} className="gradient-button inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-bold text-white"><FilePlus2 size={15} /> New draft</button>
        <span className="mr-auto text-[12px] text-[var(--text-muted)]">Drafts are saved to this account on this computer.</span>
        <button type="button" onClick={onExport} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent-text)]"><Download size={13} /> Export</button>
        <label className="inline-flex cursor-pointer items-center gap-1 text-[12px] font-semibold text-[var(--accent-text)]"><Upload size={13} /> Import<input type="file" accept="application/json,.json" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImport(file); event.target.value = ""; }} /></label>
      </div>
      {drafts.length === 0 ? <div className="flex flex-col items-center border-t border-[var(--line)] px-6 py-9 text-center"><FolderOpen size={22} className="text-[var(--accent-text)]" /><p className="mt-2 text-[13px] font-semibold text-[var(--text-secondary)]">No saved drafts yet</p><p className="mt-1 text-[12px] text-[var(--text-soft)]">Write a post in Create, then save it there.</p></div> : <div className="grid gap-3 border-t border-[var(--line)] p-6 sm:grid-cols-2 sm:p-7">{drafts.map((draft) => <article key={draft.id} className={`rounded-2xl border p-4 ${currentDraftId === draft.id ? "border-[var(--accent-border)] bg-[var(--accent-soft)]" : "border-[var(--line)]"}`}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="truncate text-[14px] font-bold text-[var(--text)]">{draft.title}</h3><p className="mt-1 text-[11px] text-[var(--text-soft)]">Updated {new Date(draft.updatedAt).toLocaleString("en-US")}</p></div><button type="button" aria-label={`Delete ${draft.title}`} onClick={() => onDelete(draft.id)} className="rounded-lg p-1.5 text-[var(--text-soft)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"><Trash2 size={14} /></button></div><p className="mt-3 line-clamp-2 min-h-[36px] text-[12px] leading-[18px] text-[var(--text-muted)]">{draft.source}</p><div className="mt-4 flex items-center justify-between gap-2"><span className="truncate text-[11px] text-[var(--text-soft)]">{draft.selected.map((id) => platforms[id].name).join(" · ") || "No destinations"}</span><button type="button" onClick={() => onLoad(draft)} className="shrink-0 text-[12px] font-bold text-[var(--accent-text)]">Open draft →</button></div></article>)}</div>}
    </section>
  );
}
