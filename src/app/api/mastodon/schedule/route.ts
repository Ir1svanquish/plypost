import { NextResponse } from "next/server";
import { currentUser, sameOrigin } from "@/lib/server/auth";
import { cancelMastodonSchedule, createMastodonSchedule, listMastodonSchedules, mastodonScheduleExecutionEnabled, mastodonWorkerLastSeen, MastodonScheduleError } from "@/lib/server/mastodon-schedule";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 48 * 1024;
// The authenticated owner confirms each exact account, text and time in the client before POST.

async function limitedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new MastodonScheduleError("Invalid scheduling request.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new MastodonScheduleError("Scheduling request is too large.", 413); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new MastodonScheduleError("Invalid JSON body."); }
}

function errorResponse(error: unknown) {
  const known = error instanceof MastodonScheduleError ? error :
    new MastodonScheduleError("Mastodon schedule could not be updated.", 500);
  return NextResponse.json({ error: known.message }, { status: known.status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const user = currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  try {
    return NextResponse.json({ items: listMastodonSchedules(user),
      executionEnabled: mastodonScheduleExecutionEnabled(), mastodonWorkerLastSeen: mastodonWorkerLastSeen() },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const user = currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (!mastodonScheduleExecutionEnabled()) return NextResponse.json(
    { error: "Automatic Mastodon publishing is paused on this installation." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
  try {
    const { item, created } = createMastodonSchedule(user, await limitedJson(request));
    return NextResponse.json({ item }, { status: created ? 201 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const user = currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  try {
    return NextResponse.json({ item: cancelMastodonSchedule(user, await limitedJson(request)) },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
