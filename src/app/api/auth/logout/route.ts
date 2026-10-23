import { NextResponse } from "next/server";
import { audit } from "@/lib/server/db";
import { currentUser, deleteSession, readToken, sameOrigin, SESSION_COOKIE } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const user = currentUser(request);
  const token = readToken(request);
  if (token) deleteSession(token);
  if (user) audit(user, "session.logout");
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
