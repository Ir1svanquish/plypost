import { isPlatformId, type PlatformId } from "./platforms";

export type WeeklySlot = { platform: PlatformId; day: number; time: string };
export type SlotSettings = { timeZone: string; rules: WeeklySlot[] };

const MAX_RULES = 56;
const DAY_MS = 86_400_000;
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let value = formatterCache.get(timeZone);
  if (!value) {
    value = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatterCache.set(timeZone, value);
  }
  return value;
}

function localParts(instant: number, timeZone: string) {
  const parts = formatter(timeZone).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second),
  };
}

export function parseSlotSettings(value: unknown): SlotSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => key !== "timeZone" && key !== "rules") ||
      typeof source.timeZone !== "string" || source.timeZone.length > 64 ||
      !/^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){1,3})$/.test(source.timeZone) ||
      !Array.isArray(source.rules) || source.rules.length > MAX_RULES) return null;
  try { formatter(source.timeZone); } catch { return null; }
  const seen = new Set<string>();
  const rules: WeeklySlot[] = [];
  for (const entry of source.rules) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const rule = entry as Record<string, unknown>;
    if (Object.keys(rule).some((key) => key !== "platform" && key !== "day" && key !== "time") ||
        !isPlatformId(rule.platform) || !Number.isInteger(rule.day) ||
        (rule.day as number) < 0 || (rule.day as number) > 6 ||
        typeof rule.time !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(rule.time)) return null;
    const key = `${rule.platform}:${rule.day}:${rule.time}`;
    if (seen.has(key)) return null;
    seen.add(key);
    rules.push({ platform: rule.platform, day: rule.day as number, time: rule.time });
  }
  return { timeZone: source.timeZone, rules };
}

function matchingInstants(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number[] {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const offsets = new Set<number>();
  // Sampling either side of the wall date catches both offsets at DST transitions.
  for (let step = -6; step <= 6; step++) {
    const sample = wallAsUtc + step * 6 * 3_600_000;
    const parts = localParts(sample, timeZone);
    offsets.add(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - sample);
  }
  return [...offsets].map((offset) => wallAsUtc - offset).filter((instant) => {
    const parts = localParts(instant, timeZone);
    return parts.year === year && parts.month === month && parts.day === day &&
      parts.hour === hour && parts.minute === minute;
  }).sort((a, b) => a - b);
}

export function slotCandidates(settings: SlotSettings, platform: PlatformId, after: number, days = 56): string[] {
  if (!Number.isFinite(after) || days < 1 || days > 56) return [];
  const start = localParts(after, settings.timeZone);
  const firstDay = Date.UTC(start.year, start.month - 1, start.day);
  const candidates: number[] = [];
  for (let offset = 0; offset < days; offset++) {
    const date = new Date(firstDay + offset * DAY_MS);
    const year = date.getUTCFullYear(), month = date.getUTCMonth() + 1, day = date.getUTCDate();
    for (const rule of settings.rules) {
      if (rule.platform !== platform || rule.day !== date.getUTCDay()) continue;
      const [hour, minute] = rule.time.split(":").map(Number);
      // A nonexistent spring-forward wall time is skipped. A repeated fall-back
      // wall time uses its first occurrence, so a rule never fires twice.
      const instant = matchingInstants(year, month, day, hour, minute, settings.timeZone)[0];
      if (instant !== undefined && instant >= after) candidates.push(instant);
    }
  }
  return [...new Set(candidates)].sort((a, b) => a - b).map((instant) => new Date(instant).toISOString());
}

export function slotMinute(instant: string): number {
  return Math.floor(Date.parse(instant) / 60_000);
}

export function suggestedSlotIsReady(instant: string | undefined, now: number): boolean {
  const timestamp = instant ? Date.parse(instant) : NaN;
  return Number.isFinite(timestamp) && timestamp >= now + 10_000;
}
