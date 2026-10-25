import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { audit, database, transaction } from "./db";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 20_000_000;
export const MAX_OWNER_MEDIA_BYTES = 64 * 1024 * 1024;
export const MAX_OWNER_MEDIA_COUNT = 200;
const MEDIA_ID_PATTERN = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

type SupportedImageFormat = "jpeg" | "png" | "webp";
type MediaRow = {
  id: string;
  original_name: string;
  mime_type: string;
  byte_size: number;
  width: number;
  height: number;
  created_at: string;
};

export type MediaItem = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  createdAt: string;
  url: string;
};

export class MediaError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

function mediaDatabase() {
  const db = database();
  db.exec(`
    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      body BLOB NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, sha256)
    );
    CREATE INDEX IF NOT EXISTS media_owner ON media(user_id, created_at DESC);
  `);
  return db;
}

function itemFromRow(row: MediaRow): MediaItem {
  return {
    id: row.id,
    name: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: row.byte_size,
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
    url: `/api/media/${row.id}`,
  };
}

function safeName(value: string): string {
  const base = value.replaceAll("\\", "/").split("/").at(-1) || "image";
  const name = [...base].filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code > 31 && code !== 127;
  }).join("").trim() || "image";
  return name.slice(0, 120);
}

function imageMime(format: SupportedImageFormat): string {
  return `image/${format}`;
}

export function listMedia(userId: string): MediaItem[] {
  return mediaDatabase().prepare("SELECT id,original_name,mime_type,byte_size,width,height,created_at FROM media WHERE user_id=? ORDER BY created_at DESC,id DESC")
    .all(userId).map((row) => itemFromRow(row as MediaRow));
}

export function getMedia(userId: string, id: string): { media: MediaItem; bytes: Buffer } | null {
  if (!MEDIA_ID_PATTERN.test(id)) return null;
  const row = mediaDatabase().prepare("SELECT id,original_name,mime_type,byte_size,width,height,created_at,body FROM media WHERE id=? AND user_id=?")
    .get(id, userId) as (MediaRow & { body: Uint8Array }) | undefined;
  return row ? { media: itemFromRow(row), bytes: Buffer.from(row.body.buffer, row.body.byteOffset, row.body.byteLength) } : null;
}

export function assertOwnedMedia(userId: string, mediaIds: unknown): asserts mediaIds is string[] {
  if (!Array.isArray(mediaIds) || mediaIds.length > 4 || new Set(mediaIds).size !== mediaIds.length ||
      mediaIds.some((id) => typeof id !== "string" || !MEDIA_ID_PATTERN.test(id))) {
    throw new MediaError("Choose up to four distinct images from your media library.");
  }
  const db = mediaDatabase();
  for (const id of mediaIds) {
    if (!db.prepare("SELECT id FROM media WHERE id=? AND user_id=?").get(id, userId)) {
      throw new MediaError("An attached image is missing from your media library.");
    }
  }
}

export function deleteMedia(userId: string, id: string): boolean {
  if (!MEDIA_ID_PATTERN.test(id)) return false;
  mediaDatabase();
  const result = transaction((db) => {
    if (!db.prepare("SELECT id FROM media WHERE id=? AND user_id=?").get(id, userId)) return { changes: 0 };
    for (const [collection, label] of [["drafts", "saved drafts"], ["jobs", "planned posts"], ["assisted", "assisted items"]] as const) {
      const rows = db.prepare(`SELECT payload FROM ${collection} WHERE user_id=?`).all(userId) as { payload: string }[];
      if (rows.some((row) => {
        const item = JSON.parse(row.payload) as { mediaIds?: unknown };
        return Array.isArray(item.mediaIds) && item.mediaIds.includes(id);
      })) {
        throw new MediaError(`Remove this image from ${label} before deleting it.`, 409);
      }
    }
    const deleted = db.prepare("DELETE FROM media WHERE id=? AND user_id=?").run(id, userId);
    if (deleted.changes) audit(userId, "media.deleted", id);
    return deleted;
  });
  return Boolean(result.changes);
}

export async function createMedia(userId: string, file: { name: string; type: string; bytes: Buffer }): Promise<{ media: MediaItem; created: boolean }> {
  if (!file.bytes.length || file.bytes.length > MAX_IMAGE_BYTES) throw new MediaError("Image must be no larger than 5 MiB.", 413);
  let format: SupportedImageFormat;
  let encoded: Buffer;
  let width: number;
  let height: number;
  try {
    const image = sharp(file.bytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error", animated: false });
    const metadata = await image.metadata();
    if (metadata.format !== "jpeg" && metadata.format !== "png" && metadata.format !== "webp") {
      throw new MediaError("Choose a JPEG, PNG, or WebP image.");
    }
    format = metadata.format;
    if (file.type && file.type !== imageMime(format)) throw new MediaError("The file type does not match its image content.");
    if (!metadata.width || !metadata.height || metadata.width > 8192 || metadata.height > 8192 ||
        metadata.width * metadata.height > MAX_IMAGE_PIXELS || (metadata.pages ?? 1) !== 1) {
      throw new MediaError("Image dimensions are unsupported. Use one frame with at most 20 megapixels and 8,192 pixels per side.");
    }
    // Re-encoding strips EXIF, location data, XMP, and ancillary metadata. Rotate applies the orientation first.
    const output = image.rotate();
    const result = await (format === "jpeg" ? output.jpeg({ quality: 88 }) :
      format === "webp" ? output.webp({ quality: 88 }) : output.png({ compressionLevel: 9 }))
      .toBuffer({ resolveWithObject: true });
    encoded = result.data;
    width = result.info.width;
    height = result.info.height;
    if (encoded.length > MAX_IMAGE_BYTES) throw new MediaError("Processed image exceeds 5 MiB. Try a smaller image.", 413);
  } catch (error) {
    if (error instanceof MediaError) throw error;
    throw new MediaError("Image could not be decoded. Choose a valid JPEG, PNG, or WebP file.");
  }

  const digest = createHash("sha256").update(encoded).digest("hex");
  mediaDatabase();
  return transaction((db) => {
    const existing = db.prepare("SELECT id,original_name,mime_type,byte_size,width,height,created_at FROM media WHERE user_id=? AND sha256=?")
      .get(userId, digest) as MediaRow | undefined;
    if (existing) return { media: itemFromRow(existing), created: false };
    const usage = db.prepare("SELECT COUNT(*) AS count,COALESCE(SUM(byte_size),0) AS bytes FROM media WHERE user_id=?")
      .get(userId) as { count: number; bytes: number };
    if (usage.count >= MAX_OWNER_MEDIA_COUNT) throw new MediaError("Media library is full (200 images).", 409);
    if (usage.bytes + encoded.length > MAX_OWNER_MEDIA_BYTES) throw new MediaError("Media library has reached its 64 MiB storage limit.", 409);
    const row: MediaRow = {
      id: randomUUID(), original_name: safeName(file.name), mime_type: imageMime(format),
      byte_size: encoded.length, width, height, created_at: new Date().toISOString(),
    };
    db.prepare("INSERT INTO media(id,user_id,original_name,mime_type,byte_size,width,height,sha256,body,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(row.id, userId, row.original_name, row.mime_type, row.byte_size, row.width, row.height, digest, encoded, row.created_at);
    audit(userId, "media.created", row.id, `${format}; ${row.byte_size} bytes`);
    return { media: itemFromRow(row), created: true };
  });
}
