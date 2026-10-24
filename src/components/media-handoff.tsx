"use client";

import Image from "next/image";
import { useState } from "react";
import { Check, ChevronDown, Copy, Download, Images } from "lucide-react";

/** Review and retrieve the images attached to a saved plan or assisted item. */
export function MediaHandoff({ mediaIds, mediaAlt }: { mediaIds?: readonly string[]; mediaAlt?: readonly string[] }) {
  const [open, setOpen] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [copyError, setCopyError] = useState(false);
  if (!mediaIds?.length) return null;

  async function copyDescription(index: number) {
    const description = mediaAlt?.[index];
    if (!description) return;
    try {
      await navigator.clipboard.writeText(description);
      setCopiedIndex(index);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  }

  return <div className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] p-3">
    <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex w-full items-center gap-2 text-left text-[12px] font-semibold text-[var(--text-secondary)]">
      <Images size={15} className="shrink-0 text-[var(--accent-text)]" aria-hidden="true" />
      <span className="flex-1">{mediaIds.length} saved {mediaIds.length === 1 ? "image" : "images"} · manual handoff</span>
      <ChevronDown size={14} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
    </button>
    {open && <div className="mt-3 border-t border-[var(--line)] pt-3">
      <p className="mb-3 text-[11px] leading-5 text-[var(--text-muted)]">Download these images in order, then upload them and add their descriptions on the destination platform.</p>
      {copyError && <p role="alert" className="mb-2 text-[11px] text-[var(--danger)]">Could not copy. Select the description and copy it manually.</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {mediaIds.map((id, index) => <div key={id} className="min-w-0 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)]">
          <div className="relative aspect-[2/1] bg-[var(--field)]">
            <Image unoptimized loading="lazy" src={`/api/media/${encodeURIComponent(id)}`} alt={mediaAlt?.[index] || `Saved image ${index + 1} of ${mediaIds.length}`} fill sizes="(max-width: 640px) 90vw, 300px" className="object-cover" />
            <span className="absolute left-1.5 top-1.5 rounded bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--text)] shadow-sm">{index + 1}</span>
          </div>
          <a href={`/api/media/${encodeURIComponent(id)}?download=1`} download className="flex items-center justify-center gap-1.5 px-2 py-2 text-[11px] font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-soft)]" aria-label={`Download saved image ${index + 1} of ${mediaIds.length}`}><Download size={12} aria-hidden="true" /> Download {index + 1}</a>
          {mediaAlt?.[index] && <div className="border-t border-[var(--line)] px-2.5 py-2"><p className="select-text break-words text-[11px] leading-5 text-[var(--text-secondary)]">{mediaAlt[index]}</p><button type="button" onClick={() => { void copyDescription(index); }} className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--accent-text)]">{copiedIndex === index ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}{copiedIndex === index ? "Copied" : "Copy description"}</button></div>}
        </div>)}
      </div>
    </div>}
  </div>;
}
