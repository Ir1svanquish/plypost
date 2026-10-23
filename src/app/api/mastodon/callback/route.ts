import { NextResponse } from "next/server";
import { completeMastodonConnect, mastodonCallbackRedirect, mastodonOAuthCookie } from "@/lib/server/mastodon";

export const runtime = "nodejs";

function callbackCookie(request: Request): string {
  const entry = (request.headers.get("cookie") || "").split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${mastodonOAuthCookie()}=`));
  try { return entry ? decodeURIComponent(entry.slice(mastodonOAuthCookie().length + 1)) : ""; }
  catch { return ""; }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  let success = false;
  if (!url.searchParams.has("error")) {
    try {
      await completeMastodonConnect(url.searchParams.get("state") || "", url.searchParams.get("code") || "", callbackCookie(request));
      success = true;
    } catch { /* Authorization errors never include provider codes or secrets in the redirect. */ }
  }
  try {
    const target = mastodonCallbackRedirect(success);
    const response = NextResponse.redirect(target, { status: 303 });
    response.cookies.set(mastodonOAuthCookie(), "", {
      httpOnly: true, secure: target.startsWith("https://"), sameSite: "lax", path: "/api/mastodon/callback", maxAge: 0,
    });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch {
    return NextResponse.json({ error: "Mastodon callback could not be completed." }, { status: 503,
      headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  }
}
