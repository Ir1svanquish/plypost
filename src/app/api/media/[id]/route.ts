import { NextResponse } from "next/server";
import { currentUser, sameOrigin } from "@/lib/server/auth";
import { deleteMedia, getMedia, MediaError } from "@/lib/server/media";

export const runtime = "nodejs";

const noStore = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
};

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const user = currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401, headers: noStore });
  const { id } = await context.params;
  const found = getMedia(user, id);
  if (!found) return NextResponse.json({ error: "Image not found." }, { status: 404, headers: noStore });
  const download = new URL(request.url).searchParams.has("download");
  return new Response(new Uint8Array(found.bytes.buffer as ArrayBuffer, found.bytes.byteOffset, found.bytes.byteLength), {
    headers: {
      ...noStore,
      "Content-Type": found.media.mimeType,
      "Content-Length": String(found.bytes.length),
      ...(download ? { "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(found.media.name)}` } : {}),
    },
  });
}

export async function DELETE(request: Request, context: Context) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStore });
  const user = currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401, headers: noStore });
  const { id } = await context.params;
  try {
    if (!deleteMedia(user, id)) return NextResponse.json({ error: "Image not found." }, { status: 404, headers: noStore });
  } catch (error) {
    if (error instanceof MediaError) return NextResponse.json({ error: error.message }, { status: error.status, headers: noStore });
    throw error;
  }
  return NextResponse.json({ ok: true }, { headers: noStore });
}
