import { NextResponse } from "next/server";
import { currentUser, readToken, sameOrigin } from "@/lib/server/auth";
import { beginBlueskyConnect, BlueskyError, blueskyConfiguredOrigin, blueskyOAuthCookie } from "@/lib/server/bluesky";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const user = currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  try {
    if (new URL(request.url).origin !== blueskyConfiguredOrigin()) throw new BlueskyError("Use the configured local app address to connect Bluesky.", 400);
    const reader = request.body?.getReader();
    if (!reader) throw new BlueskyError("Enter a Bluesky handle.");
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) { await reader.cancel(); throw new BlueskyError("Connection request is too large.", 413); }
      chunks.push(value);
    }
    let input: unknown;
    try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new BlueskyError("Invalid connection request."); }
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).some((key) => key !== "handle")) throw new BlueskyError("Invalid connection request.");
    const { authorizeUrl, nonce } = await beginBlueskyConnect(user, readToken(request) || "", (input as { handle?: unknown }).handle);
    const response = NextResponse.json({ authorizeUrl });
    response.cookies.set(blueskyOAuthCookie(), nonce, {
      httpOnly: true, secure: false, sameSite: "lax", path: "/api/bluesky/callback", maxAge: 600,
    });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) {
    const known = error instanceof BlueskyError ? error : new BlueskyError("Could not start Bluesky authorization.", 500);
    return NextResponse.json({ error: known.message }, { status: known.status, headers: { "Cache-Control": "no-store" } });
  }
}
