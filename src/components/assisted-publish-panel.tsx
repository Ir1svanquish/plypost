"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, CalendarClock, Check, Copy, Download, ExternalLink, RotateCcw, Trash2 } from "lucide-react";
import { assistedDestinations, assistedTextImageDisplayIds, assistedVideoDisplayIds, missingHandoffMedia, type AssistedDestinationId } from "@/lib/assisted";
import { characterCount, isPlatformId } from "@/lib/platforms";
import { buildManualReminderCalendar, upcomingManualReminders } from "@/lib/calendar-export";
import { validatePlatformText } from "@/lib/platform-validation";
import { assistedState, hasManualReminder, localDateTimeValue, MAX_ASSISTED_OUTCOME_COUNT, MAX_ASSISTED_OUTCOME_NOTES, normalizePublicPostUrl, type AssistedOutcomeInput, type AssistedPost, type SavedDraft } from "@/lib/workspace";
import { formatLocalDateTime, isValidLocalDateTime, LocalDateTimeField } from "@/components/local-date-time-field";
import { MediaHandoff } from "@/components/media-handoff";
import { ImageAttachmentPicker } from "@/components/image-attachments";
import { PlatformImageSelection } from "@/components/platform-image-selection";
import { PrivateVideoPreview, VideoAttachmentPicker } from "@/components/video-attachment-picker";
import { AIHandoffAssistant } from "@/components/ai-handoff-assistant";
import { isManualAiDestination } from "@/lib/ai-handoff";
import { imageLimitForDestination, imageLimitWarning } from "@/lib/media-policy";

type Props = {
  items: AssistedPost[];
  drafts: SavedDraft[];
  destination: AssistedDestinationId;
  text: string;
  customText: boolean;
  time: string;
  now: number;
  workspaceReady: boolean;
  busy: boolean;
  mediaBusy: boolean;
  sourceMediaIds: string[];
  sourceMediaAlt: string[];
  initialVideoId?: string | null;
  notificationPermission: NotificationPermission | "unsupported";
  onDestinationChange: (destination: AssistedDestinationId) => void;
  onTextChange: (text: string) => void;
  onResetText: () => void;
  onTimeChange: (time: string) => void;
  onAdd: (videoId?: string, selectedMediaIds?: string[]) => Promise<boolean>;
  onSetReminder: (post: AssistedPost, scheduledFor: string | null) => Promise<void>;
  onCopy: (text: string, destination: AssistedDestinationId) => void;
  onMarkPosted: (id: string, postUrl?: string) => Promise<boolean>;
  onUpdateText: (id: string, expectedText: string, text: string) => Promise<boolean>;
  onUpdateVideo: (id: string, expectedVideoId: string | null, videoId: string | null) => Promise<boolean>;
  onUpdateImages: (id: string, expectedMediaIds: string[], expectedMediaAlt: string[], mediaIds: string[], mediaAlt: string[]) => Promise<boolean>;
  onUpdateDescriptions: (id: string, expectedMediaAlt: string[], mediaAlt: string[]) => Promise<boolean>;
  onUpdatePostUrl: (id: string, postUrl: string | null) => Promise<boolean>;
  onUpdateOutcome: (id: string, outcome: AssistedOutcomeInput | null) => Promise<boolean>;
  onUndo: (id: string) => Promise<boolean>;
  onRemove: (id: string) => void;
  onEnableNotifications: () => void;
  onEditImages: () => void;
  onOpenSourceDraft: (draft: SavedDraft) => void;
  mastodonInstance?: string;
  focusItemId?: string;
  startExpanded?: boolean;
  startWithVideoGroup?: boolean;
};

type OutcomeForm = { views: string; likes: string; replies: string; notes: string };
type ImageEdit = { itemId: string; expectedIds: string[]; expectedAlt: string[]; ids: string[]; descriptions: Record<string, string> };
const statusFilters = [
  { id: "to-post", label: "To post" },
  { id: "due", label: "Due now" },
  { id: "upcoming", label: "Upcoming" },
  { id: "posted", label: "Posted" },
] as const;
type StatusFilter = (typeof statusFilters)[number]["id"];

function outcomeForm(item: AssistedPost): OutcomeForm {
  return {
    views: item.outcome?.views?.toString() ?? "",
    likes: item.outcome?.likes?.toString() ?? "",
    replies: item.outcome?.replies?.toString() ?? "",
    notes: item.outcome?.notes ?? "",
  };
}

function readOutcomeForm(form: OutcomeForm): { value?: AssistedOutcomeInput; error?: string } {
  const value: AssistedOutcomeInput = {};
  for (const key of ["views", "likes", "replies"] as const) {
    const input = form[key].trim();
    if (!input) continue;
    if (!/^\d+$/.test(input) || !Number.isSafeInteger(Number(input)) || Number(input) > MAX_ASSISTED_OUTCOME_COUNT) {
      return { error: "Use whole numbers from 0 to 1,000,000,000 for results." };
    }
    value[key] = Number(input);
  }
  const notes = form.notes.trim();
  if (notes.length > MAX_ASSISTED_OUTCOME_NOTES) return { error: "Keep notes within 500 characters." };
  if (notes) value.notes = notes;
  if (!Object.keys(value).length) return { error: "Add at least one count or a note." };
  return { value };
}

function safeMastodonOrigin(instance?: string): string | null {
  if (!instance) return null;
  try {
    const url = new URL(instance);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash &&
      url.pathname === "/" ? url.origin : null;
  } catch { return null; }
}

