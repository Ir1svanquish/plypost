"use client";

import { useRef, useState } from "react";
import { Download, FilePlus2, FolderOpen, Search, Trash2, Upload } from "lucide-react";
import { platformDisplayIds, platforms, type PlatformId } from "@/lib/platforms";
import { type AssistedPost, type SavedDraft } from "@/lib/workspace";

type DraftLibraryProps = {
  drafts: SavedDraft[];
  assisted: AssistedPost[];
  currentDraftId: string | null;
  onNew: () => void;
  onLoad: (draft: SavedDraft) => void;
  onPrepare: (draft: SavedDraft) => void;
  onOpenAssisted: (item: AssistedPost) => void;
  onDelete: (id: string, updatedAt: string) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onFullExport: () => Promise<void>;
  onFullImport: (file: File) => Promise<void>;
  backupBusy: boolean;
};

function draftPreview(draft: SavedDraft): string {
  return draft.source.trim() || platformDisplayIds.map((id) => draft.variants[id]?.trim()).find(Boolean) ||
    (draft.mediaIds?.length ? `${draft.mediaIds.length} saved ${draft.mediaIds.length === 1 ? "image" : "images"} · add a caption later` :
      draft.videoId ? "Saved video · add a caption later" : "Caption to add later");
}

function DraftCard({ draft, currentDraftId, handoffs, onLoad, onPrepare, onOpenAssisted, onDelete }: {
  draft: SavedDraft;
  currentDraftId: string | null;
  handoffs: AssistedPost[];
  onLoad: (draft: SavedDraft) => void;
  onPrepare: (draft: SavedDraft) => void;
  onOpenAssisted: (item: AssistedPost) => void;
  onDelete: (id: string, updatedAt: string) => void;
}) {
  const queued = handoffs.filter((item) => item.status === "queued");
  const postedCount = handoffs.length - queued.length;
  const nextHandoff = queued[0] ?? handoffs[0];
  return <article className={`rounded-2xl border p-4 ${currentDraftId === draft.id ? "border-[var(--accent-border)] bg-[var(--accent-soft)]" : "border-[var(--line)]"}`}>
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0"><h3 className="truncate text-[14px] font-bold text-[var(--text)]">{draft.title}</h3><p className="mt-1 text-[11px] text-[var(--text-soft)]">Updated {new Date(draft.updatedAt).toLocaleString("en-US")}</p>{draft.plannedDate && <p className="mt-1 text-[11px] font-semibold text-[var(--accent-text)]">Target {draft.plannedDate} · draft only</p>}</div>
      <button type="button" aria-label={`Delete ${draft.title}`} onClick={() => onDelete(draft.id, draft.updatedAt)} className="rounded-lg p-1.5 text-[var(--text-soft)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"><Trash2 size={14} /></button>
    </div>
    <p className="mt-3 line-clamp-2 min-h-[36px] text-[12px] leading-[18px] text-[var(--text-muted)]">{draftPreview(draft)}</p>
    <p className="mt-2 text-[11px] font-semibold text-[var(--text-secondary)]">{handoffs.length === 0 ? "No manual posts prepared" : [queued.length && `${queued.length} to post`, postedCount && `${postedCount} marked posted`].filter(Boolean).join(" · ")}</p>
    <p className="mt-2 truncate text-[11px] text-[var(--text-soft)]">{[...platformDisplayIds.filter((id) => draft.selected.includes(id)).map((id) => platforms[id].name), ...(draft.videoId ? ["Video"] : [])].join(" · ") || "No preview platforms"}</p>
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      <button type="button" onClick={() => onLoad(draft)} className="text-[12px] font-bold text-[var(--accent-text)]">Open draft →</button>
      <button type="button" onClick={() => onPrepare(draft)} className="text-[12px] font-bold text-[var(--accent-text)]">Prepare posts →</button>
      {nextHandoff && <button type="button" onClick={() => onOpenAssisted(nextHandoff)} className="text-[12px] font-bold text-[var(--accent-text)]">View handoffs →</button>}
    </div>
  </article>;
}

