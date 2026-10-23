import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { transaction, audit, database } from "./db";
import { listMedia, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, MAX_OWNER_MEDIA_BYTES, MAX_OWNER_MEDIA_COUNT } from "./media";
import { parseWorkspace, type AssistedPost, type SavedDraft, type ScheduledPost } from "../workspace";

export const MAX_PORTABLE_BACKUP_BYTES = 128 * 1024 * 1024;

const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const validInstant = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

type JobStatus = "queued" | "failed" | "simulated";
type PortableJob = {
  post: ScheduledPost;
  timezone: string;
  status: JobStatus;
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  completedAt: string | null;
  receipts: NonNullable<ScheduledPost["receipts"]>;
};
type PortableMedia = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  createdAt: string;
  sha256: string;
  base64: string;
};
export type PortableBackup = {
  format: "plypost-portable";
  version: 1;
  exportedAt: string;
  drafts: SavedDraft[];
  jobs: PortableJob[];
  assisted: AssistedPost[];
  media: PortableMedia[];
};

type StoredMedia = {
  id: string; original_name: string; mime_type: string; byte_size: number; width: number; height: number;
  created_at: string; sha256: string; body: Uint8Array;
};
type StoredJob = {
  id: string; payload: string; timezone: string; status: string; attempts: number; next_attempt_at: string;
  last_error: string | null; completed_at: string | null; receipts: string;
};
type PreparedMedia = {
  oldId: string; newId: string; name: string; mimeType: string; sizeBytes: number;
  width: number; height: number; createdAt: string; sha256: string; body: Buffer;
};

export class BackupError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

function invalid(message = "Invalid portable backup."): never { throw new BackupError(message); }

function validTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64 ||
      !/^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){1,3})$/.test(value)) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; }
  catch { return false; }
}

function safeName(value: string): string {
  const base = value.replaceAll("\\", "/").split("/").at(-1) || "image";
  const name = [...base].filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code > 31 && code !== 127;
  }).join("").trim() || "image";
  return name.slice(0, 120);
}

function mediaReferences(value: unknown): string[] {
  if (!isRecord(value) || value.mediaIds === undefined) return [];
  if (!Array.isArray(value.mediaIds) || value.mediaIds.length > 4 ||
      new Set(value.mediaIds).size !== value.mediaIds.length || !value.mediaIds.every(validId)) {
    invalid("Backup contains invalid image references.");
  }
  return value.mediaIds as string[];
}

function sameVariants(raw: unknown, parsed: unknown): boolean {
  if (!isRecord(raw) || !isRecord(parsed)) return false;
  return Object.keys(raw).length === Object.keys(parsed).length &&
    Object.entries(raw).every(([key, value]) => parsed[key] === value);
}

function containsJobMetadata(post: unknown): boolean {
  return isRecord(post) &&
    ["attempts", "nextAttemptAt", "lastError", "completedAt", "simulatedAt", "receipts"].some((key) => key in post);
}

function validateCollection<T extends { id: string }>(raw: unknown, parsed: T[], label: string): T[] {
  if (!Array.isArray(raw) || raw.length > 100 || parsed.length !== raw.length ||
      raw.some((item, index) => !isRecord(item) || !validId(item.id) || item.id !== parsed[index].id ||
        JSON.stringify(mediaReferences(item)) !== JSON.stringify(mediaReferences(parsed[index])))) {
    invalid(`Backup contains invalid ${label}.`);
  }
  for (let index = 0; index < raw.length; index++) {
    const item = raw[index] as Record<string, unknown>;
    const normalized = parsed[index] as Record<string, unknown>;
    if (label === "drafts") {
      if (!Array.isArray(item.selected) || item.selected.length !== (normalized.selected as unknown[]).length ||
          item.selected.some((id) => !(normalized.selected as unknown[]).includes(id)) ||
          !sameVariants(item.variants, normalized.variants)) {
        invalid("Backup contains invalid draft destinations or platform versions.");
      }
    }
    if (label === "assisted items" &&
        ((item.postedAt !== undefined && item.postedAt !== normalized.postedAt) ||
          (item.postUrl !== undefined && item.postUrl !== normalized.postUrl) ||
          (item.notifiedAt !== undefined && item.notifiedAt !== normalized.notifiedAt))) {
      invalid("Backup contains invalid assisted item history.");
    }
  }
  return parsed;
}

