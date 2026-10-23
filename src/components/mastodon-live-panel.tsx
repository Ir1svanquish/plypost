"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, CircleAlert, Link2, LoaderCircle, Send } from "lucide-react";

export type MastodonConnection = {
  configured: boolean;
  instance?: string;
  connected: boolean;
  account?: { username: string; url: string };
};

export function isMastodonConnection(value: unknown): value is MastodonConnection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (typeof item.configured !== "boolean" || typeof item.connected !== "boolean" ||
      (item.instance !== undefined && typeof item.instance !== "string")) return false;
  if (!item.connected) return true;
  if (!item.account || typeof item.account !== "object" || Array.isArray(item.account)) return false;
  const account = item.account as Record<string, unknown>;
  return typeof account.username === "string" && typeof account.url === "string";
}

export type MastodonPublication = {
  clientRequestId: string;
  status: "inflight" | "posted" | "unknown" | "rejected";
  createdAt: string;
  excerpt?: string;
  resolution?: "found" | "absent";
  resolvedAt?: string;
  url?: string;
  id?: string;
  error?: string;
};

function safeHttpsUrl(value: unknown, instance?: string): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const host = instance ? new URL(instance.includes("://") ? instance : `https://${instance}`).host : null;
    return url.protocol === "https:" && !url.username && !url.password && (!host || url.host === host) ? url.toString() : null;
  } catch {
    return null;
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json().catch(() => null);
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function MastodonConnectionPanel({ connection, loading, loadError, onRefresh }: {
  connection: MastodonConnection | null;
  loading: boolean;
  loadError: string | null;
  onRefresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disconnectNotice, setDisconnectNotice] = useState<string | null>(null);

  async function connect() {
    if (busy || !connection?.configured || !connection.instance || connection.connected) return;
    setBusy(true);
    setError(null);
    setDisconnectNotice(null);
    try {
      const response = await fetch("/api/mastodon/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await readJson(response);
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not start Mastodon connection.");
      const authorizeUrl = safeHttpsUrl(data.authorizeUrl, connection.instance);
      if (!authorizeUrl) throw new Error("The authorization link did not match the configured Mastodon server.");
      window.location.assign(authorizeUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start Mastodon connection.");
      setBusy(false);
    }
  }

  async function disconnect() {
    if (busy || !connection?.connected) return;
    const prompt = connection.configured
      ? "Disconnect this Mastodon account and revoke Plypost's access? Planned simulations will stay unchanged."
      : "Remove this saved Mastodon connection? Server settings are missing, so Plypost cannot revoke access remotely. Check authorized apps in Mastodon settings afterward.";
    if (!window.confirm(prompt)) return;
    setBusy(true);
    setError(null);
    setDisconnectNotice(null);
    try {
      const response = await fetch("/api/mastodon/disconnect", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await readJson(response);
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not disconnect Mastodon.");
      await onRefresh();
      setDisconnectNotice(data.revoked === false
        ? "Plypost removed the local connection, but remote revocation could not be confirmed. Check authorized apps in Mastodon settings."
        : "Mastodon access was revoked and the local connection was removed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not disconnect Mastodon.");
    } finally {
      setBusy(false);
    }
  }

  const accountUrl = safeHttpsUrl(connection?.account?.url, connection?.instance);
  return <section className="panel-border soft-shadow overflow-hidden rounded-[18px] bg-[var(--surface)]" aria-labelledby="mastodon-connection-heading">
    <div className="border-b border-[var(--line)] px-6 py-5 sm:px-7">
      <h2 id="mastodon-connection-heading" className="text-[17px] font-bold text-[var(--text)]">Mastodon connection</h2>
      <p className="mt-1 text-[13px] text-[var(--text-muted)]">An optional connection for sending a text post from Create. Your scheduled plan still runs simulations.</p>
    </div>
    <div className="space-y-3 px-6 py-5 sm:px-7">
      {loading ? <p role="status" className="text-[13px] text-[var(--text-muted)]">Checking connection…</p> : loadError ? <div role="alert" className="space-y-2"><p className="text-[13px] text-[var(--danger)]">{loadError}</p><button type="button" onClick={() => void onRefresh()} className="text-[12px] font-semibold text-[var(--accent-text)]">Try again</button></div> : <>
        {connection?.instance && <p className="text-[12px] text-[var(--text-muted)]">Server: <span className="font-semibold text-[var(--text-secondary)]">{connection.instance}</span></p>}
        {connection?.connected ? <>
          {!connection.configured && <p role="alert" className="text-[12px] leading-5 text-[var(--warning)]">Server settings are missing or changed. Live posting is unavailable; you can still remove this saved connection locally.</p>}
          {connection.account?.username ? <p className="text-[13px] text-[var(--positive)]">{connection.configured ? "Connected as" : "Saved account:"} <span className="font-semibold">{connection.account.username}</span></p> : <p role="alert" className="text-[12px] text-[var(--warning)]">Account identity is unavailable. Refresh the connection before posting.</p>}
          {accountUrl && <a href={accountUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent-text)]">View account <ArrowUpRight size={13} /></a>}
          <div><button type="button" onClick={() => void disconnect()} disabled={busy} className="rounded-xl border border-[var(--line)] px-4 py-2.5 text-[12px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50">{busy ? "Disconnecting…" : connection.configured ? "Disconnect and revoke access" : "Remove local connection"}</button></div>
        </> : connection?.configured ? <button type="button" onClick={() => void connect()} disabled={busy || !connection.instance} className="gradient-button inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[12px] font-bold text-white disabled:opacity-50"><Link2 size={14} />{busy ? "Opening authorization…" : "Connect Mastodon"}</button> : <p className="text-[13px] leading-6 text-[var(--text-muted)]">Mastodon live posting is not configured on this installation. Drafts, simulations and assisted publishing remain available.</p>}
      </>}
      {error && <p role="alert" className="text-[12px] leading-5 text-[var(--danger)]">{error}</p>}
      {disconnectNotice && <p role="status" className="text-[12px] leading-5 text-[var(--warning)]">{disconnectNotice}</p>}
    </div>
  </section>;
}

export function MastodonLivePanel({ connection, connectionLoading, connectionError, selected, active, text, imageCount, mediaBusy, onOpenAccount }: {
  connection: MastodonConnection | null;
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
  const [result, setResult] = useState<{ status: "posted" | "unknown"; text: string; clientRequestId?: string; url?: string; id?: string } | null>(null);
  const [publications, setPublications] = useState<MastodonPublication[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  async function refreshPublications() {
    const response = await fetch("/api/mastodon/publications", { cache: "no-store" });
    const data = await readJson(response);
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not load Mastodon publishing history.");
    const raw = Array.isArray(data.publications) ? data.publications : [];
    const items = raw.filter((item): item is MastodonPublication => Boolean(item && typeof item === "object" &&
      typeof (item as MastodonPublication).clientRequestId === "string" &&
      typeof (item as MastodonPublication).createdAt === "string" &&
      ["inflight", "posted", "unknown", "rejected"].includes((item as MastodonPublication).status)));
    setPublications(items);
    setHistoryError(null);
    return items;
  }

  useEffect(() => {
    if (!connection?.connected) return;
    setHistoryLoading(true);
    void refreshPublications()
      .catch((cause) => setHistoryError(cause instanceof Error ? cause.message : "Could not load Mastodon publishing history."))
      .finally(() => setHistoryLoading(false));
  }, [connection?.connected]);

  useEffect(() => {
    if (result?.status !== "unknown" || !result.clientRequestId) return;
    const attempt = publications.find((item) => item.clientRequestId === result.clientRequestId);
    if (attempt?.status === "rejected") {
      setResult(null);
      setError(attempt.error || "Mastodon rejected the post before it was sent.");
    } else if (attempt?.status === "posted") {
      setResult({ status: "posted", text: result.text, url: attempt.url, id: attempt.id });
      setError(null);
    }
  }, [publications, result]);

  const unresolved = publications.find((item) => item.status === "inflight" || (item.status === "unknown" && !item.resolution));
  const locallyUnknown = result?.status === "unknown" && result.text === text;
  const recentPosted = result?.status === "posted" && result.text === text ? result : null;
  const blocked = Boolean(locallyUnknown || recentPosted || historyLoading);
  const ready = selected && active && connection?.configured && connection.connected && Boolean(connection.instance && connection.account?.username) && !connectionLoading && !connectionError && !mediaBusy && imageCount === 0 && Boolean(text.trim()) && !blocked;

  async function publish() {
    if (!ready || busyRef.current || busy) return;
    if (!window.confirm(`Publish a real post now to ${connection?.account?.username} on ${connection?.instance}? Visibility follows that account's Mastodon settings.\n\n${text}\n\nThis action cannot be undone in Plypost.`)) return;
    const clientRequestId = crypto.randomUUID();
    const snapshot = text;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/mastodon/publish", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: snapshot, clientRequestId }),
      });
      const data = await readJson(response);
      if (!response.ok) {
        if (response.status >= 500 || data.status === "unknown") {
          const attempts = await refreshPublications().catch(() => null);
          const attempt = attempts?.find((item) => item.clientRequestId === clientRequestId);
          if (attempt?.status === "rejected") {
            throw new Error(typeof data.error === "string" ? data.error : attempt.error || "Mastodon rejected the post before it was sent.");
          }
          if (attempt?.status === "posted") {
            setResult({ status: "posted", text: snapshot, url: attempt.url, id: attempt.id });
          } else {
            setResult({ status: "unknown", text: snapshot, clientRequestId });
            setError("The result is uncertain. Check your Mastodon account before attempting another post.");
          }
        } else {
          throw new Error(typeof data.error === "string" ? data.error : "Mastodon rejected the post.");
        }
      } else if (data.status === "posted") {
        setResult({ status: "posted", text: snapshot, url: typeof data.url === "string" ? data.url : undefined, id: typeof data.id === "string" ? data.id : undefined });
      } else if (data.status === "unknown") {
        setResult({ status: "unknown", text: snapshot, clientRequestId });
        setError("The result is uncertain. Check your Mastodon account before attempting another post.");
      } else {
        setResult({ status: "unknown", text: snapshot, clientRequestId });
        setError("The server returned an unexpected result. Check your Mastodon account before attempting another post.");
      }
      void refreshPublications().catch(() => {});
    } catch (cause) {
      // A browser network error may occur after the server has already sent the post.
      if (cause instanceof TypeError) {
        setResult({ status: "unknown", text: snapshot, clientRequestId });
        setError("The connection ended before Plypost could confirm the result. Check Mastodon before posting again.");
        void refreshPublications().catch(() => {});
      } else {
        setError(cause instanceof Error ? cause.message : "Mastodon could not publish this post.");
        void refreshPublications().catch(() => {});
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function resolvePublication(item: MastodonPublication, resolution: "found" | "absent") {
    if (resolvingId || item.status !== "unknown" || item.resolution) return;
    const detail = item.excerpt ? `\n\n${item.excerpt}` : "";
    const prompt = resolution === "found"
      ? `After checking your Mastodon account, did you find this post? This records your own check, not a verified platform receipt.${detail}`
      : `After checking your Mastodon account, are you sure this post is absent? This will allow a new attempt with the same text and could create a duplicate if the first post exists.${detail}`;
    if (!window.confirm(prompt)) return;
    setResolvingId(item.clientRequestId);
    setHistoryError(null);
    try {
      const response = await fetch("/api/mastodon/publications/resolve", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientRequestId: item.clientRequestId, resolution }),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not record your check.");
      await refreshPublications();
      setResult(null);
      setError(null);
    } catch (cause) {
      setHistoryError(cause instanceof Error ? cause.message : "Could not record your check.");
    } finally {
      setResolvingId(null);
    }
  }

  const receiptUrl = safeHttpsUrl(recentPosted?.url, connection?.instance);
  return <section className="panel-border soft-shadow rounded-[18px] bg-[var(--surface)] p-6 sm:p-7" aria-labelledby="mastodon-live-heading">
    <div className="mb-3 flex items-center gap-2"><span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-text)]"><Send size={16} /></span><h2 id="mastodon-live-heading" className="text-[16px] font-bold text-[var(--text)]">Live Mastodon post</h2><span className="rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--accent-text)]">Real post</span></div>
    <p className="text-[12px] leading-5 text-[var(--text-muted)]">Sends only the Mastodon text version when you confirm. Images and planned items are never sent by this action.</p>
    <div className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] p-3"><p className="mb-2 text-[11px] font-bold text-[var(--text-secondary)]">Exact text to send</p><p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-[12px] leading-5 text-[var(--text)]">{text || "Your Mastodon draft is empty."}</p></div>
    {!connectionLoading && connection?.connected && connection.account?.username && <p className="mt-3 text-[12px] text-[var(--text-secondary)]">Destination: <strong>{connection.account.username}</strong> · {connection.instance}</p>}
    {!connectionLoading && connection?.connected && !connection.account?.username && <p role="alert" className="mt-3 text-[12px] text-[var(--warning)]">Account identity is unavailable. Reopen Account and refresh before live posting.</p>}
    {!selected && <p className="mt-3 text-[12px] text-[var(--text-muted)]">Select Mastodon in the editor to enable this action.</p>}
    {selected && !active && <p className="mt-3 text-[12px] text-[var(--text-muted)]">Open the Mastodon draft above to review it before live posting.</p>}
    {imageCount > 0 && <p className="mt-3 flex items-start gap-1.5 text-[12px] leading-5 text-[var(--warning)]"><CircleAlert size={14} className="mt-0.5 shrink-0" /> Remove the {imageCount} selected {imageCount === 1 ? "image" : "images"} before live posting. Image publishing is not connected yet.</p>}
    {connectionError && <p role="alert" className="mt-3 text-[12px] text-[var(--danger)]">{connectionError}</p>}
    {!connectionLoading && connection?.configured && !connection.connected && <button type="button" onClick={onOpenAccount} className="mt-3 text-[12px] font-semibold text-[var(--accent-text)]">Connect an account in Account →</button>}
    {!connectionLoading && !connection?.configured && <p className="mt-3 text-[12px] text-[var(--text-muted)]">Live posting is not configured on this installation.</p>}
    {historyLoading && connection?.connected && <p role="status" className="mt-3 text-[12px] text-[var(--text-muted)]">Checking recent live attempts…</p>}
    {historyError && <p role="alert" className="mt-3 text-[12px] text-[var(--warning)]">{historyError} The server will still check for duplicate attempts.</p>}
    {unresolved && <div role="alert" className="mt-3 rounded-xl border border-[var(--warning)] bg-[var(--warning-soft)] p-3 text-[12px] leading-5 text-[var(--warning)]"><p>A previous live attempt has no confirmed result. Check the connected Mastodon account before attempting the same text again, then record what you found in Recent live attempts. Other drafts remain available.</p></div>}
    {error && <p role="alert" className="mt-3 text-[12px] leading-5 text-[var(--danger)]">{error}</p>}
    {recentPosted && <div role="status" className="mt-3 rounded-xl border border-[var(--positive)] bg-[var(--positive-soft)] p-3 text-[12px] leading-5 text-[var(--positive)]"><p>Posted to Mastodon. This is a live platform receipt, separate from simulations.</p>{receiptUrl && <a href={receiptUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 font-bold underline underline-offset-2">View post <ArrowUpRight size={13} /></a>}</div>}
    {publications.length > 0 && <details open={Boolean(unresolved)} className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2.5"><summary className="cursor-pointer text-[12px] font-semibold text-[var(--text-secondary)]">Recent live attempts ({publications.length})</summary><ul className="mt-3 max-h-80 space-y-3 overflow-y-auto border-t border-[var(--line)] pt-3">{publications.map((item) => {
      const url = safeHttpsUrl(item.url, connection?.instance);
      const label = item.status === "posted" ? "Posted · platform confirmed" : item.status === "rejected" ? "Rejected" : item.status === "inflight" ? "In progress" : item.resolution === "found" ? "You marked this post found" : item.resolution === "absent" ? "You marked this post absent" : "Result unknown";
      return <li key={item.clientRequestId} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2.5 text-[11px] text-[var(--text-muted)]"><div className="flex flex-wrap items-center justify-between gap-2"><span>{label} · {new Date(item.createdAt).toLocaleString("en-US")}</span>{url && <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-[var(--accent-text)]">View post <ArrowUpRight size={12} /></a>}</div>{item.excerpt && <p className="mt-1.5 line-clamp-2 whitespace-pre-wrap break-words text-[var(--text-secondary)]">{item.excerpt}</p>}{item.status === "unknown" && !item.resolution && <div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => void resolvePublication(item, "found")} disabled={Boolean(resolvingId)} className="rounded-lg border border-[var(--line)] px-2.5 py-1.5 font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50">I found the post</button><button type="button" onClick={() => void resolvePublication(item, "absent")} disabled={Boolean(resolvingId)} className="rounded-lg border border-[var(--line)] px-2.5 py-1.5 font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50">No post found</button></div>}</li>;
    })}</ul></details>}
    <button type="button" onClick={() => void publish()} disabled={!ready || busy} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] px-4 py-3 text-[13px] font-bold text-[var(--accent-text)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-45">{busy ? <LoaderCircle size={15} className="animate-spin" /> : <Send size={15} />}{busy ? "Publishing to Mastodon…" : "Publish text to Mastodon now"}</button>
    <p className="mt-2 text-center text-[11px] text-[var(--text-soft)]">This action is immediate. Scheduled plans remain simulations.</p>
  </section>;
}
