import { currentUser, sameOrigin } from "@/lib/server/auth";
import { createVideo, listVideos, MAX_VIDEO_BYTES, VideoError } from "@/lib/server/video";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = MAX_VIDEO_BYTES + 256 * 1024;
const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

async function boundedBody(request: Request): Promise<Uint8Array> {
  const claimed = Number(request.headers.get("content-length"));
  if (Number.isFinite(claimed) && claimed > MAX_REQUEST_BYTES) throw new VideoError("Upload request exceeds 32 MiB.", 413);
  if (!request.body) throw new VideoError("Upload is empty.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) { await reader.cancel(); throw new VideoError("Upload request exceeds 32 MiB.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

export async function GET(request: Request) {
  const user = currentUser(request);
  if (!user) return Response.json({ error: "Sign in to continue." }, { status: 401, headers: privateHeaders });
  return Response.json({ videos: listVideos(user) }, { headers: privateHeaders });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403, headers: privateHeaders });
  const user = currentUser(request);
  if (!user) return Response.json({ error: "Sign in to continue." }, { status: 401, headers: privateHeaders });
  const contentType = request.headers.get("content-type") || "";
  if (!/^multipart\/form-data;\s*boundary=/i.test(contentType)) {
    return Response.json({ error: "Upload one video as multipart form data." }, { status: 415, headers: privateHeaders });
  }
  try {
    const body = await boundedBody(request);
    const multipart = new Request(request.url, { method: "POST", headers: { "Content-Type": contentType }, body: new Uint8Array(body) });
    const entries = [...(await multipart.formData()).entries()];
    if (entries.length !== 1 || entries[0][0] !== "file" || !(entries[0][1] instanceof File)) {
      throw new VideoError("Upload exactly one video in the file field.");
    }
    const file = entries[0][1] as File;
    if (file.size > MAX_VIDEO_BYTES) throw new VideoError("Video must be no larger than 32 MiB.", 413);
    const result = createVideo(user, { name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) });
    return Response.json({ video: result.video }, { status: result.created ? 201 : 200, headers: privateHeaders });
  } catch (error) {
    const known = error instanceof VideoError;
    return Response.json({ error: known ? error.message : "Invalid video upload." }, { status: known ? error.status : 400, headers: privateHeaders });
  }
}
