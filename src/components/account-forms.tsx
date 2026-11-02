"use client";

import Image from "next/image";
import { useState } from "react";
import { ThemeSwitcher } from "./theme-switcher";

const field = "mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--field)] px-4 py-3 text-[16px] text-[var(--text)] outline-none focus:border-[var(--accent-border)]";
const button = "w-full rounded-xl bg-[#4e50c7] px-4 py-3 text-[14px] font-semibold text-white disabled:opacity-50";

async function submitAccount(path: string, values: Record<string, string>) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values), signal: AbortSignal.timeout(20000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not update your account.");
  return data as { email: string; recoveryCode?: string };
}

export function RecoveryCode({ code, onDone }: { code: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  return <div className="space-y-4" aria-live="polite">
    <h2 className="text-xl font-semibold">Save your recovery code</h2>
    <p className="text-sm leading-6 text-[var(--text-muted)]">Keep this code in your password manager. It can reset your password without email. It is shown only here, and replaces any previous code.</p>
    <textarea aria-label="Recovery code" readOnly value={code} rows={3} className={`${field} resize-none break-all font-mono`} onFocus={(event) => event.target.select()} />
    <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} className="mt-1" />I have saved this code somewhere private.</label>
    <button type="button" disabled={!saved} onClick={onDone} className={button}>Continue</button>
  </div>;
}

export function AccountAccess({ registrationOpen, onSignedIn, initialError = "" }: { registrationOpen: boolean; onSignedIn: (email: string) => void; initialError?: string }) {
  const [mode, setMode] = useState<"login" | "register" | "recover">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ email: string; recoveryCode?: string } | null>(null);
  const title = mode === "login" ? "Sign in to Plypost" : mode === "register" ? "Create your account" : "Reset your password";
  function switchMode(next: typeof mode) { setMode(next); setPassword(""); setConfirm(""); setCode(""); setError(""); }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (mode !== "login" && password !== confirm) { setError("Passwords do not match."); return; }
    setBusy(true);
    try {
      const data = await submitAccount(`/api/auth/${mode}`, { email, password, recoveryCode: code });
      setPassword(""); setConfirm(""); setCode("");
      if (data.recoveryCode) setResult(data); else onSignedIn(data.email);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not reach the server. Please retry."); }
    finally { setBusy(false); }
  }
  return <div className="app-shell flex min-h-screen items-center justify-center px-5 py-10"><main className="panel-border w-full max-w-md rounded-[22px] bg-[var(--surface)] p-6 sm:p-8">
    <div className="mb-7 flex items-center gap-3"><Image src="/plypost-mark.svg" alt="" width={44} height={44} /><span className="text-[25px] font-bold tracking-tight">Plypost.</span></div>
    {result?.recoveryCode ? <RecoveryCode code={result.recoveryCode} onDone={() => onSignedIn(result.email)} /> : <>
      <h1 className="text-[22px] font-semibold">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{mode === "register" ? "A private space for your drafts, media and writing style." : mode === "recover" ? "Use the recovery code you saved. No reset email is sent." : "Open your drafts, media and posting plan."}</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <fieldset disabled={busy} className="space-y-4">
          <label className="block text-sm font-medium">Email<input type="email" autoComplete="username" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} className={field} /></label>
          {mode === "recover" && <label className="block text-sm font-medium">Recovery code<input autoComplete="off" required value={code} onChange={(e) => setCode(e.target.value)} className={field} /></label>}
          <label className="block text-sm font-medium">{mode === "recover" ? "New password" : "Password"}<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "login" ? undefined : 12} maxLength={mode === "login" ? 1024 : 128} value={password} onChange={(e) => setPassword(e.target.value)} className={field} /></label>
          {mode !== "login" && <><p className="text-xs text-[var(--text-muted)]">Use 12–128 characters. Email addresses are not verified; save your recovery code to regain access.</p><label className="block text-sm font-medium">Confirm password<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirm} onChange={(e) => setConfirm(e.target.value)} className={field} /></label></>}
          <button type="submit" className={button}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : mode === "register" ? "Create account" : "Reset password"}</button>
        </fieldset>
      </form>
      {(error || initialError) && <p role="alert" className="mt-4 text-sm text-[var(--danger)]">{error || initialError}</p>}
      <div className="mt-5 flex flex-wrap justify-between gap-4 text-sm text-[var(--accent-text)]">
        {mode === "login" ? <>{registrationOpen && <button disabled={busy} onClick={() => switchMode("register")}>Create an account</button>}<button disabled={busy} onClick={() => switchMode("recover")}>Forgot password?</button></> : <button disabled={busy} onClick={() => switchMode("login")}>Back to sign in</button>}
      </div>
    </>}
    <div className="mt-6 flex justify-end"><ThemeSwitcher /></div>
  </main></div>;
}

export function AccountSecurity() {
  const [action, setAction] = useState("password");
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(""); setMessage("");
    if (action === "password" && password !== confirm) { setError("Passwords do not match."); return; }
    setBusy(true);
    try {
      const data = await submitAccount("/api/auth/account", { action, currentPassword: current, password });
      setCurrent(""); setPassword(""); setConfirm(""); setCode(data.recoveryCode || "");
      setMessage(action === "password" ? "Password changed. Other sessions have been signed out." : action === "sessions" ? "Other sessions have been signed out." : "Recovery code replaced.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update your account."); }
    finally { setBusy(false); }
  }
  return <details className="panel-border rounded-[18px] bg-[var(--surface)]" aria-label="Account security">
    <summary className="cursor-pointer px-6 py-5 text-[17px] font-semibold">Password and security</summary>
    <div className="border-t border-[var(--line)] p-6"><div className="max-w-md">
      {code ? <RecoveryCode code={code} onDone={() => setCode("")} /> : <form onSubmit={submit} className="space-y-4">
        <fieldset disabled={busy} className="space-y-4">
          <label className="block text-sm font-medium">Manage<select value={action} onChange={(e) => { setAction(e.target.value); setCurrent(""); setPassword(""); setConfirm(""); setMessage(""); setError(""); }} className={field}><option value="password">Change password</option><option value="recovery-code">Replace recovery code</option><option value="sessions">Sign out other sessions</option></select></label>
          {action !== "sessions" && <label className="block text-sm font-medium">Current password<input type="password" autoComplete="current-password" required maxLength={1024} value={current} onChange={(e) => setCurrent(e.target.value)} className={field} /></label>}
          {action === "password" && <><label className="block text-sm font-medium">New password<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} className={field} /></label><p className="text-xs text-[var(--text-muted)]">12–128 characters. Changing your password signs out other sessions and replaces your recovery code.</p><label className="block text-sm font-medium">Confirm new password<input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className={field} /></label></>}
          {action === "recovery-code" && <p className="text-sm text-[var(--text-muted)]">Your previous recovery code will stop working.</p>}
          {action === "sessions" && <p className="text-sm text-[var(--text-muted)]">Keep this browser signed in and end all other sessions for this account.</p>}
          <button className={button} type="submit">{busy ? "Saving…" : action === "password" ? "Change password" : action === "recovery-code" ? "Replace recovery code" : "Sign out other sessions"}</button>
        </fieldset>
      </form>}
      {message && <p role="status" className="mt-4 text-sm text-[var(--positive)]">{message}</p>}
      {error && <p role="alert" className="mt-4 text-sm text-[var(--danger)]">{error}</p>}
    </div></div>
  </details>;
}
