import { audit, database, transaction } from "./db";
import { isPlatformId, type PlatformId } from "../platforms";
import { parseSlotSettings, slotCandidates, slotMinute, type SlotSettings } from "../slot-settings";
import { hasManualReminder, type AssistedPost, type ScheduledPost } from "../workspace";

type Db = ReturnType<typeof database>;
type ScheduledRow = { payload: string; scheduled_for: string };
export type SlotSettingsSnapshot = { settings: SlotSettings | null; updatedAt: string | null };
export class SlotSettingsConflictError extends Error {}

export function loadSlotSettingsSnapshot(userId: string): SlotSettingsSnapshot {
  const row = database().prepare("SELECT payload,updated_at FROM slot_settings WHERE user_id=?")
    .get(userId) as { payload: string; updated_at: string } | undefined;
  if (!row) return { settings: null, updatedAt: null };
  const settings = parseSlotSettings(JSON.parse(row.payload));
  if (!settings) throw new Error("Saved weekly slots are invalid. Restore a backup or remove this setting.");
  return { settings, updatedAt: row.updated_at };
}

export function getSlotSettings(userId: string): SlotSettings | null {
  return loadSlotSettingsSnapshot(userId).settings;
}

export function saveSlotSettingsIfCurrent(userId: string, input: unknown, expectedUpdatedAt: string | null): SlotSettingsSnapshot {
  const settings = parseSlotSettings(input);
  if (!settings) throw new Error("Choose a valid time zone and up to 56 unique weekly slots.");
  return transaction((db) => {
    const updatedAt = new Date(Math.max(Date.now(), expectedUpdatedAt ? Date.parse(expectedUpdatedAt) + 1 : 0)).toISOString();
    const payload = JSON.stringify(settings);
    const result = expectedUpdatedAt === null
      ? db.prepare("INSERT INTO slot_settings(user_id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO NOTHING")
        .run(userId, payload, updatedAt)
      : db.prepare("UPDATE slot_settings SET payload=?,updated_at=? WHERE user_id=? AND updated_at=?")
        .run(payload, updatedAt, userId, expectedUpdatedAt);
    if (result.changes !== 1) throw new SlotSettingsConflictError("Weekly slots changed in another window. Review both versions before saving again.");
    audit(userId, "slots.saved", undefined, `${settings.rules.length} weekly slots`);
    return { settings, updatedAt };
  });
}

export function saveSlotSettings(userId: string, input: unknown): SlotSettings {
  const settings = parseSlotSettings(input);
  if (!settings) throw new Error("Choose a valid time zone and up to 56 unique weekly slots.");
  transaction((db) => {
    db.prepare(`INSERT INTO slot_settings(user_id,payload,updated_at) VALUES (?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at`)
      .run(userId, JSON.stringify(settings), new Date().toISOString());
    audit(userId, "slots.saved", undefined, `${settings.rules.length} weekly slots`);
  });
  return settings;
}

function occupiedMinutes(db: Db, userId: string, start: string, end: string): Set<string> {
  const occupied = new Set<string>();
  const manual = db.prepare("SELECT payload,scheduled_for FROM assisted WHERE user_id=? AND scheduled_for>=? AND scheduled_for<?")
    .all(userId, start, end) as ScheduledRow[];
  for (const row of manual) {
    const item = JSON.parse(row.payload) as AssistedPost;
    if (item.status === "queued" && hasManualReminder(item) && isPlatformId(item.destination))
      occupied.add(`${item.destination}:${slotMinute(row.scheduled_for)}`);
  }
  const simulated = db.prepare(`SELECT payload,scheduled_for FROM jobs WHERE user_id=? AND scheduled_for>=? AND scheduled_for<?
    AND status IN ('queued','running','failed')`).all(userId, start, end) as ScheduledRow[];
  for (const row of simulated) {
    const post = JSON.parse(row.payload) as ScheduledPost;
    for (const platform of Object.keys(post.posts)) {
      if (isPlatformId(platform)) occupied.add(`${platform}:${slotMinute(row.scheduled_for)}`);
    }
  }
  const real = db.prepare(`SELECT scheduled_for FROM mastodon_scheduled_posts WHERE user_id=?
    AND scheduled_for>=? AND scheduled_for<? AND status IN ('queued','inflight')`)
    .all(userId, start, end) as { scheduled_for: string }[];
  for (const row of real) occupied.add(`mastodon:${slotMinute(row.scheduled_for)}`);
  return occupied;
}

export function slotIsFree(db: Db, userId: string, platform: PlatformId, instant: string): boolean {
  const minute = slotMinute(instant);
  const start = new Date(minute * 60_000).toISOString();
  const end = new Date((minute + 1) * 60_000).toISOString();
  return !occupiedMinutes(db, userId, start, end).has(`${platform}:${minute}`);
}

export function suggestWeeklySlots(userId: string, input: unknown, now = Date.now()) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 4 ||
      input.some((item) => !isPlatformId(item)) || new Set(input).size !== input.length) {
    throw new Error("Select one to four different platform destinations.");
  }
  const settings = getSlotSettings(userId);
  if (!settings?.rules.length) throw new Error("Add weekly slots in Plan first.");
  const after = now + 10 * 60_000;
  const end = after + 57 * 86_400_000;
  const occupied = occupiedMinutes(database(), userId, new Date(after).toISOString(), new Date(end).toISOString());
  const suggestions = (input as PlatformId[]).map((platform) => {
    const candidates = slotCandidates(settings, platform, after);
    let skippedConflicts = 0;
    for (const scheduledFor of candidates) {
      if (occupied.has(`${platform}:${slotMinute(scheduledFor)}`)) { skippedConflicts++; continue; }
      return { platform, scheduledFor, skippedConflicts };
    }
    throw new Error(`No free ${platform} slot was found in the next eight weeks. Add another weekly slot or clear a conflict.`);
  });
  return { timeZone: settings.timeZone, suggestions };
}
