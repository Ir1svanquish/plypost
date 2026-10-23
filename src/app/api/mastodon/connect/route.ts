import { NextResponse } from "next/server";
import { currentUser, readToken, sameOrigin } from "@/lib/server/auth";
import { beginMastodonConnect, MastodonError, mastodonOAuthCookie } from "@/lib/server/mastodon";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const user = currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  try {
    const { authorizeUrl, nonce, secureCookie } = await beginMastodonConnect(user, readToken(request) || "");
    const response = NextResponse.json({ authorizeUrl });
    response.cookies.set(mastodonOAuthCookie(), nonce, {
      httpOnly: true, secure: secureCookie, sameSite: "lax", path: "/api/mastodon/callback", maxAge: 600,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    const known = error instanceof MastodonError ? error : new MastodonError("Could not start Mastodon authorization.", 500);
    return NextResponse.json({ error: known.message }, { status: known.status, headers: { "Cache-Control": "no-store" } });
  }
}
