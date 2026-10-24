import { NextResponse } from "next/server";
import { currentUser, sameOrigin } from "@/lib/server/auth";
import { BlueskyError, disconnectBluesky } from "@/lib/server/bluesky";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const user = currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  try { return NextResponse.json(await disconnectBluesky(user), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    const known = error instanceof BlueskyError ? error : new BlueskyError("Could not disconnect Bluesky.", 500);
    return NextResponse.json({ error: known.message }, { status: known.status, headers: { "Cache-Control": "no-store" } });
  }
}
