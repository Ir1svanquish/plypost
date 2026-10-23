"use client";

import { useEffect, useState } from "react";
import { Bell, CalendarClock, Check, Copy, ExternalLink, RotateCcw, Trash2 } from "lucide-react";
import { assistedDestinations, assistedIds, type AssistedDestinationId } from "@/lib/assisted";
import { isPlatformId } from "@/lib/platforms";
import { validatePlatformText } from "@/lib/platform-validation";
import { assistedState, normalizePublicPostUrl, type AssistedPost } from "@/lib/workspace";
import { formatLocalDateTime, isValidLocalDateTime, LocalDateTimeField } from "@/components/local-date-time-field";
import { MediaHandoff } from "@/components/media-handoff";

type Props = {
  items: AssistedPost[];
  destination: AssistedDestinationId;
  text: string;
  time: string;
  now: number;
  busy: boolean;
  mediaBusy: boolean;
  imageCount: number;
  notificationPermission: NotificationPermission | "unsupported";
  onDestinationChange: (destination: AssistedDestinationId) => void;
  onTextChange: (text: string) => void;
  onTimeChange: (time: string) => void;
  onAdd: () => void;
  onCopy: (text: string, destination: AssistedDestinationId) => void;
  onMarkPosted: (id: string, postUrl?: string) => void;
  onUpdatePostUrl: (id: string, postUrl: string | null) => Promise<boolean>;
  onUndo: (id: string) => void;
  onRemove: (id: string) => void;
  onEnableNotifications: () => void;
  onEditImages: () => void;
  focusItemId?: string;
};

