import { NextResponse } from "next/server";
import { audit } from "@/lib/server/db";
import { accountHash, cookieOptions, createSession, sameOrigin, SESSION_COOKIE, verifyLoginPassword } from "@/lib/server/auth";
import { readBoundedJsonObject } from "@/lib/server/bounded-json";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const body = await readBoundedJsonObject(request, 4_096);
  if (body.kind === "too-large") return NextResponse.json({ error: "Request is too large." }, { status: 413 });
  if (body.kind === "invalid") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const input = body.value;
  const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input?.password === "string" ? input.password : "";
  if (!email || !password || password.length > 1024) return NextResponse.json({ error: "Enter email and password." }, { status: 400 });
  const stored = accountHash(email);
  const dummy = `scrypt:${"0".repeat(32)}:${"0".repeat(128)}`;
  const valid = await verifyLoginPassword(password, stored || dummy);
  if (valid === "busy") return NextResponse.json({ error: "Sign-in is busy. Try again in a moment." },
    { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "1" } });
  if (!valid || !stored || accountHash(email) !== stored) return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
  const token = createSession(email);
  audit(email, "session.login");
  const response = NextResponse.json({ email });
  response.cookies.set(SESSION_COOKIE, token, cookieOptions(request));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
