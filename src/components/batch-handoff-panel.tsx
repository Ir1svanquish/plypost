"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Copy, ShieldCheck } from "lucide-react";
import { LocalDateTimeField, isValidLocalDateTime } from "@/components/local-date-time-field";
import { MediaHandoff } from "@/components/media-handoff";
import { VideoAttachmentPicker } from "@/components/video-attachment-picker";
import { adaptDraft, characterCount, isPlatformId, platformDisplayIds, platforms, type PlatformId } from "@/lib/platforms";
import { assistedDestinations, assistedOnlyDisplayIds, assistedTextImageOnlyDisplayIds, assistedVideoDisplayIds, missingHandoffMedia, type AssistedDestinationId } from "@/lib/assisted";
import { validatePlatformText } from "@/lib/platform-validation";
import type { AssistedPost, SavedDraft } from "@/lib/workspace";

export type BatchHandoffItem = { destination: AssistedDestinationId; scheduledFor: string; text: string; reminderEnabled?: false; videoId?: string };
export type BatchPrepareResult = "prepared" | "rejected" | "uncertain";

type Props = {
  draft: SavedDraft;
  existing: AssistedPost[];
  now: number;
  editorDirty: boolean;
  busy: boolean;
  mediaBusy: boolean;
  startExpanded?: boolean;
  onPrepare: (draftId: string, expectedUpdatedAt: string, batchId: string, items: BatchHandoffItem[], requireFreeSlots: boolean) => Promise<BatchPrepareResult>;
  onOpenAssisted: () => void;
};

