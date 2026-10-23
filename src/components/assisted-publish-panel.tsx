"use client";

import { Bell, CalendarClock, Check, Copy, ExternalLink, RotateCcw, Trash2 } from "lucide-react";
import { assistedDestinations, assistedIds, type AssistedDestinationId } from "@/lib/assisted";
import { isPlatformId } from "@/lib/platforms";
import { validatePlatformText } from "@/lib/platform-validation";
import { assistedState, type AssistedPost } from "@/lib/workspace";
import { formatLocalDateTime, isValidLocalDateTime, LocalDateTimeField } from "@/components/local-date-time-field";

type Props = {
  items: AssistedPost[];
  destination: AssistedDestinationId;
  text: string;
  time: string;
  now: number;
  busy: boolean;
  notificationPermission: NotificationPermission | "unsupported";
  onDestinationChange: (destination: AssistedDestinationId) => void;
  onTextChange: (text: string) => void;
  onTimeChange: (time: string) => void;
  onAdd: () => void;
  onCopy: (text: string, destination: AssistedDestinationId) => void;
  onMarkPosted: (id: string) => void;
  onUndo: (id: string) => void;
  onRemove: (id: string) => void;
  onEnableNotifications: () => void;
};

export function AssistedPublishPanel({ items, destination, text, time, now, busy, notificationPermission, onDestinationChange, onTextChange, onTimeChange, onAdd, onCopy, onMarkPosted, onUndo, onRemove, onEnableNotifications }: Props) {
  const dueCount = items.filter((item) => assistedState(item, now) === "due").length;
  const selected = assistedDestinations[destination];
  const validation = isPlatformId(destination) ? validatePlatformText(destination, text) : null;

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
          <p className="mt-2 text-[12px] leading-5 text-[var(--text-muted)]">{selected.hint}{selected.needsMedia ? " Plypost saves the text only; add the media on the platform." : ""}</p>
          {validation && text.trim() && <div role="status" className="mt-2 space-y-1 text-[12px] leading-5">
            <p className={validation.valid ? "text-[var(--text-muted)]" : "font-semibold text-[var(--danger)]"}>{validation.count} / {validation.limit} {destination === "bluesky" ? "graphemes" : "characters"}{validation.byteCount !== undefined ? ` · ${validation.byteCount} / ${validation.byteLimit} UTF-8 bytes` : ""}</p>
            {validation.issues.map((issue) => <p key={issue.code} className={issue.severity === "error" ? "text-[var(--danger)]" : "text-[var(--warning)]"}>{issue.message}</p>)}
          </div>}
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button type="button" onClick={onAdd} disabled={busy || !text.trim() || validation?.valid === false || Boolean(time && !isValidLocalDateTime(time, now))} className="gradient-button inline-flex items-center gap-2 rounded-xl px-4 py-3 text-[13px] font-bold text-white disabled:opacity-50"><CalendarClock size={15} /> {busy ? "Saving..." : time ? "Save reminder" : "Add to checklist"}</button>
          {notificationPermission === "default" && <button type="button" onClick={onEnableNotifications} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--accent-text)]"><Bell size={14} /> Enable browser alerts</button>}
          <span className="text-[12px] leading-5 text-[var(--text-soft)]">{notificationPermission === "granted" ? "Browser alerts enabled while this page is open." : "Due items appear here while this page is open."}</span>
        </div>
      </div>

      <div className="border-t border-[var(--line)] px-6 py-3 text-[12px] leading-5 text-[var(--text-muted)] sm:px-7">Copy the saved text, open the platform, and publish there yourself. Opening a platform does not send your text or mark it as posted.</div>
      {items.length === 0 ? (
        <div className="flex flex-col items-center border-t border-[var(--line)] px-6 py-9 text-center"><Bell size={22} className="text-[var(--accent-text)]" /><p className="mt-2 text-[13px] font-semibold text-[var(--text-secondary)]">No assisted posts yet</p><p className="mt-1 text-[12px] text-[var(--text-soft)]">Add one above to get a ready-to-publish checklist.</p></div>
      ) : (
        <div className="divide-y divide-[var(--line)] border-t border-[var(--line)]">
          {items.map((item) => {
            const state = assistedState(item, now);
            const target = assistedDestinations[item.destination];
            return <article key={item.id} className="px-6 py-4 sm:px-7">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-[13px] font-bold text-[var(--text-secondary)]">{item.title}</h3><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${state === "due" ? "bg-[var(--warning-soft)] text-[var(--warning)]" : state === "posted" ? "bg-[var(--positive-soft)] text-[var(--positive)]" : "bg-[var(--accent-soft)] text-[var(--accent-text)]"}`}>{state === "due" ? "Ready · publish manually" : state === "posted" ? "Marked posted by you" : "Upcoming"}</span></div><p className="mt-1 text-[12px] text-[var(--text-muted)]">{target.name} · {formatLocalDateTime(item.scheduledFor)}</p></div>
                <button type="button" aria-label={`Remove ${item.title} from assisted publishing`} onClick={() => onRemove(item.id)} disabled={busy} className="rounded-lg p-1.5 text-[var(--text-soft)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:opacity-50"><Trash2 size={14} /></button>
              </div>
              <details className="mt-2 text-[12px] text-[var(--text-muted)]"><summary className="cursor-pointer font-semibold text-[var(--accent-text)]">Review saved text</summary><p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-[var(--accent-soft)] p-3 leading-5">{item.text}</p></details>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => onCopy(item.text, item.destination)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent-border)] px-3 py-2 text-[12px] font-bold text-[var(--accent-text)]"><Copy size={13} /> Copy text</button>
                <a href={target.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-2 text-[12px] font-bold text-[var(--text-secondary)]"><ExternalLink size={13} /> Open {target.name}</a>
                {item.status === "queued" ? <button type="button" onClick={() => onMarkPosted(item.id)} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--positive-soft)] px-3 py-2 text-[12px] font-bold text-[var(--positive)] disabled:opacity-50"><Check size={13} /> I posted it</button> : <button type="button" onClick={() => onUndo(item.id)} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold text-[var(--text-muted)] disabled:opacity-50"><RotateCcw size={13} /> Undo mark</button>}
              </div>
            </article>;
          })}
        </div>
      )}
    </section>
  );
}
