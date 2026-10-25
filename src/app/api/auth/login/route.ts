import { NextResponse } from "next/server";
import { audit } from "@/lib/server/db";
import { clearLoginFailures, cookieOptions, createSession, loginAllowed, loginFailureKey, owner, recordLoginFailure, sameOrigin, SESSION_COOKIE, verifyPassword } from "@/lib/server/auth";
import { readBoundedJsonObject } from "@/lib/server/bounded-json";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const configured = owner();
  if (!configured) return NextResponse.json({ error: "Owner account is not configured. See README setup." }, { status: 503 });
  const body = await readBoundedJsonObject(request, 4_096);
  if (body.kind === "too-large") return NextResponse.json({ error: "Request is too large." }, { status: 413 });
  if (body.kind === "invalid") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const input = body.value;
  const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input?.password === "string" ? input.password : "";
  if (!email || !password || password.length > 1024) return NextResponse.json({ error: "Enter email and password." }, { status: 400 });
  const key = loginFailureKey(request);
  if (!loginAllowed(key)) return NextResponse.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });
  if (email !== configured || !verifyPassword(password, process.env.PLYPOST_OWNER_PASSWORD_HASH || "")) {
    recordLoginFailure(key);
    return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
  }
  clearLoginFailures(key);
  const token = createSession(configured);
  audit(configured, "session.login");
  const response = NextResponse.json({ email: configured });
  response.cookies.set(SESSION_COOKIE, token, cookieOptions(request));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
