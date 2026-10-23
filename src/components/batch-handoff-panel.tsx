"use client";

import { useRef, useState } from "react";
import { ArrowRight, Check, Copy, ShieldCheck } from "lucide-react";
import { LocalDateTimeField, isValidLocalDateTime } from "@/components/local-date-time-field";
import { adaptDraft, platformIds, platforms, type PlatformId } from "@/lib/platforms";
import { validatePlatformText } from "@/lib/platform-validation";
import type { AssistedPost, SavedDraft } from "@/lib/workspace";

export type BatchHandoffItem = { destination: PlatformId; scheduledFor: string };

type Props = {
  draft: SavedDraft;
  existing: AssistedPost[];
  now: number;
  editorDirty: boolean;
  busy: boolean;
  mediaBusy: boolean;
  onPrepare: (draftId: string, batchId: string, items: BatchHandoffItem[]) => Promise<boolean>;
  onOpenAssisted: () => void;
};

export function BatchHandoffPanel({ draft, existing, now, editorDirty, busy, mediaBusy, onPrepare, onOpenAssisted }: Props) {
  const [open, setOpen] = useState(false);
  const [destinations, setDestinations] = useState<PlatformId[]>(() => draft.selected.filter((id) =>
    !existing.some((item) => item.sourceDraftId === draft.id && item.destination === id)));
  const [reminders, setReminders] = useState<Partial<Record<PlatformId, string>>>({});
  const [attempted, setAttempted] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const batchIdRef = useRef<string | null>(null);
  const attemptedItemsRef = useRef<BatchHandoffItem[] | null>(null);
  const submittingRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const reviewRef = useRef<HTMLDivElement>(null);
  const savedPlatforms = platformIds.filter((id) => draft.selected.includes(id));
  const priorHandoffs = existing.filter((item) => item.sourceDraftId === draft.id);
  const duplicateDestinations = destinations.filter((id) => priorHandoffs.some((item) => item.destination === id));
  const currentTime = now || Date.now();
  const invalidText = destinations.filter((id) => {
    const text = draft.variants[id] ?? adaptDraft(draft.source, id);
    return !validatePlatformText(id, text).valid;
  });
  const invalidReminders = destinations.filter((id) => reminders[id] && !isValidLocalDateTime(reminders[id]!, currentTime));
  const canPrepare = !editorDirty && !busy && !mediaBusy && !submitting && !prepared &&
    (attempted ? Boolean(attemptedItemsRef.current) :
      destinations.length > 0 && invalidText.length === 0 && invalidReminders.length === 0);

  function toggleDestination(id: PlatformId) {
    if (attempted || submitting) return;
    setDestinations((current) => current.includes(id) ? current.filter((item) => item !== id) :
      platformIds.filter((item) => current.includes(item) || item === id));
  }

  function openReview() {
    setOpen(true);
    requestAnimationFrame(() => reviewRef.current?.focus());
  }

  function closeReview() {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function prepareAnother() {
    batchIdRef.current = null;
    attemptedItemsRef.current = null;
    setAttempted(false);
    setPrepared(false);
    setDestinations(draft.selected.filter((id) => !existing.some((item) =>
      item.sourceDraftId === draft.id && item.destination === id)));
    setReminders({});
    openReview();
  }

  async function prepare() {
    if (submittingRef.current || !canPrepare) return;
    if (!attempted && destinations.some((id) => reminders[id] && !isValidLocalDateTime(reminders[id]!, Date.now()))) return;
    const items = attemptedItemsRef.current ?? (() => {
      const timestamp = Date.now();
      return destinations.map((destination) => {
        const reminder = reminders[destination];
        return {
          destination,
          scheduledFor: reminder ? new Date(reminder).toISOString() : new Date(timestamp).toISOString(),
        };
      });
    })();
    attemptedItemsRef.current = items;
    if (!batchIdRef.current) batchIdRef.current = crypto.randomUUID();
    submittingRef.current = true;
    setSubmitting(true);
    setAttempted(true);
    try {
      const succeeded = await onPrepare(draft.id, batchIdRef.current, items);
      if (succeeded) setPrepared(true);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return <section className="panel-border soft-shadow rounded-[18px] bg-[var(--surface)] p-6 sm:p-7" aria-labelledby="batch-handoff-heading">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h2 id="batch-handoff-heading" className="text-[17px] font-bold tracking-[-0.025em] text-[var(--text)]">Prepare assisted handoffs</h2><p className="mt-1 text-[13px] leading-5 text-[var(--text-muted)]">Make one manual posting item for each selected platform from this saved draft.</p></div>
      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-bold text-[var(--accent-text)]"><Copy size={12} aria-hidden="true" /> Manual</span>
    </div>
    {editorDirty && <p role="status" className="mt-4 rounded-xl bg-[var(--warning-soft)] px-3 py-2.5 text-[12px] leading-5 text-[var(--warning)]">Save your latest editor changes first. Handoffs use the saved version of this draft.</p>}
    {!editorDirty && !open && !prepared && <button ref={triggerRef} type="button" onClick={openReview} aria-expanded={open} aria-controls="batch-handoff-review" disabled={busy || mediaBusy || !savedPlatforms.length} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] px-4 py-3 text-[13px] font-bold text-[var(--accent-text)] transition hover:bg-[var(--surface-hover)] disabled:opacity-45">Review {savedPlatforms.length} platform {savedPlatforms.length === 1 ? "handoff" : "handoffs"} <ArrowRight size={15} aria-hidden="true" /></button>}
    {!savedPlatforms.length && <p className="mt-3 text-[12px] text-[var(--text-muted)]">Choose a destination in the editor and save the draft first.</p>}
    {priorHandoffs.length > 0 && !prepared && <p className="mt-3 text-[11px] leading-5 text-[var(--text-muted)]">{priorHandoffs.length} {priorHandoffs.length === 1 ? "handoff" : "handoffs"} already prepared from this draft. Previously prepared platforms are unchecked by default. <button type="button" onClick={onOpenAssisted} className="font-semibold text-[var(--accent-text)] underline underline-offset-2">View existing handoffs</button></p>}
    {prepared && <div role="status" className="mt-4 rounded-xl border border-[var(--positive)] bg-[var(--positive-soft)] p-4 text-[12px] leading-5 text-[var(--positive)]"><p className="flex items-center gap-2 font-bold"><Check size={15} aria-hidden="true" /> Handoffs added to Assisted.</p><p className="mt-1">Copy the saved text and images, then publish from your own accounts. Plypost has not posted anything.</p><div className="mt-3 flex flex-wrap gap-4"><button type="button" onClick={onOpenAssisted} className="inline-flex items-center gap-1 font-bold underline underline-offset-2">Open Assisted <ArrowRight size={13} aria-hidden="true" /></button><button type="button" onClick={prepareAnother} className="font-semibold underline underline-offset-2">Prepare another batch</button></div></div>}
    {open && !prepared && <div id="batch-handoff-review" ref={reviewRef} role="dialog" aria-modal="false" aria-labelledby="batch-handoff-review-heading" tabIndex={-1} onKeyDown={(event) => { if (event.key === "Escape" && !submitting) { event.preventDefault(); closeReview(); } }} className="mt-5 space-y-4 border-t border-[var(--line)] pt-5 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
      <h3 id="batch-handoff-review-heading" className="text-[14px] font-bold text-[var(--text)]">Review saved platform handoffs</h3>
      <div className="flex items-start gap-2 rounded-xl bg-[var(--surface-muted)] px-3 py-2.5 text-[12px] leading-5 text-[var(--text-muted)]"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-[var(--accent-text)]" aria-hidden="true" /><span>Review the saved text below. Reminder times are optional and use your local time. Confirming adds checklist items only; you will finish every post yourself.</span></div>
      {savedPlatforms.map((id) => {
        const text = draft.variants[id] ?? adaptDraft(draft.source, id);
        const check = validatePlatformText(id, text);
        const selected = destinations.includes(id);
        return <div key={id} className={`min-w-0 rounded-xl border p-4 ${selected ? "border-[var(--accent-border)] bg-[var(--accent-soft)]" : "border-[var(--line)] bg-[var(--surface-muted)]"}`}>
          <label className="flex cursor-pointer items-start gap-3 text-[13px] font-bold text-[var(--text)]"><input type="checkbox" checked={selected} onChange={() => toggleDestination(id)} disabled={attempted || submitting || editorDirty} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]" /><span>{platforms[id].name}{priorHandoffs.some((item) => item.destination === id) && <span className="ml-2 text-[11px] font-normal text-[var(--text-muted)]">Already prepared</span>}</span></label>
          {selected && <div className="mt-3 space-y-3"><p className="whitespace-pre-wrap break-words rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-[12px] leading-5 text-[var(--text-secondary)]">{text || "No saved text"}</p><p className={`text-[11px] ${check.valid ? "text-[var(--text-muted)]" : "font-semibold text-[var(--danger)]"}`}>{check.count} / {check.limit} {id === "bluesky" ? "graphemes" : "characters"}{check.byteCount !== undefined ? ` · ${check.byteCount} / ${check.byteLimit} UTF-8 bytes` : ""}{!check.valid ? " · Fix this platform draft and save it first" : ""}</p><fieldset disabled={attempted} className={attempted ? "opacity-70" : ""}><LocalDateTimeField id={`batch-reminder-${id}`} label={`${platforms[id].name} reminder`} value={reminders[id] ?? ""} minTimestamp={currentTime} optional onChange={(value) => setReminders((current) => ({ ...current, [id]: value }))} /></fieldset></div>}
        </div>;
      })}
      <p className="text-[11px] leading-5 text-[var(--text-soft)]">{draft.mediaIds?.length ? `${draft.mediaIds.length} saved ${draft.mediaIds.length === 1 ? "image" : "images"} will be attached to each checklist item for manual download.` : "This draft has no saved images."} Images are not uploaded to any platform.</p>
      {invalidReminders.length > 0 && <p role="alert" className="text-[12px] text-[var(--danger)]">Correct the future reminder times for {invalidReminders.map((id) => platforms[id].name).join(", ")}.</p>}
      {duplicateDestinations.length > 0 && <p role="status" className="rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-[11px] leading-5 text-[var(--warning)]">{duplicateDestinations.map((id) => platforms[id].name).join(", ")} already {duplicateDestinations.length === 1 ? "has a handoff" : "have handoffs"} from this draft. Confirming will add another item for each selected platform.</p>}
      {attempted && <p role="status" className="text-[11px] leading-5 text-[var(--text-muted)]">If the request did not confirm, retry the same batch. Check Assisted before starting another batch.</p>}
      <div className="flex flex-wrap items-center justify-end gap-3"><button type="button" onClick={closeReview} disabled={submitting} className="rounded-lg px-3 py-2 text-[12px] font-semibold text-[var(--text-secondary)] disabled:opacity-45">Close review</button><button type="button" onClick={() => void prepare()} disabled={!canPrepare} className="gradient-button inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[12px] font-bold text-white disabled:opacity-45"><Check size={15} aria-hidden="true" />{submitting ? "Preparing…" : attempted ? "Retry same batch" : `Confirm ${destinations.length} ${destinations.length === 1 ? "handoff" : "handoffs"}`}</button></div>
    </div>}
  </section>;
}
