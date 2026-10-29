import { createHash, randomUUID } from "node:crypto";
import { audit, database, transaction } from "./db";
import { unicodePrefixByCodeUnits } from "./media-name";

export const MAX_VIDEO_BYTES = 32 * 1024 * 1024;
export const MAX_OWNER_VIDEO_BYTES = 64 * 1024 * 1024;
export const MAX_OWNER_VIDEO_COUNT = 12;
const VIDEO_ID_PATTERN = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const extensions: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

type VideoRow = {
  id: string; original_name: string; mime_type: string; byte_size: number; created_at: string;
};

export type VideoItem = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

export class VideoError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

function videoDatabase() {
  const db = database();
  db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      body BLOB NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, sha256)
    );
    CREATE INDEX IF NOT EXISTS videos_owner ON videos(user_id, created_at DESC);
  `);
  return db;
}

function itemFromRow(row: VideoRow): VideoItem {
  return { id: row.id, name: row.original_name, mimeType: row.mime_type,
    sizeBytes: row.byte_size, createdAt: row.created_at };
}

export function validVideoBytes(mimeType: unknown, bytes: Uint8Array): mimeType is keyof typeof extensions {
  if (typeof mimeType !== "string" || !extensions[mimeType] || bytes.length < 12 || bytes.length > MAX_VIDEO_BYTES) return false;
  if (mimeType === "video/webm") return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  const brand = Buffer.from(bytes.subarray(8, 12)).toString("ascii");
  return Buffer.from(bytes.subarray(4, 8)).toString("ascii") === "ftyp" &&
    (mimeType === "video/quicktime" ? brand === "qt  " : brand !== "qt  ");
}

export function safeVideoName(value: string, mimeType: string): string {
  const basename = value.replaceAll("\\", "/").split("/").at(-1) || "video";
  const stem = basename.replace(/\.[^.]+$/, "").replace(/[<>:"|?*]/g, "")
    .split("").filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    }).join("").trim();
  const shortStem = unicodePrefixByCodeUnits(stem, 110) || "video";
  return `${shortStem}.${extensions[mimeType] ?? "mp4"}`;
}

export function listVideos(userId: string): VideoItem[] {
  return videoDatabase().prepare("SELECT id,original_name,mime_type,byte_size,created_at FROM videos WHERE user_id=? ORDER BY created_at DESC,id DESC")
    .all(userId).map((row) => itemFromRow(row as VideoRow));
}

export function getVideoMetadata(userId: string, id: string): VideoItem | null {
  if (!VIDEO_ID_PATTERN.test(id)) return null;
  const row = videoDatabase().prepare("SELECT id,original_name,mime_type,length(body) AS byte_size,created_at FROM videos WHERE id=? AND user_id=?")
    .get(id, userId) as VideoRow | undefined;
  return row ? itemFromRow(row) : null;
}

export function getVideo(userId: string, id: string, range?: { start: number; end: number }): { video: VideoItem; bytes: Buffer } | null {
  if (!VIDEO_ID_PATTERN.test(id)) return null;
  if (range && (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 ||
      range.end < range.start || range.end >= MAX_VIDEO_BYTES)) return null;
  // Slice the BLOB inside SQLite: a short playback range must not load the whole clip into JavaScript memory.
  const row = range
    ? videoDatabase().prepare("SELECT id,original_name,mime_type,byte_size,created_at,substr(body,?,?) AS body FROM videos WHERE id=? AND user_id=?")
      .get(range.start + 1, range.end - range.start + 1, id, userId) as (VideoRow & { body: Uint8Array }) | undefined
    : videoDatabase().prepare("SELECT id,original_name,mime_type,byte_size,created_at,body FROM videos WHERE id=? AND user_id=?")
      .get(id, userId) as (VideoRow & { body: Uint8Array }) | undefined;
  return row ? { video: itemFromRow(row), bytes: Buffer.from(row.body.buffer, row.body.byteOffset, row.body.byteLength) } : null;
}

export function assertOwnedVideo(userId: string, id: unknown): void {
  if (id === undefined) return;
  if (typeof id !== "string" || !VIDEO_ID_PATTERN.test(id) ||
      !videoDatabase().prepare("SELECT id FROM videos WHERE id=? AND user_id=?").get(id, userId)) {
    throw new VideoError("Attached video is missing from your private library.");
  }
}

export function createVideo(userId: string, file: { name: string; type: string; bytes: Buffer }): { video: VideoItem; created: boolean } {
  if (!file.bytes.length || file.bytes.length > MAX_VIDEO_BYTES) throw new VideoError("Video must be no larger than 32 MiB.", 413);
  if (!validVideoBytes(file.type, file.bytes)) throw new VideoError("Choose a valid MP4, WebM, or MOV video.");
  const digest = createHash("sha256").update(file.bytes).digest("hex");
  videoDatabase();
  return transaction((db) => {
    const existing = db.prepare("SELECT id,original_name,mime_type,byte_size,created_at FROM videos WHERE user_id=? AND sha256=?")
      .get(userId, digest) as VideoRow | undefined;
    if (existing) return { video: itemFromRow(existing), created: false };
    const usage = db.prepare("SELECT COUNT(*) AS count,COALESCE(SUM(byte_size),0) AS bytes FROM videos WHERE user_id=?")
      .get(userId) as { count: number; bytes: number };
    if (usage.count >= MAX_OWNER_VIDEO_COUNT) throw new VideoError("Video library is full (12 clips).", 409);
    if (usage.bytes + file.bytes.length > MAX_OWNER_VIDEO_BYTES) throw new VideoError("Video library has reached its 64 MiB storage limit.", 409);
    const row: VideoRow = { id: randomUUID(), original_name: safeVideoName(file.name, file.type),
      mime_type: file.type, byte_size: file.bytes.length, created_at: new Date().toISOString() };
    db.prepare("INSERT INTO videos(id,user_id,original_name,mime_type,byte_size,sha256,body,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(row.id, userId, row.original_name, row.mime_type, row.byte_size, digest, file.bytes, row.created_at);
    audit(userId, "video.created", row.id);
    return { video: itemFromRow(row), created: true };
  });
}

export function deleteVideo(userId: string, id: string): boolean {
  if (!VIDEO_ID_PATTERN.test(id)) return false;
  videoDatabase();
  return transaction((db) => {
    if (!db.prepare("SELECT id FROM videos WHERE id=? AND user_id=?").get(id, userId)) return false;
    const referenced = ["drafts", "assisted"].some((table) =>
      (db.prepare(`SELECT payload FROM ${table} WHERE user_id=?`).all(userId) as { payload: string }[])
        .some((row) => (JSON.parse(row.payload) as { videoId?: unknown }).videoId === id));
    if (referenced) throw new VideoError("Detach this video from saved drafts and handoffs before deleting it.", 409);
    db.prepare("DELETE FROM videos WHERE id=? AND user_id=?").run(id, userId);
    audit(userId, "video.deleted", id);
    return true;
  });
}
