import { NextResponse } from "next/server";
import { currentUser, sameOrigin } from "@/lib/server/auth";
import { disconnectMastodon, MastodonError } from "@/lib/server/mastodon";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const user = currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  try {
    return NextResponse.json(await disconnectMastodon(user), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = error instanceof MastodonError ? error : new MastodonError("Could not disconnect Mastodon.", 500);
    return NextResponse.json({ error: known.message }, { status: known.status, headers: { "Cache-Control": "no-store" } });
  }
}
