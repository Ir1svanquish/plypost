import { parseGuide, type VoiceProfile } from "../ai-studio";
import { audit, database } from "./db";

export function loadVoiceProfile(userId: string): VoiceProfile | null {
  const row = database().prepare("SELECT guide,updated_at FROM voice_profiles WHERE user_id=?")
    .get(userId) as { guide: string; updated_at: string } | undefined;
  return row ? { guide: row.guide, updatedAt: row.updated_at } : null;
}

export function saveVoiceProfile(userId: string, value: unknown): VoiceProfile {
  const guide = parseGuide(value);
  if (!guide) throw new Error("The style guide is invalid.");
  const updatedAt = new Date().toISOString();
  database().prepare("INSERT INTO voice_profiles(user_id,guide,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET guide=excluded.guide,updated_at=excluded.updated_at")
    .run(userId, guide, updatedAt);
  audit(userId, "ai.voice_profile_saved");
  return { guide, updatedAt };
}

export function deleteVoiceProfile(userId: string): void {
  database().prepare("DELETE FROM voice_profiles WHERE user_id=?").run(userId);
  audit(userId, "ai.voice_profile_deleted");
}