export function BatchHandoffPanel({ draft, existing, now, editorDirty, busy, mediaBusy, startExpanded = false, onPrepare, onOpenAssisted }: Props) {
  const [open, setOpen] = useState(startExpanded);
  const [destinations, setDestinations] = useState<AssistedDestinationId[]>(() => platformDisplayIds.filter((id) =>
    draft.selected.includes(id) && !existing.some((item) => item.sourceDraftId === draft.id && item.destination === id)));
  const [focusedDestination, setFocusedDestination] = useState<AssistedDestinationId | null>(null);
  const [reminders, setReminders] = useState<Partial<Record<AssistedDestinationId, string>>>({});
  const [texts, setTexts] = useState<Partial<Record<AssistedDestinationId, string>>>({});
  const [slotPreview, setSlotPreview] = useState<{ timeZone: string; suggestions: { platform: PlatformId; scheduledFor: string; skippedConflicts: number }[] } | null>(null);
  const [slotTimes, setSlotTimes] = useState<Partial<Record<PlatformId, string>>>({});
  const [slotApplied, setSlotApplied] = useState(false);
  const [slotBusy, setSlotBusy] = useState(false);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [videoId, setVideoId] = useState<string | null>(draft.videoId ?? null);
  const [videoBusy, setVideoBusy] = useState(false);
  const batchIdRef = useRef<string | null>(null);
  const attemptedItemsRef = useRef<BatchHandoffItem[] | null>(null);
  const attemptedSlotModeRef = useRef(false);
  const submittingRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const reviewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (startExpanded) reviewRef.current?.focus({ preventScroll: true });
  }, [startExpanded]);
  const savedPlatforms = platformDisplayIds.filter((id) => draft.selected.includes(id));
  const availableDestinations: AssistedDestinationId[] = [
    ...savedPlatforms, ...assistedOnlyDisplayIds,
  ];
  const selectedSlotPlatforms = savedPlatforms.filter((id) => destinations.includes(id));
  const activeDestination = focusedDestination && destinations.includes(focusedDestination)
    ? focusedDestination : destinations[0] ?? null;
  const priorHandoffs = existing.filter((item) => item.sourceDraftId === draft.id);
  const duplicateDestinations = destinations.filter((id) => priorHandoffs.some((item) => item.destination === id));
  const currentTime = now || Date.now();
  const textFor = (id: AssistedDestinationId) => texts[id] ??
    (isPlatformId(id) ? draft.variants[id] ?? adaptDraft(draft.source, id) : draft.source);
  const invalidText = destinations.filter((id) => {
    const text = textFor(id);
    return isPlatformId(id) ? !validatePlatformText(id, text).valid : !text.trim() || characterCount(text) > 5000;
  });
  const invalidReminders = destinations.filter((id) => slotApplied && isPlatformId(id)
    ? !slotTimes[id] || Date.parse(slotTimes[id]!) < currentTime + 10_000
    : reminders[id] && !isValidLocalDateTime(reminders[id]!, currentTime));
  const mediaGaps = destinations.flatMap((id) => {
    const kind = missingHandoffMedia(id, draft.mediaIds?.length ?? 0, Boolean(videoId));
    return kind ? [{ id, kind }] : [];
  });
  const canPrepare = !editorDirty && !busy && !mediaBusy && !videoBusy && !submitting && !prepared &&
    (attempted ? Boolean(attemptedItemsRef.current) :
      destinations.length > 0 && invalidText.length === 0 && invalidReminders.length === 0);

  function toggleDestination(id: AssistedDestinationId) {
    if (attempted || submitting) return;
    if (isPlatformId(id)) {
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

  function focusDestination(id: AssistedDestinationId) {
    setFocusedDestination(id);
    requestAnimationFrame(() => document.getElementById(`batch-text-${id}`)?.focus());
  }

  function prepareAnother() {
    batchIdRef.current = null;
    attemptedItemsRef.current = null;
    attemptedSlotModeRef.current = false;
    setAttempted(false);
    setPrepared(false);
    setDestinations(platformDisplayIds.filter((id) => draft.selected.includes(id) && !existing.some((item) =>
      item.sourceDraftId === draft.id && item.destination === id)));
    setFocusedDestination(null);
    setReminders({});
    setTexts({});
    setVideoId(draft.videoId ?? null);
    setSlotPreview(null); setSlotTimes({}); setSlotApplied(false); setSlotError(null);
    openReview();
  }

  async function previewSlots() {
    if (slotBusy || attempted || !selectedSlotPlatforms.length) return;
    setSlotBusy(true); setSlotError(null); setSlotPreview(null); setSlotTimes({}); setSlotApplied(false);
    try {
      const response = await fetch("/api/slots", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "suggest", destinations: selectedSlotPlatforms }) });
      const body = await response.json() as { timeZone?: string; suggestions?: { platform: PlatformId; scheduledFor: string; skippedConflicts: number }[]; error?: string };
      if (!response.ok || !body.timeZone || !Array.isArray(body.suggestions) || body.suggestions.length !== selectedSlotPlatforms.length ||
          body.suggestions.some((item) => !selectedSlotPlatforms.includes(item.platform) || !Number.isFinite(Date.parse(item.scheduledFor)))) {
        throw new Error(body.error || "Could not preview free slots.");
      }
      setSlotPreview({ timeZone: body.timeZone, suggestions: body.suggestions });
    } catch (cause) { setSlotError(cause instanceof Error ? cause.message : "Could not preview free slots."); }
    finally { setSlotBusy(false); }
  }

  async function prepare() {
    if (submittingRef.current || !canPrepare) return;
    if (!attempted && destinations.some((id) => slotApplied && isPlatformId(id)
      ? !slotTimes[id] || Date.parse(slotTimes[id]!) < Date.now() + 10_000
      : reminders[id] && !isValidLocalDateTime(reminders[id]!, Date.now()))) return;
    const items = attemptedItemsRef.current ?? (() => {
      const timestamp = Date.now();
      return destinations.map((destination) => {
        const reminder = reminders[destination];
        return {
          destination,
          text: textFor(destination),
          scheduledFor: slotApplied && isPlatformId(destination) ? slotTimes[destination]! : reminder ? new Date(reminder).toISOString() : new Date(timestamp).toISOString(),
          ...(!((slotApplied && isPlatformId(destination)) || reminder) ? { reminderEnabled: false as const } : {}),
          ...(videoId ? { videoId } : {}),
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
    return <label key={id} className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[12px] font-semibold text-[var(--text-secondary)]">
      <input type="checkbox" checked={selected} onChange={() => toggleDestination(id)} disabled={attempted || submitting || editorDirty} className="h-4 w-4 shrink-0 accent-[var(--accent)]" />
      <span className="truncate">{assistedDestinations[id].name}</span>
      {priorHandoffs.some((item) => item.destination === id) && <span className="ml-auto shrink-0 text-[10px] font-normal text-[var(--text-muted)]">Prepared</span>}
    </label>;
  }

  return <section className="panel-border soft-shadow rounded-[18px] bg-[var(--surface)] p-6 sm:p-7" aria-labelledby="batch-handoff-heading">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h2 id="batch-handoff-heading" className="text-[17px] font-bold tracking-[-0.025em] text-[var(--text)]">Prepare manual posts</h2><p className="mt-1 text-[13px] leading-5 text-[var(--text-muted)]">Review a separate handoff for each platform you want to use.</p></div>
      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-bold text-[var(--accent-text)]"><Copy size={12} aria-hidden="true" /> Manual</span>
    </div>
    {editorDirty && <p role="status" className="mt-4 rounded-xl bg-[var(--warning-soft)] px-3 py-2.5 text-[12px] leading-5 text-[var(--warning)]">Save your latest editor changes first. Handoffs use the saved version of this draft.</p>}
    {!editorDirty && !open && !prepared && <button ref={triggerRef} type="button" onClick={openReview} aria-expanded={open} aria-controls="batch-handoff-review" disabled={busy || mediaBusy} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] px-4 py-3 text-[13px] font-bold text-[var(--accent-text)] transition hover:bg-[var(--surface-hover)] disabled:opacity-45">Review manual handoffs <ArrowRight size={15} aria-hidden="true" /></button>}
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
              <div className="mt-2 grid gap-2">{assistedTextImageOnlyDisplayIds.map(destinationOption)}</div>
            </details>
          </div>
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
            <p className="mb-2 text-[12px] font-bold text-[var(--text-secondary)]">Video-first</p>
            <div className="grid gap-2">{assistedVideoDisplayIds.map(destinationOption)}</div>
            <p className="mt-2 text-[11px] leading-4 text-[var(--text-muted)]">YouTube needs a video. TikTok can use photos too.</p>
          </div>
        </div>
      </details>
      {!attempted && <details className="rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] p-3"><summary className="cursor-pointer text-[12px] font-bold text-[var(--text-secondary)]">Weekly posting slots · optional{slotApplied ? " · applied" : ""}</summary><div className="mt-3 border-t border-[var(--line)] pt-3"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-[12px] font-semibold text-[var(--text-secondary)]">Use weekly posting slots</p><button type="button" disabled={slotBusy || !selectedSlotPlatforms.length} onClick={() => void previewSlots()} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[12px] font-semibold text-[var(--accent-text)] disabled:opacity-45">{slotBusy ? "Finding slots…" : "Preview next free slots"}</button></div><p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">Slots apply to the four draft platforms. Other platforms can use custom reminder times.</p>
        {slotError && <p role="alert" className="mt-2 text-[12px] text-[var(--danger)]">{slotError}</p>}
        {slotPreview && !slotApplied && <div className="mt-3 space-y-2"><p className="text-[11px] font-bold text-[var(--text-secondary)]">Suggested in {slotPreview.timeZone}</p>{slotPreview.suggestions.map((item) => <p key={item.platform} className="text-[12px] text-[var(--text-secondary)]">{platforms[item.platform].name}: {new Intl.DateTimeFormat("en-US", { timeZone: slotPreview.timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(item.scheduledFor))}{item.skippedConflicts ? ` · ${item.skippedConflicts} occupied ${item.skippedConflicts === 1 ? "slot" : "slots"} skipped` : ""}</p>)}<button type="button" onClick={() => { setSlotTimes(Object.fromEntries(slotPreview.suggestions.map((item) => [item.platform, item.scheduledFor]))); setSlotApplied(true); }} className="rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-[12px] font-bold text-[var(--accent-text)]">Use these reminder times</button></div>}
        {slotApplied && <div className="mt-3 flex flex-wrap items-center gap-3"><p role="status" className="text-[12px] font-semibold text-[var(--positive)]">Suggested times added for review below.</p><button type="button" onClick={() => { setSlotApplied(false); setSlotTimes({}); setSlotPreview(null); }} className="text-[11px] font-semibold text-[var(--accent-text)] underline underline-offset-2">Use custom reminder times</button></div>}
      </div></details>}
      {destinations.length > 0 ? <div>
        <p className="mb-2 text-[12px] font-bold text-[var(--text-secondary)]">Review each post · {destinations.length} selected</p>
        <div role="group" aria-label="Selected posts to review" className="flex flex-wrap gap-2">
          {destinations.map((id) => {
            const active = id === activeDestination;
            const needsEdit = invalidText.includes(id) || invalidReminders.includes(id);
            return <button key={id} type="button" aria-pressed={active} aria-controls="batch-active-editor" onClick={() => setFocusedDestination(id)} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-semibold transition ${active ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--text)]" : "border-[var(--line)] bg-[var(--surface)] text-[var(--text-secondary)] hover:border-[var(--accent-border)]"}`}>
              {assistedDestinations[id].name}
              <span className={`text-[10px] ${needsEdit ? "text-[var(--danger)]" : "text-[var(--text-muted)]"}`}>{needsEdit ? "Fix" : texts[id] !== undefined ? "Edited" : "Draft"}</span>
              {mediaGaps.some((gap) => gap.id === id) && <span className="text-[10px] text-[var(--warning)]">Media later</span>}
              {(reminders[id] || (slotApplied && isPlatformId(id) && slotTimes[id])) && <span className="text-[10px] text-[var(--accent-text)]">Time set</span>}
            </button>;
          })}
        </div>
      </div> : <p className="rounded-xl border border-dashed border-[var(--line)] px-4 py-5 text-[12px] text-[var(--text-muted)]">Choose at least one destination to review.</p>}
      {(activeDestination ? [activeDestination] : []).map((id) => {
        const text = textFor(id);
        const check = isPlatformId(id) ? validatePlatformText(id, text) : null;
        const valid = check?.valid ?? Boolean(text.trim() && characterCount(text) <= 5000);
        const missingMedia = missingHandoffMedia(id, draft.mediaIds?.length ?? 0, Boolean(videoId));
        return <div key={id} id="batch-active-editor" className="min-w-0 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] p-4">
          <label htmlFor={`batch-text-${id}`} className="text-[13px] font-bold text-[var(--text)]">{assistedDestinations[id].name} text</label>
          <textarea id={`batch-text-${id}`} value={text} onChange={(event) => setTexts((current) => ({ ...current, [id]: event.target.value }))} disabled={attempted} className="mt-2 min-h-28 w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-[13px] leading-5 text-[var(--text)] outline-none focus:border-[var(--accent-border)] disabled:opacity-70" />
          <p className={`mt-1 text-[11px] ${valid ? "text-[var(--text-muted)]" : "font-semibold text-[var(--danger)]"}`}>{check ? `${check.count} / ${check.limit} ${id === "bluesky" ? "graphemes" : "characters"}` : `${characterCount(text)} / 5,000 characters`}{check?.byteCount !== undefined ? ` · ${check.byteCount} / ${check.byteLimit} UTF-8 bytes` : ""}{!valid ? " · Edit this text before confirming" : ""}</p>
          {!isPlatformId(id) && <p className="mt-2 text-[11px] leading-5 text-[var(--text-muted)]">{assistedDestinations[id].hint}{missingMedia === "video" ? " No video is attached here; bring one when posting." : missingMedia ? " No photo or video is attached here; bring one when posting." : ""}</p>}
          <div className="mt-3">{slotApplied && isPlatformId(id) && slotTimes[id] ? <p className="rounded-lg border border-[var(--accent-border)] bg-[var(--surface)] px-3 py-2 text-[12px] font-semibold text-[var(--text-secondary)]">Reminder: {new Intl.DateTimeFormat("en-US", { timeZone: slotPreview?.timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(slotTimes[id]))} · {slotPreview?.timeZone}</p> : <fieldset disabled={attempted} className={attempted ? "opacity-70" : ""}><LocalDateTimeField id={`batch-reminder-${id}`} label={`${assistedDestinations[id].name} reminder`} value={reminders[id] ?? ""} minTimestamp={currentTime} optional onChange={(value) => setReminders((current) => ({ ...current, [id]: value }))} /></fieldset>}</div>
        </div>;
      })}
      {draft.mediaIds?.length ? <MediaHandoff mediaIds={draft.mediaIds} mediaAlt={draft.mediaAlt} variant="review" /> : <p className="text-[11px] leading-5 text-[var(--text-soft)]">{videoId ? "This draft has no saved images. The selected video will be attached to each handoff." : "This draft has no saved images. You can still bring media directly to the platform when publishing."}</p>}
      <details className="rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] p-3">
        <summary className="cursor-pointer text-[12px] font-bold text-[var(--text-secondary)]">Video for this batch · {videoId ? "attached" : "optional"}</summary>
        <div className="mt-3"><VideoAttachmentPicker selectedId={videoId} onChange={setVideoId} onBusyChange={setVideoBusy} disabled={busy || mediaBusy || attempted || submitting} /></div>
        <p className="mt-2 text-[11px] leading-5 text-[var(--text-muted)]">One clip is attached to every selected handoff. You can change each handoff separately in Assisted before posting.</p>
      </details>
      {!attempted && (invalidText.length > 0 || invalidReminders.length > 0) && <div role="alert" className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2.5 text-[12px] text-[var(--danger)]">
        <p className="font-semibold">Fix these posts before confirming:</p>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {destinations.filter((id) => invalidText.includes(id) || invalidReminders.includes(id)).map((id) => <button key={id} type="button" onClick={() => focusDestination(id)} className="font-semibold underline underline-offset-2">{assistedDestinations[id].name} · {invalidText.includes(id) ? "text" : ""}{invalidText.includes(id) && invalidReminders.includes(id) ? " and " : ""}{invalidReminders.includes(id) ? "reminder" : ""}</button>)}
        </div>
      </div>}
      {!attempted && mediaGaps.length > 0 && <div role="status" className="rounded-lg bg-[var(--warning-soft)] px-3 py-2.5 text-[12px] leading-5 text-[var(--warning)]">
        <p className="font-semibold">Media to bring before posting</p>
        <p>These handoffs can be saved now. Add media in Assisted or bring it directly to the platform before you publish:</p>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {mediaGaps.map(({ id, kind }) => <button key={id} type="button" onClick={() => focusDestination(id)} className="font-semibold underline underline-offset-2">{assistedDestinations[id].name} · {kind === "video" ? "video" : "photo or video"}</button>)}
        </div>
      </div>}
      {duplicateDestinations.length > 0 && <p role="status" className="rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-[11px] leading-5 text-[var(--warning)]">{duplicateDestinations.map((id) => assistedDestinations[id].name).join(", ")} already {duplicateDestinations.length === 1 ? "has a handoff" : "have handoffs"} from this draft. Confirming will add another item for each selected platform.</p>}
      {attempted && <p role="status" className="text-[11px] leading-5 text-[var(--text-muted)]">If the request did not confirm, retry the same batch. Check Assisted before starting another batch.</p>}
      <div className="flex flex-wrap items-center justify-end gap-3"><button type="button" onClick={closeReview} disabled={submitting} className="rounded-lg px-3 py-2 text-[12px] font-semibold text-[var(--text-secondary)] disabled:opacity-45">Close review</button><button type="button" onClick={() => void prepare()} disabled={!canPrepare} className="gradient-button inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[12px] font-bold text-white disabled:opacity-45"><Check size={15} aria-hidden="true" />{submitting ? "Preparing…" : attempted ? "Retry same batch" : `Confirm ${destinations.length} ${destinations.length === 1 ? "handoff" : "handoffs"}`}</button></div>
    </div>}
  </section>;
}
