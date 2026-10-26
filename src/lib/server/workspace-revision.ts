import { createHash } from "node:crypto";
import { database, transaction } from "./db";
import { listMedia } from "./media";
import { listVideos } from "./video";

/** Changes whenever saved account data that a full restore could replace changes. */
export function workspaceDataRevision(db: ReturnType<typeof database>, userId: string): string {
  const hash = createHash("sha256");
  const tables = [
    "SELECT id,payload,updated_at FROM drafts WHERE user_id=? ORDER BY id",
    "SELECT id,payload,scheduled_for,timezone,status,attempts,next_attempt_at,last_error,completed_at,receipts FROM jobs WHERE user_id=? ORDER BY id",
    "SELECT id,payload,scheduled_for,updated_at FROM assisted WHERE user_id=? ORDER BY id",
    "SELECT id,sha256,byte_size FROM media WHERE user_id=? ORDER BY id",
    "SELECT id,sha256,byte_size FROM videos WHERE user_id=? ORDER BY id",
    "SELECT user_id,payload FROM brand_briefs WHERE user_id=?",
    "SELECT user_id,guide,updated_at FROM voice_profiles WHERE user_id=?",
    "SELECT id,payload,created_at FROM weekly_plans WHERE user_id=? ORDER BY id",
    "SELECT user_id,payload,updated_at FROM slot_settings WHERE user_id=?",
  ];
  for (const query of tables) hash.update(JSON.stringify(db.prepare(query).all(userId)));
  return hash.digest("hex");
}

export function currentWorkspaceRevision(userId: string): string {
  // Asset tables are created on first use, before entering the read transaction.
  listMedia(userId);
  listVideos(userId);
  return transaction((db) => workspaceDataRevision(db, userId));
}
