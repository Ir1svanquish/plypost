"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Copy, ShieldCheck, Sparkles } from "lucide-react";
import { LocalDateTimeField, isValidLocalDateTime } from "@/components/local-date-time-field";
import { PlatformImageSelection } from "@/components/platform-image-selection";
import { VideoAttachmentPicker } from "@/components/video-attachment-picker";
import { adaptDraft, characterCount, isPlatformId, platformDisplayIds, platforms, type PlatformId } from "@/lib/platforms";
import { assistedDestinations, assistedOnlyDisplayIds, assistedTextImageOnlyDisplayIds, assistedVideoDisplayIds, missingHandoffMedia, type AssistedDestinationId } from "@/lib/assisted";
import { validatePlatformText } from "@/lib/platform-validation";
import type { AssistedPost, SavedDraft } from "@/lib/workspace";
import { AIHandoffAssistant } from "@/components/ai-handoff-assistant";
import { AiLiteralNotice } from "@/components/ai-literal-notice";
import { isManualAiDestination } from "@/lib/ai-handoff";
import type { PreflightReport } from "@/lib/ai-preflight";
import { defaultHandoffImageIds, imageLimitForDestination, imageLimitWarning } from "@/lib/media-policy";
import { suggestedSlotIsReady } from "@/lib/slot-settings";

export type BatchHandoffItem = { destination: AssistedDestinationId; scheduledFor: string; text: string; mediaIds: string[]; reminderEnabled?: false; videoId?: string };
export type BatchPrepareResult = "prepared" | "rejected" | "uncertain";
export type BatchReviewState = { dirty: boolean; busy: boolean };