function validateJobs(raw: unknown): PortableJob[] {
  if (!Array.isArray(raw) || raw.length > 100) invalid("Backup contains invalid planned items.");
  return raw.map((value): PortableJob => {
    if (!isRecord(value) || !isRecord(value.post) || !validId(value.post.id) ||
        (value.status !== "queued" && value.status !== "failed" && value.status !== "simulated") ||
        !validTimezone(value.timezone) || !validInstant(value.nextAttemptAt) ||
        !Number.isInteger(value.attempts) || (value.attempts as number) < 0 || (value.attempts as number) > 1_000_000 ||
        (value.lastError !== null && (typeof value.lastError !== "string" || value.lastError.length > 300)) ||
        (value.completedAt !== null && !validInstant(value.completedAt)) ||
        (value.status === "simulated") !== (value.completedAt !== null) ||
        !Array.isArray(value.receipts) || value.receipts.length > 4 ||
        value.post.status !== value.status || containsJobMetadata(value.post)) {
      invalid("Backup contains invalid planned items.");
    }
    const post = {
      ...value.post,
      status: value.status,
      attempts: value.attempts,
      ...(value.status === "queued" ? { nextAttemptAt: value.nextAttemptAt } : {}),
      ...(value.lastError ? { lastError: value.lastError } : {}),
      ...(value.status === "simulated" ? { simulatedAt: value.completedAt } : {}),
      receipts: value.receipts,
    };
    const parsed = parseWorkspace({ version: 3, drafts: [], schedule: [post], assisted: [] });
    if (!parsed || parsed.schedule.length !== 1 ||
        JSON.stringify(mediaReferences(value.post)) !== JSON.stringify(mediaReferences(parsed.schedule[0]))) {
      invalid("Backup contains invalid planned items.");
    }
    return {
      post: parsed.schedule[0], timezone: value.timezone as string, status: value.status as JobStatus,
      attempts: value.attempts as number, nextAttemptAt: value.nextAttemptAt as string,
      lastError: value.lastError as string | null, completedAt: value.completedAt as string | null,
      receipts: parsed.schedule[0].receipts ?? [],
    };
  });
}

function validateWorkspace(raw: Record<string, unknown>) {
  const drafts = raw.drafts;
  const assisted = raw.assisted;
  const jobs = validateJobs(raw.jobs);
  const parsed = parseWorkspace({ version: 3, drafts, schedule: [], assisted });
  if (!parsed) invalid();
  return {
    drafts: validateCollection(drafts, parsed.drafts, "drafts"),
    assisted: validateCollection(assisted, parsed.assisted, "assisted items"),
    jobs,
  };
}

function assertUniqueIds(items: { id: string }[]) {
  if (new Set(items.map((item) => item.id)).size !== items.length) invalid("Backup contains duplicate IDs.");
}

function decodeCanonicalBase64(value: unknown): Buffer {
  if (typeof value !== "string" || value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
      value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    invalid("Backup contains invalid image data.");
  }
  const body = Buffer.from(value, "base64");
  if (body.toString("base64") !== value) invalid("Backup contains invalid image data.");
  return body;
}

