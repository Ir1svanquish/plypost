import { NextResponse } from "next/server";
import { currentUser, owner } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return NextResponse.json({ email: currentUser(request), configured: Boolean(owner()) }, { headers: { "Cache-Control": "no-store" } });
}
