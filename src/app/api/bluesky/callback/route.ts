import { NextResponse } from "next/server";
import { blueskyCallbackRedirect, blueskyConfiguredOrigin, blueskyOAuthCookie, completeBlueskyConnect } from "@/lib/server/bluesky";

export const runtime = "nodejs";

function callbackCookie(request: Request): string {
  const entry = (request.headers.get("cookie") || "").split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${blueskyOAuthCookie()}=`));
  try { return entry ? decodeURIComponent(entry.slice(blueskyOAuthCookie().length + 1)) : ""; }
  catch { return ""; }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  let success = false;
  if (url.origin === blueskyConfiguredOrigin() && !url.searchParams.has("error")) {
    try { await completeBlueskyConnect(url.searchParams, callbackCookie(request)); success = true; }
    catch { /* The redirect never exposes provider codes or tokens. */ }
  }
  try {
    const response = NextResponse.redirect(blueskyCallbackRedirect(success), { status: 303 });
    response.cookies.set(blueskyOAuthCookie(), "", {
      httpOnly: true, secure: false, sameSite: "lax", path: "/api/bluesky/callback", maxAge: 0,
    });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch {
    return NextResponse.json({ error: "Bluesky callback could not be completed." }, { status: 503,
      headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  }
}
