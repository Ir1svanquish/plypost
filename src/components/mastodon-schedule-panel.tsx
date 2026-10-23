"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, CalendarClock, CircleAlert, LoaderCircle, RotateCcw, Trash2 } from "lucide-react";
import { LocalDateTimeField, formatLocalDateTime, isValidLocalDateTime } from "@/components/local-date-time-field";
import type { MastodonConnection } from "@/components/mastodon-live-panel";
import { validatePlatformText } from "@/lib/platform-validation";

type ScheduledMastodonPost = {
  clientRequestId: string;
  status: "queued" | "inflight" | "posted" | "unknown" | "rejected" | "cancelled";
  text: string;
  scheduledFor: string;
  createdAt: string;
  instance: string;
  account: { id: string; username: string; url: string };
  postUrl?: string;
  id?: string;
  error?: string;
  resolution?: "found" | "absent";
  resolvedAt?: string;
};

type PendingRequest = {
  clientRequestId: string;
  text: string;
  scheduledFor: string;
  accountId: string;
  accountLabel: string;
  instance: string;
};

type Props = {
  connection: MastodonConnection | null;
  connectionLoading: boolean;
  connectionError: string | null;
  selected: boolean;
  text: string;
  imageCount: number;
  mediaBusy: boolean;
  now: number;
  visible: boolean;
  workerLastSeen: string | null;
  onOpenAccount: () => void;
  onOpenEditor: () => void;
};

const statuses = new Set(["queued", "inflight", "posted", "unknown", "rejected", "cancelled"]);

function accountIdOf(connection: MastodonConnection | null): string | null {
  const account = connection?.account;
  return account && "id" in account && typeof account.id === "string" && account.id ? account.id : null;
}

function isScheduledPost(value: unknown): value is ScheduledMastodonPost {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const account = item.account;
  return typeof item.clientRequestId === "string" && statuses.has(String(item.status)) &&
    typeof item.text === "string" && typeof item.scheduledFor === "string" &&
    typeof item.createdAt === "string" && typeof item.instance === "string" &&
    Boolean(account && typeof account === "object" && !Array.isArray(account) &&
      typeof (account as Record<string, unknown>).id === "string" &&
      typeof (account as Record<string, unknown>).username === "string" &&
      typeof (account as Record<string, unknown>).url === "string");
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json().catch(() => null);
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safePostUrl(value: unknown, instance: string): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const server = new URL(instance.includes("://") ? instance : `https://${instance}`);
    return url.protocol === "https:" && !url.username && !url.password && url.host === server.host ? url.toString() : null;
  } catch {
    return null;
  }
}

function statusLabel(post: ScheduledMastodonPost): string {
  switch (post.status) {
    case "queued": return "Queued · real request";
    case "inflight": return "Publishing now";
    case "posted": return "Posted · platform confirmed";
    case "unknown": return post.resolution === "found" ? "You marked it found · unverified" : post.resolution === "absent" ? "You marked it absent · unverified" : "Result unknown · check Mastodon";
    case "rejected": return "Rejected · not posted";
    case "cancelled": return "Cancelled";
  }
}

