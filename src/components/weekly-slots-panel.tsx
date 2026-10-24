"use client";

import { useEffect, useState } from "react";
import { Clock3, Plus, Trash2 } from "lucide-react";
import { platformDisplayIds, platforms, type PlatformId } from "@/lib/platforms";
import { parseSlotSettings, type SlotSettings } from "@/lib/slot-settings";

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayOrder = [1, 2, 3, 4, 5, 6, 0];
const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export function WeeklySlotsPanel() {
  const [settings, setSettings] = useState<SlotSettings | null>(null);
  const [zoneInput, setZoneInput] = useState("");
  const [platform, setPlatform] = useState<PlatformId>(platformDisplayIds[0]);
  const [days, setDays] = useState<number[]>([1]);
  const [time, setTime] = useState("09:00");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const response = await fetch("/api/slots", { cache: "no-store" });
        const body = await response.json() as { settings?: unknown; error?: string };
        if (!response.ok) throw new Error(body.error || "Could not load weekly slots.");
        const saved = body.settings === null ? null : parseSlotSettings(body.settings);
        if (body.settings !== null && !saved) throw new Error("Saved weekly slots could not be read.");
        if (live) { setSettings(saved ?? { timeZone: deviceZone(), rules: [] }); setZoneInput(saved?.timeZone ?? deviceZone()); }
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : "Could not load weekly slots.");
      } finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, []);

  async function save(next: SlotSettings, success: string) {
    if (saving) return;
    setSaving(true); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/slots", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", settings: next }),
      });
      const body = await response.json() as { settings?: unknown; error?: string };
      if (!response.ok) throw new Error(body.error || "Could not save weekly slots.");
      const stored = parseSlotSettings(body.settings);
      if (!stored) throw new Error("Weekly slots were saved, but the response could not be read. Reload to check them.");
      setSettings(stored); setZoneInput(stored.timeZone); setMessage(success);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save weekly slots."); }
    finally { setSaving(false); }
  }

  function add() {
    if (!settings || !days.length) { setError("Choose at least one day."); return; }
    const additions = days.map((day) => ({ platform, day, time }));
    const rules = [...settings.rules, ...additions];
    const next = parseSlotSettings({ timeZone: settings.timeZone, rules });
    if (!next) { setError("Check the time, duplicate slots and 56-slot limit."); return; }
    void save(next, `${additions.length} weekly ${additions.length === 1 ? "slot" : "slots"} saved.`);
  }

  function updateZone() {
    if (!settings) return;
    const next = parseSlotSettings({ timeZone: zoneInput.trim(), rules: settings.rules });
    if (!next) { setError("Enter a supported IANA time zone, such as Asia/Hong_Kong."); return; }
    void save(next, "Time zone saved. Existing reminders keep their original dates and times.");
  }

  return <section className="panel-border soft-shadow rounded-[18px] bg-[var(--surface)] p-6 sm:p-7" aria-labelledby="weekly-slots-heading">
    <div className="flex items-start gap-3"><span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-text)]"><Clock3 size={18} aria-hidden="true" /></span><div><h2 id="weekly-slots-heading" className="text-[17px] font-bold tracking-[-0.025em] text-[var(--text)]">Weekly posting slots</h2><p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">Set reusable times for each platform. In Create, preview the next free times before confirming manual handoffs. Slots never publish on their own.</p></div></div>
    {loading && <p role="status" className="mt-5 text-[12px] text-[var(--text-muted)]">Loading weekly slots…</p>}
    {error && <p role="alert" className="mt-4 rounded-xl bg-[var(--danger-soft)] px-3 py-2.5 text-[12px] text-[var(--danger)]">{error}</p>}
    {message && <p role="status" className="mt-4 rounded-xl bg-[var(--positive-soft)] px-3 py-2.5 text-[12px] text-[var(--positive)]">{message}</p>}
    {settings && <div className="mt-5 space-y-5">
      <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] p-4">
        <label htmlFor="weekly-slot-zone" className="block text-[12px] font-bold text-[var(--text-secondary)]">Planning time zone</label>
        <div className="mt-2 flex flex-wrap gap-2"><input id="weekly-slot-zone" value={zoneInput} onChange={(event) => setZoneInput(event.target.value)} spellCheck={false} disabled={saving} className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)]" /><button type="button" onClick={updateZone} disabled={saving || zoneInput.trim() === settings.timeZone} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[12px] font-semibold text-[var(--text-secondary)] disabled:opacity-45">Save time zone</button></div>
        <p className="mt-2 text-[11px] leading-5 text-[var(--text-muted)]">Use an IANA name such as Asia/Hong_Kong. Changing this changes future suggestions, not items already scheduled.</p>
      </div>
      <div className="rounded-xl border border-[var(--line)] p-4">
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-[12px] font-semibold text-[var(--text-secondary)]">Platform<select value={platform} onChange={(event) => setPlatform(event.target.value as PlatformId)} disabled={saving} className="mt-1 block w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)]">{platformDisplayIds.map((id) => <option key={id} value={id}>{platforms[id].name}</option>)}</select></label><label className="text-[12px] font-semibold text-[var(--text-secondary)]">Local time (24h)<input type="text" inputMode="numeric" autoComplete="off" placeholder="HH:mm" maxLength={5} value={time} onChange={(event) => setTime(event.target.value)} disabled={saving} className="mt-1 block w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)]" /></label></div>
        <fieldset className="mt-4"><legend className="text-[12px] font-semibold text-[var(--text-secondary)]">Days</legend><div className="mt-2 flex flex-wrap gap-2">{dayOrder.map((day) => <label key={day} className={`cursor-pointer rounded-full border px-3 py-1.5 text-[12px] font-semibold focus-within:ring-2 focus-within:ring-[var(--accent)] ${days.includes(day) ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]" : "border-[var(--line)] text-[var(--text-secondary)]"}`}><input type="checkbox" className="sr-only" checked={days.includes(day)} disabled={saving} onChange={() => setDays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day].sort((a, b) => (a + 6) % 7 - (b + 6) % 7))} />{dayNames[day]}</label>)}</div></fieldset>
        <button type="button" onClick={add} disabled={saving || !days.length} className="gradient-button mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[12px] font-bold text-white disabled:opacity-45"><Plus size={15} aria-hidden="true" /> Add weekly {days.length === 1 ? "slot" : "slots"}</button>
      </div>
      {settings.rules.length ? <div><h3 className="text-[12px] font-bold text-[var(--text-secondary)]">Saved slots · {settings.rules.length}</h3><div className="mt-2 grid gap-2 sm:grid-cols-2">{[...settings.rules].sort((a, b) => (a.day + 6) % 7 - (b.day + 6) % 7 || a.time.localeCompare(b.time) || a.platform.localeCompare(b.platform)).map((rule) => <div key={`${rule.platform}:${rule.day}:${rule.time}`} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-[12px] text-[var(--text-secondary)]"><span>{dayNames[rule.day]} {rule.time} · {platforms[rule.platform].name}</span><button type="button" aria-label={`Remove ${dayNames[rule.day]} ${rule.time} ${platforms[rule.platform].name} slot`} disabled={saving} onClick={() => void save({ ...settings, rules: settings.rules.filter((item) => item !== rule) }, "Weekly slot removed.")} className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--danger)] disabled:opacity-45"><Trash2 size={14} aria-hidden="true" /></button></div>)}</div></div> : <p className="text-[12px] text-[var(--text-muted)]">No weekly slots yet. Add a day and time to start planning.</p>}
      <p className="text-[11px] leading-5 text-[var(--text-soft)]">When daylight saving skips a local time, that week has no slot. When a local time repeats, Plypost uses its first occurrence.</p>
    </div>}
  </section>;
}
