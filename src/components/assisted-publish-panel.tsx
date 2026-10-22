"use client";

import { Bell, CalendarClock, Check, Copy, ExternalLink, RotateCcw, Trash2 } from "lucide-react";
import { assistedDestinations, assistedIds, type AssistedDestinationId } from "@/lib/assisted";
import { assistedState, localDateTimeValue, type AssistedPost } from "@/lib/workspace";

type Props = {
  items: AssistedPost[];
  destination: AssistedDestinationId;
  text: string;
  time: string;
  now: number;
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

export function AssistedPublishPanel({ items, destination, text, time, now, notificationPermission, onDestinationChange, onTextChange, onTimeChange, onAdd, onCopy, onMarkPosted, onUndo, onRemove, onEnableNotifications }: Props) {
  const dueCount = items.filter((item) => assistedState(item, now) === "due").length;
  const selected = assistedDestinations[destination];

  return (
    <section id="assisted" className="panel-border soft-shadow mt-8 overflow-hidden rounded-[22px] bg-white" aria-labelledby="assisted-heading">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#eff0f4] px-6 py-5 sm:px-7">
        <div>
          <h2 id="assisted-heading" className="text-[16px] font-bold tracking-[-0.025em]">Assisted publishing</h2>
          <p className="mt-1 text-[12px] text-[#989bad]">Prepare a post for any platform, then finish it in your own account.</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${dueCount ? "bg-[#fff2e2] text-[#a66b2a]" : "bg-[#f4f4f8] text-[#84889d]"}`}>{dueCount ? `${dueCount} ready now` : "Manual publishing"}</span>
      </div>

      <div className="grid gap-4 p-6 sm:grid-cols-2 sm:p-7">
        <div>
          <label htmlFor="assisted-destination" className="mb-2 block text-[11px] font-bold text-[#676b7f]">Destination</label>
          <select id="assisted-destination" value={destination} onChange={(event) => onDestinationChange(event.target.value as AssistedDestinationId)} className="w-full rounded-xl border border-[#e5e6ee] bg-white px-4 py-3 text-[13px] outline-none focus:border-[#9488f4]">
            <optgroup label="More platforms">{assistedIds.slice(0, 7).map((id) => <option key={id} value={id}>{assistedDestinations[id].name}</option>)}</optgroup>
            <optgroup label="Current destinations">{assistedIds.slice(7).map((id) => <option key={id} value={id}>{assistedDestinations[id].name}</option>)}</optgroup>
          </select>
        </div>
        <div>
          <label htmlFor="assisted-time" className="mb-2 block text-[11px] font-bold text-[#676b7f]">Reminder time · optional</label>
          <input id="assisted-time" type="datetime-local" value={time} min={now ? localDateTimeValue(new Date(now)) : undefined} onChange={(event) => onTimeChange(event.target.value)} className="w-full rounded-xl border border-[#e5e6ee] bg-white px-4 py-3 text-[13px] outline-none focus:border-[#9488f4]" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="assisted-text" className="mb-2 block text-[11px] font-bold text-[#676b7f]">Text to copy</label>
          <textarea id="assisted-text" value={text} maxLength={5000} onChange={(event) => onTextChange(event.target.value)} className="min-h-[120px] w-full resize-y rounded-xl border border-[#e5e6ee] bg-[#fcfcfe] px-4 py-3 text-[13px] leading-6 outline-none focus:border-[#9488f4]" />
          <p className="mt-2 text-[11px] leading-5 text-[#8f93a5]">{selected.hint}{selected.needsMedia ? " SocialFlow saves the text only; add the media on the platform." : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button type="button" onClick={onAdd} disabled={!text.trim()} className="gradient-button inline-flex items-center gap-2 rounded-xl px-4 py-3 text-[12px] font-bold text-white"><CalendarClock size={15} /> {time ? "Save reminder" : "Add to checklist"}</button>
          {notificationPermission === "default" && <button type="button" onClick={onEnableNotifications} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#7060df]"><Bell size={14} /> Enable browser alerts</button>}
          <span className="text-[11px] leading-5 text-[#a0a4b4]">{notificationPermission === "granted" ? "Browser alerts enabled while this page is open." : "Due items appear here while this page is open."}</span>
        </div>
      </div>

      <div className="border-t border-[#f0f1f5] px-6 py-3 text-[11px] leading-5 text-[#9296a8] sm:px-7">Copy the saved text, open the platform, and publish there yourself. Opening a platform does not send your text or mark it as posted.</div>
      {items.length === 0 ? (
        <div className="flex flex-col items-center border-t border-[#f0f1f5] px-6 py-9 text-center"><Bell size={22} className="text-[#a4a6ce]" /><p className="mt-2 text-[12px] font-semibold text-[#5e6074]">No assisted posts yet</p><p className="mt-1 text-[11px] text-[#a0a4b4]">Add one above to get a ready-to-publish checklist.</p></div>
      ) : (
        <div className="divide-y divide-[#f0f1f5] border-t border-[#f0f1f5]">
          {items.map((item) => {
            const state = assistedState(item, now);
            const target = assistedDestinations[item.destination];
            return <article key={item.id} className="px-6 py-4 sm:px-7">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-[12px] font-bold text-[#45485c]">{item.title}</h3><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${state === "due" ? "bg-[#fff3e4] text-[#a66b2a]" : state === "posted" ? "bg-[#edf9f2] text-[#358860]" : "bg-[#f0edff] text-[#7464cf]"}`}>{state === "due" ? "Ready · publish manually" : state === "posted" ? "Marked posted by you" : "Upcoming"}</span></div><p className="mt-1 text-[11px] text-[#8b8fa1]">{target.name} · {new Date(item.scheduledFor).toLocaleString()}</p></div>
                <button type="button" aria-label={`Remove ${item.title} from assisted publishing`} onClick={() => onRemove(item.id)} className="rounded-lg p-1.5 text-[#abb0bd] hover:bg-[#fff0f0] hover:text-[#cc626a]"><Trash2 size={14} /></button>
              </div>
              <details className="mt-2 text-[11px] text-[#75798c]"><summary className="cursor-pointer font-semibold text-[#7566d9]">Review saved text</summary><p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-[#fafaff] p-3 leading-5">{item.text}</p></details>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => onCopy(item.text, item.destination)} className="inline-flex items-center gap-1.5 rounded-lg border border-[#e3dfff] px-3 py-2 text-[11px] font-bold text-[#7060df]"><Copy size={13} /> Copy text</button>
                <a href={target.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e6ee] px-3 py-2 text-[11px] font-bold text-[#62667c]"><ExternalLink size={13} /> Open {target.name}</a>
                {item.status === "queued" ? <button type="button" onClick={() => onMarkPosted(item.id)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#edf9f2] px-3 py-2 text-[11px] font-bold text-[#358860]"><Check size={13} /> I posted it</button> : <button type="button" onClick={() => onUndo(item.id)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold text-[#85899b]"><RotateCcw size={13} /> Undo mark</button>}
              </div>
            </article>;
          })}
        </div>
      )}
    </section>
  );
}
