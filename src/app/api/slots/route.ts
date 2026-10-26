import { NextResponse } from "next/server";
import { currentUser, sameOrigin } from "@/lib/server/auth";
import { loadSlotSettingsSnapshot, saveSlotSettingsIfCurrent, SlotSettingsConflictError, suggestWeeklySlots } from "@/lib/server/slots";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

async function boundedJson(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Enter weekly slot settings.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16_384) { await reader.cancel(); throw new Error("Weekly slot request is too large."); }
    chunks.push(value);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("Invalid JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid weekly slot request.");
  return value as Record<string, unknown>;
}

export async function GET(request: Request) {
  const user = currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401, headers });
  try { return NextResponse.json(loadSlotSettingsSnapshot(user), { headers }); }
  catch { return NextResponse.json({ error: "Could not load weekly slots." }, { status: 500, headers }); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers });
  const user = currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401, headers });
  try {
    const input = await boundedJson(request);
    if (input.action === "save" && Object.hasOwn(input, "expectedUpdatedAt") &&
        Object.keys(input).every((key) => key === "action" || key === "settings" || key === "expectedUpdatedAt")) {
      const expected = input.expectedUpdatedAt;
      if (expected !== null && (typeof expected !== "string" ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(expected))) {
        throw new Error("Reload weekly slots before saving.");
      }
      return NextResponse.json(saveSlotSettingsIfCurrent(user, input.settings, expected), { headers });
    }
    if (input.action === "suggest" && Object.keys(input).every((key) => key === "action" || key === "destinations")) {
      return NextResponse.json(suggestWeeklySlots(user, input.destinations), { headers });
    }
    throw new Error("Unknown weekly slot action.");
  } catch (error) {
    if (error instanceof SlotSettingsConflictError) {
      return NextResponse.json({ error: error.message, ...loadSlotSettingsSnapshot(user) }, { status: 409, headers });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update weekly slots." },
      { status: 400, headers });
  }
}
