"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Copy, Download, Images } from "lucide-react";
import { MAX_IMAGE_ALT_CHARS } from "@/lib/workspace";
import type { AssistedDestinationId } from "@/lib/assisted";

/** Review and retrieve the images attached to a saved plan or assisted item. */
export function MediaHandoff({ mediaIds, mediaAlt, onUpdateDescriptions, onDirtyChange, onEditingChange, variant = "handoff", destination }: {
  mediaIds?: readonly string[];
  mediaAlt?: readonly string[];
  onUpdateDescriptions?: (expectedIds: string[], expectedAlt: string[], next: string[]) => Promise<boolean>;
  onDirtyChange?: (dirty: boolean) => void;
  onEditingChange?: (editing: boolean) => void;
  variant?: "handoff" | "review";
  destination?: AssistedDestinationId;
}) {
  const inputPrefix = useId();
  const [open, setOpen] = useState(variant === "review");
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [copyError, setCopyError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [expectedIds, setExpectedIds] = useState<string[]>([]);
  const [expected, setExpected] = useState<string[]>([]);
  const [draft, setDraft] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const onDirtyChangeRef = useRef(onDirtyChange);
  useEffect(() => { onDirtyChangeRef.current = onDirtyChange; }, [onDirtyChange]);
  const onEditingChangeRef = useRef(onEditingChange);
  useEffect(() => { onEditingChangeRef.current = onEditingChange; }, [onEditingChange]);
  const currentIds = mediaIds ?? [];
  const saved = currentIds.map((_, index) => mediaAlt?.[index] ?? "");
  const unavailable = editing && !onUpdateDescriptions;
  const stale = editing && (currentIds.length !== expectedIds.length ||
    currentIds.some((id, index) => id !== expectedIds[index]) ||
    saved.some((description, index) => description !== expected[index]));
  const changed = draft.some((description, index) => description.trim() !== expected[index]);
  useEffect(() => {
    onDirtyChangeRef.current?.(editing && changed);
    return () => { onDirtyChangeRef.current?.(false); };
  }, [editing, changed]);
  useEffect(() => {
    onEditingChangeRef.current?.(editing);
    return () => { onEditingChangeRef.current?.(false); };
  }, [editing]);
  if (!currentIds.length && !editing) return null;
  const displayedIds = editing ? expectedIds : currentIds;
  const displayedAlt = editing ? expected : saved;

  function startEditing() {
    setExpectedIds([...currentIds]);
    setExpected([...saved]);
    setDraft([...saved]);
    setEditing(true);
  }

  async function saveDescriptions() {
    if (!onUpdateDescriptions || saving || stale) return;
    setSaving(true);
    try {
      const next = draft.map((description) => description.trim());
      if (await onUpdateDescriptions(expectedIds, expected, next)) {
        setEditing(false);
        setCopiedIndex(null);
      }
    } finally {
      setSaving(false);
    }
  }

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
      <span className="flex-1">{displayedIds.length} saved {displayedIds.length === 1 ? "image" : "images"} · {variant === "review" ? "review before confirming" : "manual handoff"}</span>
      <ChevronDown size={14} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
    </button>
    {open && <div className="mt-3 border-t border-[var(--line)] pt-3">
      <p className="mb-3 text-[11px] leading-5 text-[var(--text-muted)]">{destination === "youtube" ? "This image is an optional thumbnail reference. Upload the video in YouTube Studio separately; custom thumbnails require a verified account." : variant === "review" ? "These images and descriptions will be copied to each selected handoff. Edit the saved draft to change them before confirming." : "Download these images in order, then upload them and add their descriptions on the destination platform."}</p>
      {onUpdateDescriptions && !editing && <button type="button" onClick={startEditing} className="mb-3 text-[11px] font-semibold text-[var(--accent-text)] underline underline-offset-2">Edit descriptions for this handoff</button>}
      {unavailable && <p role="alert" className="mb-3 text-[11px] text-[var(--danger)]">This handoff is no longer editable. Select and copy any unsaved descriptions below before closing the editor.</p>}
      {editing && stale && <p role="alert" className="mb-3 text-[11px] text-[var(--danger)]">Images or descriptions changed in another window. Select and copy any unsaved descriptions below, then reopen the latest version.</p>}
      {copyError && <p role="alert" className="mb-2 text-[11px] text-[var(--danger)]">Could not copy. Select the description and copy it manually.</p>}
      <div className={`grid gap-2 ${displayedIds.length > 1 && !editing ? "grid-cols-2" : "sm:grid-cols-2"}`}>
        {displayedIds.map((id, index) => <div key={id} className="min-w-0 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)]">
          <div className={`relative bg-[var(--field)] ${displayedIds.length > 1 && !editing ? "aspect-square sm:aspect-[2/1]" : "aspect-[2/1]"}`}>
            <Image unoptimized loading="lazy" src={`/api/media/${encodeURIComponent(id)}?thumb=1`} alt={displayedAlt[index] || `Saved image ${index + 1} of ${displayedIds.length}`} fill sizes="(max-width: 640px) 45vw, 300px" className="object-cover" />
            <span className="absolute left-1.5 top-1.5 rounded bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--text)] shadow-sm">{index + 1}</span>
          </div>
          <a href={`/api/media/${encodeURIComponent(id)}?download=1`} download className="flex items-center justify-center gap-1.5 px-2 py-2 text-[11px] font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-soft)]" aria-label={`Download saved image ${index + 1} of ${displayedIds.length}`}><Download size={12} aria-hidden="true" /> Download {index + 1}</a>
          {editing ? <div className="border-t border-[var(--line)] px-2.5 py-2"><label htmlFor={`${inputPrefix}-${id}`} className="block text-[11px] font-semibold text-[var(--text-secondary)]">Description for image {index + 1}</label><input id={`${inputPrefix}-${id}`} type="text" value={draft[index] ?? ""} maxLength={MAX_IMAGE_ALT_CHARS} disabled={saving} readOnly={stale || unavailable} onChange={(event) => setDraft((current) => current.map((value, position) => position === index ? Array.from(event.target.value).filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join("") : value))} placeholder="Describe what this image shows" className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--field)] px-2 py-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent-border)] disabled:opacity-50" /></div>
            : mediaAlt?.[index] && <div className="border-t border-[var(--line)] px-2.5 py-2"><p className="select-text break-words text-[11px] leading-5 text-[var(--text-secondary)]">{mediaAlt[index]}</p><button type="button" onClick={() => { void copyDescription(index); }} className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--accent-text)]">{copiedIndex === index ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}{copiedIndex === index ? "Copied" : "Copy description"}</button></div>}
        </div>)}
      </div>
      {editing && <div className="mt-3 flex flex-wrap items-center gap-3"><button type="button" onClick={() => { void saveDescriptions(); }} disabled={saving || stale || unavailable || !changed} className="rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-[11px] font-semibold text-[var(--accent-text)] disabled:opacity-50">{saving ? "Saving…" : "Save descriptions"}</button><button type="button" onClick={() => setEditing(false)} disabled={saving} className="text-[11px] font-semibold text-[var(--text-muted)] disabled:opacity-50">Cancel</button></div>}
    </div>}
  </div>;
}
