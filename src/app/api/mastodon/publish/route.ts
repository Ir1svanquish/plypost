import { NextResponse } from "next/server";
import { currentUser, sameOrigin } from "@/lib/server/auth";
import { MastodonError, publishMastodonText } from "@/lib/server/mastodon";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 48 * 1024;

async function limitedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new MastodonError("Invalid publishing request.", 400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new MastodonError("Publishing request is too large.", 413); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new MastodonError("Invalid JSON body.", 400); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const user = currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  try {
    const result = await publishMastodonText(user, await limitedJson(request));
    return NextResponse.json(result, { status: result.status === "unknown" ? 202 : 200,
      headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = error instanceof MastodonError ? error : new MastodonError("Mastodon publishing failed.", 500);
    return NextResponse.json({ error: known.message }, { status: known.status, headers: { "Cache-Control": "no-store" } });
  }
}