export function AssistedPublishPanel({ items, drafts, destination, text, customText, time, now, workspaceReady, busy, mediaBusy, sourceMediaIds, sourceMediaAlt, initialVideoId = null, notificationPermission, onDestinationChange, onTextChange, onResetText, onTimeChange, onAdd, onSetReminder, onCopy, onMarkPosted, onUpdateText, onUpdateVideo, onUpdateImages, onUpdateDescriptions, onUpdatePostUrl, onUpdateOutcome, onUndo, onRemove, onEnableNotifications, onEditImages, onOpenSourceDraft, mastodonInstance, focusItemId, startExpanded = false, startWithVideoGroup = false }: Props) {
  const [postUrls, setPostUrls] = useState<Record<string, string>>({});
  const [textEdits, setTextEdits] = useState<Record<string, { expectedText: string; value: string }>>({});
  const [textSavingId, setTextSavingId] = useState<string | null>(null);
  const [videoEdits, setVideoEdits] = useState<Record<string, { expectedVideoId: string | null; value: string | null }>>({});
  const [videoSavingId, setVideoSavingId] = useState<string | null>(null);
  const [imageEdit, setImageEdit] = useState<ImageEdit | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageSavingId, setImageSavingId] = useState<string | null>(null);
  const [editingLinks, setEditingLinks] = useState<Record<string, boolean>>({});
  const [linkSavingId, setLinkSavingId] = useState<string | null>(null);
  const [outcomeDrafts, setOutcomeDrafts] = useState<Record<string, OutcomeForm>>({});
  const [editingOutcomes, setEditingOutcomes] = useState<Record<string, boolean>>({});
  const [outcomeSavingId, setOutcomeSavingId] = useState<string | null>(null);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(startExpanded);
  const [composerInitialized, setComposerInitialized] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("to-post");
  const [destinationFilter, setDestinationFilter] = useState<AssistedDestinationId | "all">("all");
  const [pendingStatusFocus, setPendingStatusFocus] = useState<{ id: string; status: "posted" | "queued" } | null>(null);
  const [reminderEdit, setReminderEdit] = useState<{ itemId: string; value: string; error: string } | null>(null);
  const [reminderSavingId, setReminderSavingId] = useState<string | null>(null);
  const [showVideoDestinations, setShowVideoDestinations] = useState(() => startWithVideoGroup || assistedVideoDisplayIds.some((id) => id === destination));
  const previousDestination = useRef(destination);
  const [videoId, setVideoId] = useState<string | null>(initialVideoId);
  const [imageSelections, setImageSelections] = useState<Partial<Record<AssistedDestinationId, string[]>>>({});
  const [videoBusy, setVideoBusy] = useState(false);
  const handledFocusRef = useRef<string | null>(null);
  const dueCount = items.filter((item) => assistedState(item, now) === "due").length;
  const futureReminderCount = upcomingManualReminders(items, now).length;
  const selected = assistedDestinations[destination];
  const selectedMediaIds = (imageSelections[destination] ?? sourceMediaIds.slice(0, imageLimitForDestination(destination)))
    .filter((id) => sourceMediaIds.includes(id));
  const missingComposerMedia = missingHandoffMedia(destination, selectedMediaIds.length, Boolean(videoId));
  const videoFirst = assistedVideoDisplayIds.some((id) => id === destination);
  const validation = isPlatformId(destination) ? validatePlatformText(destination, text) : null;
  const availableTextImageDestinations = assistedTextImageDisplayIds.filter((id) => items.some((item) => item.destination === id));
  const availableVideoDestinations = assistedVideoDisplayIds.filter((id) => items.some((item) => item.destination === id));
  const availableDestinations: AssistedDestinationId[] = [...availableTextImageDestinations, ...availableVideoDestinations];
  const activeDestinationFilter = destinationFilter !== "all" && availableDestinations.includes(destinationFilter) ? destinationFilter : "all";
  const destinationItems = activeDestinationFilter === "all" ? items : items.filter((item) => item.destination === activeDestinationFilter);
  const statusCounts: Record<StatusFilter, number> = {
    "to-post": destinationItems.filter((item) => item.status === "queued").length,
    due: destinationItems.filter((item) => assistedState(item, now) === "due").length,
    upcoming: destinationItems.filter((item) => assistedState(item, now) === "upcoming").length,
    posted: destinationItems.filter((item) => item.status === "posted").length,
  };
  const visibleItems = destinationItems.filter((item) => {
    if (statusFilter === "to-post") return item.status === "queued";
    if (statusFilter === "due") return assistedState(item, now) === "due";
    return assistedState(item, now) === statusFilter;
  });
  const hasFocusedItem = Boolean(focusItemId && visibleItems.some((item) => item.id === focusItemId));
  const mastodonOrigin = safeMastodonOrigin(mastodonInstance);

  useEffect(() => {
    if (!workspaceReady || composerInitialized) return;
    setComposerOpen(startExpanded || items.length === 0 || Boolean(time));
    setComposerInitialized(true);
  }, [workspaceReady, composerInitialized, items.length, time, startExpanded]);

  useEffect(() => {
    if (previousDestination.current === destination) return;
    previousDestination.current = destination;
    setShowVideoDestinations(assistedVideoDisplayIds.some((id) => id === destination));
  }, [destination]);

  useEffect(() => {
    if (!focusItemId) { handledFocusRef.current = null; return; }
    if (handledFocusRef.current === focusItemId) return;
    const focused = items.find((item) => item.id === focusItemId);
    if (!focused) return;
    handledFocusRef.current = focusItemId;
    setDestinationFilter("all");
    setStatusFilter(focused.status === "posted" ? "posted" : "to-post");
  }, [focusItemId, items]);

  useEffect(() => {
    if (!focusItemId || !hasFocusedItem) return;
    const element = document.getElementById(`assisted-item-${focusItemId}`);
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
    element?.focus({ preventScroll: true });
  }, [focusItemId, hasFocusedItem, statusFilter, activeDestinationFilter]);

  useEffect(() => {
    if (!pendingStatusFocus || !visibleItems.some((item) => item.id === pendingStatusFocus.id && item.status === pendingStatusFocus.status)) return;
    const element = document.getElementById(`assisted-item-${pendingStatusFocus.id}`);
    if (!element) return;
    if (pendingStatusFocus.status === "posted") {
      const record = document.getElementById(`assisted-posted-record-${pendingStatusFocus.id}`);
      if (record instanceof HTMLDetailsElement) record.open = true;
    }
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    element.focus({ preventScroll: true });
    setPendingStatusFocus(null);
  }, [pendingStatusFocus, visibleItems]);

  function closeLinkEditor(id: string) {
    setEditingLinks((current) => { const next = { ...current }; delete next[id]; return next; });
    setPostUrls((current) => { const next = { ...current }; delete next[id]; return next; });
  }

  function closeTextEditor(id: string) {
    setTextEdits((current) => { const next = { ...current }; delete next[id]; return next; });
  }

  function closeVideoEditor(id: string) {
    setVideoEdits((current) => { const next = { ...current }; delete next[id]; return next; });
  }

  async function updateSavedText(id: string, expectedText: string, value: string) {
    if (busy || textSavingId) return;
    setTextSavingId(id);
    try {
      if (await onUpdateText(id, expectedText, value)) closeTextEditor(id);
    } finally {
      setTextSavingId(null);
    }
  }

  async function updateSavedVideo(id: string, expectedVideoId: string | null, videoId: string | null) {
    if (busy || videoBusy || videoSavingId) return;
    setVideoSavingId(id);
    try {
      if (await onUpdateVideo(id, expectedVideoId, videoId)) closeVideoEditor(id);
    } finally { setVideoSavingId(null); }
  }

  function startImageEdit(item: AssistedPost) {
    const ids = [...(item.mediaIds ?? [])];
    const alt = ids.map((_, index) => item.mediaAlt?.[index] ?? "");
    setImageEdit({ itemId: item.id, expectedIds: ids, expectedAlt: alt, ids, descriptions: Object.fromEntries(ids.map((id, index) => [id, alt[index]])) });
  }

  async function saveImageEdit(edit: ImageEdit) {
    if (busy || mediaBusy || imageBusy || imageSavingId) return;
    setImageSavingId(edit.itemId);
    try {
      const nextAlt = edit.ids.map((id) => (edit.descriptions[id] ?? "").trim());
      if (await onUpdateImages(edit.itemId, edit.expectedIds, edit.expectedAlt, edit.ids, nextAlt)) setImageEdit(null);
    } finally { setImageSavingId(null); }
  }

  async function updateLink(id: string, postUrl: string | null) {
    if (busy || linkSavingId) return;
    setLinkSavingId(id);
    try {
      if (await onUpdatePostUrl(id, postUrl)) closeLinkEditor(id);
    } finally {
      setLinkSavingId(null);
    }
  }

  function closeOutcomeEditor(id: string) {
    setEditingOutcomes((current) => { const next = { ...current }; delete next[id]; return next; });
    setOutcomeDrafts((current) => { const next = { ...current }; delete next[id]; return next; });
  }

  function changeOutcomeField(item: AssistedPost, key: keyof OutcomeForm, value: string) {
    setOutcomeDrafts((current) => ({
      ...current,
      [item.id]: { ...(current[item.id] ?? outcomeForm(item)), [key]: value },
    }));
  }

  function downloadCalendar() {
    setCalendarError(null);
    try {
      const content = buildManualReminderCalendar(items);
      const url = URL.createObjectURL(new Blob([content], { type: "text/calendar;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `plypost-reminders-${new Date().toISOString().slice(0, 10)}.ics`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (cause) {
      setCalendarError(cause instanceof Error ? cause.message : "Could not create the calendar file.");
    }
  }

  async function updateOutcome(id: string, outcome: AssistedOutcomeInput | null) {
    if (busy || outcomeSavingId) return;
    setOutcomeSavingId(id);
    try {
      if (await onUpdateOutcome(id, outcome)) closeOutcomeEditor(id);
    } finally {
      setOutcomeSavingId(null);
    }
  }

  function chooseDestination(next: AssistedDestinationId) {
    if (next === destination) return;
    onDestinationChange(next);
  }

  async function saveReminder(item: AssistedPost, scheduledFor: string | null) {
    if (busy || reminderSavingId) return;
    setReminderSavingId(item.id);
    try {
      await onSetReminder(item, scheduledFor);
      setReminderEdit(null);
    } catch (cause) {
      setReminderEdit((current) => current?.itemId === item.id ? { ...current, error: cause instanceof Error ? cause.message : "Could not update this reminder." } : current);
    } finally {
      setReminderSavingId(null);
    }
  }

  async function addPost() {
    setStatusFilter("to-post");
    setDestinationFilter("all");
    if (await onAdd(videoId ?? undefined, selectedMediaIds)) setImageSelections({});
  }

  async function markPosted(id: string, postUrl?: string) {
    if (busy || !await onMarkPosted(id, postUrl)) return;
    closeVideoEditor(id);
    setDestinationFilter("all");
    setStatusFilter("posted");
    setPendingStatusFocus({ id, status: "posted" });
  }

  async function undoPosted(id: string) {
    if (busy || !await onUndo(id)) return;
    closeOutcomeEditor(id);
    setDestinationFilter("all");
    setStatusFilter("to-post");
    setPendingStatusFocus({ id, status: "queued" });
  }

  return (
    <section id="assisted" className="section-anchor panel-border soft-shadow mt-8 overflow-hidden rounded-[18px] bg-[var(--surface)]" aria-labelledby="assisted-heading">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] px-6 py-5 sm:px-7">
        <div>
          <h2 id="assisted-heading" className="text-[17px] font-bold tracking-[-0.025em]">Assisted publishing</h2>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">Prepare a post for any platform, then finish it in your own account.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {futureReminderCount > 0 && <button type="button" onClick={downloadCalendar} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[12px] font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-soft)]"><Download size={13} aria-hidden="true" /> Download {futureReminderCount} calendar {futureReminderCount === 1 ? "reminder" : "reminders"}</button>}
          <button type="button" onClick={() => setComposerOpen((current) => !current)} disabled={!composerInitialized} aria-expanded={composerOpen} aria-controls="assisted-compose-form" className="rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-2 text-[12px] font-bold text-[var(--accent-text)] disabled:opacity-50">{composerOpen ? "Hide new post" : "New manual post"}</button>
          <span className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${dueCount ? "bg-[var(--warning-soft)] text-[var(--warning)]" : "bg-[var(--field)] text-[var(--text-muted)]"}`}>{dueCount ? `${dueCount} due now` : "Manual publishing"}</span>
        </div>
      </div>
      {calendarError && <p role="alert" className="mx-6 mt-3 rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-[12px] text-[var(--danger)] sm:mx-7">{calendarError}</p>}

      {composerOpen && <div id="assisted-compose-form" className="grid gap-4 p-6 sm:grid-cols-2 sm:p-7">
        <div className="sm:col-span-2">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><p id="assisted-destination-label" className="text-[12px] font-bold text-[var(--text-secondary)]">Destination</p><span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent-text)]">Selected: {selected.name}</span></div>
          <div role="group" aria-label="Platform type" className="mb-3 inline-flex rounded-xl border border-[var(--line)] bg-[var(--field)] p-1">
            <button type="button" aria-pressed={!showVideoDestinations} onClick={() => setShowVideoDestinations(false)} className={`rounded-lg px-3 py-2 text-[12px] font-semibold ${!showVideoDestinations ? "bg-[var(--surface)] text-[var(--text)] shadow-sm" : "text-[var(--text-muted)]"}`}>Photo &amp; text-first</button>
            <button type="button" aria-pressed={showVideoDestinations} onClick={() => setShowVideoDestinations(true)} className={`rounded-lg px-3 py-2 text-[12px] font-semibold ${showVideoDestinations ? "bg-[var(--surface)] text-[var(--text)] shadow-sm" : "text-[var(--text-muted)]"}`}>Video-first</button>
          </div>
          <div role="group" aria-labelledby="assisted-destination-label" className="flex flex-wrap gap-2">
            {(showVideoDestinations ? assistedVideoDisplayIds : assistedTextImageDisplayIds).map((id) => <button key={id} type="button" aria-pressed={destination === id} onClick={() => chooseDestination(id)} className={`rounded-lg border px-3 py-2 text-[12px] font-semibold ${destination === id ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]" : "border-[var(--line)] bg-[var(--surface)] text-[var(--text-secondary)] hover:border-[var(--accent-border)]"}`}>{assistedDestinations[id].name}</button>)}
          </div>
          <p className="mt-2 text-[11px] text-[var(--text-muted)]">Browse a group, then choose a platform to change the destination. Some platforms support both formats.</p>
        </div>
        <LocalDateTimeField id="assisted-time" label="Reminder time" value={time} minTimestamp={now} optional onChange={onTimeChange} />
        <div className="sm:col-span-2">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><label htmlFor="assisted-text" className="text-[12px] font-bold text-[var(--text-secondary)]">Text to copy · {customText ? `Custom for ${selected.name}` : "From current draft"}</label>{customText && <button type="button" onClick={onResetText} className="text-[12px] font-semibold text-[var(--accent-text)] underline underline-offset-2">Use current draft text</button>}</div>
          <textarea id="assisted-text" value={text} maxLength={5000} onChange={(event) => onTextChange(event.target.value)} className="min-h-[120px] w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--accent-soft)] px-4 py-3 text-[14px] leading-6 outline-none focus:border-[var(--accent-border)]" />
          {!isPlatformId(destination) && isManualAiDestination(destination) && <AIHandoffAssistant key={`ai-${destination}`} destination={destination} source={text} disabled={busy} onApply={onTextChange} />}
          <p className="mt-2 text-[12px] leading-5 text-[var(--text-muted)]">{selected.hint} Saved images are available for manual download; upload them on the platform yourself.</p>
          <PlatformImageSelection destination={destination} sourceIds={sourceMediaIds} sourceAlt={sourceMediaAlt} selectedIds={selectedMediaIds} onChange={(ids) => setImageSelections((current) => ({ ...current, [destination]: ids }))} disabled={busy || mediaBusy} />
          <button type="button" onClick={onEditImages} className="mt-2 text-[12px] font-semibold text-[var(--accent-text)] underline underline-offset-2">Edit the image pool in Create</button>
          <details key={`video-${destination}`} open={videoFirst || Boolean(videoId)} className="mt-3"><summary className="cursor-pointer text-[12px] font-semibold text-[var(--accent-text)]">{videoId ? "Video attached" : "Attach a video clip"}</summary><div className="mt-2"><VideoAttachmentPicker selectedId={videoId} onChange={setVideoId} onBusyChange={setVideoBusy} disabled={busy || mediaBusy} /></div></details>
          {selected.needsMedia && <p className={`mt-2 rounded-lg px-3 py-2 text-[12px] leading-5 ${missingComposerMedia ? "bg-[var(--warning-soft)] text-[var(--warning)]" : "bg-[var(--surface-muted)] text-[var(--text-muted)]"}`}>{missingComposerMedia === "video" ? "No video attached here. Attach one or bring a video when you publish on YouTube." : missingComposerMedia ? "No photo or video attached here. Bring one when you publish." : "Check your media against this platform's current rules before posting. You upload it there yourself."}</p>}
          {validation && text.trim() && <div role="status" className="mt-2 space-y-1 text-[12px] leading-5">
            <p className={validation.valid ? "text-[var(--text-muted)]" : "font-semibold text-[var(--danger)]"}>{validation.count} / {validation.limit} {destination === "bluesky" ? "graphemes" : "characters"}{validation.byteCount !== undefined ? ` · ${validation.byteCount} / ${validation.byteLimit} UTF-8 bytes` : ""}</p>
            {validation.issues.map((issue) => <p key={issue.code} className={issue.severity === "error" ? "text-[var(--danger)]" : "text-[var(--warning)]"}>{issue.message}</p>)}
          </div>}
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button type="button" onClick={() => void addPost()} disabled={busy || mediaBusy || videoBusy || !text.trim() || validation?.valid === false || Boolean(time && !isValidLocalDateTime(time, now))} className="gradient-button inline-flex items-center gap-2 rounded-xl px-4 py-3 text-[13px] font-bold text-white disabled:opacity-50"><CalendarClock size={15} /> {mediaBusy || videoBusy ? "Wait for media…" : busy ? "Saving..." : time ? "Save reminder" : "Add to checklist"}</button>
          {notificationPermission === "default" && <button type="button" onClick={onEnableNotifications} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--accent-text)]"><Bell size={14} /> Enable browser alerts</button>}
          <span className="text-[12px] leading-5 text-[var(--text-soft)]">{notificationPermission === "granted" ? "Browser alerts enabled while this page is open." : "Due items appear here while this page is open."}</span>
        </div>
      </div>}

      <div className="border-t border-[var(--line)] px-6 py-3 text-[12px] leading-5 text-[var(--text-muted)] sm:px-7">Copy text, add media and publish in your own account. Calendar downloads do not sync later edits; browser alerts work while this page is open.</div>
      {items.length > 0 && <div className="flex flex-wrap items-end justify-between gap-3 border-t border-[var(--line)] px-6 py-4 sm:px-7">
        <div role="group" aria-label="Filter assisted posts by status" className="flex flex-wrap gap-2">
          {statusFilters.map((filter) => <button key={filter.id} type="button" aria-pressed={statusFilter === filter.id} onClick={() => setStatusFilter(filter.id)} className={`rounded-lg border px-3 py-2 text-[12px] font-semibold ${statusFilter === filter.id ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]" : "border-[var(--line)] bg-[var(--surface)] text-[var(--text-secondary)]"}`}>{filter.label} <span className="ml-1 text-[var(--text-muted)]">{statusCounts[filter.id]}</span></button>)}
        </div>
        <label htmlFor="assisted-list-destination" className="text-[11px] font-semibold text-[var(--text-secondary)]">Platform
          <select id="assisted-list-destination" value={activeDestinationFilter} onChange={(event) => setDestinationFilter(event.target.value as AssistedDestinationId | "all")} className="mt-1 block min-w-40 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent-border)]">
            <option value="all">All platforms</option>
            {availableTextImageDestinations.length > 0 && <optgroup label="Photo &amp; text-first">{availableTextImageDestinations.map((id) => <option key={id} value={id}>{assistedDestinations[id].name}</option>)}</optgroup>}
            {availableVideoDestinations.length > 0 && <optgroup label="Video-first">{availableVideoDestinations.map((id) => <option key={id} value={id}>{assistedDestinations[id].name}</option>)}</optgroup>}
          </select>
        </label>
      </div>}
      {items.length === 0 ? (
        <div className="flex flex-col items-center border-t border-[var(--line)] px-6 py-9 text-center"><Bell size={22} className="text-[var(--accent-text)]" /><p className="mt-2 text-[13px] font-semibold text-[var(--text-secondary)]">No assisted posts yet</p><p className="mt-1 text-[12px] text-[var(--text-soft)]">Add one above to start a manual publishing checklist.</p></div>
      ) : visibleItems.length === 0 ? (
        <div className="border-t border-[var(--line)] px-6 py-8 text-center sm:px-7"><p className="text-[13px] font-semibold text-[var(--text-secondary)]">No posts in this view</p><p className="mt-1 text-[12px] text-[var(--text-muted)]">Choose another status or platform to see more.</p></div>
      ) : (
        <div className="divide-y divide-[var(--line)] border-t border-[var(--line)]">
          {visibleItems.map((item) => {
            const state = assistedState(item, now);
            const reminder = hasManualReminder(item);
            const editingReminder = reminderEdit?.itemId === item.id ? reminderEdit : null;
            const target = assistedDestinations[item.destination];
            const missingMedia = missingHandoffMedia(item.destination, item.mediaIds?.length ?? 0, Boolean(item.videoId));
            const enteredUrl = postUrls[item.id] ?? "";
            const normalizedUrl = enteredUrl ? normalizePublicPostUrl(enteredUrl) : undefined;
            const invalidUrl = normalizedUrl === null;
            const savedUrl = item.postUrl && normalizePublicPostUrl(item.postUrl) === item.postUrl ? item.postUrl : undefined;
            const editingLink = item.status === "posted" && Boolean(editingLinks[item.id]);
            const editedLink = postUrls[item.id] ?? savedUrl ?? "";
            const normalizedEditedLink = editedLink ? normalizePublicPostUrl(editedLink) : undefined;
            const invalidEditedLink = normalizedEditedLink === null;
            const editingOutcome = item.status === "posted" && Boolean(editingOutcomes[item.id]);
            const resultDraft = outcomeDrafts[item.id] ?? outcomeForm(item);
            const resultValidation = readOutcomeForm(resultDraft);
            const resultSummary = item.outcome && (["views", "likes", "replies"] as const)
              .filter((key) => item.outcome?.[key] !== undefined)
              .map((key) => `${key[0].toUpperCase()}${key.slice(1)} ${item.outcome?.[key]?.toLocaleString()}`)
              .join(" · ");
            const sourceDraft = item.sourceDraftId ? drafts.find((draft) => draft.id === item.sourceDraftId) : undefined;
            const textEdit = textEdits[item.id];
            const textEditStale = Boolean(textEdit && textEdit.expectedText !== item.text);
            const textEditCount = textEdit ? characterCount(textEdit.value) : 0;
            const textEditValidation = textEdit && isPlatformId(item.destination)
              ? validatePlatformText(item.destination, textEdit.value.trim()) : null;
            const canSaveText = Boolean(textEdit && !textEditStale && textEdit.value.trim() &&
              textEdit.value.trim() !== item.text && textEditCount <= 5000 && textEditValidation?.valid !== false);
            const videoEdit = videoEdits[item.id];
            const videoEditStale = Boolean(videoEdit && videoEdit.expectedVideoId !== (item.videoId ?? null));
            const canSaveVideo = Boolean(videoEdit && !videoEditStale && videoEdit.value !== videoEdit.expectedVideoId);
            const editingImages = imageEdit?.itemId === item.id ? imageEdit : null;
            const savedImageIds = item.mediaIds ?? [];
            const savedImageAlt = savedImageIds.map((_, index) => item.mediaAlt?.[index] ?? "");
            const imageEditStale = Boolean(editingImages && (savedImageIds.length !== editingImages.expectedIds.length ||
              savedImageIds.some((id, index) => id !== editingImages.expectedIds[index] || savedImageAlt[index] !== editingImages.expectedAlt[index])));
            const imageEditChanged = Boolean(editingImages && (editingImages.ids.length !== editingImages.expectedIds.length ||
              editingImages.ids.some((id, index) => id !== editingImages.expectedIds[index] ||
                (editingImages.descriptions[id] ?? "").trim() !== editingImages.expectedAlt[index])));
            return <article key={item.id} id={`assisted-item-${item.id}`} tabIndex={-1} className={`scroll-mt-24 px-6 py-4 outline-none sm:px-7 ${focusItemId === item.id ? "bg-[var(--accent-soft)] ring-2 ring-inset ring-[var(--accent-border)]" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-[14px] font-bold text-[var(--text)]">{target.name}</h3><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${state === "due" ? "bg-[var(--warning-soft)] text-[var(--warning)]" : state === "posted" ? "bg-[var(--positive-soft)] text-[var(--positive)]" : "bg-[var(--accent-soft)] text-[var(--accent-text)]"}`}>{state === "due" ? "Due now · publish manually" : state === "posted" ? "Marked posted by you" : state === "unscheduled" ? "No reminder" : "Upcoming"}</span></div><p className="mt-1 text-[12px] text-[var(--text-muted)]">{reminder ? formatLocalDateTime(item.scheduledFor) : "Publish when you are ready"}{item.status === "queued" && <> · <button type="button" onClick={() => setReminderEdit({ itemId: item.id, value: reminder ? localDateTimeValue(new Date(item.scheduledFor)) : "", error: "" })} disabled={busy || reminderSavingId !== null} className="font-semibold text-[var(--accent-text)] underline underline-offset-2 disabled:opacity-50">{reminder ? "Change reminder" : "Add reminder"}</button></>}</p><p className="mt-2 line-clamp-2 whitespace-pre-wrap break-words text-[12px] leading-5 text-[var(--text-secondary)]">{item.text}</p>{item.status === "queued" && missingMedia && <p className="mt-1 text-[11px] font-semibold text-[var(--warning)]">{missingMedia === "video" ? "No video attached here. Bring one when posting." : "No photo or video attached here. Bring one when posting."}</p>}{item.sourceDraftId && <p className="mt-1 text-[11px] text-[var(--text-soft)]">Prepared from saved draft{sourceDraft && <> · <button type="button" onClick={() => onOpenSourceDraft(sourceDraft)} className="font-semibold text-[var(--accent-text)] underline underline-offset-2">Open draft</button></>}</p>}{item.contentEditedAt && <p className="mt-1 text-[11px] text-[var(--text-soft)]">Handoff text revised {formatLocalDateTime(item.contentEditedAt)}</p>}</div>
                <button type="button" aria-label={`Remove ${target.name} handoff: ${item.title}`} onClick={() => onRemove(item.id)} disabled={busy} className="rounded-lg p-1.5 text-[var(--text-soft)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:opacity-50"><Trash2 size={14} /></button>
              </div>
              {item.status === "queued" && editingReminder && <form onSubmit={(event) => { event.preventDefault(); if (!isValidLocalDateTime(editingReminder.value, Date.now() + 10_000)) { setReminderEdit({ ...editingReminder, error: "Choose a future local date and time." }); return; } void saveReminder(item, new Date(editingReminder.value).toISOString()); }} className="mt-3 max-w-xl rounded-xl border border-[var(--accent-border)] bg-[var(--surface-muted)] p-3">
                <LocalDateTimeField id={`assisted-reminder-${item.id}`} label="Reminder time" value={editingReminder.value} minTimestamp={now + 10_000} onChange={(value) => setReminderEdit((current) => current?.itemId === item.id ? { ...current, value, error: "" } : current)} />
                {editingReminder.error && <p role="alert" className="mt-2 text-[12px] text-[var(--danger)]">{editingReminder.error}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-3"><button type="submit" disabled={busy || reminderSavingId !== null || !isValidLocalDateTime(editingReminder.value, now + 10_000)} className="rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-[12px] font-semibold text-[var(--accent-text)] disabled:opacity-50">{reminderSavingId === item.id ? "Saving…" : "Save reminder"}</button>{reminder && <button type="button" onClick={() => void saveReminder(item, null)} disabled={busy || reminderSavingId !== null} className="text-[12px] font-semibold text-[var(--text-secondary)] disabled:opacity-50">Remove reminder</button>}<button type="button" onClick={() => setReminderEdit(null)} disabled={reminderSavingId !== null} className="text-[12px] font-semibold text-[var(--text-muted)] disabled:opacity-50">Cancel</button></div>
              </form>}
              <details className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-[12px] text-[var(--text-muted)]">
                <summary className="cursor-pointer font-semibold text-[var(--accent-text)]">Post details{item.mediaIds?.length ? ` · ${item.mediaIds.length} ${item.mediaIds.length === 1 ? "image" : "images"}` : ""}{item.videoId ? " · video" : ""}</summary>
                <p className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-[var(--surface)] p-3 leading-5 text-[var(--text-secondary)]">{item.text}</p>
              {item.status === "queued" && !textEdit && <button type="button" onClick={() => setTextEdits((current) => ({ ...current, [item.id]: { expectedText: item.text, value: item.text } }))} disabled={busy} className="mt-2 text-[12px] font-semibold text-[var(--accent-text)] underline underline-offset-2 disabled:opacity-50">Edit saved text</button>}
              {item.status === "queued" && textEdit && <div className="mt-3 max-w-2xl rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] p-3">
                <label htmlFor={`assisted-edit-text-${item.id}`} className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Saved handoff text · {target.name}</label>
                <textarea id={`assisted-edit-text-${item.id}`} value={textEdit.value} maxLength={5000} rows={5} aria-invalid={!canSaveText && Boolean(textEdit.value.trim() !== item.text)} onChange={(event) => setTextEdits((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? { expectedText: item.text, value: item.text }), value: event.target.value } }))} disabled={busy || textSavingId === item.id} className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[13px] leading-5 text-[var(--text)] outline-none focus:border-[var(--accent-border)] disabled:opacity-60" />
                <p className="mt-1 text-[11px] leading-4 text-[var(--text-muted)]">{textEditCount} / {textEditValidation?.limit ?? 5000} {item.destination === "bluesky" ? "graphemes" : "characters"}. This changes only this manual handoff; its reminder, media and source draft stay as saved.</p>
                {textEditStale && <p role="alert" className="mt-1 text-[11px] text-[var(--danger)]">The saved text changed elsewhere. Copy your edits if needed, then cancel and reopen the latest version.</p>}
                {textEditValidation?.issues.map((issue) => <p key={issue.code} className={`mt-1 text-[11px] ${issue.severity === "error" ? "text-[var(--danger)]" : "text-[var(--warning)]"}`}>{issue.message}</p>)}
                {textEditCount > 5000 && <p className="mt-1 text-[11px] text-[var(--danger)]">Keep the handoff within 5,000 characters.</p>}
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button type="button" onClick={() => void updateSavedText(item.id, textEdit.expectedText, textEdit.value)} disabled={busy || textSavingId !== null || !canSaveText} className="rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-[12px] font-semibold text-[var(--accent-text)] disabled:opacity-50">{textSavingId === item.id ? "Saving…" : "Save text"}</button>
                  <button type="button" onClick={() => closeTextEditor(item.id)} disabled={busy || textSavingId !== null} className="text-[12px] font-semibold text-[var(--text-muted)] disabled:opacity-50">Cancel</button>
                </div>
              </div>}
              {item.placeLabel && <p className="mt-2 text-[12px] text-[var(--text-secondary)]">Place note: {item.placeLabel} <span className="text-[var(--text-soft)]">(add on the platform yourself)</span></p>}
              {imageLimitWarning(item.destination, item.mediaIds?.length ?? 0) && <p role="status" className="mt-2 rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-[12px] text-[var(--warning)]">{imageLimitWarning(item.destination, item.mediaIds?.length ?? 0)}</p>}
              {!editingImages && <MediaHandoff mediaIds={item.mediaIds} mediaAlt={item.mediaAlt} onUpdateDescriptions={item.status === "queued" ? (expected, next) => onUpdateDescriptions(item.id, expected, next) : undefined} />}
              {item.status === "queued" && !editingImages && <button type="button" onClick={() => startImageEdit(item)} disabled={busy || mediaBusy || imageBusy || imageSavingId !== null} className="mt-3 block text-[12px] font-semibold text-[var(--accent-text)] underline underline-offset-2 disabled:opacity-50">{savedImageIds.length ? "Change images for this handoff" : "Attach images to this handoff"}</button>}
              {item.status === "queued" && editingImages && <div className="mt-3 max-w-2xl rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
                <p className="text-[12px] font-semibold text-[var(--text-secondary)]">Images for {target.name}</p>
                <p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">Choose, reorder or upload images here. Save to change only this handoff; the source draft and other handoffs stay as they are.</p>
                <ImageAttachmentPicker context="handoff" selectedIds={editingImages.ids} descriptions={editingImages.descriptions}
                  onChange={(ids) => setImageEdit((current) => current?.itemId === item.id ? { ...current, ids } : current)}
                  onDescriptionChange={(id, description) => setImageEdit((current) => current?.itemId === item.id ? { ...current, descriptions: { ...current.descriptions, [id]: description } } : current)}
                  onBusyChange={setImageBusy} disabled={busy || mediaBusy || imageSavingId !== null} />
                {imageEditStale && <p role="alert" className="mt-2 text-[11px] text-[var(--danger)]">These saved images changed elsewhere. Copy your descriptions if needed, then cancel and reopen this handoff.</p>}
                <p className="mt-2 text-[11px] text-[var(--text-muted)]">Uploaded images remain in your private library even if you cancel this edit.</p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button type="button" onClick={() => void saveImageEdit(editingImages)} disabled={busy || mediaBusy || imageBusy || imageSavingId !== null || imageEditStale || !imageEditChanged} className="rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-[12px] font-semibold text-[var(--accent-text)] disabled:opacity-50">{imageSavingId === item.id ? "Saving…" : "Save images"}</button>
                  <button type="button" onClick={() => setImageEdit(null)} disabled={imageBusy || imageSavingId !== null} className="text-[12px] font-semibold text-[var(--text-muted)] disabled:opacity-50">Cancel</button>
                </div>
              </div>}
              {item.status === "queued" && !videoEdit && <button type="button" onClick={() => setVideoEdits({ [item.id]: { expectedVideoId: item.videoId ?? null, value: item.videoId ?? null } })} disabled={busy || videoBusy} className="mt-3 block text-[12px] font-semibold text-[var(--accent-text)] underline underline-offset-2 disabled:opacity-50">{item.videoId ? "Change attached video" : "Attach a video"}</button>}
              {item.status === "queued" && videoEdit && <div className="mt-3 max-w-2xl rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
                <VideoAttachmentPicker selectedId={videoEdit.value} onChange={(value) => setVideoEdits((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? videoEdit), value } }))} onBusyChange={setVideoBusy} disabled={busy || mediaBusy || videoBusy} />
                {videoEditStale && <p role="alert" className="mt-2 text-[11px] text-[var(--danger)]">The saved clip changed elsewhere. Cancel and reopen the latest handoff.</p>}
                <p className="mt-2 text-[11px] text-[var(--text-muted)]">This changes only this handoff. Its text, reminder and images stay saved.</p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button type="button" onClick={() => void updateSavedVideo(item.id, videoEdit.expectedVideoId, videoEdit.value)} disabled={busy || videoBusy || videoSavingId !== null || !canSaveVideo} className="rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-[12px] font-semibold text-[var(--accent-text)] disabled:opacity-50">{videoSavingId === item.id ? "Saving…" : "Save video"}</button>
                  <button type="button" onClick={() => closeVideoEditor(item.id)} disabled={busy || videoBusy || videoSavingId !== null} className="text-[12px] font-semibold text-[var(--text-muted)] disabled:opacity-50">Cancel</button>
                </div>
              </div>}
              {item.videoId && !videoEdit && <PrivateVideoPreview key={item.videoId} id={item.videoId} />}
              {item.videoId && <a href={`/api/videos/${encodeURIComponent(item.videoId)}`} download className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--accent-text)]"><Download size={13} aria-hidden="true" /> Download saved video</a>}
              {Boolean(item.mediaIds?.length || item.videoId) && <a href={`/api/assisted/${encodeURIComponent(item.id)}/package`} download className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent-border)] bg-[var(--surface)] px-3 py-2 text-[12px] font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-soft)]"><Download size={13} aria-hidden="true" /> Download caption and media (.zip)</a>}
              {item.status === "queued" && <div className="mt-3 max-w-xl">
                <label htmlFor={`assisted-post-url-${item.id}`} className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Public post link · optional</label>
                <input id={`assisted-post-url-${item.id}`} type="url" inputMode="url" maxLength={2048} value={enteredUrl} placeholder="https://social.example/your-post" aria-invalid={invalidUrl} aria-describedby={`assisted-post-url-hint-${item.id}`} onChange={(event) => setPostUrls((current) => ({ ...current, [item.id]: event.target.value }))} className="w-full rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[12px] text-[var(--text)] placeholder:text-[var(--text-soft)] outline-none focus:border-[var(--accent-border)]" />
                <p id={`assisted-post-url-hint-${item.id}`} className={`mt-1 text-[11px] leading-4 ${invalidUrl ? "text-[var(--danger)]" : "text-[var(--text-muted)]"}`}>{invalidUrl ? "Use a public HTTPS post link with no embedded username or password." : "After posting, paste its link here if you have one. Plypost checks the link format, not the post or account."}</p>
              </div>}
              </details>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => onCopy(item.text, item.destination)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent-border)] px-3 py-2 text-[12px] font-bold text-[var(--accent-text)]"><Copy size={13} /> Copy text</button>
                <a href={item.destination === "mastodon" && mastodonOrigin ? mastodonOrigin : target.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-2 text-[12px] font-bold text-[var(--text-secondary)]"><ExternalLink size={13} /> Open {item.destination === "mastodon" && mastodonOrigin ? "your Mastodon server" : target.name}</a>
                {item.status === "queued" ? <button type="button" onClick={() => { void markPosted(item.id, normalizedUrl ?? undefined); }} disabled={busy || videoBusy || imageBusy || Boolean(editingImages) || invalidUrl} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--positive-soft)] px-3 py-2 text-[12px] font-bold text-[var(--positive)] disabled:opacity-50"><Check size={13} /> I posted it</button> : <button type="button" onClick={() => { void undoPosted(item.id); }} disabled={busy || outcomeSavingId !== null} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold text-[var(--text-muted)] disabled:opacity-50"><RotateCcw size={13} /> Undo mark</button>}
              </div>
              {item.status === "queued" && invalidUrl && <p role="alert" className="mt-2 text-[11px] font-semibold text-[var(--danger)]">Fix or remove the link in Post details before marking this item posted.</p>}
              {item.status === "posted" && <details id={`assisted-posted-record-${item.id}`} className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-[12px] text-[var(--text-muted)]">
                <summary className="cursor-pointer font-semibold text-[var(--accent-text)]">Posted record{savedUrl ? " · link saved" : ""}{item.outcome ? " · results recorded" : ""}</summary>
              <div className="mt-3 text-[11px] leading-5 text-[var(--text-muted)]">
                <p>Marked posted by you{item.postedAt ? ` · ${formatLocalDateTime(item.postedAt)}` : ""} · not verified by Plypost.</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                  {savedUrl && <a href={savedUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-[var(--accent-text)] underline underline-offset-2"><ExternalLink size={11} /> Link you recorded · not verified</a>}
                  {!editingLink && <button type="button" onClick={() => { setPostUrls((current) => ({ ...current, [item.id]: savedUrl ?? "" })); setEditingLinks((current) => ({ ...current, [item.id]: true })); }} disabled={busy || linkSavingId !== null} className="font-semibold text-[var(--accent-text)] underline underline-offset-2 disabled:opacity-50">{savedUrl ? "Edit recorded link" : "Add recorded link"}</button>}
                </div>
                {editingLink && <div className="mt-3 max-w-xl rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] p-3">
                  <label htmlFor={`assisted-edit-post-url-${item.id}`} className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Public post link · self-reported</label>
                  <input id={`assisted-edit-post-url-${item.id}`} type="url" inputMode="url" maxLength={2048} value={editedLink} placeholder="https://social.example/your-post" aria-invalid={invalidEditedLink} aria-describedby={`assisted-edit-post-url-hint-${item.id}`} onChange={(event) => setPostUrls((current) => ({ ...current, [item.id]: event.target.value }))} disabled={busy || linkSavingId === item.id} className="w-full rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[12px] text-[var(--text)] placeholder:text-[var(--text-soft)] outline-none focus:border-[var(--accent-border)] disabled:opacity-60" />
                  <p id={`assisted-edit-post-url-hint-${item.id}`} className={`mt-1 text-[11px] leading-4 ${invalidEditedLink ? "text-[var(--danger)]" : "text-[var(--text-muted)]"}`}>{invalidEditedLink ? "Use a public HTTPS post link with no embedded username or password." : "Plypost checks the link format, not the post or account. Your posted mark and completion time stay unchanged."}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button type="button" onClick={() => { if (normalizedEditedLink) void updateLink(item.id, normalizedEditedLink); }} disabled={busy || linkSavingId !== null || !normalizedEditedLink || normalizedEditedLink === savedUrl} className="rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-[12px] font-semibold text-[var(--accent-text)] disabled:opacity-50">{linkSavingId === item.id ? "Saving…" : "Save link"}</button>
                    {savedUrl && <button type="button" onClick={() => { void updateLink(item.id, null); }} disabled={busy || linkSavingId !== null} className="text-[12px] font-semibold text-[var(--danger)] disabled:opacity-50">Remove recorded link</button>}
                    <button type="button" onClick={() => closeLinkEditor(item.id)} disabled={busy || linkSavingId !== null} className="text-[12px] font-semibold text-[var(--text-muted)] disabled:opacity-50">Cancel</button>
                  </div>
                </div>}
              </div>
              <div className="mt-3 max-w-xl rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 text-[12px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-[var(--text-secondary)]">Results you entered <span className="font-normal text-[var(--text-muted)]">· self-reported, not verified</span></p>
                  {!editingOutcome && <button type="button" onClick={() => { setOutcomeDrafts((current) => ({ ...current, [item.id]: outcomeForm(item) })); setEditingOutcomes((current) => ({ ...current, [item.id]: true })); }} disabled={busy || outcomeSavingId !== null} className="font-semibold text-[var(--accent-text)] underline underline-offset-2 disabled:opacity-50">{item.outcome ? "Edit results" : "Record results"}</button>}
                </div>
                {item.outcome ? <div className="mt-2 space-y-1 text-[var(--text-muted)]">
                  {resultSummary && <p>{resultSummary}</p>}
                  {item.outcome.notes && <p className="whitespace-pre-wrap break-words">{item.outcome.notes}</p>}
                  <p className="text-[11px]">Entered {formatLocalDateTime(item.outcome.recordedAt)}</p>
                </div> : !editingOutcome && <p className="mt-1 text-[var(--text-muted)]">Add a count or a brief note after checking the platform yourself.</p>}
                {editingOutcome && <div className="mt-3">
                  <div className="grid grid-cols-3 gap-2">
                    {(["views", "likes", "replies"] as const).map((key) => <div key={key}>
                      <label htmlFor={`assisted-outcome-${key}-${item.id}`} className="mb-1 block font-semibold capitalize text-[var(--text-secondary)]">{key}</label>
                      <input id={`assisted-outcome-${key}-${item.id}`} type="text" inputMode="numeric" pattern="[0-9]*" value={resultDraft[key]} placeholder="—" onChange={(event) => changeOutcomeField(item, key, event.target.value)} disabled={busy || outcomeSavingId === item.id} className="w-full min-w-0 rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent-border)] disabled:opacity-60" />
                    </div>)}
                  </div>
                  <label htmlFor={`assisted-outcome-notes-${item.id}`} className="mb-1 mt-3 block font-semibold text-[var(--text-secondary)]">What happened · optional</label>
                  <textarea id={`assisted-outcome-notes-${item.id}`} value={resultDraft.notes} maxLength={MAX_ASSISTED_OUTCOME_NOTES} rows={2} placeholder="A short observation for your next plan" onChange={(event) => changeOutcomeField(item, "notes", event.target.value)} disabled={busy || outcomeSavingId === item.id} className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[var(--text)] placeholder:text-[var(--text-soft)] outline-none focus:border-[var(--accent-border)] disabled:opacity-60" />
                  <p className="mt-1 text-[11px] leading-4 text-[var(--text-muted)]">Plypost does not fetch or verify these numbers, or send them to AI. Your posted time and link will stay unchanged.</p>
                  {resultValidation.error && <p role="status" className="mt-1 text-[11px] text-[var(--danger)]">{resultValidation.error}</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button type="button" onClick={() => { if (resultValidation.value) void updateOutcome(item.id, resultValidation.value); }} disabled={busy || outcomeSavingId !== null || !resultValidation.value} className="rounded-lg bg-[var(--accent-soft)] px-3 py-2 font-semibold text-[var(--accent-text)] disabled:opacity-50">{outcomeSavingId === item.id ? "Saving…" : "Save results"}</button>
                    {item.outcome && <button type="button" onClick={() => { void updateOutcome(item.id, null); }} disabled={busy || outcomeSavingId !== null} className="font-semibold text-[var(--danger)] disabled:opacity-50">Clear results</button>}
                    <button type="button" onClick={() => closeOutcomeEditor(item.id)} disabled={busy || outcomeSavingId !== null} className="font-semibold text-[var(--text-muted)] disabled:opacity-50">Cancel</button>
                  </div>
                </div>}
              </div>
              </details>}
            </article>;
          })}
        </div>
      )}
    </section>
  );
}
