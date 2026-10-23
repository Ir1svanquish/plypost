import { NextResponse } from "next/server";
import { currentUser, sameOrigin } from "@/lib/server/auth";
import { MastodonScheduleError, resolveMastodonSchedule } from "@/lib/server/mastodon-schedule";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 8 * 1024;

async function limitedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new MastodonScheduleError("Invalid result check.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new MastodonScheduleError("Result check is too large.", 413); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new MastodonScheduleError("Invalid JSON body."); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const user = currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  try {
    return NextResponse.json({ item: resolveMastodonSchedule(user, await limitedJson(request)) },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = error instanceof MastodonScheduleError ? error :
      new MastodonScheduleError("Mastodon result check failed.", 500);
    return NextResponse.json({ error: known.message }, { status: known.status, headers: { "Cache-Control": "no-store" } });
  }
}
