import { parseGuide, type VoiceProfile } from "../ai-studio";
import { audit, database } from "./db";

export class VoiceProfileConflictError extends Error {}

export function isVoiceProfileVersion(value: unknown): value is string | null {
  return value === null || typeof value === "string" && value.length <= 40 &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

export function loadVoiceProfile(userId: string): VoiceProfile | null {
  const row = database().prepare("SELECT guide,updated_at FROM voice_profiles WHERE user_id=?")
    .get(userId) as { guide: string; updated_at: string } | undefined;
  return row ? { guide: row.guide, updatedAt: row.updated_at } : null;
}

/** Only replace the guide version the editor actually read. SQLite checks this atomically. */
export function saveVoiceProfileIfCurrent(userId: string, value: unknown, expectedUpdatedAt: string | null): VoiceProfile {
  const guide = parseGuide(value);
  if (!guide) throw new Error("The style guide is invalid.");
  const updatedAt = new Date(Math.max(Date.now(), expectedUpdatedAt ? Date.parse(expectedUpdatedAt) + 1 : 0)).toISOString();
  const db = database();
  const result = expectedUpdatedAt === null
    ? db.prepare("INSERT INTO voice_profiles(user_id,guide,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO NOTHING")
      .run(userId, guide, updatedAt)
    : db.prepare("UPDATE voice_profiles SET guide=?,updated_at=? WHERE user_id=? AND updated_at=?")
      .run(guide, updatedAt, userId, expectedUpdatedAt);
  if (result.changes !== 1) throw new VoiceProfileConflictError("The writing style guide changed in another window. Review the latest version before saving again.");
  audit(userId, "ai.voice_profile_saved");
  return { guide, updatedAt };
}

export function deleteVoiceProfileIfCurrent(userId: string, expectedUpdatedAt: string): void {
  const result = database().prepare("DELETE FROM voice_profiles WHERE user_id=? AND updated_at=?")
    .run(userId, expectedUpdatedAt);
  if (result.changes !== 1) throw new VoiceProfileConflictError("The writing style guide changed in another window. Review the latest version before removing it.");
  audit(userId, "ai.voice_profile_deleted");
}
