import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { mastodonConnection } from "@/lib/server/mastodon";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(mastodonConnection(user), { headers: { "Cache-Control": "no-store" } });
}
