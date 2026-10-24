import { strToU8, zipSync } from "fflate";
import { assistedDestinations } from "../assisted";
import { parseWorkspace } from "../workspace";
import { database } from "./db";
import { getMedia, MAX_IMAGE_BYTES } from "./media";

const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const extension: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export class HandoffPackageError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

/** One private download contains the caption and every saved image in the handoff snapshot. */
export function buildHandoffPackage(userId: string, id: string): { bytes: Uint8Array; filename: string } {
  if (!uuid.test(id)) throw new HandoffPackageError("Handoff not found.", 404);
  const row = database().prepare("SELECT payload FROM assisted WHERE id=? AND user_id=?")
    .get(id, userId) as { payload: string } | undefined;
  if (!row) throw new HandoffPackageError("Handoff not found.", 404);
  const item = parseWorkspace({ version: 3, drafts: [], schedule: [], assisted: [JSON.parse(row.payload)] })?.assisted[0];
  if (!item) throw new HandoffPackageError("Saved handoff is invalid.", 409);

  const files: Record<string, Uint8Array> = { "caption.txt": strToU8(`${item.text}\n`) };
  const notes = [
    `Platform: ${assistedDestinations[item.destination].name}`,
    `Title: ${item.title}`,
    `Reminder (UTC): ${item.scheduledFor}`,
    "",
    "Copy caption.txt into the destination platform. Publish from your own account.",
  ];

  for (const [index, mediaId] of (item.mediaIds ?? []).entries()) {
    const found = getMedia(userId, mediaId);
    if (!found || !extension[found.media.mimeType] || found.bytes.length > MAX_IMAGE_BYTES) {
      throw new HandoffPackageError("A saved image is unavailable. Check this handoff before downloading.", 409);
    }
    const name = `images/${String(index + 1).padStart(2, "0")}.${extension[found.media.mimeType]}`;
    files[name] = new Uint8Array(found.bytes);
    notes.push("", `Image ${index + 1}: ${name}`, `Description: ${item.mediaAlt?.[index] || "(none saved)"}`);
  }
  if (item.destination === "youtube" || item.destination === "tiktok") {
    notes.push("", "Video files are not stored in Plypost. Bring your video separately.");
  }
  files["handoff.txt"] = strToU8(`${notes.join("\n")}\n`);
  const filename = `plypost-${item.destination}-${item.id.slice(0, 8)}.zip`;
  return { bytes: zipSync(files, { level: 0 }), filename };
}
