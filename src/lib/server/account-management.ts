import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { accountHash, cookieOptions, createSession, currentUser, hashNewPassword, owner, readToken, sameOrigin, SESSION_COOKIE, verifyLoginPassword } from "./auth";
import { audit, database, transaction } from "./db";
import { readBoundedJsonObject } from "./bounded-json";

const headers = { "Cache-Control": "no-store" };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const failure = (error: string, status = 400) => NextResponse.json({ error }, { status, headers });
const busy = () => failure("Account service is busy. Try again in a moment.", 503);
const text = (value: unknown) => typeof value === "string" ? value : "";
const validPassword = (value: string) => value.length >= 12 && value.length <= 128;
const freshCode = () => randomBytes(24).toString("hex");

export async function manageAccount(request: Request, action: "register" | "recover" | "password" | "recovery-code" | "sessions") {
  if (!sameOrigin(request)) return failure("Invalid request origin.", 403);
  const input = await readBoundedJsonObject(request, 4096);
  if (input.kind !== "ok") return failure("Invalid or oversized request.", input.kind === "too-large" ? 413 : 400);
  const body = input.value;
  const signedIn = currentUser(request);
  const email = action === "register" || action === "recover" ? text(body.email).trim().toLowerCase() : signedIn;
  if (!email) return failure("Sign in to continue.", 401);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return failure("Enter a valid email address.");
  const db = database();
  if (action === "sessions") {
    const token = readToken(request);
    db.prepare("DELETE FROM sessions WHERE user_id=? AND token_hash<>?").run(email, digest(token || ""));
    audit(email, "session.revoke_others");
    return NextResponse.json({ ok: true }, { headers });
  }
  const password = text(body.password);
  if (action !== "recovery-code" && !validPassword(password)) return failure("Use a password with 12–128 characters.");
  const stored = accountHash(email);
  if (action === "register") {
    if (process.env.PLYPOST_REGISTRATION_ENABLED === "false") return failure("Registration is closed on this installation.", 403);
    if (stored || email === owner()) return failure("Unable to create this account. Try signing in or recovering it.", 409);
    const count = db.prepare("SELECT COUNT(*) AS count FROM accounts").get() as { count: number };
    const recent = db.prepare("SELECT COUNT(*) AS count FROM accounts WHERE created_at>?").get(new Date(Date.now() - 3600000).toISOString()) as { count: number };
    if (count.count >= 100 || recent.count >= 10) return failure("Registration capacity reached. Please try later or contact the site owner.", 429);
  } else if (action === "recover") {
    const code = text(body.recoveryCode).trim();
    const row = db.prepare("SELECT recovery_hash FROM accounts WHERE email=?").get(email) as { recovery_hash: string | null } | undefined;
    if (!stored || !/^[a-f0-9]{48}$/.test(code) || row?.recovery_hash !== digest(code)) return failure("Email or recovery code is incorrect.", 401);
  } else {
    const current = text(body.currentPassword);
    if (!stored || !current || current.length > 1024) return failure("Current password is incorrect.", 401);
    const valid = await verifyLoginPassword(current, stored);
    if (valid === "busy") return busy();
    if (!valid || accountHash(email) !== stored) return failure("Current password is incorrect.", 401);
  }
  const hash = action === "recovery-code" ? stored : await hashNewPassword(password);
  if (!hash) return busy();
  const code = freshCode();
  if (action !== "register" && accountHash(email) !== stored) return failure("The account changed. Please try again.", 409);
  // Recheck credentials and capacity in the same transaction as the mutation.
  const changed = transaction((tx) => {
    if (action === "register") {
      const count = tx.prepare("SELECT COUNT(*) AS count FROM accounts").get() as { count: number };
      const recent = tx.prepare("SELECT COUNT(*) AS count FROM accounts WHERE created_at>?").get(new Date(Date.now() - 3600000).toISOString()) as { count: number };
      if (count.count >= 100 || recent.count >= 10) return false;
      return Boolean(tx.prepare("INSERT OR IGNORE INTO accounts(email,password_hash,recovery_hash,created_at) VALUES (?,?,?,?)")
        .run(email, hash, digest(code), new Date().toISOString()).changes);
    }
    const result = action === "recover"
      ? tx.prepare("UPDATE accounts SET password_hash=?,recovery_hash=? WHERE email=? AND password_hash=? AND recovery_hash=?")
        .run(hash, digest(code), email, stored, digest(text(body.recoveryCode).trim()))
      : tx.prepare("UPDATE accounts SET password_hash=?,recovery_hash=? WHERE email=? AND password_hash=?")
        .run(hash, digest(code), email, stored);
    if (!result.changes) return false;
    if (action !== "recovery-code") tx.prepare("DELETE FROM sessions WHERE user_id=?").run(email);
    return true;
  });
  if (!changed) return failure("The account changed or registration is full. Please try again.", 409);
  audit(email, `account.${action}`);
  const response = NextResponse.json({ email, recoveryCode: code }, { headers });
  if (action !== "recovery-code") response.cookies.set(SESSION_COOKIE, createSession(email), cookieOptions(request));
  return response;
}