export function DraftLibraryPanel({ drafts, assisted, currentDraftId, onNew, onLoad, onPrepare, onOpenAssisted, onDelete, onExport, onImport, onFullExport, onFullImport, backupBusy }: DraftLibraryProps) {
  const fullInput = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<PlatformId | "all" | "video">("all");
  const [sort, setSort] = useState<"updated" | "target">("updated");
  const needle = query.trim().toLocaleLowerCase();
  const visibleDrafts = drafts.filter((draft) => {
    if (show === "video" ? !draft.videoId : show !== "all" && !draft.selected.includes(show)) return false;
    if (!needle) return true;
    return [draft.title, draft.source, ...Object.values(draft.variants), ...(draft.mediaAlt ?? [])]
      .join("\n").toLocaleLowerCase().includes(needle);
  }).sort((a, b) => sort === "target"
    ? (a.plannedDate ?? "9999-12-31").localeCompare(b.plannedDate ?? "9999-12-31") || b.updatedAt.localeCompare(a.updatedAt)
    : b.updatedAt.localeCompare(a.updatedAt));
  const hasFilters = Boolean(needle) || show !== "all" || sort !== "updated";
  return (
    <section id="drafts" className="section-anchor panel-border soft-shadow mt-8 overflow-hidden rounded-[18px] bg-[var(--surface)]" aria-labelledby="library-heading">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] px-6 py-5 sm:px-7">
        <div><h2 id="library-heading" className="text-[17px] font-bold tracking-[-0.025em]">Draft library</h2><p className="mt-1 text-[13px] text-[var(--text-muted)]">Open an idea to continue editing it.</p></div>
        <span className="rounded-full bg-[var(--field)] px-2.5 py-1 text-[12px] font-semibold text-[var(--text-muted)]">{drafts.length} saved</span>
      </div>
      <div className="space-y-3 p-6 pb-3 sm:p-7 sm:pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={onNew} className="gradient-button inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-bold text-white"><FilePlus2 size={15} /> New draft</button>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void onFullExport()} disabled={backupBusy} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-2 text-[12px] font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-soft)] disabled:opacity-50"><Download size={13} /> {backupBusy ? "Working…" : "Download full backup"}</button>
            <button type="button" onClick={() => fullInput.current?.click()} disabled={backupBusy} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-2 text-[12px] font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-soft)] disabled:opacity-50"><Upload size={13} /> Restore full backup</button>
            <input ref={fullInput} type="file" accept="application/json,.json" className="sr-only" disabled={backupBusy} aria-label="Choose a full Plypost backup to restore" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onFullImport(file); event.target.value = ""; }} />
          </div>
        </div>
        <p className="text-[12px] text-[var(--text-muted)]">Drafts and media stay on this computer until you back them up.</p>
      </div>
      {drafts.length > 0 && <div className="mx-6 mb-5 grid grid-cols-2 gap-3 sm:mx-7 sm:grid-cols-[minmax(0,1fr)_minmax(130px,160px)_minmax(130px,160px)]">
        <label className="relative col-span-2 block text-[12px] font-semibold text-[var(--text-secondary)] sm:col-span-1">Search drafts
          <Search size={15} aria-hidden="true" className="pointer-events-none absolute bottom-3 left-3 text-[var(--text-soft)]" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title or post text" className="mt-1.5 w-full rounded-lg border border-[var(--line)] bg-[var(--field)] py-2.5 pl-9 pr-3 text-[13px] font-normal text-[var(--text)] outline-none placeholder:text-[var(--text-soft)] focus:border-[var(--accent-border)]" />
        </label>
        <label className="min-w-0 text-[12px] font-semibold text-[var(--text-secondary)]">Show
          <select value={show} onChange={(event) => setShow(event.target.value as PlatformId | "all" | "video")} className="mt-1.5 w-full rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2.5 text-[13px] font-normal text-[var(--text)] outline-none focus:border-[var(--accent-border)]">
            <option value="all">All drafts</option>
            {platformDisplayIds.map((id) => <option key={id} value={id}>{platforms[id].name}</option>)}
            <option value="video">Video attached</option>
          </select>
        </label>
        <label className="min-w-0 text-[12px] font-semibold text-[var(--text-secondary)]">Sort
          <select value={sort} onChange={(event) => setSort(event.target.value as "updated" | "target")} className="mt-1.5 w-full rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2.5 text-[13px] font-normal text-[var(--text)] outline-none focus:border-[var(--accent-border)]">
            <option value="updated">Newest first</option>
            <option value="target">Target date</option>
          </select>
        </label>
      </div>}
      <details className="mx-6 mb-5 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3 text-[12px] text-[var(--text-muted)] sm:mx-7">
        <summary className="cursor-pointer font-semibold text-[var(--text-secondary)]">Text-only JSON backup</summary>
        <p className="mt-2 leading-5">Use this with older Plypost copies. It includes draft, plan and handoff references, but omits image and video files. Use the full backup above to move media to another installation.</p>
        <div className="mt-3 flex flex-wrap gap-4"><button type="button" onClick={onExport} disabled={backupBusy} className="inline-flex items-center gap-1 font-semibold text-[var(--accent-text)] disabled:opacity-50"><Download size={13} /> Export text JSON</button><button type="button" onClick={() => textInput.current?.click()} disabled={backupBusy} className="inline-flex items-center gap-1 font-semibold text-[var(--accent-text)] disabled:opacity-50"><Upload size={13} /> Import text JSON</button><input ref={textInput} type="file" accept="application/json,.json" className="sr-only" disabled={backupBusy} aria-label="Choose a text-only Plypost JSON backup" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImport(file); event.target.value = ""; }} /></div>
      </details>
      {drafts.length === 0 ? <div className="flex flex-col items-center border-t border-[var(--line)] px-6 py-9 text-center"><FolderOpen size={22} className="text-[var(--accent-text)]" /><p className="mt-2 text-[13px] font-semibold text-[var(--text-secondary)]">No saved drafts yet</p><p className="mt-1 text-[12px] text-[var(--text-soft)]">Write a post in Create, then save it there.</p></div> : <div className="border-t border-[var(--line)] p-6 sm:p-7">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-[var(--text-muted)]"><p role="status">{visibleDrafts.length} of {drafts.length} drafts</p>{hasFilters && <button type="button" onClick={() => { setQuery(""); setShow("all"); setSort("updated"); }} className="font-semibold text-[var(--accent-text)] underline underline-offset-2">Clear filters</button>}</div>
        {visibleDrafts.length === 0 ? <div className="flex flex-col items-center rounded-xl border border-dashed border-[var(--line)] px-6 py-9 text-center"><Search size={21} className="text-[var(--text-soft)]" /><p className="mt-2 text-[13px] font-semibold text-[var(--text-secondary)]">No drafts match</p><p className="mt-1 text-[12px] text-[var(--text-soft)]">Try a different search or platform.</p></div> : <div className="grid gap-3 sm:grid-cols-2">{visibleDrafts.map((draft) => <DraftCard key={draft.id} draft={draft} currentDraftId={currentDraftId} handoffs={assisted.filter((item) => item.sourceDraftId === draft.id)} onLoad={onLoad} onPrepare={onPrepare} onOpenAssisted={onOpenAssisted} onDelete={onDelete} />)}</div>}
      </div>}
    </section>
  );
}
