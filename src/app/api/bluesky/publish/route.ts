import { NextResponse } from "next/server";
import { currentUser, sameOrigin } from "@/lib/server/auth";
import { BlueskyError, publishBlueskyText } from "@/lib/server/bluesky";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const user = currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new BlueskyError("Invalid publishing request.");
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 48 * 1024) { await reader.cancel(); throw new BlueskyError("Publishing request is too large.", 413); }
      chunks.push(value);
    }
    let input: unknown;
    try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new BlueskyError("Invalid JSON body."); }
    const result = await publishBlueskyText(user, input);
    return NextResponse.json(result, { status: result.status === "unknown" ? 202 : 200,
      headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = error instanceof BlueskyError ? error : new BlueskyError("Bluesky publishing failed.", 500);
    return NextResponse.json({ error: known.message }, { status: known.status, headers: { "Cache-Control": "no-store" } });
  }
}
