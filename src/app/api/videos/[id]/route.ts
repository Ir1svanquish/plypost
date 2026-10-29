import { currentUser, sameOrigin } from "@/lib/server/auth";
import { deleteVideo, getVideo, getVideoMetadata, VideoError } from "@/lib/server/video";

export const runtime = "nodejs";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
};
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const user = currentUser(request);
  if (!user) return Response.json({ error: "Sign in to continue." }, { status: 401, headers: privateHeaders });
  const { id } = await context.params;
  const preview = new URL(request.url).searchParams.get("preview") === "1";
  const requested = preview ? request.headers.get("range") : null;
  if (requested) {
    const video = getVideoMetadata(user, id);
    if (!video) return Response.json({ error: "Video not found." }, { status: 404, headers: privateHeaders });
    const length = video.sizeBytes;
    const headers = { ...privateHeaders, "Content-Type": video.mimeType,
      "Content-Disposition": "inline", "Accept-Ranges": "bytes" };
    const match = /^bytes=(\d*)-(\d*)$/.exec(requested.trim());
    let start = -1;
    let end = -1;
    if (match?.[1]) {
      start = Number(match[1]);
      end = match[2] ? Number(match[2]) : length - 1;
    } else if (match?.[2]) {
      const suffixLength = Number(match[2]);
      if (Number.isSafeInteger(suffixLength) && suffixLength > 0) {
        start = Math.max(0, length - suffixLength);
        end = length - 1;
      }
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= length || end < start) {
      return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${length}` } });
    }
    end = Math.min(end, length - 1);
    const found = getVideo(user, id, { start, end });
    if (!found) return Response.json({ error: "Video not found." }, { status: 404, headers: privateHeaders });
    return new Response(new Uint8Array(found.bytes.buffer as ArrayBuffer, found.bytes.byteOffset, found.bytes.byteLength), {
      status: 206, headers: { ...headers, "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${length}` },
    });
  }
  const found = getVideo(user, id);
  if (!found) return Response.json({ error: "Video not found." }, { status: 404, headers: privateHeaders });
  if (preview) {
    return new Response(new Uint8Array(found.bytes.buffer as ArrayBuffer, found.bytes.byteOffset, found.bytes.byteLength), {
      headers: { ...privateHeaders, "Content-Type": found.video.mimeType,
        "Content-Disposition": "inline", "Accept-Ranges": "bytes", "Content-Length": String(found.bytes.length) },
    });
  }
  return new Response(new Uint8Array(found.bytes.buffer as ArrayBuffer, found.bytes.byteOffset, found.bytes.byteLength), {
    headers: {
      ...privateHeaders,
      "Content-Type": found.video.mimeType,
      "Content-Length": String(found.bytes.length),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(found.video.name)}`,
    },
  });
}

export async function DELETE(request: Request, context: Context) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403, headers: privateHeaders });
  const user = currentUser(request);
  if (!user) return Response.json({ error: "Sign in to continue." }, { status: 401, headers: privateHeaders });
  const { id } = await context.params;
  try {
    if (!deleteVideo(user, id)) return Response.json({ error: "Video not found." }, { status: 404, headers: privateHeaders });
  } catch (error) {
    if (error instanceof VideoError) return Response.json({ error: error.message }, { status: error.status, headers: privateHeaders });
    throw error;
  }
  return Response.json({ ok: true }, { headers: privateHeaders });
}
