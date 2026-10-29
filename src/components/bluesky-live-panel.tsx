"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, CircleAlert, Link2, LoaderCircle, Send } from "lucide-react";
import { validatePlatformText } from "@/lib/platform-validation";

export type BlueskyConnection = {
  configured: boolean;
  connected: boolean;
  account?: { did: string };
};

export type BlueskyAttempt = {
  clientRequestId: string;
  did: string;
  textExcerpt: string;
  status: "inflight" | "posted" | "unknown" | "rejected";
  createdAt: string;
  uri?: string | null;
  cid?: string | null;
  error?: string | null;
  resolution?: "found" | "absent" | null;
  resolvedAt?: string | null;
};

const didPattern = /^did:(?:plc:[a-z2-7]{24}|web:[a-z0-9.:%-]+)$/i;

export function isBlueskyConnection(value: unknown): value is BlueskyConnection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (typeof item.configured !== "boolean" || typeof item.connected !== "boolean") return false;
  if (!item.connected) return true;
  if (!item.account || typeof item.account !== "object" || Array.isArray(item.account)) return false;
  const did = (item.account as Record<string, unknown>).did;
  return typeof did === "string" && didPattern.test(did);
}

async function readObject(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json().catch(() => null);
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

function postUrl(value: unknown): string | null {
  const safe = httpsUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  return url.origin === "https://bsky.app" && /^\/profile\/[^/]+\/post\/[a-z0-9]+$/i.test(url.pathname) ? safe : null;
}

export function BlueskyConnectionPanel({ connection, loading, loadError, onRefresh, editorDirty }: {
  connection: BlueskyConnection | null;
  loading: boolean;
  loadError: string | null;
  onRefresh: () => Promise<void>;
  editorDirty: boolean;
}) {
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function connect() {
    if (busy || !connection?.configured || connection.connected) return;
    if (editorDirty && !window.confirm("Your current draft has unsaved changes. Save it before leaving for Bluesky authorization. Continue anyway?")) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/bluesky/connect", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: handle.trim() }),
      });
      const data = await readObject(response);
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not start Bluesky authorization.");
      const authorizeUrl = httpsUrl(data.authorizeUrl);
      if (!authorizeUrl) throw new Error("Bluesky did not return a secure authorization link.");
      window.location.assign(authorizeUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start Bluesky authorization.");
      setBusy(false);
    }
  }

  async function disconnect() {
    if (busy || !connection?.connected) return;
    const did = connection.account?.did;
    const prompt = connection.configured
      ? `Disconnect ${did} from Plypost? Plypost will try to revoke access on Bluesky and will remove its local connection.`
      : `Remove the saved connection for ${did}? Bluesky settings are missing, so remote access cannot be revoked. Check Bluesky authorized apps afterward.`;
    if (!window.confirm(prompt)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/bluesky/disconnect", { method: "POST" });
      const data = await readObject(response);
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not disconnect Bluesky.");
      await onRefresh();
      setNotice(data.revoked === true
        ? "Bluesky access was revoked and the local connection was removed."
        : "The local connection was removed. Remote revocation could not be confirmed; check Bluesky authorized apps.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not disconnect Bluesky.");
    } finally { setBusy(false); }
  }

  const did = connection?.account?.did;
  return <section className="panel-border soft-shadow overflow-hidden rounded-[18px] bg-[var(--surface)]" aria-labelledby="bluesky-connection-heading">
    <div className="border-b border-[var(--line)] px-6 py-5 sm:px-7">
      <h2 id="bluesky-connection-heading" className="text-[17px] font-bold text-[var(--text)]">Bluesky connection</h2>
      <p className="mt-1 text-[13px] text-[var(--text-muted)]">Optional account access for one confirmed text post at a time. Bluesky scheduling is not connected.</p>
    </div>
    <div className="space-y-3 px-6 py-5 sm:px-7">
      {loading ? <p role="status" className="text-[13px] text-[var(--text-muted)]">Checking connection…</p> : loadError ? <div role="alert" className="space-y-2"><p className="text-[13px] text-[var(--danger)]">{loadError}</p><button type="button" onClick={() => void onRefresh()} className="text-[13px] font-semibold text-[var(--accent-text)]">Try again</button></div> : <>
        {connection?.connected && did ? <>
          <p className="break-all text-[12px] text-[var(--text-secondary)]">Connected account: <strong>{did}</strong></p>
          <a href={`https://bsky.app/profile/${encodeURIComponent(did)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent-text)]">View account <ArrowUpRight size={13} /></a>
          {!connection.configured && <p role="alert" className="text-[12px] leading-5 text-[var(--warning)]">Bluesky settings are missing. Live posting is unavailable.</p>}
          <div><button type="button" onClick={() => void disconnect()} disabled={busy} className="rounded-xl border border-[var(--line)] px-4 py-2.5 text-[13px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50">{busy ? "Disconnecting…" : "Disconnect Bluesky"}</button></div>
        </> : connection?.configured ? <form onSubmit={(event) => { event.preventDefault(); void connect(); }} className="space-y-3">
          <div><label htmlFor="bluesky-handle" className="mb-1.5 block text-[12px] font-semibold text-[var(--text-secondary)]">Bluesky handle</label><input id="bluesky-handle" type="text" autoComplete="off" spellCheck={false} placeholder="name.bsky.social" value={handle} onChange={(event) => setHandle(event.target.value)} required className="w-full rounded-xl border border-[var(--line)] bg-[var(--field)] px-4 py-2.5 text-[16px] text-[var(--text)] outline-none focus:border-[var(--accent-border)]" /></div>
          <button type="submit" disabled={busy || !handle.trim()} className="gradient-button inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-bold text-white disabled:opacity-50"><Link2 size={14} />{busy ? "Opening Bluesky…" : "Connect Bluesky"}</button>
          <p className="text-[11px] leading-5 text-[var(--text-soft)]">Bluesky will ask for permission to create posts. Plypost never asks for your Bluesky password. Save unsaved drafts before leaving this page.</p>
        </form> : <p className="text-[13px] leading-6 text-[var(--text-muted)]">Bluesky live posting is not configured on this installation. Drafts, simulations and assisted publishing remain available.</p>}
      </>}
      {error && <p role="alert" className="text-[12px] leading-5 text-[var(--danger)]">{error}</p>}
      {notice && <p role="status" className="text-[12px] leading-5 text-[var(--warning)]">{notice}</p>}
    </div>
  </section>;
}

export function BlueskyLivePanel({ connection, connectionLoading, connectionError, selected, active, text, imageCount, mediaBusy, onOpenAccount }: {
  connection: BlueskyConnection | null;
  connectionLoading: boolean;
  connectionError: string | null;
  selected: boolean;
  active: boolean;
  text: string;
  imageCount: number;
  mediaBusy: boolean;
  onOpenAccount: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ status: "posted" | "unknown"; text: string; clientRequestId?: string; url?: string } | null>(null);
  const [attempts, setAttempts] = useState<BlueskyAttempt[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  async function refreshAttempts() {
    const response = await fetch("/api/bluesky/publications", { cache: "no-store" });
    const data = await readObject(response);
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not load Bluesky attempts.");
    const items = Array.isArray(data.attempts) ? data.attempts.filter((item): item is BlueskyAttempt => Boolean(item && typeof item === "object" &&
      typeof (item as BlueskyAttempt).clientRequestId === "string" &&
      typeof (item as BlueskyAttempt).textExcerpt === "string" &&
      typeof (item as BlueskyAttempt).createdAt === "string" &&
      ["inflight", "posted", "unknown", "rejected"].includes((item as BlueskyAttempt).status))) : [];
    setAttempts(items);
    setHistoryError(null);
    return items;
  }

  useEffect(() => {
    if (!connection?.connected) return;
    setHistoryLoading(true);
    void refreshAttempts()
      .catch((cause) => setHistoryError(cause instanceof Error ? cause.message : "Could not load Bluesky attempts."))
      .finally(() => setHistoryLoading(false));
  }, [connection?.connected]);

  const validation = validatePlatformText("bluesky", text);
  const currentAttempts = attempts.filter((item) => item.did === connection?.account?.did);
  // History exposes excerpts, so only compare when the entire draft is in that excerpt.
  const matchingText = [...text].length <= 160 ? text : null;
  const matchingUncertain = currentAttempts.find((item) =>
    (item.status === "inflight" || item.status === "unknown" && item.resolution !== "absent") &&
    matchingText !== null && item.textExcerpt === matchingText);
  const matchingPosted = currentAttempts.find((item) => item.status === "posted" &&
    matchingText !== null && item.textExcerpt === matchingText);
  const recentPosted = result?.status === "posted" && result.text === text ? result : null;
  const locallyUnknown = result?.status === "unknown" && result.text === text;
  const ready = selected && active && connection?.configured && connection.connected && Boolean(connection.account?.did) &&
    !connectionLoading && !connectionError && !mediaBusy && imageCount === 0 && validation.valid &&
    !historyLoading && !historyError && !matchingUncertain && !matchingPosted && !recentPosted && !locallyUnknown;

  async function publish() {
    if (!ready || busyRef.current || busy) return;
    const did = connection?.account?.did;
    if (!did) return;
    if (!window.confirm(`Publish ONE real, public, plain-text post now to Bluesky account ${did}? Other selected destinations will not receive it. Links and mentions will remain plain text.\n\nExact text:\n${text}\n\nThis cannot be undone in Plypost.`)) return;
    const clientRequestId = crypto.randomUUID();
    const snapshot = text;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/bluesky/publish", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: snapshot, clientRequestId, accountDid: did }),
      });
      const data = await readObject(response);
      if (response.ok && data.status === "posted") {
        setResult({ status: "posted", text: snapshot, url: postUrl(data.url) ?? undefined });
      } else if (response.ok && data.status === "unknown" || response.status >= 500) {
        setResult({ status: "unknown", text: snapshot, clientRequestId });
        setError("The result is uncertain. Check this Bluesky account before attempting another post.");
      } else if (!response.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Bluesky rejected this post.");
      } else {
        setResult({ status: "unknown", text: snapshot, clientRequestId });
        setError("The server returned an unexpected result. Check Bluesky before posting again.");
      }
      void refreshAttempts().catch((cause) => setHistoryError(cause instanceof Error ? cause.message : "Could not load Bluesky attempts."));
    } catch (cause) {
      if (cause instanceof TypeError) {
        setResult({ status: "unknown", text: snapshot, clientRequestId });
        setError("The connection ended before Plypost could confirm the result. Check Bluesky before posting again.");
      } else {
        setError(cause instanceof Error ? cause.message : "Bluesky could not publish this post.");
      }
      void refreshAttempts().catch((failure) => setHistoryError(failure instanceof Error ? failure.message : "Could not load Bluesky attempts."));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function resolveAttempt(item: BlueskyAttempt, resolution: "found" | "absent") {
    if (resolvingId || item.status !== "unknown" || item.resolution) return;
    const prompt = resolution === "found"
      ? `After checking Bluesky account ${item.did}, did you find this post? This records your own check, not a platform-confirmed receipt.\n\n${item.textExcerpt}`
      : `After checking Bluesky account ${item.did}, are you sure this post is absent? A new attempt with the same text could create a duplicate if the first post exists. This records your own check.\n\n${item.textExcerpt}`;
    if (!window.confirm(prompt)) return;
    setResolvingId(item.clientRequestId);
    setHistoryError(null);
    try {
      const response = await fetch("/api/bluesky/publications/resolve", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientRequestId: item.clientRequestId, resolution }),
      });
      const data = await readObject(response);
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not record your check.");
      await refreshAttempts();
      if (result?.clientRequestId === item.clientRequestId) {
        setResult(null);
        setError(null);
      }
    } catch (cause) {
      setHistoryError(cause instanceof Error ? cause.message : "Could not record your check.");
    } finally { setResolvingId(null); }
  }

  const did = connection?.account?.did;
  const anyUncertain = currentAttempts.some((item) => item.status === "inflight" || item.status === "unknown" && !item.resolution);
  return <section className="panel-border soft-shadow rounded-[18px] bg-[var(--surface)] p-6 sm:p-7" aria-labelledby="bluesky-live-heading">
    <div className="mb-3 flex items-center gap-2"><span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--info-soft)] text-[var(--info)]"><Send size={16} /></span><h2 id="bluesky-live-heading" className="text-[16px] font-bold text-[var(--text)]">Live Bluesky post</h2><span className="rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--accent-text)]">Real post</span></div>
    <p className="text-[12px] leading-5 text-[var(--text-muted)]">Only the Bluesky text version is sent after your confirmation. This does not post to other channels or send images.</p>
    <div className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] p-3"><p className="mb-2 text-[11px] font-bold text-[var(--text-secondary)]">Exact text to send</p><p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-[12px] leading-5 text-[var(--text)]">{text || "Your Bluesky draft is empty."}</p></div>
    {did && <p className="mt-3 break-all text-[12px] text-[var(--text-secondary)]">Destination: <strong>{did}</strong></p>}
    {!selected && <p className="mt-3 text-[12px] text-[var(--text-muted)]">Select Bluesky in the editor to enable this action.</p>}
    {selected && !active && <p className="mt-3 text-[12px] text-[var(--text-muted)]">Open the Bluesky preview above to review this version.</p>}
    {imageCount > 0 && <p className="mt-3 flex items-start gap-1.5 text-[12px] leading-5 text-[var(--warning)]"><CircleAlert size={14} className="mt-0.5 shrink-0" /> Remove selected images before live posting. Image publishing is not connected.</p>}
    {validation.issues.map((issue) => <p key={issue.code} role={issue.severity === "error" ? "alert" : "status"} className={`mt-3 text-[12px] leading-5 ${issue.severity === "error" ? "text-[var(--danger)]" : "text-[var(--warning)]"}`}>{issue.message}</p>)}
    {connectionError && <p role="alert" className="mt-3 text-[12px] text-[var(--danger)]">{connectionError}</p>}
    {!connectionLoading && connection?.configured && !connection.connected && <button type="button" onClick={onOpenAccount} className="mt-3 text-[13px] font-semibold text-[var(--accent-text)]">Connect an account in Account →</button>}
    {!connectionLoading && !connection?.configured && <p className="mt-3 text-[12px] text-[var(--text-muted)]">Live posting is not configured on this installation.</p>}
    {historyLoading && connection?.connected && <p role="status" className="mt-3 text-[12px] text-[var(--text-muted)]">Checking recent live attempts…</p>}
    {historyError && <div role="alert" className="mt-3 text-[12px] text-[var(--warning)]">{historyError} Live posting is paused until recent attempts can be checked. <button type="button" onClick={() => void refreshAttempts().catch((cause) => setHistoryError(cause instanceof Error ? cause.message : "Could not load Bluesky attempts."))} className="font-semibold underline">Try again</button></div>}
    {anyUncertain && <p role="alert" className="mt-3 rounded-xl border border-[var(--warning)] bg-[var(--warning-soft)] p-3 text-[12px] leading-5 text-[var(--warning)]">A previous live attempt has no confirmed result. Check your Bluesky account before posting similar text. You can record what you found below; Plypost will not blindly retry.</p>}
    {matchingUncertain && <p role="status" className="mt-3 text-[12px] text-[var(--warning)]">This text matches a previous {matchingUncertain.resolution === "found" ? "post you marked as found" : "unconfirmed attempt"}. Edit it only if you intend a different post.</p>}
    {matchingPosted && <p role="status" className="mt-3 text-[12px] text-[var(--text-muted)]">This text matches a recently confirmed post. Edit the text before publishing another one.</p>}
    {error && <p role="alert" className="mt-3 text-[12px] leading-5 text-[var(--danger)]">{error}</p>}
    {recentPosted && <div role="status" className="mt-3 rounded-xl border border-[var(--positive)] bg-[var(--positive-soft)] p-3 text-[12px] leading-5 text-[var(--positive)]">Posted to Bluesky. This is a real platform receipt, separate from simulations.{recentPosted.url && <a href={recentPosted.url} target="_blank" rel="noopener noreferrer" className="mt-1 flex items-center gap-1 font-bold underline underline-offset-2">View post <ArrowUpRight size={13} /></a>}</div>}
    {currentAttempts.length > 0 && <details open={anyUncertain} className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2.5">
      <summary className="cursor-pointer text-[12px] font-semibold text-[var(--text-secondary)]">Recent live attempts ({currentAttempts.length})</summary>
      <ul className="mt-3 max-h-80 space-y-3 overflow-y-auto border-t border-[var(--line)] pt-3">{currentAttempts.map((item) => {
        const uriKey = item.uri?.split("/").at(-1) || "";
        const link = item.status === "posted" && uriKey ? postUrl(`https://bsky.app/profile/${encodeURIComponent(item.did)}/post/${encodeURIComponent(uriKey)}`) : null;
        const label = item.status === "posted" ? "Posted · platform confirmed" : item.status === "rejected" ? "Rejected" :
          item.status === "inflight" ? "In progress or interrupted" : item.resolution === "found" ? "You marked this post found · not platform verified" :
          item.resolution === "absent" ? "You marked this post absent · not platform verified" : "Result unknown";
        return <li key={item.clientRequestId} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2.5 text-[11px] text-[var(--text-muted)]">
          <div className="flex flex-wrap items-center justify-between gap-2"><span>{label} · {new Date(item.createdAt).toLocaleString("en-US")}</span>{link && <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-[var(--accent-text)]">View post <ArrowUpRight size={12} /></a>}</div>
          <p className="mt-1.5 line-clamp-2 whitespace-pre-wrap break-words text-[var(--text-secondary)]">{item.textExcerpt}</p>
          {item.error && item.status !== "posted" && <p className="mt-1 text-[var(--warning)]">{item.error}</p>}
          {item.status === "unknown" && !item.resolution && <div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => void resolveAttempt(item, "found")} disabled={Boolean(resolvingId)} className="rounded-lg border border-[var(--line)] px-2.5 py-1.5 font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50">I found the post</button><button type="button" onClick={() => void resolveAttempt(item, "absent")} disabled={Boolean(resolvingId)} className="rounded-lg border border-[var(--line)] px-2.5 py-1.5 font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50">No post found</button></div>}
        </li>;
      })}</ul>
    </details>}
    <button type="button" onClick={() => void publish()} disabled={!ready || busy} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] px-4 py-3 text-[13px] font-bold text-[var(--accent-text)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-45">{busy ? <LoaderCircle size={15} className="animate-spin" /> : <Send size={15} />}{busy ? "Publishing to Bluesky…" : "Publish text to Bluesky now"}</button>
    <p className="mt-2 text-center text-[11px] text-[var(--text-soft)]">Immediate and public. Bluesky items in the ordinary calendar remain simulations.</p>
  </section>;
}
