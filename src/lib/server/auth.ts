import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { database } from "./db";

export const SESSION_COOKIE = "plypost_session";
const SESSION_SECONDS = 7 * 24 * 60 * 60;

export function passwordHash(password: string, salt = randomBytes(16).toString("hex")): string {
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algorithm, salt, digest] = stored.split(":");
  if (algorithm !== "scrypt" || !/^[a-f0-9]{32}$/.test(salt || "") || !/^[a-f0-9]{128}$/.test(digest || "")) return false;
  const expected = Buffer.from(digest, "hex");
  return timingSafeEqual(scryptSync(password, salt, expected.length), expected);
}

export function owner(): string | null {
  const email = process.env.PLYPOST_OWNER_EMAIL?.trim().toLowerCase();
  return email && process.env.PLYPOST_OWNER_PASSWORD_HASH ? email : null;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSession(userId: string): string {
  const token = randomBytes(32).toString("base64url");
  database().prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)")
    .run(tokenHash(token), userId, new Date(Date.now() + SESSION_SECONDS * 1000).toISOString());
  return token;
}

export function deleteSession(token: string) {
  database().prepare("DELETE FROM sessions WHERE token_hash=?").run(tokenHash(token));
}

export function readToken(request: Request): string | null {
  const cookies = request.headers.get("cookie") || "";
  const value = cookies.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  try { return value ? decodeURIComponent(value.slice(SESSION_COOKIE.length + 1)) : null; }
  catch { return null; }
}

export function currentUser(request: Request): string | null {
  const token = readToken(request);
  const configured = owner();
  if (!token || !configured) return null;
  const row = database().prepare("SELECT user_id FROM sessions WHERE token_hash=? AND expires_at > ?")
    .get(tokenHash(token), new Date().toISOString()) as { user_id: string } | undefined;
  return row?.user_id === configured ? configured : null;
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const url = new URL(request.url);
    const parsed = new URL(origin);
    const host = request.headers.get("host") || url.host;
    return parsed.host === host && parsed.protocol === url.protocol;
  } catch {
    return false;
  }
}

export function cookieOptions(request: Request) {
  const host = request.headers.get("host") || "";
  const url = new URL(request.url);
  const localHttpDemo = process.env.PLYPOST_LOCAL_DEMO_HTTP === "true" && url.protocol === "http:" &&
    /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host) &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  return { httpOnly: true, secure: process.env.NODE_ENV === "production" && !localHttpDemo,
    sameSite: "strict" as const, path: "/", maxAge: SESSION_SECONDS };
}

export function loginAllowed(key: string): boolean {
  const db = database();
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  db.prepare("DELETE FROM login_attempts WHERE created_at < ?").run(since);
  const row = db.prepare("SELECT COUNT(*) AS count FROM login_attempts WHERE key=?").get(key) as { count: number };
  return row.count < 5;
}

export function recordLoginFailure(key: string) {
  database().prepare("INSERT INTO login_attempts(key,created_at) VALUES (?,?)").run(key, new Date().toISOString());
}

export function clearLoginFailures(key: string) {
  database().prepare("DELETE FROM login_attempts WHERE key=?").run(key);
}