async function prepareMedia(raw: unknown): Promise<PreparedMedia[]> {
  if (!Array.isArray(raw) || raw.length > MAX_OWNER_MEDIA_COUNT) invalid("Backup contains too many images.");
  const prepared: PreparedMedia[] = [];
  let totalBytes = 0;
  let encodedTotal = 0;
  const digests = new Set<string>();
  const ids = new Set<string>();
  for (const entry of raw) {
    if (!isRecord(entry) || !validId(entry.id) || typeof entry.name !== "string" || entry.name.length > 120 ||
        (entry.mimeType !== "image/jpeg" && entry.mimeType !== "image/png" && entry.mimeType !== "image/webp") ||
        !Number.isInteger(entry.sizeBytes) || (entry.sizeBytes as number) < 1 || (entry.sizeBytes as number) > MAX_IMAGE_BYTES ||
        !Number.isInteger(entry.width) || (entry.width as number) < 1 || (entry.width as number) > 8192 ||
        !Number.isInteger(entry.height) || (entry.height as number) < 1 || (entry.height as number) > 8192 ||
        (entry.width as number) * (entry.height as number) > MAX_IMAGE_PIXELS ||
        !validInstant(entry.createdAt) || typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      invalid("Backup contains invalid image metadata.");
    }
    if (ids.has(entry.id)) invalid("Backup contains duplicate IDs.");
    ids.add(entry.id);
    const body = decodeCanonicalBase64(entry.base64);
    if (body.length !== entry.sizeBytes || body.length > MAX_IMAGE_BYTES ||
        createHash("sha256").update(body).digest("hex") !== entry.sha256) {
      invalid("Backup image size or checksum does not match.");
    }
    totalBytes += body.length;
    if (totalBytes > MAX_OWNER_MEDIA_BYTES) invalid("Backup images exceed the 64 MiB library limit.");
    let encoded: Buffer;
    let width: number;
    let height: number;
    try {
      const image = sharp(body, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error", animated: false });
      const metadata = await image.metadata();
      const format = metadata.format;
      if ((format !== "jpeg" && format !== "png" && format !== "webp") ||
          entry.mimeType !== `image/${format}` || !metadata.width || !metadata.height ||
          metadata.width !== entry.width || metadata.height !== entry.height ||
          metadata.width > 8192 || metadata.height > 8192 ||
          metadata.width * metadata.height > MAX_IMAGE_PIXELS || (metadata.pages ?? 1) !== 1) {
        invalid("Backup image format or dimensions do not match.");
      }
      const output = image.rotate();
      const result = await (format === "jpeg" ? output.jpeg({ quality: 88 }) :
        format === "webp" ? output.webp({ quality: 88 }) : output.png({ compressionLevel: 9 }))
        .toBuffer({ resolveWithObject: true });
      encoded = result.data;
      width = result.info.width;
      height = result.info.height;
    } catch (error) {
      if (error instanceof BackupError) throw error;
      invalid("Backup contains an undecodable image.");
    }
    if (encoded.length > MAX_IMAGE_BYTES || width !== entry.width || height !== entry.height) {
      invalid("Backup contains an unsupported image.");
    }
    encodedTotal += encoded.length;
    if (encodedTotal > MAX_OWNER_MEDIA_BYTES) invalid("Backup images exceed the 64 MiB library limit.");
    const digest = createHash("sha256").update(encoded).digest("hex");
    if (digests.has(digest)) invalid("Backup contains duplicate images.");
    digests.add(digest);
    prepared.push({
      oldId: entry.id, newId: randomUUID(), name: safeName(entry.name), mimeType: entry.mimeType,
      sizeBytes: encoded.length, width, height, createdAt: entry.createdAt, sha256: digest, body: encoded,
    });
  }
  return prepared;
}

function remapMediaIds<T extends { id: string }>(item: T, mediaMap: Map<string, string>): T {
  const mediaIds = mediaReferences(item);
  return {
    ...item,
    id: randomUUID(),
    ...(mediaIds.length || Object.prototype.hasOwnProperty.call(item, "mediaIds")
      ? { mediaIds: mediaIds.map((id) => {
        const replacement = mediaMap.get(id);
        if (!replacement) invalid("Backup references an image that is missing from the archive.");
        return replacement;
      }) }
      : {}),
  };
}

function ownerDataFingerprint(db: ReturnType<typeof database>, userId: string): string {
  const hash = createHash("sha256");
  const tables = [
    "SELECT id,payload,updated_at FROM drafts WHERE user_id=? ORDER BY id",
    "SELECT id,payload,scheduled_for,timezone,status,attempts,next_attempt_at,last_error,completed_at,receipts FROM jobs WHERE user_id=? ORDER BY id",
    "SELECT id,payload,scheduled_for,updated_at FROM assisted WHERE user_id=? ORDER BY id",
    "SELECT id,sha256,byte_size FROM media WHERE user_id=? ORDER BY id",
  ];
  for (const query of tables) hash.update(JSON.stringify(db.prepare(query).all(userId)));
  return hash.digest("hex");
}

export function exportPortableBackup(userId: string): string {
  // Create the media table before the snapshot transaction; no schema DDL is run inside it.
  listMedia(userId);
  const snapshot = transaction((db) => {
    const rows = db.prepare("SELECT id,payload,timezone,status,attempts,next_attempt_at,last_error,completed_at,receipts FROM jobs WHERE user_id=? ORDER BY scheduled_for,id")
      .all(userId) as StoredJob[];
    if (rows.some((row) => row.status === "running")) throw new BackupError("Wait for running planned items before exporting a backup.", 409);
    const drafts = db.prepare("SELECT payload FROM drafts WHERE user_id=? ORDER BY updated_at DESC,id")
      .all(userId).map((row) => JSON.parse((row as { payload: string }).payload) as SavedDraft);
    const assisted = db.prepare("SELECT payload FROM assisted WHERE user_id=? ORDER BY scheduled_for,id")
      .all(userId).map((row) => JSON.parse((row as { payload: string }).payload) as AssistedPost);
    const jobs = rows.map((row): PortableJob => {
      const content = JSON.parse(row.payload) as ScheduledPost;
      delete content.attempts;
      delete content.nextAttemptAt;
      delete content.lastError;
      delete content.simulatedAt;
      delete content.receipts;
      return {
        post: { ...content, status: row.status as JobStatus },
        timezone: row.timezone, status: row.status as JobStatus, attempts: row.attempts,
        nextAttemptAt: row.next_attempt_at, lastError: row.last_error, completedAt: row.completed_at,
        receipts: JSON.parse(row.receipts) as PortableJob["receipts"],
      };
    });
    const media = db.prepare("SELECT id,original_name,mime_type,byte_size,width,height,created_at,sha256,body FROM media WHERE user_id=? ORDER BY created_at DESC,id")
      .all(userId) as StoredMedia[];
    return { drafts, assisted, jobs, media };
  });
  const archive: PortableBackup = {
    format: "plypost-portable", version: 1, exportedAt: new Date().toISOString(),
    drafts: snapshot.drafts, jobs: snapshot.jobs, assisted: snapshot.assisted,
    media: snapshot.media.map((row) => {
      const body = Buffer.from(row.body);
      if (body.length !== row.byte_size || createHash("sha256").update(body).digest("hex") !== row.sha256) {
        invalid("Stored image integrity check failed; backup was not created.");
      }
      return {
        id: row.id, name: row.original_name, mimeType: row.mime_type, sizeBytes: row.byte_size,
        width: row.width, height: row.height, createdAt: row.created_at, sha256: row.sha256,
        base64: body.toString("base64"),
      };
    }),
  };
  const validated = validateWorkspace(archive);
  const allIds = [
    ...validated.drafts.map((item) => item.id), ...validated.jobs.map((item) => item.post.id),
    ...validated.assisted.map((item) => item.id), ...archive.media.map((item) => item.id),
  ];
  assertUniqueIds(allIds.map((id) => ({ id })));
  const mediaIds = new Set(archive.media.map((item) => item.id));
  for (const item of [...validated.drafts, ...validated.jobs.map((job) => job.post), ...validated.assisted]) {
    for (const id of mediaReferences(item)) {
      if (!mediaIds.has(id)) invalid("Stored work references an image that is missing from the library.");
    }
  }
  const serialized = JSON.stringify(archive);
  if (Buffer.byteLength(serialized) > MAX_PORTABLE_BACKUP_BYTES) {
    throw new BackupError("Backup exceeds the 128 MiB portable archive limit.", 413);
  }
  return serialized;
}

export async function importPortableBackup(userId: string, raw: unknown) {
  if (!isRecord(raw) || raw.format !== "plypost-portable" || raw.version !== 1 ||
      !validInstant(raw.exportedAt)) invalid("This is not a supported Plypost portable backup.");
  const workspace = validateWorkspace(raw);
  listMedia(userId);
  // Reject a restore if another tab or request changes this account while images are prepared.
  const startingData = transaction((db) => ownerDataFingerprint(db, userId));
  const media = await prepareMedia(raw.media);
  const allIds = [
    ...workspace.drafts.map((item) => item.id), ...workspace.jobs.map((item) => item.post.id),
    ...workspace.assisted.map((item) => item.id), ...media.map((item) => item.oldId),
  ];
  if (new Set(allIds).size !== allIds.length) invalid("Backup contains duplicate IDs.");
  const mediaMap = new Map(media.map((item) => [item.oldId, item.newId]));
  const drafts = workspace.drafts.map((item) => remapMediaIds(item, mediaMap));
  const jobs = workspace.jobs.map((item) => ({ ...item, post: remapMediaIds(item.post, mediaMap) }));
  const assisted = workspace.assisted.map((item) => remapMediaIds(item, mediaMap));
  // No user data is changed until every image and every reference has passed validation.
  transaction((db) => {
    if (ownerDataFingerprint(db, userId) !== startingData) {
      throw new BackupError("Saved work changed while the backup was being prepared. Reload and retry the restore.", 409);
    }
    const running = db.prepare("SELECT 1 FROM jobs WHERE user_id=? AND status='running' LIMIT 1").get(userId);
    if (running) throw new BackupError("Wait for running planned items before importing a backup.", 409);
    db.prepare("DELETE FROM drafts WHERE user_id=?").run(userId);
    db.prepare("DELETE FROM jobs WHERE user_id=?").run(userId);
    db.prepare("DELETE FROM assisted WHERE user_id=?").run(userId);
    db.prepare("DELETE FROM media WHERE user_id=?").run(userId);
    for (const image of media) {
      db.prepare("INSERT INTO media(id,user_id,original_name,mime_type,byte_size,width,height,sha256,body,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run(image.newId, userId, image.name, image.mimeType, image.sizeBytes, image.width, image.height,
          image.sha256, image.body, image.createdAt);
    }
    for (const draft of drafts) {
      db.prepare("INSERT INTO drafts(id,user_id,payload,updated_at) VALUES (?,?,?,?)")
        .run(draft.id, userId, JSON.stringify(draft), draft.updatedAt);
    }
    for (const item of jobs) {
      db.prepare(`INSERT INTO jobs(id,user_id,payload,scheduled_for,timezone,status,attempts,next_attempt_at,
        lease_until,last_error,completed_at,receipts) VALUES (?,?,?,?,?,?,?,?,NULL,?,?,?)`)
        .run(item.post.id, userId, JSON.stringify(item.post), item.post.scheduledFor, item.timezone,
          item.status, item.attempts, item.nextAttemptAt, item.lastError, item.completedAt, JSON.stringify(item.receipts));
    }
    for (const item of assisted) {
      db.prepare("INSERT INTO assisted(id,user_id,payload,scheduled_for,updated_at) VALUES (?,?,?,?,?)")
        .run(item.id, userId, JSON.stringify(item), item.scheduledFor, new Date().toISOString());
    }
    audit(userId, "workspace.portable_imported", undefined,
      `${drafts.length} drafts; ${jobs.length} jobs; ${assisted.length} assisted; ${media.length} images`);
  });
  return { drafts: drafts.length, jobs: jobs.length, assisted: assisted.length, media: media.length };
}
