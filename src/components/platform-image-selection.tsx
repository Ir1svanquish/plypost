"use client";

import Image from "next/image";
import { ChevronLeft, ChevronRight, Check } from "lucide-react";
import { assistedDestinations, type AssistedDestinationId } from "@/lib/assisted";
import { imageLimitForDestination } from "@/lib/media-policy";

/** Pick a platform-specific subset from the saved draft without changing its image pool. */
export function PlatformImageSelection({ destination, sourceIds, sourceAlt, selectedIds, onChange, disabled }: {
  destination: AssistedDestinationId;
  sourceIds: readonly string[];
  sourceAlt?: readonly string[];
  selectedIds: readonly string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
}) {
  if (!sourceIds.length) return null;
  const limit = imageLimitForDestination(destination);
  const name = assistedDestinations[destination].name;

  function toggle(id: string) {
    if (selectedIds.includes(id)) onChange(selectedIds.filter((current) => current !== id));
    else if (selectedIds.length < limit) onChange([...selectedIds, id]);
  }

  function move(index: number, direction: -1 | 1) {
    const next = [...selectedIds];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    onChange(next);
  }

  return <section className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3" aria-label={`${name} image selection`}>
    <div className="flex flex-wrap items-baseline justify-between gap-1">
      <p className="text-[12px] font-bold text-[var(--text)]">Images for {name}</p>
      <span className="text-[11px] font-semibold text-[var(--text-muted)]">{selectedIds.length} / {limit} selected</span>
    </div>
    <p className="mt-1 text-[11px] leading-4 text-[var(--text-muted)]">
      {sourceIds.length > limit
        ? selectedIds.length >= limit
          ? `This platform can use ${limit} of ${sourceIds.length} draft images. Unselect one to choose another.`
          : `Choose up to ${limit} of ${sourceIds.length} draft images.`
        : `Choose from ${sourceIds.length} draft ${sourceIds.length === 1 ? "image" : "images"}.`}
    </p>
    <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
      {sourceIds.map((id, index) => {
        const selectedPosition = selectedIds.indexOf(id);
        const selected = selectedPosition >= 0;
        const unavailable = !selected && selectedIds.length >= limit;
        return <button key={id} type="button" onClick={() => toggle(id)} disabled={disabled || unavailable}
          aria-label={`${selected ? "Remove" : "Select"} draft image ${index + 1}${sourceAlt?.[index] ? `, ${sourceAlt[index]}` : ""}`}
          aria-pressed={selected}
          className={`relative aspect-square overflow-hidden rounded-lg border-2 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-45 ${selected ? "border-[var(--accent)]" : "border-[var(--line)] hover:border-[var(--accent-border)]"}`}>
          <Image unoptimized loading="lazy" src={`/api/media/${encodeURIComponent(id)}`} alt="" fill sizes="96px" className="object-cover" />
          <span className="absolute bottom-1 left-1 rounded bg-[var(--surface)] px-1 text-[10px] font-bold text-[var(--text)]">{index + 1}</span>
          {selected && <span className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-bold text-white"><Check size={11} aria-hidden="true" />{selectedPosition + 1}</span>}
        </button>;
      })}
    </div>
    {selectedIds.length > 1 && <div className="mt-3 border-t border-[var(--line)] pt-2">
      <p className="text-[11px] font-semibold text-[var(--text-secondary)]">Upload order</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {selectedIds.map((id, index) => <div key={id} className="flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-1.5 py-1 text-[11px] font-semibold text-[var(--text-secondary)]">
          <span>{index + 1}. Draft {sourceIds.indexOf(id) + 1}</span>
          <button type="button" aria-label={`Move image ${index + 1} earlier`} title="Move earlier" disabled={disabled || index === 0} onClick={() => move(index, -1)} className="rounded p-1 text-[var(--accent-text)] hover:bg-[var(--surface)] disabled:opacity-30"><ChevronLeft size={13} aria-hidden="true" /></button>
          <button type="button" aria-label={`Move image ${index + 1} later`} title="Move later" disabled={disabled || index === selectedIds.length - 1} onClick={() => move(index, 1)} className="rounded p-1 text-[var(--accent-text)] hover:bg-[var(--surface)] disabled:opacity-30"><ChevronRight size={13} aria-hidden="true" /></button>
        </div>)}
      </div>
    </div>}
    {selectedIds.length === 0 && <p role="status" className="mt-2 text-[11px] text-[var(--warning)]">No images will be included in this handoff.</p>}
  </section>;
}

