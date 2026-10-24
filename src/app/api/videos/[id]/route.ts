import { currentUser, sameOrigin } from "@/lib/server/auth";
import { deleteVideo, getVideo, VideoError } from "@/lib/server/video";

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
  const found = getVideo(user, id);
  if (!found) return Response.json({ error: "Video not found." }, { status: 404, headers: privateHeaders });
  return new Response(new Uint8Array(found.bytes), {
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