type Props = {
  draft: SavedDraft;
  existing: AssistedPost[];
  now: number;
  editorDirty: boolean;
  busy: boolean;
  mediaBusy: boolean;
  stale: boolean;
  startExpanded?: boolean;
  onPrepare: (draftId: string, expectedUpdatedAt: string, batchId: string, items: BatchHandoffItem[], requireFreeSlots: boolean) => Promise<BatchPrepareResult>;
  onOpenAssisted: () => void;
  onOpenLatest?: () => void;
  onStateChange: (state: BatchReviewState) => void;
};

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function BatchHandoffPanel({ draft, existing, now, editorDirty, busy, mediaBusy, stale, startExpanded = false, onPrepare, onOpenAssisted, onOpenLatest, onStateChange }: Props) {
  const [initialDestinations] = useState<AssistedDestinationId[]>(() => platformDisplayIds.filter((id) =>
    draft.selected.includes(id) && !existing.some((item) => item.sourceDraftId === draft.id && item.destination === id)));
  const [open, setOpen] = useState(startExpanded);
  const [destinations, setDestinations] = useState<AssistedDestinationId[]>(() => initialDestinations);
  const [focusedDestination, setFocusedDestination] = useState<AssistedDestinationId | null>(null);
  const [reminders, setReminders] = useState<Partial<Record<AssistedDestinationId, string>>>({});
  const [texts, setTexts] = useState<Partial<Record<AssistedDestinationId, string>>>({});
  const [imageSelections, setImageSelections] = useState<Partial<Record<AssistedDestinationId, string[]>>>({});
  const [slotPreview, setSlotPreview] = useState<{ timeZone: string; suggestions: { platform: PlatformId; scheduledFor: string; skippedConflicts: number }[] } | null>(null);
  const [slotTimes, setSlotTimes] = useState<Partial<Record<PlatformId, string>>>({});
  const [slotApplied, setSlotApplied] = useState(false);
  const [slotBusy, setSlotBusy] = useState(false);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [timeCheckedAt, setTimeCheckedAt] = useState(0);
  const [attempted, setAttempted] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [videoId, setVideoId] = useState<string | null>(draft.videoId ?? null);
  const [videoSelections, setVideoSelections] = useState<Partial<Record<AssistedDestinationId, boolean>>>({});
  const [videoBusy, setVideoBusy] = useState(false);
  const [preflightReports, setPreflightReports] = useState<Partial<Record<AssistedDestinationId, { source: string; text: string; report: PreflightReport }>>>({});
  const [preflightBusyId, setPreflightBusyId] = useState<AssistedDestinationId | null>(null);
  const [preflightErrors, setPreflightErrors] = useState<Partial<Record<AssistedDestinationId, string>>>({});
  const batchIdRef = useRef<string | null>(null);
  const attemptedItemsRef = useRef<BatchHandoffItem[] | null>(null);
  const attemptedSlotModeRef = useRef(false);
  const slotRequestVersion = useRef(0);
  const slotAbortRef = useRef<AbortController | null>(null);
  const submittingRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const reviewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (startExpanded) reviewRef.current?.focus({ preventScroll: true });
  }, [startExpanded]);
  const savedPlatforms = platformDisplayIds.filter((id) => draft.selected.includes(id));
  const additionalPlatforms = platformDisplayIds.filter((id) => !draft.selected.includes(id));
  const availableDestinations: AssistedDestinationId[] = [
    ...platformDisplayIds, ...assistedOnlyDisplayIds,
  ];
  const selectedSlotPlatforms = platformDisplayIds.filter((id) => destinations.includes(id));
  const activeDestination = focusedDestination && destinations.includes(focusedDestination)
    ? focusedDestination : destinations[0] ?? null;
  const priorHandoffs = existing.filter((item) => item.sourceDraftId === draft.id);
  const duplicateDestinations = destinations.filter((id) => priorHandoffs.some((item) => item.destination === id));
  const currentTime = Math.max(now || Date.now(), timeCheckedAt);
  const textFor = (id: AssistedDestinationId) => texts[id] ??
    (isPlatformId(id) ? draft.variants[id] ?? adaptDraft(draft.source, id) : draft.source);
  const videoFor = (id: AssistedDestinationId) => videoId && videoSelections[id] !== false ? videoId : null;
  const imagesFor = (id: AssistedDestinationId) => imageSelections[id] ??
    defaultHandoffImageIds(id, draft.mediaIds ?? [], Boolean(videoFor(id)));
  const invalidText = destinations.filter((id) => {
    const text = textFor(id);
    return isPlatformId(id) ? !validatePlatformText(id, text).valid : !text.trim() || characterCount(text) > 5000;
  });
  const expiredSlotPlatforms = selectedSlotPlatforms.filter((id) => slotApplied &&
    !suggestedSlotIsReady(slotTimes[id], currentTime));
  const slotPreviewExpired = Boolean(slotPreview?.suggestions.some((item) =>
    !suggestedSlotIsReady(item.scheduledFor, currentTime)));
  const invalidReminders = destinations.filter((id) => slotApplied && isPlatformId(id)
    ? expiredSlotPlatforms.includes(id)
    : reminders[id] && !isValidLocalDateTime(reminders[id]!, currentTime));
  const mediaGaps = destinations.flatMap((id) => {
    const kind = missingHandoffMedia(id, imagesFor(id).length, Boolean(videoFor(id)));
    return kind ? [{ id, kind }] : [];
  });
  const mediaLimitIssues = destinations.filter((id) =>
    imagesFor(id).length > imageLimitForDestination(id, Boolean(videoFor(id))));
  const reviewDirty = !prepared && (attempted || !sameIds(destinations, initialDestinations) ||
    Object.entries(texts).some(([id, value]) => value !== (isPlatformId(id) ? draft.variants[id] ?? adaptDraft(draft.source, id) : draft.source)) ||
    Object.entries(imageSelections).some(([id, ids]) => !sameIds(ids ?? [], defaultHandoffImageIds(id, draft.mediaIds ?? [], Boolean(videoFor(id as AssistedDestinationId))))) ||
    Object.values(reminders).some(Boolean) || slotApplied || videoId !== (draft.videoId ?? null) ||
    Boolean(videoId && Object.values(videoSelections).some((selected) => selected === false)));
  useEffect(() => { onStateChange({ dirty: reviewDirty, busy: submitting || videoBusy }); }, [reviewDirty, submitting, videoBusy, onStateChange]);
  useEffect(() => () => onStateChange({ dirty: false, busy: false }), [onStateChange]);
  useEffect(() => () => slotAbortRef.current?.abort(), []);
  const canPrepare = !stale && !editorDirty && !busy && !mediaBusy && !videoBusy && !submitting && !prepared &&
    (attempted ? Boolean(attemptedItemsRef.current) :
      destinations.length > 0 && invalidText.length === 0 && invalidReminders.length === 0 && mediaLimitIssues.length === 0);

  function toggleDestination(id: AssistedDestinationId) {
    if (attempted || submitting) return;
    if (isPlatformId(id)) {
      slotRequestVersion.current += 1;
      slotAbortRef.current?.abort(); slotAbortRef.current = null; setSlotBusy(false);
      setSlotPreview(null); setSlotTimes({}); setSlotApplied(false); setSlotError(null);
    }
    if (!destinations.includes(id)) setFocusedDestination(id);
    else if (focusedDestination === id) setFocusedDestination(null);
    setDestinations((current) => current.includes(id) ? current.filter((item) => item !== id) :
      availableDestinations.filter((item) => current.includes(item) || item === id));
  }

  function openReview() {
    setOpen(true);
    requestAnimationFrame(() => reviewRef.current?.focus());
  }

  function closeReview() {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function discardReview() {
    if (submitting || videoBusy || !window.confirm(attempted
      ? "Discard this review? A handoff request may already have completed. Check Assisted before starting another batch."
      : "Discard your unconfirmed handoff review edits? The saved draft will stay unchanged.")) return;
    slotRequestVersion.current += 1;
    slotAbortRef.current?.abort(); slotAbortRef.current = null; setSlotBusy(false);
    batchIdRef.current = null;
    attemptedItemsRef.current = null;
    attemptedSlotModeRef.current = false;
    setAttempted(false);
    setDestinations(initialDestinations);
    setFocusedDestination(null);
    setReminders({}); setTexts({}); setImageSelections({});
    setVideoId(draft.videoId ?? null); setVideoSelections({});
    setSlotPreview(null); setSlotTimes({}); setSlotApplied(false); setSlotError(null);
    setPreflightReports({}); setPreflightErrors({});
    closeReview();
  }

  function focusDestination(id: AssistedDestinationId, field: "text" | "reminder" = "text") {
    setFocusedDestination(id);
    if (field === "reminder" && slotApplied && isPlatformId(id)) {
      const slots = document.getElementById("batch-weekly-slots") as HTMLDetailsElement | null;
      if (slots) slots.open = true;
      requestAnimationFrame(() => document.getElementById(expiredSlotPlatforms.includes(id) ? "batch-refresh-slots" : "batch-custom-reminders")?.focus());
      return;
    }
    requestAnimationFrame(() => document.getElementById(field === "reminder" ? `batch-reminder-${id}-date` : `batch-text-${id}`)?.focus());
  }

  function prepareAnother() {
    slotRequestVersion.current += 1;
    slotAbortRef.current?.abort(); slotAbortRef.current = null; setSlotBusy(false);
    batchIdRef.current = null;
    attemptedItemsRef.current = null;
    attemptedSlotModeRef.current = false;
    setAttempted(false);
    setPrepared(false);
    setDestinations(initialDestinations);
    setFocusedDestination(null);
    setReminders({});
    setTexts({});
    setImageSelections({});
    setVideoId(draft.videoId ?? null); setVideoSelections({});
    setSlotPreview(null); setSlotTimes({}); setSlotApplied(false); setSlotError(null);
    setPreflightReports({}); setPreflightErrors({});
    openReview();
  }

  async function checkWithAi(destination: AssistedDestinationId) {
    const text = textFor(destination);
    if (preflightBusyId || attempted || !text.trim() || characterCount(text) > 5000) return;
    setPreflightBusyId(destination);
    setPreflightErrors((current) => ({ ...current, [destination]: "" }));
    try {
      const response = await fetch("/api/ai-preflight", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store",
        body: JSON.stringify({ destination, source: draft.source, text }),
      });
      const body = await response.json() as { report?: PreflightReport; error?: string };
      if (!response.ok || !body.report || !Array.isArray(body.report.findings)) {
        throw new Error(body.error || "Could not check this post.");
      }
      setPreflightReports((current) => ({ ...current, [destination]: { source: draft.source, text, report: body.report! } }));
    } catch (cause) {
      setPreflightErrors((current) => ({ ...current, [destination]: cause instanceof Error ? cause.message : "Could not check this post." }));
    } finally { setPreflightBusyId(null); }
  }

  async function previewSlots() {
    if (slotBusy || attempted || !selectedSlotPlatforms.length) return;
    const requestVersion = ++slotRequestVersion.current;
    const controller = new AbortController();
    slotAbortRef.current = controller;
    setSlotBusy(true); setSlotError(null); setSlotPreview(null); setSlotTimes({}); setSlotApplied(false);
    try {
      const response = await fetch("/api/slots", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "suggest", destinations: selectedSlotPlatforms }), signal: controller.signal });
      const body = await response.json() as { timeZone?: string; suggestions?: { platform: PlatformId; scheduledFor: string; skippedConflicts: number }[]; error?: string };
      if (!response.ok || !body.timeZone || !Array.isArray(body.suggestions) || body.suggestions.length !== selectedSlotPlatforms.length ||
          new Set(body.suggestions.map((item) => item.platform)).size !== selectedSlotPlatforms.length ||
          body.suggestions.some((item) => !selectedSlotPlatforms.includes(item.platform) || !Number.isFinite(Date.parse(item.scheduledFor)))) {
        throw new Error(body.error || "Could not preview free slots.");
      }
      if (requestVersion === slotRequestVersion.current) {
        setSlotPreview({ timeZone: body.timeZone, suggestions: body.suggestions });
        requestAnimationFrame(() => document.getElementById("batch-use-slots")?.focus());
      }
    } catch (cause) {
      if (requestVersion === slotRequestVersion.current) {
        setSlotError(cause instanceof Error ? cause.message : "Could not preview free slots.");
        requestAnimationFrame(() => document.getElementById("batch-preview-slots")?.focus());
      }
    }
    finally {
      if (slotAbortRef.current === controller) slotAbortRef.current = null;
      if (requestVersion === slotRequestVersion.current) setSlotBusy(false);
    }
  }

  function applySuggestedSlots() {
    if (!slotPreview) return;
    if (slotPreview.suggestions.some((item) => !suggestedSlotIsReady(item.scheduledFor, Date.now()))) {
      setSlotPreview(null);
      setSlotError("These suggested times have passed. Preview the next free slots.");
      requestAnimationFrame(() => document.getElementById("batch-preview-slots")?.focus());
      return;
    }
    setSlotTimes(Object.fromEntries(slotPreview.suggestions.map((item) => [item.platform, item.scheduledFor])));
    setSlotApplied(true);
    requestAnimationFrame(() => document.getElementById("batch-slot-applied-status")?.focus());
  }

  function useCustomReminderTimes() {
    const destination = activeDestination && isPlatformId(activeDestination) ? activeDestination : selectedSlotPlatforms[0];
    setSlotApplied(false);
    setSlotTimes({});
    setSlotPreview(null);
    if (destination) {
      setFocusedDestination(destination);
      requestAnimationFrame(() => document.getElementById(`batch-reminder-${destination}-date`)?.focus());
    }
  }

  async function prepare() {
    if (submittingRef.current || !canPrepare) return;
    const checkedAt = Date.now();
    if (!attempted && destinations.some((id) => slotApplied && isPlatformId(id)
      ? !suggestedSlotIsReady(slotTimes[id], checkedAt)
      : reminders[id] && !isValidLocalDateTime(reminders[id]!, checkedAt))) {
      setTimeCheckedAt(checkedAt);
      if (slotApplied) setSlotError("A suggested time has passed. Find new times before confirming.");
      return;
    }
    const items = attemptedItemsRef.current ?? (() => {
      const timestamp = Date.now();
      return destinations.map((destination) => {
        const reminder = reminders[destination];
        const selectedVideoId = videoFor(destination);
        return {
          destination,
          text: textFor(destination),
          mediaIds: [...imagesFor(destination)],
          scheduledFor: slotApplied && isPlatformId(destination) ? slotTimes[destination]! : reminder ? new Date(reminder).toISOString() : new Date(timestamp).toISOString(),
          ...(!((slotApplied && isPlatformId(destination)) || reminder) ? { reminderEnabled: false as const } : {}),
          ...(selectedVideoId ? { videoId: selectedVideoId } : {}),
        };
      });
    })();
    attemptedItemsRef.current = items;
    if (!attempted) attemptedSlotModeRef.current = slotApplied;
    if (!batchIdRef.current) batchIdRef.current = crypto.randomUUID();
    submittingRef.current = true;
    setSubmitting(true);
    setAttempted(true);
    try {
      const result = await onPrepare(draft.id, draft.updatedAt, batchIdRef.current, items, attemptedSlotModeRef.current);
      if (result === "prepared") setPrepared(true);
      if (result === "rejected") {
        batchIdRef.current = null;
        attemptedItemsRef.current = null;
        attemptedSlotModeRef.current = false;
        setAttempted(false);
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function destinationOption(id: AssistedDestinationId) {
    const selected = destinations.includes(id);
    const wasPrepared = priorHandoffs.some((item) => item.destination === id);
    return <label key={id} className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[12px] font-semibold text-[var(--text-secondary)]">
      <input type="checkbox" checked={selected} onChange={() => toggleDestination(id)} disabled={attempted || submitting || editorDirty} className="h-4 w-4 shrink-0 accent-[var(--accent)]" />
      <span className="truncate">{assistedDestinations[id].name}</span>
      {wasPrepared ? <span className="ml-auto shrink-0 text-[10px] font-normal text-[var(--text-muted)]">Prepared</span> :
        isPlatformId(id) && !draft.selected.includes(id) && <span className="ml-auto shrink-0 text-[10px] font-normal text-[var(--text-muted)]">From base draft</span>}
    </label>;
  }

  return <section className="panel-border soft-shadow rounded-[18px] bg-[var(--surface)] p-6 sm:p-7" aria-labelledby="batch-handoff-heading">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h2 id="batch-handoff-heading" className="text-[17px] font-bold tracking-[-0.025em] text-[var(--text)]">Prepare manual posts</h2><p className="mt-1 text-[13px] leading-5 text-[var(--text-muted)]">Review a separate handoff for each platform you want to use.</p></div>
      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-bold text-[var(--accent-text)]"><Copy size={12} aria-hidden="true" /> Manual</span>
    </div>
    {editorDirty && <p role="status" className="mt-4 rounded-xl bg-[var(--warning-soft)] px-3 py-2.5 text-[12px] leading-5 text-[var(--warning)]">Save your latest editor changes first. Handoffs use the saved version of this draft.</p>}
    {stale && <p role="alert" className="mt-4 rounded-xl bg-[var(--warning-soft)] px-3 py-2.5 text-[12px] leading-5 text-[var(--warning)]">This saved draft changed or was deleted in another window. Your review edits are still here, but cannot be confirmed against the old version. Copy anything you need{onOpenLatest ? <>, then <button type="button" onClick={onOpenLatest} className="font-bold underline underline-offset-2">open the latest draft</button>.</> : " before starting a new draft."}</p>}
    {!editorDirty && !open && !prepared && <button ref={triggerRef} type="button" onClick={openReview} aria-expanded={open} aria-controls="batch-handoff-review" disabled={busy || mediaBusy} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] px-4 py-3 text-[13px] font-bold text-[var(--accent-text)] transition hover:bg-[var(--surface-hover)] disabled:opacity-45">Review manual handoffs <ArrowRight size={15} aria-hidden="true" /></button>}
    {!open && reviewDirty && <button type="button" onClick={discardReview} disabled={submitting || videoBusy} className="mt-2 text-[12px] font-semibold text-[var(--danger)] underline underline-offset-2 disabled:opacity-45">Discard review edits</button>}
    {priorHandoffs.length > 0 && !prepared && <p className="mt-3 text-[11px] leading-5 text-[var(--text-muted)]">{priorHandoffs.length} {priorHandoffs.length === 1 ? "handoff" : "handoffs"} already prepared from this draft. Previously prepared platforms are unchecked by default. <button type="button" onClick={onOpenAssisted} className="font-semibold text-[var(--accent-text)] underline underline-offset-2">View existing handoffs</button></p>}
    {prepared && <div role="status" className="mt-4 rounded-xl border border-[var(--positive)] bg-[var(--positive-soft)] p-4 text-[12px] leading-5 text-[var(--positive)]"><p className="flex items-center gap-2 font-bold"><Check size={15} aria-hidden="true" /> Handoffs added to Assisted.</p><p className="mt-1">Copy the saved text and download any media, then publish from your own accounts. Plypost has not posted anything.</p><div className="mt-3 flex flex-wrap gap-4"><button type="button" onClick={onOpenAssisted} className="inline-flex items-center gap-1 font-bold underline underline-offset-2">Open Assisted <ArrowRight size={13} aria-hidden="true" /></button><button type="button" onClick={prepareAnother} className="font-semibold underline underline-offset-2">Prepare another batch</button></div></div>}
    {open && !prepared && <div id="batch-handoff-review" ref={reviewRef} role="dialog" aria-modal="false" aria-labelledby="batch-handoff-review-heading" tabIndex={-1} onKeyDown={(event) => { if (event.key === "Escape" && !submitting) { event.preventDefault(); closeReview(); } }} className="mt-5 space-y-4 border-t border-[var(--line)] pt-5 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
      <h3 id="batch-handoff-review-heading" className="text-[14px] font-bold text-[var(--text)]">Review manual handoffs</h3>
      <div className="flex items-start gap-2 rounded-xl bg-[var(--surface-muted)] px-3 py-2.5 text-[12px] leading-5 text-[var(--text-muted)]"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-[var(--accent-text)]" aria-hidden="true" /><span>Edit each platform's text here without changing the saved draft. Reminder times are optional. Confirming adds checklist items; you publish the posts yourself.</span></div>
      <details className="rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] p-3" open={destinations.length === 0 ? true : undefined}>
        <summary className="cursor-pointer text-[12px] font-bold text-[var(--text-secondary)]">Choose destinations · {destinations.length} selected</summary>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
            <p className="mb-2 text-[12px] font-bold text-[var(--text-secondary)]">Photo &amp; text-first</p>
            {savedPlatforms.length > 0 && <div className="grid gap-2">{savedPlatforms.map(destinationOption)}</div>}
            <details className={savedPlatforms.length ? "mt-2" : ""} open={savedPlatforms.length === 0 ? true : undefined}>
              <summary className="cursor-pointer py-1 text-[12px] font-semibold text-[var(--accent-text)]">{savedPlatforms.length ? "More photo & text platforms" : "Choose a platform"}</summary>
              <div className="mt-2 grid gap-2">{additionalPlatforms.map(destinationOption)}{assistedTextImageOnlyDisplayIds.map(destinationOption)}</div>
            </details>
          </div>
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
            <p className="mb-2 text-[12px] font-bold text-[var(--text-secondary)]">Video-first</p>
            <div className="grid gap-2">{assistedVideoDisplayIds.map(destinationOption)}</div>
            <p className="mt-2 text-[11px] leading-4 text-[var(--text-muted)]">YouTube needs a video. TikTok can use photos too.</p>
          </div>
        </div>
      </details>
      {!attempted && <details id="batch-weekly-slots" className="rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] p-3"><summary className="cursor-pointer text-[12px] font-bold text-[var(--text-secondary)]">Weekly posting slots · optional{slotApplied ? " · applied" : ""}</summary><div className="mt-3 border-t border-[var(--line)] pt-3"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-[12px] font-semibold text-[var(--text-secondary)]">Use weekly posting slots</p><button id="batch-preview-slots" type="button" disabled={slotBusy || !selectedSlotPlatforms.length} onClick={() => void previewSlots()} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[12px] font-semibold text-[var(--accent-text)] disabled:opacity-45">{slotBusy ? "Finding slots…" : "Preview next free slots"}</button></div><p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">Suggestions start at least 10 minutes from now. Slots apply to the four draft platforms; other platforms can use custom reminder times.</p>
        {slotError && <p role="alert" className="mt-2 text-[12px] text-[var(--danger)]">{slotError}</p>}
        {slotPreview && !slotApplied && <div className="mt-3 space-y-2"><p className="text-[11px] font-bold text-[var(--text-secondary)]">Suggested in {slotPreview.timeZone}</p>{slotPreview.suggestions.map((item) => <p key={item.platform} className="text-[12px] text-[var(--text-secondary)]">{platforms[item.platform].name}: {new Intl.DateTimeFormat("en-US", { timeZone: slotPreview.timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(item.scheduledFor))}{item.skippedConflicts ? ` · ${item.skippedConflicts} occupied ${item.skippedConflicts === 1 ? "slot" : "slots"} skipped` : ""}</p>)}{slotPreviewExpired && <p role="alert" className="text-[11px] text-[var(--danger)]">These suggested times have passed. Find new times before using them.</p>}<button id="batch-use-slots" type="button" disabled={slotBusy} onClick={slotPreviewExpired ? () => void previewSlots() : applySuggestedSlots} className="rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-[12px] font-bold text-[var(--accent-text)] disabled:opacity-45">{slotPreviewExpired ? "Find new times" : "Use these reminder times"}</button></div>}
        {slotApplied && <div className="mt-3 flex flex-wrap items-center gap-3"><p id="batch-slot-applied-status" tabIndex={-1} role="status" className={`rounded text-[12px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${expiredSlotPlatforms.length ? "text-[var(--danger)]" : "text-[var(--positive)]"}`}>{expiredSlotPlatforms.length ? "A suggested time has passed. Find new times before confirming." : "Suggested times added for review below."}</p>{expiredSlotPlatforms.length > 0 && <button id="batch-refresh-slots" type="button" disabled={slotBusy} onClick={() => void previewSlots()} className="text-[11px] font-semibold text-[var(--accent-text)] underline underline-offset-2 disabled:opacity-45">Find new times</button>}<button id="batch-custom-reminders" type="button" onClick={useCustomReminderTimes} className="text-[11px] font-semibold text-[var(--accent-text)] underline underline-offset-2">Use custom reminder times</button></div>}
      </div></details>}
      {destinations.length > 0 ? <div>
        <p className="mb-2 text-[12px] font-bold text-[var(--text-secondary)]">Review each post · {destinations.length} selected</p>
        <div role="group" aria-label="Selected posts to review" className="flex flex-wrap gap-2">
          {destinations.map((id) => {
            const active = id === activeDestination;
            const needsEdit = invalidText.includes(id) || invalidReminders.includes(id) || mediaLimitIssues.includes(id);
            return <button key={id} type="button" aria-pressed={active} aria-controls="batch-active-editor" onClick={() => setFocusedDestination(id)} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-semibold transition ${active ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--text)]" : "border-[var(--line)] bg-[var(--surface)] text-[var(--text-secondary)] hover:border-[var(--accent-border)]"}`}>
              {assistedDestinations[id].name}
              <span className={`text-[10px] ${needsEdit ? "text-[var(--danger)]" : "text-[var(--text-muted)]"}`}>{needsEdit ? "Fix" : texts[id] !== undefined ? "Edited" : "Draft"}</span>
              {mediaGaps.some((gap) => gap.id === id) && <span className="text-[10px] text-[var(--warning)]">Media later</span>}
              {imagesFor(id).length > 0 && videoFor(id) && <span className="text-[10px] text-[var(--warning)]">Photos + video</span>}
              {(reminders[id] || (slotApplied && isPlatformId(id) && slotTimes[id])) && <span className="text-[10px] text-[var(--accent-text)]">Time set</span>}
            </button>;
          })}
        </div>
      </div> : <p className="rounded-xl border border-dashed border-[var(--line)] px-4 py-5 text-[12px] text-[var(--text-muted)]">Choose at least one destination to review.</p>}
      {(activeDestination ? [activeDestination] : []).map((id) => {
        const text = textFor(id);
        const check = isPlatformId(id) ? validatePlatformText(id, text) : null;
        const valid = check?.valid ?? Boolean(text.trim() && characterCount(text) <= 5000);
        const missingMedia = missingHandoffMedia(id, imagesFor(id).length, Boolean(videoFor(id)));
        const preflight = preflightReports[id];
        const preflightStale = Boolean(preflight && (preflight.source !== draft.source || preflight.text !== text));
        return <div key={id} id="batch-active-editor" className="min-w-0 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] p-4">
          <label htmlFor={`batch-text-${id}`} className="text-[13px] font-bold text-[var(--text)]">{assistedDestinations[id].name} text</label>
          <textarea id={`batch-text-${id}`} value={text} onChange={(event) => setTexts((current) => ({ ...current, [id]: event.target.value }))} disabled={attempted} aria-invalid={!valid} aria-describedby={`batch-text-${id}-validation`} className="mt-2 min-h-28 w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-[13px] leading-5 text-[var(--text)] outline-none focus:border-[var(--accent-border)] disabled:opacity-70" />
          {!isPlatformId(id) && isManualAiDestination(id) && <AIHandoffAssistant destination={id} source={text} disabled={attempted || editorDirty || busy || mediaBusy} onApply={(next) => setTexts((current) => ({ ...current, [id]: next }))} />}
          <p id={`batch-text-${id}-validation`} className={`mt-1 text-[11px] ${valid ? "text-[var(--text-muted)]" : "font-semibold text-[var(--danger)]"}`}>{check ? `${check.count} / ${check.limit} ${id === "bluesky" ? "graphemes" : "characters"}` : `${characterCount(text)} / 5,000 characters`}{check?.byteCount !== undefined ? ` · ${check.byteCount} / ${check.byteLimit} UTF-8 bytes` : ""}{!valid ? " · Edit this text before confirming" : ""}</p>
          {draft.source.trim() && <AiLiteralNotice source={draft.source} suggestion={text} />}
          {!isPlatformId(id) && <p className="mt-2 text-[11px] leading-5 text-[var(--text-muted)]">{assistedDestinations[id].hint}{missingMedia === "video" ? " No video is attached here; bring one when posting." : missingMedia ? " No photo or video is attached here; bring one when posting." : ""}</p>}
          <PlatformImageSelection destination={id} sourceIds={draft.mediaIds ?? []} sourceAlt={draft.mediaAlt} selectedIds={imagesFor(id)} hasVideo={Boolean(videoFor(id))} onChange={(ids) => setImageSelections((current) => ({ ...current, [id]: ids }))} disabled={attempted || editorDirty || busy || mediaBusy} />
          {videoId && <label className="mt-2 flex items-start gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[12px] font-semibold leading-5 text-[var(--text-secondary)]">
            <input type="checkbox" checked={Boolean(videoFor(id))} onChange={(event) => setVideoSelections((current) => ({ ...current, [id]: event.target.checked }))} disabled={attempted || editorDirty || busy || mediaBusy} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]" />
            Include the saved video in this {assistedDestinations[id].name} handoff
          </label>}
          {id !== "x" && id !== "youtube" && id !== "bluesky" && imagesFor(id).length > 0 && videoFor(id) && <p role="status" className="mt-2 rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-[12px] leading-5 text-[var(--warning)]">This handoff includes photos and a video. Check {assistedDestinations[id].name}&apos;s current rules before posting; deselect the photos above or turn off video here if it accepts only one format per post.</p>}
          {imageLimitWarning(id, imagesFor(id).length, Boolean(videoFor(id))) && <p role="alert" className="mt-2 rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-[12px] leading-5 text-[var(--danger)]">{imageLimitWarning(id, imagesFor(id).length, Boolean(videoFor(id)))}</p>}
          {draft.placeLabel && <p className="mt-2 text-[12px] text-[var(--text-secondary)]">Place note: {draft.placeLabel} · add on the platform yourself</p>}
          <div className="mt-3 rounded-lg border border-[var(--accent-border)] bg-[var(--surface)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><p className="text-[13px] font-bold text-[var(--text)]">AI post check</p><p className="mt-0.5 text-[12px] leading-5 text-[var(--text-muted)]">Check this post against the saved draft before publishing.</p></div>
              <button type="button" onClick={() => void checkWithAi(id)} disabled={attempted || editorDirty || busy || mediaBusy || Boolean(preflightBusyId) || !text.trim() || characterCount(text) > 5000} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-2 text-[12px] font-bold text-[var(--accent-text)] disabled:opacity-45"><Sparkles size={13} aria-hidden="true" />{preflightBusyId === id ? "Checking…" : preflight ? "Check again" : "Check with AI"}</button>
            </div>
            <p className="mt-2 text-[11px] leading-4 text-[var(--text-soft)]">Clicking sends this post and the saved draft text to Nebius. It does not send media or verify facts online.</p>
            {preflightErrors[id] && <p role="alert" className="mt-2 text-[11px] text-[var(--danger)]">{preflightErrors[id]}</p>}
            {preflightStale && <p role="status" className="mt-2 text-[11px] font-semibold text-[var(--warning)]">Text changed after this check. Run it again for the current version.</p>}
            {preflight && !preflightStale && <div role="status" className="mt-3 border-t border-[var(--line)] pt-3">
              {preflight.report.findings.length ? <ul className="space-y-2">{preflight.report.findings.map((finding, index) => <li key={`${finding.excerpt}-${index}`} className="rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-[12px] leading-5 text-[var(--text-secondary)]"><span className="font-bold text-[var(--accent-text)]">{finding.kind === "source-drift" ? "Check against draft" : "Check clarity"}</span><span className="mx-1">·</span><q className="break-words">{finding.excerpt}</q><p className="mt-0.5">{finding.question}</p></li>)}</ul> : <p className="text-[12px] leading-5 text-[var(--text-muted)]">No specific wording concerns found. Verify facts, links and platform formatting yourself.</p>}
            </div>}
          </div>
          <div className="mt-3">{slotApplied && isPlatformId(id) && slotTimes[id] ? <p className="rounded-lg border border-[var(--accent-border)] bg-[var(--surface)] px-3 py-2 text-[12px] font-semibold text-[var(--text-secondary)]">Reminder: {new Intl.DateTimeFormat("en-US", { timeZone: slotPreview?.timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(slotTimes[id]))} · {slotPreview?.timeZone}</p> : <fieldset disabled={attempted} className={attempted ? "opacity-70" : ""}><LocalDateTimeField id={`batch-reminder-${id}`} label={`${assistedDestinations[id].name} reminder`} value={reminders[id] ?? ""} minTimestamp={currentTime} optional onChange={(value) => setReminders((current) => ({ ...current, [id]: value }))} /></fieldset>}</div>
        </div>;
      })}
      {!draft.mediaIds?.length && <p className="text-[11px] leading-5 text-[var(--text-soft)]">{videoId ? "This draft has no saved images. The selected video will be attached to each handoff." : "This draft has no saved images. You can still bring media directly to the platform when publishing."}</p>}
      <details className="rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] p-3">
        <summary className="cursor-pointer text-[12px] font-bold text-[var(--text-secondary)]">Video for this batch · {videoId ? "attached" : "optional"}</summary>
        <div className="mt-3"><VideoAttachmentPicker selectedId={videoId} onChange={setVideoId} onBusyChange={setVideoBusy} disabled={busy || mediaBusy || attempted || submitting} /></div>
        <p className="mt-2 text-[11px] leading-5 text-[var(--text-muted)]">The selected clip is available to each handoff. Turn it off for individual platforms above, or change a saved handoff in Assisted before posting.</p>
      </details>
      {!attempted && (invalidText.length > 0 || invalidReminders.length > 0) && <div role="alert" className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2.5 text-[12px] text-[var(--danger)]">
        <p className="font-semibold">Fix these posts before confirming:</p>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {destinations.filter((id) => invalidText.includes(id) || invalidReminders.includes(id)).map((id) => <span key={id} className="inline-flex flex-wrap gap-2">
            {invalidText.includes(id) && <button type="button" onClick={() => focusDestination(id, "text")} className="font-semibold underline underline-offset-2">{assistedDestinations[id].name} · text</button>}
            {invalidReminders.includes(id) && <button type="button" onClick={() => focusDestination(id, "reminder")} className="font-semibold underline underline-offset-2">{assistedDestinations[id].name} · reminder</button>}
          </span>)}
        </div>
      </div>}
      {!attempted && mediaGaps.length > 0 && <div role="status" className="rounded-lg bg-[var(--warning-soft)] px-3 py-2.5 text-[12px] leading-5 text-[var(--warning)]">
        <p className="font-semibold">Media to bring before posting</p>
        <p>These handoffs can be saved now. Add media in Assisted or bring it directly to the platform before you publish:</p>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {mediaGaps.map(({ id, kind }) => <button key={id} type="button" onClick={() => focusDestination(id)} className="font-semibold underline underline-offset-2">{assistedDestinations[id].name} · {kind === "video" ? "video" : "photo or video"}</button>)}
        </div>
      </div>}
      {mediaLimitIssues.length > 0 && <div role="alert" className="rounded-lg bg-[var(--danger-soft)] px-3 py-2.5 text-[12px] leading-5 text-[var(--danger)]">
        <p className="font-semibold">Review media counts before confirming</p>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">{mediaLimitIssues.map((id) => <button key={id} type="button" onClick={() => focusDestination(id)} className="font-semibold underline underline-offset-2">{assistedDestinations[id].name}</button>)}</div>
      </div>}
      {duplicateDestinations.length > 0 && <p role="status" className="rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-[11px] leading-5 text-[var(--warning)]">{duplicateDestinations.map((id) => assistedDestinations[id].name).join(", ")} already {duplicateDestinations.length === 1 ? "has a handoff" : "have handoffs"} from this draft. Confirming will add another item for each selected platform.</p>}
      {attempted && <p role="status" className="text-[11px] leading-5 text-[var(--text-muted)]">If the request did not confirm, retry the same batch. Check Assisted before starting another batch.</p>}
      <div className="flex flex-wrap items-center justify-end gap-3">{reviewDirty && <button type="button" onClick={discardReview} disabled={submitting || videoBusy} className="rounded-lg px-3 py-2 text-[12px] font-semibold text-[var(--danger)] disabled:opacity-45">Discard review edits</button>}<button type="button" onClick={closeReview} disabled={submitting} className="rounded-lg px-3 py-2 text-[12px] font-semibold text-[var(--text-secondary)] disabled:opacity-45">Close review</button><button type="button" onClick={() => void prepare()} disabled={!canPrepare} className="gradient-button inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[12px] font-bold text-white disabled:opacity-45"><Check size={15} aria-hidden="true" />{submitting ? "Preparing…" : attempted ? "Retry same batch" : `Confirm ${destinations.length} ${destinations.length === 1 ? "handoff" : "handoffs"}`}</button></div>
    </div>}
  </section>;
}