export function AssistedPublishPanel({ items, destination, text, time, now, busy, mediaBusy, imageCount, notificationPermission, onDestinationChange, onTextChange, onTimeChange, onAdd, onCopy, onMarkPosted, onUpdatePostUrl, onUndo, onRemove, onEnableNotifications, onEditImages, focusItemId }: Props) {
  const [postUrls, setPostUrls] = useState<Record<string, string>>({});
  const [editingLinks, setEditingLinks] = useState<Record<string, boolean>>({});
  const [linkSavingId, setLinkSavingId] = useState<string | null>(null);
  const dueCount = items.filter((item) => assistedState(item, now) === "due").length;
  const selected = assistedDestinations[destination];
  const validation = isPlatformId(destination) ? validatePlatformText(destination, text) : null;
  const hasFocusedItem = Boolean(focusItemId && items.some((item) => item.id === focusItemId));

  useEffect(() => {
    if (!focusItemId || !hasFocusedItem) return;
    const element = document.getElementById(`assisted-item-${focusItemId}`);
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
    element?.focus({ preventScroll: true });
  }, [focusItemId, hasFocusedItem]);

  function closeLinkEditor(id: string) {
    setEditingLinks((current) => { const next = { ...current }; delete next[id]; return next; });
    setPostUrls((current) => { const next = { ...current }; delete next[id]; return next; });
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

  return (
    <section id="assisted" className="section-anchor panel-border soft-shadow mt-8 overflow-hidden rounded-[18px] bg-[var(--surface)]" aria-labelledby="assisted-heading">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] px-6 py-5 sm:px-7">
        <div>
          <h2 id="assisted-heading" className="text-[17px] font-bold tracking-[-0.025em]">Assisted publishing</h2>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">Prepare a post for any platform, then finish it in your own account.</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${dueCount ? "bg-[var(--warning-soft)] text-[var(--warning)]" : "bg-[var(--field)] text-[var(--text-muted)]"}`}>{dueCount ? `${dueCount} ready now` : "Manual publishing"}</span>
      </div>

      <div className="grid gap-4 p-6 sm:grid-cols-2 sm:p-7">
        <div>
          <label htmlFor="assisted-destination" className="mb-2 block text-[12px] font-bold text-[var(--text-secondary)]">Destination</label>
          <select id="assisted-destination" value={destination} onChange={(event) => onDestinationChange(event.target.value as AssistedDestinationId)} className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-[14px] outline-none focus:border-[var(--accent-border)]">
            <optgroup label="More platforms">{assistedIds.slice(0, 7).map((id) => <option key={id} value={id}>{assistedDestinations[id].name}</option>)}</optgroup>
            <optgroup label="Current destinations">{assistedIds.slice(7).map((id) => <option key={id} value={id}>{assistedDestinations[id].name}</option>)}</optgroup>
          </select>
        </div>
        <LocalDateTimeField id="assisted-time" label="Reminder time" value={time} minTimestamp={now} optional onChange={onTimeChange} />
        <div className="sm:col-span-2">
          <label htmlFor="assisted-text" className="mb-2 block text-[12px] font-bold text-[var(--text-secondary)]">Text to copy</label>
          <textarea id="assisted-text" value={text} maxLength={5000} onChange={(event) => onTextChange(event.target.value)} className="min-h-[120px] w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--accent-soft)] px-4 py-3 text-[14px] leading-6 outline-none focus:border-[var(--accent-border)]" />
          <p className="mt-2 text-[12px] leading-5 text-[var(--text-muted)]">{selected.hint} Saved images are available for manual download; upload them on the platform yourself.</p>
          <p className="mt-2 text-[12px] text-[var(--text-secondary)]">{imageCount ? `${imageCount} ${imageCount === 1 ? "image" : "images"} from the current draft will be saved with this handoff.` : "No images selected in the current draft."} <button type="button" onClick={onEditImages} className="font-semibold text-[var(--accent-text)] underline underline-offset-2">Edit images in Create</button></p>
          {validation && text.trim() && <div role="status" className="mt-2 space-y-1 text-[12px] leading-5">
            <p className={validation.valid ? "text-[var(--text-muted)]" : "font-semibold text-[var(--danger)]"}>{validation.count} / {validation.limit} {destination === "bluesky" ? "graphemes" : "characters"}{validation.byteCount !== undefined ? ` · ${validation.byteCount} / ${validation.byteLimit} UTF-8 bytes` : ""}</p>
            {validation.issues.map((issue) => <p key={issue.code} className={issue.severity === "error" ? "text-[var(--danger)]" : "text-[var(--warning)]"}>{issue.message}</p>)}
          </div>}
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button type="button" onClick={onAdd} disabled={busy || mediaBusy || !text.trim() || validation?.valid === false || Boolean(time && !isValidLocalDateTime(time, now))} className="gradient-button inline-flex items-center gap-2 rounded-xl px-4 py-3 text-[13px] font-bold text-white disabled:opacity-50"><CalendarClock size={15} /> {mediaBusy ? "Wait for images…" : busy ? "Saving..." : time ? "Save reminder" : "Add to checklist"}</button>
          {notificationPermission === "default" && <button type="button" onClick={onEnableNotifications} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--accent-text)]"><Bell size={14} /> Enable browser alerts</button>}
          <span className="text-[12px] leading-5 text-[var(--text-soft)]">{notificationPermission === "granted" ? "Browser alerts enabled while this page is open." : "Due items appear here while this page is open."}</span>
        </div>
      </div>

      <div className="border-t border-[var(--line)] px-6 py-3 text-[12px] leading-5 text-[var(--text-muted)] sm:px-7">Copy the saved text, download any saved images in order, then publish on the platform yourself. Opening a platform does not send the post or mark it as published.</div>
      {items.length === 0 ? (
        <div className="flex flex-col items-center border-t border-[var(--line)] px-6 py-9 text-center"><Bell size={22} className="text-[var(--accent-text)]" /><p className="mt-2 text-[13px] font-semibold text-[var(--text-secondary)]">No assisted posts yet</p><p className="mt-1 text-[12px] text-[var(--text-soft)]">Add one above to get a ready-to-publish checklist.</p></div>
      ) : (
        <div className="divide-y divide-[var(--line)] border-t border-[var(--line)]">
          {items.map((item) => {
            const state = assistedState(item, now);
            const target = assistedDestinations[item.destination];
            const enteredUrl = postUrls[item.id] ?? "";
            const normalizedUrl = enteredUrl ? normalizePublicPostUrl(enteredUrl) : undefined;
            const invalidUrl = normalizedUrl === null;
            const savedUrl = item.postUrl && normalizePublicPostUrl(item.postUrl) === item.postUrl ? item.postUrl : undefined;
            const editingLink = item.status === "posted" && Boolean(editingLinks[item.id]);
            const editedLink = postUrls[item.id] ?? savedUrl ?? "";
            const normalizedEditedLink = editedLink ? normalizePublicPostUrl(editedLink) : undefined;
            const invalidEditedLink = normalizedEditedLink === null;
            return <article key={item.id} id={`assisted-item-${item.id}`} tabIndex={-1} className={`scroll-mt-24 px-6 py-4 outline-none sm:px-7 ${focusItemId === item.id ? "bg-[var(--accent-soft)] ring-2 ring-inset ring-[var(--accent-border)]" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-[13px] font-bold text-[var(--text-secondary)]">{item.title}</h3><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${state === "due" ? "bg-[var(--warning-soft)] text-[var(--warning)]" : state === "posted" ? "bg-[var(--positive-soft)] text-[var(--positive)]" : "bg-[var(--accent-soft)] text-[var(--accent-text)]"}`}>{state === "due" ? "Ready · publish manually" : state === "posted" ? "Marked posted by you" : "Upcoming"}</span></div><p className="mt-1 text-[12px] text-[var(--text-muted)]">{target.name} · {formatLocalDateTime(item.scheduledFor)}</p></div>
                <button type="button" aria-label={`Remove ${item.title} from assisted publishing`} onClick={() => onRemove(item.id)} disabled={busy} className="rounded-lg p-1.5 text-[var(--text-soft)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:opacity-50"><Trash2 size={14} /></button>
              </div>
              <details className="mt-2 text-[12px] text-[var(--text-muted)]"><summary className="cursor-pointer font-semibold text-[var(--accent-text)]">Review saved text</summary><p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-[var(--accent-soft)] p-3 leading-5">{item.text}</p></details>
              <MediaHandoff mediaIds={item.mediaIds} />
              {item.status === "queued" && <div className="mt-3 max-w-xl">
                <label htmlFor={`assisted-post-url-${item.id}`} className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Public post link · optional</label>
                <input id={`assisted-post-url-${item.id}`} type="url" inputMode="url" maxLength={2048} value={enteredUrl} placeholder="https://social.example/your-post" aria-invalid={invalidUrl} aria-describedby={`assisted-post-url-hint-${item.id}`} onChange={(event) => setPostUrls((current) => ({ ...current, [item.id]: event.target.value }))} className="w-full rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[12px] text-[var(--text)] placeholder:text-[var(--text-soft)] outline-none focus:border-[var(--accent-border)]" />
                <p id={`assisted-post-url-hint-${item.id}`} className={`mt-1 text-[11px] leading-4 ${invalidUrl ? "text-[var(--danger)]" : "text-[var(--text-muted)]"}`}>{invalidUrl ? "Use a public HTTPS post link with no embedded username or password." : "After posting, paste its link here if you have one. Plypost checks the link format, not the post or account."}</p>
              </div>}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => onCopy(item.text, item.destination)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent-border)] px-3 py-2 text-[12px] font-bold text-[var(--accent-text)]"><Copy size={13} /> Copy text</button>
                <a href={target.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-2 text-[12px] font-bold text-[var(--text-secondary)]"><ExternalLink size={13} /> Open {target.name}</a>
                {item.status === "queued" ? <button type="button" onClick={() => onMarkPosted(item.id, normalizedUrl ?? undefined)} disabled={busy || invalidUrl} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--positive-soft)] px-3 py-2 text-[12px] font-bold text-[var(--positive)] disabled:opacity-50"><Check size={13} /> I posted it</button> : <button type="button" onClick={() => onUndo(item.id)} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold text-[var(--text-muted)] disabled:opacity-50"><RotateCcw size={13} /> Undo mark</button>}
              </div>
              {item.status === "posted" && <div className="mt-2 text-[11px] leading-5 text-[var(--text-muted)]">
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
              </div>}
            </article>;
          })}
        </div>
      )}
    </section>
  );
}
