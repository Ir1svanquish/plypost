import { NextResponse } from "next/server";
import { currentUser, owner } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return NextResponse.json({ email: currentUser(request), configured: true, legacyImportAllowed: Boolean(owner()) && currentUser(request) === owner(), registrationOpen: process.env.PLYPOST_REGISTRATION_ENABLED !== "false" }, { headers: { "Cache-Control": "no-store" } });
}
