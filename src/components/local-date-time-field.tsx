"use client";

import { localDateTimeValue } from "@/lib/workspace";

type Props = {
  id: string;
  label: string;
  value: string;
  minTimestamp: number;
  optional?: boolean;
  onChange: (value: string) => void;
};

export function isValidLocalDateTime(value: string, minTimestamp = 0): boolean {
  if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])-([0-2]\d|3[01])T([01]\d|2[0-3]):[0-5]\d$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && localDateTimeValue(parsed) === value && parsed.getTime() > minTimestamp;
}

export function formatLocalDateTime(value: string): string {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
}

function formatTypedDigits(value: string, groups: number[]): string {
  const digits = value.replace(/\D/g, "").slice(0, groups.reduce((total, length) => total + length, 0));
  const parts: string[] = [];
  let offset = 0;
  for (const length of groups) {
    if (offset >= digits.length) break;
    parts.push(digits.slice(offset, offset + length));
    offset += length;
  }
  return parts.join(groups.length === 2 ? ":" : "-");
}

export function LocalDateTimeField({ id, label, value, minTimestamp, optional = false, onChange }: Props) {
  const [date = "", time = ""] = value ? value.split("T", 2) : [];
  const invalid = Boolean(value) && !isValidLocalDateTime(value, minTimestamp);
  const hintId = `${id}-hint`;

  function update(nextDate: string, nextTime: string) {
    onChange(nextDate || nextTime ? `${nextDate}T${nextTime}` : "");
  }

  return <fieldset className="min-w-0">
    <legend className="mb-2 text-[12px] font-bold text-[var(--text-secondary)]">{label}{optional ? " · optional" : ""}</legend>
    <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-2">
      <label className="min-w-0">
        <span className="mb-1 block text-[11px] font-semibold text-[var(--text-muted)]">Date</span>
        <input id={`${id}-date`} type="text" inputMode="numeric" autoComplete="off" maxLength={10} placeholder="YYYY-MM-DD" value={date} aria-invalid={invalid} aria-describedby={hintId} onChange={(event) => update(formatTypedDigits(event.target.value, [4, 2, 2]), time)} className="w-full min-w-0 rounded-xl border border-[var(--line)] bg-[var(--field)] px-3 py-2.5 text-[13px] text-[var(--text)] placeholder:text-[var(--text-soft)] outline-none focus:border-[var(--accent-border)]" />
      </label>
      <label className="min-w-0">
        <span className="mb-1 block text-[11px] font-semibold text-[var(--text-muted)]">Time (24h)</span>
        <input id={`${id}-time`} type="text" inputMode="numeric" autoComplete="off" maxLength={5} placeholder="HH:mm" value={time} aria-invalid={invalid} aria-describedby={hintId} onChange={(event) => update(date, formatTypedDigits(event.target.value, [2, 2]))} className="w-full min-w-0 rounded-xl border border-[var(--line)] bg-[var(--field)] px-3 py-2.5 text-[13px] text-[var(--text)] placeholder:text-[var(--text-soft)] outline-none focus:border-[var(--accent-border)]" />
      </label>
    </div>
    <p id={hintId} aria-live="polite" className={`mt-1.5 text-[11px] leading-4 ${invalid ? "text-[var(--danger)]" : "text-[var(--text-soft)]"}`}>
      {invalid ? "Use a future local date and time in the formats shown." : "Local time · separators are added as you type"}
    </p>
  </fieldset>;
}
