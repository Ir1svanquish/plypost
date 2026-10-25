import { NextResponse } from "next/server";
import { database } from "@/lib/server/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    database().prepare("SELECT 1").get();
    return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "unavailable" }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}