export function MastodonSchedulePanel({ connection, connectionLoading, connectionError, selected, text, imageCount, mediaBusy, now, visible, workerLastSeen, onOpenAccount, onOpenEditor }: Props) {
  const [time, setTime] = useState("");
  const [items, setItems] = useState<ScheduledMastodonPost[]>([]);
  const [executionEnabled, setExecutionEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const busyRef = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const validation = validatePlatformText("mastodon", text);
  const accountId = accountIdOf(connection);
  const queuedCount = items.filter((item) => item.status === "queued").length;
  const sameTextInProgress = items.some((item) => item.account.id === accountId && item.text === text.trim() &&
    (item.status === "queued" || item.status === "inflight" || (item.status === "unknown" && !item.resolution)));
  const workerTimestamp = workerLastSeen ? Date.parse(workerLastSeen) : NaN;
  const workerRecentlySeen = Number.isFinite(workerTimestamp) && now - workerTimestamp < 45_000;
  const showHistory = executionEnabled || items.length > 0 || Boolean(loadError || actionError || notice);
  const ready = Boolean(connection?.configured && connection.connected && accountId && connection.account?.username && connection.instance &&
    executionEnabled && !connectionLoading && !connectionError && selected && !mediaBusy && imageCount === 0 && text.trim() && validation.valid &&
    isValidLocalDateTime(time, now + 60_000) && !sameTextInProgress && !loading && !loadError && !busy && !pending);

  async function refresh() {
    const response = await fetch("/api/mastodon/schedule", { cache: "no-store" });
    const data = await readJson(response);
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not load scheduled Mastodon posts.");
    if (!Array.isArray(data.items) || !data.items.every(isScheduledPost)) throw new Error("Mastodon schedule returned an unexpected result.");
    setExecutionEnabled(data.executionEnabled === true);
    setItems(data.items);
    setLoadError(null);
    return data.items;
  }

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setLoading(true);
    void refresh().catch((cause) => {
      if (active) setLoadError(cause instanceof Error ? cause.message : "Could not load scheduled Mastodon posts.");
    }).finally(() => { if (active) setLoading(false); });
    const timer = window.setInterval(() => { void refresh().catch((cause) => {
      if (active) setLoadError(cause instanceof Error ? cause.message : "Could not refresh scheduled Mastodon posts.");
    }); }, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [visible]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (pending && dialog && !dialog.open) dialog.showModal();
    if (!pending && dialog?.open) dialog.close();
  }, [pending]);

  useEffect(() => {
    if (!uncertain || !pending) return;
    const found = items.find((item) => item.clientRequestId === pending.clientRequestId);
    if (found) {
      setUncertain(false);
      setPending(null);
      setActionError(null);
      setNotice(found.status === "queued" ? "The real Mastodon post is queued. Its exact text and time are listed below." : `This request is ${statusLabel(found).toLowerCase()}. See its status below.`);
    }
  }, [items, pending, uncertain]);

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || !connection?.instance || !connection.account?.username || !accountId) return;
    setActionError(null);
    setNotice(null);
    setUncertain(false);
    setPending({
      clientRequestId: crypto.randomUUID(),
      text: text.trim(),
      scheduledFor: new Date(time).toISOString(),
      accountId,
      accountLabel: connection.account.username,
      instance: connection.instance,
    });
  }

  async function submit() {
    if (!pending || !executionEnabled || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setUncertain(false);
    setActionError(null);
    try {
      const response = await fetch("/api/mastodon/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientRequestId: pending.clientRequestId, text: pending.text, scheduledFor: pending.scheduledFor, accountId: pending.accountId }),
      });
      const data = await readJson(response);
      if (!response.ok) {
        if (response.status === 503 && data.error === "Automatic Mastodon publishing is not enabled on this installation.") {
          setExecutionEnabled(false);
          setPending(null);
          setActionError(data.error);
          return;
        }
        if (response.status >= 500) {
          setUncertain(true);
          setActionError("The server result is uncertain. Check the queue before retrying this exact request.");
          void refresh().catch(() => {});
        } else {
          setActionError(typeof data.error === "string" ? data.error : "Could not queue this Mastodon post.");
        }
        return;
      }
      if (!isScheduledPost(data.item)) {
        setUncertain(true);
        setActionError("The server returned an unexpected result. Check the queue before retrying this exact request.");
        void refresh().catch(() => {});
        return;
      }
      setItems((current) => [data.item as ScheduledMastodonPost, ...current.filter((item) => item.clientRequestId !== pending.clientRequestId)]);
      setPending(null);
      setTime("");
      setNotice("The real Mastodon post is queued. It will require the background worker to be running at or after the scheduled time.");
      void refresh().catch(() => {});
    } catch (cause) {
      setUncertain(true);
      setActionError(cause instanceof Error ? `${cause.message} Check the queue before retrying this exact request.` : "Connection lost. Check the queue before retrying this exact request.");
      void refresh().catch(() => {});
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function cancel(post: ScheduledMastodonPost) {
    if (post.status !== "queued" || cancelling) return;
    if (!window.confirm(`Cancel the queued real Mastodon post for ${post.account.username} at ${formatLocalDateTime(post.scheduledFor)}?\n\n${post.text}`)) return;
    setCancelling(post.clientRequestId);
    setActionError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/mastodon/schedule", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientRequestId: post.clientRequestId }),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not cancel this queued post.");
      if (!isScheduledPost(data.item)) throw new Error("Cancellation result is uncertain. Refresh the queue before taking another action.");
      setItems((current) => current.map((item) => item.clientRequestId === post.clientRequestId ? data.item as ScheduledMastodonPost : item));
      setNotice("The queued Mastodon post was cancelled before publishing began.");
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not cancel this queued post.");
      void refresh().catch(() => {});
    } finally {
      setCancelling(null);
    }
  }

  async function resolve(post: ScheduledMastodonPost, resolution: "found" | "absent") {
    if (post.status !== "unknown" || post.resolution || resolving) return;
    const prompt = resolution === "found"
      ? `After checking ${post.account.username} on Mastodon, did you find this post? This records your own check, not a verified platform receipt.\n\n${post.text}`
      : `After checking ${post.account.username} on Mastodon, are you sure this post is absent? A new attempt with the same text could create a duplicate if it exists.\n\n${post.text}`;
    if (!window.confirm(prompt)) return;
    setResolving(post.clientRequestId);
    setActionError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/mastodon/schedule/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientRequestId: post.clientRequestId, resolution }),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not record your Mastodon check.");
      if (!isScheduledPost(data.item)) throw new Error("The result of your check is uncertain. Refresh the queue before retrying.");
      setItems((current) => current.map((item) => item.clientRequestId === post.clientRequestId ? data.item as ScheduledMastodonPost : item));
      setNotice(resolution === "found" ? "Recorded that you found the post. This is your report, not platform confirmation." : "Recorded that you could not find the post. Check again before making another attempt.");
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not record your Mastodon check.");
      void refresh().catch(() => {});
    } finally {
      setResolving(null);
    }
  }

  return <section id="mastodon-real-schedule" className="panel-border soft-shadow mt-8 rounded-[18px] bg-[var(--surface)] p-6 sm:p-7" aria-labelledby="mastodon-real-schedule-heading">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="flex flex-wrap items-center gap-2"><h2 id="mastodon-real-schedule-heading" className="text-[17px] font-bold text-[var(--text)]">Mastodon auto-publish</h2><span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${executionEnabled ? "border-[var(--positive)] bg-[var(--positive-soft)] text-[var(--positive)]" : "border-[var(--line)] bg-[var(--surface-muted)] text-[var(--text-muted)]"}`}>{executionEnabled ? "Real post" : "Not enabled"}</span></div>{executionEnabled && <p className="mt-1 text-[13px] leading-5 text-[var(--text-muted)]">Opt in to a real text-only post from your connected account. Simulations and manual handoffs stay separate.</p>}</div>
      {showHistory && <button type="button" onClick={() => { setLoading(true); void refresh().catch((cause) => setLoadError(cause instanceof Error ? cause.message : "Could not refresh the queue.")).finally(() => setLoading(false)); }} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-2 text-[12px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50"><RotateCcw size={13} /> Refresh status</button>}
    </div>
    {!executionEnabled && <p role="status" className="mt-3 rounded-lg border border-[var(--warning)] bg-[var(--warning-soft)] p-3 text-[12px] leading-5 text-[var(--warning)]">Real scheduling is not enabled here. New Mastodon posts cannot be queued, and existing queued records will not be sent automatically. Simulations and manual reminders below still work.</p>}
    {executionEnabled && queuedCount > 0 && <p role="status" className={`mt-4 rounded-lg p-3 text-[12px] leading-5 ${workerRecentlySeen ? "bg-[var(--surface-muted)] text-[var(--text-muted)]" : "bg-[var(--warning-soft)] text-[var(--warning)]"}`}>{workerRecentlySeen ? "Background worker recently seen. This shows process activity, not a guarantee that any post was sent." : "Background worker not recently seen. Keep this computer and npm run worker running; queued posts need it to publish."}</p>}
    {showHistory && <div className={`mt-5 ${executionEnabled ? "grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : ""}`}>
      {executionEnabled && <form onSubmit={review} className="min-w-0 space-y-4 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] p-4">
        <div><h3 className="text-[13px] font-bold text-[var(--text)]">Review the current Mastodon draft</h3><p className="mt-1 text-[11px] leading-5 text-[var(--text-soft)]">When real scheduling is enabled, the exact text shown here will be saved as a snapshot. Later editor changes will not alter a queued post.</p></div>
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3"><p className="text-[11px] font-bold text-[var(--text-secondary)]">Exact text</p><p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-[12px] leading-5 text-[var(--text)]">{text || "No Mastodon text in the current editor."}</p></div>
        {connection?.account?.username && connection.instance && <p className="text-[12px] text-[var(--text-secondary)]">Account: <strong>{connection.account.username}</strong> · {connection.instance}</p>}
        {connectionLoading && <p role="status" className="text-[12px] text-[var(--text-muted)]">Checking Mastodon connection…</p>}
        {connectionError && <p role="alert" className="text-[12px] text-[var(--danger)]">{connectionError}</p>}
        {!connectionLoading && !connection?.configured && <p className="text-[12px] text-[var(--text-muted)]">Real posting is not configured on this installation. You can still use simulations and assisted publishing.</p>}
        {!connectionLoading && connection?.configured && !connection.connected && <button type="button" onClick={onOpenAccount} className="text-[12px] font-semibold text-[var(--accent-text)]">Connect Mastodon in Account →</button>}
        {connection?.connected && !accountId && <p role="alert" className="text-[12px] text-[var(--warning)]">Account identity is incomplete. Refresh the connection in Account before scheduling.</p>}
        {!selected && <button type="button" onClick={onOpenEditor} className="text-[12px] font-semibold text-[var(--accent-text)]">Select Mastodon in Create →</button>}
        {imageCount > 0 && <p className="flex items-start gap-1.5 text-[12px] leading-5 text-[var(--warning)]"><CircleAlert size={14} className="mt-0.5 shrink-0" /> Remove selected images before real scheduling. This integration posts text only.</p>}
        {sameTextInProgress && <p role="alert" className="flex items-start gap-1.5 text-[12px] leading-5 text-[var(--warning)]"><CircleAlert size={14} className="mt-0.5 shrink-0" /> This exact text is already queued, publishing, or has an unresolved result for this account. Check the real queue before scheduling it again.</p>}
        {!validation.valid && <p role="alert" className="text-[12px] text-[var(--danger)]">Add valid Mastodon text in Create before scheduling.</p>}
        {validation.issues.filter((issue) => issue.severity === "warning").map((issue) => <p key={issue.code} className="flex items-start gap-1.5 text-[11px] leading-5 text-[var(--warning)]"><CircleAlert size={13} className="mt-0.5 shrink-0" /> {issue.message}</p>)}
        <LocalDateTimeField id="mastodon-schedule-time" label="Real publishing time" value={time} minTimestamp={now + 60_000} onChange={setTime} />
        <button type="submit" disabled={!ready} className="gradient-button inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-45"><CalendarClock size={15} /> Review real schedule</button>
        <p className="text-[11px] leading-5 text-[var(--text-soft)]">The time is shown in your local timezone. This requires the background worker to run on the hosting computer.</p>
      </form>}
      <div className="min-w-0"><div className="flex items-center justify-between gap-2"><h3 className="text-[13px] font-bold text-[var(--text)]">Real post queue and history</h3><span className="text-[11px] text-[var(--text-soft)]">{items.length} items</span></div>
        {loading && <p role="status" className="mt-4 text-[12px] text-[var(--text-muted)]">Loading real post status…</p>}
        {loadError && <p role="alert" className="mt-4 text-[12px] text-[var(--danger)]">{loadError} <button type="button" onClick={() => { setLoading(true); void refresh().catch((cause) => setLoadError(cause instanceof Error ? cause.message : "Could not load the queue.")).finally(() => setLoading(false)); }} className="font-semibold underline underline-offset-2">Retry</button></p>}
        {actionError && <p role="alert" className="mt-4 rounded-lg bg-[var(--danger-soft)] p-3 text-[12px] text-[var(--danger)]">{actionError}</p>}
        {notice && <p role="status" className="mt-4 rounded-lg bg-[var(--positive-soft)] p-3 text-[12px] text-[var(--positive)]">{notice}</p>}
        {!loading && !loadError && items.length === 0 && <p className="mt-4 rounded-xl border border-dashed border-[var(--line)] p-5 text-[12px] text-[var(--text-muted)]">No real Mastodon posts queued yet. Simulated and manual items appear in the calendar below.</p>}
        <ul className="mt-4 max-h-[480px] space-y-3 overflow-y-auto">{items.map((item) => {
          const postUrl = item.status === "posted" ? safePostUrl(item.postUrl, item.instance) : null;
          const tone = item.status === "posted" ? "text-[var(--positive)] bg-[var(--positive-soft)]" : item.status === "unknown" || item.status === "rejected" ? "text-[var(--warning)] bg-[var(--warning-soft)]" : "text-[var(--text-secondary)] bg-[var(--field)]";
          return <li key={item.clientRequestId} className="rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] p-3 text-[12px]"><div className="flex flex-wrap items-center justify-between gap-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tone}`}>{statusLabel(item)}</span><span className="text-[11px] text-[var(--text-muted)]">{formatLocalDateTime(item.scheduledFor)}</span></div><p className="mt-2 text-[11px] text-[var(--text-muted)]">{item.account.username} · {item.instance}</p><p className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-[12px] leading-5 text-[var(--text)]">{item.text}</p>{item.error && <p role="status" className="mt-2 text-[11px] leading-5 text-[var(--warning)]">{item.error}</p>}{item.status === "unknown" && !item.resolution && <p className="mt-2 text-[11px] leading-5 text-[var(--warning)]">The result is uncertain. Check this Mastodon account before making a new post with the same text.</p>}<div className="mt-3 flex flex-wrap gap-3">{postUrl && <a href={postUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-[var(--accent-text)]">View verified post <ArrowUpRight size={12} /></a>}{item.status === "queued" && <button type="button" onClick={() => void cancel(item)} disabled={Boolean(cancelling)} className="inline-flex items-center gap-1 font-semibold text-[var(--danger)] disabled:opacity-50">{cancelling === item.clientRequestId ? <LoaderCircle size={12} className="animate-spin" /> : <Trash2 size={12} />} Cancel queued post</button>}{item.status === "unknown" && !item.resolution && <><button type="button" onClick={() => void resolve(item, "found")} disabled={Boolean(resolving)} className="font-semibold text-[var(--accent-text)] disabled:opacity-50">I found the post</button><button type="button" onClick={() => void resolve(item, "absent")} disabled={Boolean(resolving)} className="font-semibold text-[var(--accent-text)] disabled:opacity-50">No post found</button></>}</div></li>;
        })}</ul>
      </div>
    </div>}
    <dialog ref={dialogRef} onCancel={(event) => { if (busy || uncertain) { event.preventDefault(); return; } setPending(null); }} aria-labelledby="mastodon-schedule-review-heading" className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 text-[var(--text)] shadow-2xl backdrop:bg-black/65 sm:p-7">
      {pending && <><h3 id="mastodon-schedule-review-heading" className="text-[18px] font-bold">Confirm real Mastodon schedule</h3><p className="mt-2 text-[12px] leading-5 text-[var(--text-muted)]">When this integration is enabled, Plypost will send this post automatically from the account below if the background worker is running. You can cancel only while it is still queued.</p><dl className="mt-4 grid gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] p-4 text-[12px]"><div><dt className="font-bold text-[var(--text-secondary)]">Account</dt><dd className="mt-1 break-words">{pending.accountLabel} · {pending.instance}</dd></div><div><dt className="font-bold text-[var(--text-secondary)]">Local time</dt><dd className="mt-1">{formatLocalDateTime(pending.scheduledFor)}</dd></div><div><dt className="font-bold text-[var(--text-secondary)]">Exact text</dt><dd className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap break-words">{pending.text}</dd></div></dl>{!executionEnabled && <p role="alert" className="mt-4 text-[12px] text-[var(--warning)]">Real scheduling is unavailable. Close this review; nothing has been queued.</p>}{actionError && <p role="alert" className="mt-4 text-[12px] text-[var(--danger)]">{actionError}</p>}{uncertain && <p className="mt-2 text-[12px] text-[var(--warning)]">Refresh the queue first. Retrying below uses the same request ID to avoid adding a second copy.</p>}<div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => { setPending(null); setUncertain(false); setActionError(null); }} disabled={busy || uncertain} className="rounded-xl border border-[var(--line)] px-4 py-2.5 text-[12px] font-semibold text-[var(--text-secondary)] disabled:opacity-50">Back</button>{uncertain && <button type="button" onClick={() => { void refresh().catch((cause) => setLoadError(cause instanceof Error ? cause.message : "Could not check the queue.")); }} disabled={busy} className="rounded-xl border border-[var(--line)] px-4 py-2.5 text-[12px] font-semibold text-[var(--accent-text)]">Check queue</button>}<button type="button" onClick={() => void submit()} disabled={busy || !executionEnabled} className="gradient-button inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[12px] font-bold text-white disabled:opacity-50">{busy && <LoaderCircle size={13} className="animate-spin" />}{uncertain ? "Retry same request" : "Confirm real schedule"}</button></div></>}
    </dialog>
  </section>;
}
