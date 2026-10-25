import { strToU8, Zip, ZipPassThrough, zipSync } from "fflate";
import { assistedDestinations } from "../assisted";
import { hasManualReminder, parseWorkspace } from "../workspace";
import { database } from "./db";
import { getMedia, listMedia, MAX_IMAGE_BYTES } from "./media";
import { getVideo, listVideos, MAX_VIDEO_BYTES } from "./video";

const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const extension: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const CHUNK_BYTES = 64 * 1024;

type PackageFile = { name: string; load: () => Uint8Array };

export class HandoffPackageError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

function prepareHandoffPackage(userId: string, id: string): { files: PackageFile[]; filename: string } {
  if (!uuid.test(id)) throw new HandoffPackageError("Handoff not found.", 404);
  const row = database().prepare("SELECT payload FROM assisted WHERE id=? AND user_id=?")
    .get(id, userId) as { payload: string } | undefined;
  if (!row) throw new HandoffPackageError("Handoff not found.", 404);
  const item = parseWorkspace({ version: 3, drafts: [], schedule: [], assisted: [JSON.parse(row.payload)] })?.assisted[0];
  if (!item) throw new HandoffPackageError("Saved handoff is invalid.", 409);

  const files: PackageFile[] = [{ name: "caption.txt", load: () => strToU8(`${item.text}\n`) }];
  const notes = [
    `Platform: ${assistedDestinations[item.destination].name}`,
    `Title: ${item.title}`,
    hasManualReminder(item) ? `Reminder (UTC): ${item.scheduledFor}` : "Reminder: none",
    ...(item.placeLabel ? [`Place note: ${item.placeLabel}`, "Add this as a location only if the destination supports it; Plypost does not tag a location for you."] : []),
    "",
    "Copy caption.txt into the destination platform. Publish from your own account.",
  ];

  // The private asset tables are created lazily; imported handoffs may reference missing assets.
  if (item.mediaIds?.length) listMedia(userId);
  if (item.videoId) listVideos(userId);
  for (const [index, mediaId] of (item.mediaIds ?? []).entries()) {
    const image = database().prepare("SELECT mime_type, length(body) AS body_size FROM media WHERE id=? AND user_id=?")
      .get(mediaId, userId) as { mime_type: string; body_size: number } | undefined;
    if (!image || !extension[image.mime_type] || image.body_size > MAX_IMAGE_BYTES) {
      throw new HandoffPackageError("A saved image is unavailable. Check this handoff before downloading.", 409);
    }
    const name = `images/${String(index + 1).padStart(2, "0")}.${extension[image.mime_type]}`;
    files.push({ name, load: () => {
      const found = getMedia(userId, mediaId);
      if (!found || found.bytes.length > MAX_IMAGE_BYTES) throw new HandoffPackageError("A saved image is unavailable.", 409);
      return found.bytes;
    } });
    notes.push("", `Image ${index + 1}: ${name}`, `Description: ${item.mediaAlt?.[index] || "(none saved)"}`);
  }
  if (item.videoId) {
    const video = database().prepare("SELECT original_name, length(body) AS body_size FROM videos WHERE id=? AND user_id=?")
      .get(item.videoId, userId) as { original_name: string; body_size: number } | undefined;
    if (!video || video.body_size > MAX_VIDEO_BYTES) {
      throw new HandoffPackageError("The saved video is unavailable. Check this handoff before downloading.", 409);
    }
    const path = `video/clip.${video.original_name.split(".").at(-1)}`;
    files.push({ name: path, load: () => {
      const found = getVideo(userId, item.videoId!);
      if (!found || found.bytes.length > MAX_VIDEO_BYTES) throw new HandoffPackageError("The saved video is unavailable.", 409);
      return found.bytes;
    } });
    notes.push("", `Video: ${path}`, `Original name: ${video.original_name}`);
  } else if (item.destination === "youtube" || item.destination === "tiktok") {
    notes.push("", "No video is attached to this handoff. Bring your video separately.");
  }
  files.push({ name: "handoff.txt", load: () => strToU8(`${notes.join("\n")}\n`) });
  const filename = `plypost-${item.destination}-${item.id.slice(0, 8)}.zip`;
  return { files, filename };
}

/** Synchronous form kept for internal exports and tests. */
export function buildHandoffPackage(userId: string, id: string): { bytes: Uint8Array; filename: string } {
  const { files, filename } = prepareHandoffPackage(userId, id);
  return { bytes: zipSync(Object.fromEntries(files.map((file) => [file.name, file.load()])), { level: 0 }), filename };
}

/** Stream one saved asset at a time so downloads do not hold the full archive in memory. */
export function streamHandoffPackage(userId: string, id: string): { stream: ReadableStream<Uint8Array>; filename: string } {
  const { files, filename } = prepareHandoffPackage(userId, id);
  let zip: Zip | undefined;
  let current: { entry: ZipPassThrough; bytes: Uint8Array; offset: number } | undefined;
  let nextFile = 0;
  let finished = false;
  const output: Uint8Array[] = [];
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      try {
        zip ??= new Zip((error, chunk, final) => {
          if (error) { controller.error(error); return; }
          if (chunk.length) output.push(chunk);
          if (final) finished = true;
        });
        while (!output.length && !finished) {
          if (!current) {
            if (nextFile === files.length) { zip.end(); continue; }
            const file = files[nextFile++];
            current = { entry: new ZipPassThrough(file.name), bytes: file.load(), offset: 0 };
            zip.add(current.entry);
          }
          const end = Math.min(current.offset + CHUNK_BYTES, current.bytes.length);
          current.entry.push(current.bytes.subarray(current.offset, end), end === current.bytes.length);
          if (end === current.bytes.length) current = undefined;
          else current.offset = end;
        }
        if (output.length) controller.enqueue(output.shift()!);
        else controller.close();
      } catch (error) {
        zip?.terminate();
        controller.error(error);
      }
    },
    cancel() { zip?.terminate(); current = undefined; output.length = 0; },
  }, { highWaterMark: 0 });
  return { stream, filename };
}
