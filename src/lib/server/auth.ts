import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import { database } from "./db";

export const SESSION_COOKIE = "plypost_session";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const MAX_ACTIVE_LOGIN_CHECKS = 2;
let activeLoginChecks = 0;

export function passwordHash(password: string, salt = randomBytes(16).toString("hex")): string {
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export async function hashNewPassword(password: string): Promise<string | null> {
  if (activeLoginChecks >= MAX_ACTIVE_LOGIN_CHECKS) return null;
  activeLoginChecks++;
  try {
    const salt = randomBytes(16).toString("hex");
    const result = await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(key));
    });
    return `scrypt:${salt}:${result.toString("hex")}`;
  } finally { activeLoginChecks--; }
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algorithm, salt, digest] = stored.split(":");
  if (algorithm !== "scrypt" || !/^[a-f0-9]{32}$/.test(salt || "") || !/^[a-f0-9]{128}$/.test(digest || "")) return false;
  const expected = Buffer.from(digest, "hex");
  return timingSafeEqual(scryptSync(password, salt, expected.length), expected);
}

export async function verifyLoginPassword(password: string, stored: string): Promise<boolean | "busy"> {
  const [algorithm, salt, digest] = stored.split(":");
  if (algorithm !== "scrypt" || !/^[a-f0-9]{32}$/.test(salt || "") || !/^[a-f0-9]{128}$/.test(digest || "")) return false;
  if (activeLoginChecks >= MAX_ACTIVE_LOGIN_CHECKS) return "busy";
  activeLoginChecks++;
  try {
    const expected = Buffer.from(digest, "hex");
    const actual = await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, expected.length, (error, result) => error ? reject(error) : resolve(result));
    });
    return timingSafeEqual(actual, expected);
  } finally {
    activeLoginChecks--;
  }
}

export function owner(): string | null {
  const email = process.env.PLYPOST_OWNER_EMAIL?.trim().toLowerCase();
  return email && process.env.PLYPOST_OWNER_PASSWORD_HASH ? email : null;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function accountHash(email: string): string | null {
  const db = database();
  if (email === owner()) {
    const seed = process.env.PLYPOST_OWNER_PASSWORD_HASH!;
    db.prepare(`INSERT INTO accounts(email,password_hash,bootstrap_hash,created_at) VALUES (?,?,?,?)
      ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash,
      bootstrap_hash=excluded.bootstrap_hash,recovery_hash=NULL
      WHERE accounts.bootstrap_hash IS NOT excluded.bootstrap_hash`).run(email, seed, seed, new Date().toISOString());
  }
  return (db.prepare("SELECT password_hash FROM accounts WHERE email=?").get(email) as { password_hash: string } | undefined)?.password_hash ?? null;
}

function credentialFingerprint(userId: string): string {
  return createHash("sha256").update(accountHash(userId) || "").digest("hex");
}

export function createSession(userId: string): string {
  const token = randomBytes(32).toString("base64url");
  database().prepare("INSERT INTO sessions(token_hash,user_id,expires_at,credential_fingerprint) VALUES (?,?,?,?)")
    .run(tokenHash(token), userId, new Date(Date.now() + SESSION_SECONDS * 1000).toISOString(), credentialFingerprint(userId));
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
  if (!token) return null;
  const user = sessionUser(tokenHash(token));
  const expected = request.headers.get("x-plypost-account");
  return expected && expected !== user ? null : user;
}

export function sessionUser(hash: string): string | null {
  const row = database().prepare("SELECT user_id,credential_fingerprint FROM sessions WHERE token_hash=? AND expires_at > ?")
    .get(hash, new Date().toISOString()) as { user_id: string; credential_fingerprint: string | null } | undefined;
  return row && accountHash(row.user_id) && row.credential_fingerprint === credentialFingerprint(row.user_id) ? row.user_id : null;
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
