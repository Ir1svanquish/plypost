"use client";

import { useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { ArrowUpRight, CalendarClock, CircleAlert, LoaderCircle, RotateCcw, Trash2 } from "lucide-react";
import { LocalDateTimeField, formatLocalDateTime, isValidLocalDateTime } from "@/components/local-date-time-field";
import type { MastodonConnection } from "@/components/mastodon-live-panel";
import { validatePlatformText } from "@/lib/platform-validation";
import type { RealMastodonSchedule } from "@/lib/plan-agenda";
import { localDateTimeValue } from "@/lib/workspace";

type ScheduledMastodonPost = RealMastodonSchedule;

type PendingRequest = {
  clientRequestId: string;
  text: string;
  scheduledFor: string;
  accountId: string;
  accountLabel: string;
  instance: string;
};

type PendingMove = { post: ScheduledMastodonPost; scheduledFor: string };
type PendingQueueAction = { kind: "cancel"; post: ScheduledMastodonPost } |
  { kind: "resolve"; post: ScheduledMastodonPost; resolution: "found" | "absent" };

type Props = {
  items: ScheduledMastodonPost[];
  onItemsChange: Dispatch<SetStateAction<ScheduledMastodonPost[]>>;
  onLoadErrorChange: Dispatch<SetStateAction<string | null>>;
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

function MastodonQueueItem({ item, now, moving, cancelling, resolving, onMove, onCancel, onResolve }: {
  item: ScheduledMastodonPost;
  now: number;
  moving: string | null;
  cancelling: string | null;
  resolving: string | null;
  onMove: (item: ScheduledMastodonPost, scheduledFor: string) => boolean;
  onCancel: (item: ScheduledMastodonPost) => void;
  onResolve: (item: ScheduledMastodonPost, resolution: "found" | "absent") => void;
}) {
  const [editingTime, setEditingTime] = useState(false);
  const [moveTime, setMoveTime] = useState("");
  const postUrl = item.status === "posted" ? safePostUrl(item.postUrl, item.instance) : null;
  const tone = item.status === "posted" ? "text-[var(--positive)] bg-[var(--positive-soft)]" :
    item.status === "unknown" || item.status === "rejected" ? "text-[var(--warning)] bg-[var(--warning-soft)]" :
    "text-[var(--text-secondary)] bg-[var(--field)]";
  const moveValid = isValidLocalDateTime(moveTime, now + 60_000) &&
    moveTime !== localDateTimeValue(new Date(item.scheduledFor));
  const actionBusy = Boolean(moving || cancelling || resolving);

  function submitMove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!moveValid || item.status !== "queued" || actionBusy) return;
    if (onMove(item, new Date(moveTime).toISOString())) setEditingTime(false);
  }

  return <li id={`mastodon-schedule-${item.clientRequestId}`} tabIndex={-1}
    className="rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] p-3 text-[12px] outline-none focus:ring-2 focus:ring-[var(--accent)]">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tone}`}>{statusLabel(item)}</span>
      <span className="text-[11px] text-[var(--text-muted)]">{formatLocalDateTime(item.scheduledFor)}</span>
    </div>
    <p className="mt-2 text-[11px] text-[var(--text-muted)]">{item.account.username} · {item.instance}</p>
    <p className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-[12px] leading-5 text-[var(--text)]">{item.text}</p>
    {item.error && <p role="status" className="mt-2 text-[11px] leading-5 text-[var(--warning)]">{item.error}</p>}
    {item.status === "unknown" && !item.resolution && <p className="mt-2 text-[11px] leading-5 text-[var(--warning)]">The result is uncertain. Check this Mastodon account before making a new post with the same text.</p>}
    <div className="mt-3 flex flex-wrap gap-3">
      {postUrl && <a href={postUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-[var(--accent-text)]">View verified post <ArrowUpRight size={12} /></a>}
      {item.status === "queued" && <>
        <button type="button" onClick={() => { setMoveTime(localDateTimeValue(new Date(item.scheduledFor))); setEditingTime(true); }} disabled={actionBusy || editingTime} className="inline-flex items-center gap-1 font-semibold text-[var(--accent-text)] disabled:opacity-50"><CalendarClock size={12} /> Change time</button>
        <button type="button" onClick={() => onCancel(item)} disabled={actionBusy} className="inline-flex items-center gap-1 font-semibold text-[var(--danger)] disabled:opacity-50">{cancelling === item.clientRequestId ? <LoaderCircle size={12} className="animate-spin" /> : <Trash2 size={12} />} Cancel queued post</button>
      </>}
      {item.status === "unknown" && !item.resolution && <>
        <button type="button" onClick={() => onResolve(item, "found")} disabled={actionBusy} className="font-semibold text-[var(--accent-text)] disabled:opacity-50">I found the post</button>
        <button type="button" onClick={() => onResolve(item, "absent")} disabled={actionBusy} className="font-semibold text-[var(--accent-text)] disabled:opacity-50">No post found</button>
      </>}
    </div>
    {item.status === "queued" && editingTime && <form onSubmit={submitMove} className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
      <LocalDateTimeField id={`mastodon-move-${item.clientRequestId}`} label="New real publishing time" value={moveTime} minTimestamp={now + 60_000} onChange={setMoveTime} />
      <p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">The connected account and exact text above stay unchanged. You will confirm the new time before it takes effect.</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="submit" disabled={!moveValid || actionBusy} className="rounded-lg bg-[var(--accent-soft)] px-3 py-2 font-semibold text-[var(--accent-text)] disabled:opacity-50">{moving === item.clientRequestId ? "Saving…" : "Review time change"}</button>
        <button type="button" onClick={() => setEditingTime(false)} disabled={actionBusy} className="font-semibold text-[var(--text-muted)] disabled:opacity-50">Cancel</button>
      </div>
    </form>}
  </li>;
}

export function MastodonSchedulePanel({ items, onItemsChange, onLoadErrorChange, connection, connectionLoading, connectionError, selected, text, imageCount, mediaBusy, now, visible, workerLastSeen, onOpenAccount, onOpenEditor }: Props) {
  const [time, setTime] = useState("");
  const [executionEnabled, setExecutionEnabled] = useState(false);
  const [realWorkerLastSeen, setRealWorkerLastSeen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moveUncertain, setMoveUncertain] = useState(false);
  const [pendingQueueAction, setPendingQueueAction] = useState<PendingQueueAction | null>(null);
  const [queueActionError, setQueueActionError] = useState<string | null>(null);
  const [queueChecking, setQueueChecking] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const busyRef = useRef(false);
  const movingRef = useRef(false);
  const queueActionBusyRef = useRef(false);
  const queueCheckingRef = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const moveDialogRef = useRef<HTMLDialogElement>(null);
  const queueActionDialogRef = useRef<HTMLDialogElement>(null);
  const validation = validatePlatformText("mastodon", text);
  const accountId = accountIdOf(connection);
  const queuedCount = items.filter((item) => item.status === "queued").length;
  const sameTextInProgress = items.some((item) => item.account.id === accountId && item.text === text.trim() &&
    (item.status === "queued" || item.status === "inflight" || (item.status === "unknown" && !item.resolution)));
  const workerTimestamp = realWorkerLastSeen ? Date.parse(realWorkerLastSeen) : NaN;
  const workerRecentlySeen = Number.isFinite(workerTimestamp) && now - workerTimestamp < 45_000;
  const simulationWorkerTimestamp = workerLastSeen ? Date.parse(workerLastSeen) : NaN;
  const simulationWorkerRecentlySeen = Number.isFinite(simulationWorkerTimestamp) && now - simulationWorkerTimestamp < 45_000;
  const showComposer = executionEnabled && Boolean(connection?.configured && connection.connected);
  const showHistory = showComposer || items.length > 0 || Boolean(loadError || actionError || notice);
  const statusLabelText = loading || connectionLoading ? "Checking" : !executionEnabled ? "Paused" : connection?.connected ? workerRecentlySeen ? "Ready" : "Worker offline" : "Setup needed";
  const ready = Boolean(connection?.configured && connection.connected && accountId && connection.account?.username && connection.instance &&
    executionEnabled && !connectionLoading && !connectionError && selected && !mediaBusy && imageCount === 0 && text.trim() && validation.valid &&
    isValidLocalDateTime(time, now + 60_000) && !sameTextInProgress && !loading && !loadError && !busy && !pending);

  useEffect(() => { onLoadErrorChange(loadError); }, [loadError, onLoadErrorChange]);

  async function refresh() {
    const response = await fetch("/api/mastodon/schedule", { cache: "no-store" });
    const data = await readJson(response);
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not load scheduled Mastodon posts.");
    if (!Array.isArray(data.items) || !data.items.every(isScheduledPost)) throw new Error("Mastodon schedule returned an unexpected result.");
    setExecutionEnabled(data.executionEnabled === true);
    setRealWorkerLastSeen(typeof data.mastodonWorkerLastSeen === "string" ? data.mastodonWorkerLastSeen : null);
    onItemsChange(data.items);
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
    const dialog = moveDialogRef.current;
    if (pendingMove && dialog && !dialog.open) dialog.showModal();
    if (!pendingMove && dialog?.open) dialog.close();
  }, [pendingMove]);

  useEffect(() => {
    const dialog = queueActionDialogRef.current;
    if (pendingQueueAction && dialog && !dialog.open) dialog.showModal();
    if (!pendingQueueAction && dialog?.open) dialog.close();
  }, [pendingQueueAction]);

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
        if (response.status === 503 && data.error === "Automatic Mastodon publishing is paused on this installation.") {
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
      onItemsChange((current) => [data.item as ScheduledMastodonPost, ...current.filter((item) => item.clientRequestId !== pending.clientRequestId)]);
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

  function reviewCancel(post: ScheduledMastodonPost) {
    if (post.status !== "queued" || cancelling || resolving || movingRef.current || queueActionBusyRef.current || queueCheckingRef.current || pendingQueueAction) return;
    setQueueActionError(null);
    setPendingQueueAction({ kind: "cancel", post });
  }

  async function cancel(post: ScheduledMastodonPost) {
    if (queueActionBusyRef.current) return;
    queueActionBusyRef.current = true;
    setCancelling(post.clientRequestId);
    setActionError(null);
    setNotice(null);
    setQueueActionError(null);
    try {
      const response = await fetch("/api/mastodon/schedule", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientRequestId: post.clientRequestId }),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not cancel this queued post.");
      if (!isScheduledPost(data.item) || data.item.status !== "cancelled") throw new Error("Cancellation result is uncertain. Refresh the queue before taking another action.");
      onItemsChange((current) => current.map((item) => item.clientRequestId === post.clientRequestId ? data.item as ScheduledMastodonPost : item));
      setPendingQueueAction(null);
      setNotice("The queued Mastodon post was cancelled before publishing began.");
    } catch (cause) {
      setQueueActionError(cause instanceof Error ? cause.message : "Could not cancel this queued post.");
      await checkQueueAction({ kind: "cancel", post });
    } finally {
      setCancelling(null);
      queueActionBusyRef.current = false;
    }
  }

  async function reconcileMove(post: ScheduledMastodonPost, scheduledFor: string): Promise<boolean> {
    try {
      const latest = (await refresh()).find((item) => item.clientRequestId === post.clientRequestId);
      if (latest?.status === "queued" && latest.scheduledFor === scheduledFor &&
          latest.text === post.text && latest.account.id === post.account.id) {
        setNotice("The new real publishing time is saved. The account and text were kept.");
        setActionError(null);
        setPendingMove(null);
        setMoveError(null);
        setMoveUncertain(false);
        return true;
      }
      if (latest?.status === "queued" && latest.scheduledFor === post.scheduledFor &&
          latest.text === post.text && latest.account.id === post.account.id) {
        setMoveError("The original time is still queued. No change was confirmed; you can retry this same request.");
        setMoveUncertain(false);
      } else {
        setPendingMove(null);
        setMoveUncertain(false);
        setActionError("The queued post changed or publishing has started. Review its current status before taking another action.");
      }
    } catch {
      setMoveError("The time change result is uncertain. Refresh the real queue before trying again.");
      setMoveUncertain(true);
    }
    return false;
  }

  function reviewMove(post: ScheduledMastodonPost, scheduledFor: string): boolean {
    if (post.status !== "queued" || movingRef.current || busyRef.current || !executionEnabled || pendingMove) return false;
    setActionError(null);
    setNotice(null);
    setMoveError(null);
    setMoveUncertain(false);
    setPendingMove({ post, scheduledFor });
    return true;
  }

  async function submitMove(): Promise<void> {
    if (!pendingMove || movingRef.current || busyRef.current || !executionEnabled || moveUncertain) return;
    const { post, scheduledFor } = pendingMove;
    movingRef.current = true;
    setMoving(post.clientRequestId);
    setActionError(null);
    setNotice(null);
    setMoveError(null);
    try {
      const response = await fetch("/api/mastodon/schedule", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientRequestId: post.clientRequestId,
          expectedScheduledFor: post.scheduledFor, scheduledFor }),
      });
      const data = await readJson(response);
      if (!response.ok) {
        if (response.status === 503) {
          setExecutionEnabled(false);
          setPendingMove(null);
          setActionError(typeof data.error === "string" ? data.error : "Real scheduling is paused.");
          return;
        }
        if (response.status >= 500) {
          await reconcileMove(post, scheduledFor);
          return;
        }
        if (response.status === 409) {
          setPendingMove(null);
          setActionError(typeof data.error === "string" ? data.error : "The queued post changed. Refresh the queue.");
          void refresh().catch(() => {});
          return;
        }
        setMoveError(typeof data.error === "string" ? data.error : "Could not change this real Mastodon time.");
        return;
      }
      if (!isScheduledPost(data.item) || data.item.status !== "queued" ||
          data.item.scheduledFor !== scheduledFor || data.item.text !== post.text ||
          data.item.account.id !== post.account.id) {
        await reconcileMove(post, scheduledFor);
        return;
      }
      onItemsChange((current) => current.map((item) => item.clientRequestId === post.clientRequestId
        ? data.item as ScheduledMastodonPost : item));
      setPendingMove(null);
      setMoveUncertain(false);
      setNotice("The new real publishing time is saved. The account and text were kept.");
      void refresh().catch(() => {});
    } catch {
      await reconcileMove(post, scheduledFor);
    } finally {
      movingRef.current = false;
      setMoving(null);
    }
  }

  function reviewResolve(post: ScheduledMastodonPost, resolution: "found" | "absent") {
    if (post.status !== "unknown" || post.resolution || resolving || cancelling || movingRef.current || queueActionBusyRef.current || queueCheckingRef.current || pendingQueueAction) return;
    setQueueActionError(null);
    setPendingQueueAction({ kind: "resolve", post, resolution });
  }

  async function reconcileQueueAction(action: PendingQueueAction) {
    try {
      const latest = (await refresh()).find((item) => item.clientRequestId === action.post.clientRequestId);
      const completed = action.kind === "cancel" ? latest?.status === "cancelled" :
        latest?.status === "unknown" && latest.resolution === action.resolution;
      if (completed) {
        setPendingQueueAction(null);
        setQueueActionError(null);
        setNotice(action.kind === "cancel" ? "The queued Mastodon post is cancelled." :
          "Your Mastodon check was recorded. This remains self-reported, not a platform receipt.");
      } else if (!latest || latest.status !== action.post.status ||
          (action.kind === "resolve" && latest.resolution)) {
        setPendingQueueAction(null);
        setActionError("The real post changed while you were reviewing it. Check its current status before taking another action.");
      }
    } catch {
      setQueueActionError("Could not check the current queue. Refresh status before retrying this action.");
    }
  }

  async function checkQueueAction(action: PendingQueueAction) {
    if (queueCheckingRef.current) return;
    queueCheckingRef.current = true;
    setQueueChecking(true);
    try { await reconcileQueueAction(action); }
    finally { queueCheckingRef.current = false; setQueueChecking(false); }
  }

  async function resolve(post: ScheduledMastodonPost, resolution: "found" | "absent") {
    if (queueActionBusyRef.current) return;
    queueActionBusyRef.current = true;
    setResolving(post.clientRequestId);
    setActionError(null);
    setNotice(null);
    setQueueActionError(null);
    try {
      const response = await fetch("/api/mastodon/schedule/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientRequestId: post.clientRequestId, resolution }),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not record your Mastodon check.");
      if (!isScheduledPost(data.item) || data.item.resolution !== resolution) throw new Error("The result of your check is uncertain. Refresh the queue before retrying.");
      onItemsChange((current) => current.map((item) => item.clientRequestId === post.clientRequestId ? data.item as ScheduledMastodonPost : item));
      setPendingQueueAction(null);
      setNotice(resolution === "found" ? "Recorded that you found the post. This is your report, not platform confirmation." : "Recorded that you could not find the post. Check again before making another attempt.");
    } catch (cause) {
      setQueueActionError(cause instanceof Error ? cause.message : "Could not record your Mastodon check.");
      await checkQueueAction({ kind: "resolve", post, resolution });
    } finally {
      setResolving(null);
      queueActionBusyRef.current = false;
    }
  }

  return <section id="mastodon-real-schedule" className="panel-border soft-shadow mt-8 rounded-[18px] bg-[var(--surface)] p-6 sm:p-7" aria-labelledby="mastodon-real-schedule-heading">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="flex flex-wrap items-center gap-2"><h2 id="mastodon-real-schedule-heading" className="text-[17px] font-bold text-[var(--text)]">Mastodon auto-publish</h2><span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${showComposer && workerRecentlySeen ? "border-[var(--positive)] bg-[var(--positive-soft)] text-[var(--positive)]" : showComposer ? "border-[var(--warning)] bg-[var(--warning-soft)] text-[var(--warning)]" : "border-[var(--line)] bg-[var(--surface-muted)] text-[var(--text-muted)]"}`}>{statusLabelText}</span></div>{showComposer && <p className="mt-1 text-[13px] leading-5 text-[var(--text-muted)]">Opt in to a real text-only post from your connected account. Simulations and manual handoffs stay separate.</p>}</div>
      {showHistory && <button type="button" onClick={() => { setLoading(true); void refresh().catch((cause) => setLoadError(cause instanceof Error ? cause.message : "Could not refresh the queue.")).finally(() => setLoading(false)); }} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-2 text-[12px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50"><RotateCcw size={13} /> Refresh status</button>}
    </div>
    {!executionEnabled && !loading && <p role="status" className="mt-3 rounded-lg border border-[var(--warning)] bg-[var(--warning-soft)] p-3 text-[12px] leading-5 text-[var(--warning)]">Real scheduling is paused here. New Mastodon posts cannot be queued, and existing queued records will not be sent automatically. Restart the web app and worker after changing this setting. Simulations and manual reminders below still work.</p>}
    {executionEnabled && !showComposer && items.length === 0 && !loading && !loadError && <div role={connectionError ? "alert" : "status"} className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3 text-[12px] text-[var(--text-muted)]"><p>{connectionLoading ? "Checking the Mastodon connection…" : connectionError ? connectionError : connection?.configured ? "Connect your Mastodon account before scheduling real posts." : "Configure a Mastodon instance in the local server settings before scheduling real posts."}</p>{connection?.configured && !connection.connected && !connectionLoading && <button type="button" onClick={onOpenAccount} className="shrink-0 font-semibold text-[var(--accent-text)]">Open Account →</button>}</div>}
    {executionEnabled && (showComposer || queuedCount > 0) && <p role="status" className={`mt-4 rounded-lg p-3 text-[12px] leading-5 ${workerRecentlySeen ? "bg-[var(--surface-muted)] text-[var(--text-muted)]" : "bg-[var(--warning-soft)] text-[var(--warning)]"}`}>{workerRecentlySeen ? "Real publishing worker recently seen. This shows process activity, not a guarantee that any post was sent." : simulationWorkerRecentlySeen ? "Only a simulation worker was recently seen. Restart npm run worker before relying on confirmed real Mastodon schedules." : "Real publishing worker not recently seen. Start npm run worker and keep this computer running before relying on a scheduled post."}</p>}
    {showHistory && <div className={`mt-5 ${showComposer ? "grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : ""}`}>
      {showComposer && <form onSubmit={review} className="min-w-0 space-y-4 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] p-4">
        <div><h3 className="text-[13px] font-bold text-[var(--text)]">Review the current Mastodon draft</h3><p className="mt-1 text-[11px] leading-5 text-[var(--text-soft)]">The exact text shown here is saved as a snapshot when you confirm the schedule. Later editor changes will not alter a queued post.</p></div>
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
        <ul className="mt-4 max-h-[480px] space-y-3 overflow-y-auto">{items.map((item) =>
          <MastodonQueueItem key={item.clientRequestId} item={item} now={now} moving={moving} cancelling={cancelling}
            resolving={resolving} onMove={reviewMove} onCancel={reviewCancel}
            onResolve={reviewResolve} />
        )}</ul>
      </div>
    </div>}
    <dialog ref={moveDialogRef} onCancel={(event) => { if (moving || moveUncertain) { event.preventDefault(); return; } setPendingMove(null); }} aria-labelledby="mastodon-move-review-heading" className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 text-[var(--text)] shadow-2xl backdrop:bg-black/65 sm:p-7">
      {pendingMove && <><h3 id="mastodon-move-review-heading" className="text-[18px] font-bold">Confirm new publishing time</h3><p className="mt-2 text-[12px] leading-5 text-[var(--text-muted)]">This changes the time of one queued real Mastodon post. The connected account and exact text stay the same.</p><dl className="mt-4 grid gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] p-4 text-[12px]"><div><dt className="font-bold text-[var(--text-secondary)]">Account</dt><dd className="mt-1 break-words">{pendingMove.post.account.username} · {pendingMove.post.instance}</dd></div><div><dt className="font-bold text-[var(--text-secondary)]">Original local time</dt><dd className="mt-1">{formatLocalDateTime(pendingMove.post.scheduledFor)}</dd></div><div><dt className="font-bold text-[var(--text-secondary)]">New local time</dt><dd className="mt-1 font-bold text-[var(--accent-text)]">{formatLocalDateTime(pendingMove.scheduledFor)}</dd></div><div><dt className="font-bold text-[var(--text-secondary)]">Exact text</dt><dd className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap break-words">{pendingMove.post.text}</dd></div></dl>{moveError && <p role="alert" className="mt-4 text-[12px] leading-5 text-[var(--danger)]">{moveError}</p>}{!executionEnabled && <p role="alert" className="mt-4 text-[12px] text-[var(--warning)]">Real scheduling is paused. This time change cannot be saved.</p>}<div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => { setPendingMove(null); setMoveError(null); }} disabled={Boolean(moving || moveUncertain)} className="rounded-xl border border-[var(--line)] px-4 py-2.5 text-[12px] font-semibold text-[var(--text-secondary)] disabled:opacity-50">Back</button>{moveUncertain && <button type="button" onClick={() => { void reconcileMove(pendingMove.post, pendingMove.scheduledFor); }} disabled={Boolean(moving)} className="rounded-xl border border-[var(--line)] px-4 py-2.5 text-[12px] font-semibold text-[var(--accent-text)] disabled:opacity-50">Refresh queue</button>}<button type="button" onClick={() => void submitMove()} disabled={Boolean(moving || moveUncertain || !executionEnabled)} className="gradient-button inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[12px] font-bold text-white disabled:opacity-50">{moving && <LoaderCircle size={13} className="animate-spin" />}Confirm changed time</button></div></>}
    </dialog>
    <dialog ref={queueActionDialogRef} onCancel={(event) => { if (cancelling || resolving || queueChecking) { event.preventDefault(); return; } setPendingQueueAction(null); }} aria-labelledby="mastodon-queue-action-heading" className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 text-[var(--text)] shadow-2xl backdrop:bg-black/65 sm:p-7">
      {pendingQueueAction && <><h3 id="mastodon-queue-action-heading" className="text-[18px] font-bold">{pendingQueueAction.kind === "cancel" ? "Cancel real Mastodon post?" : "Record your Mastodon check?"}</h3><p className="mt-2 text-[12px] leading-5 text-[var(--text-muted)]">{pendingQueueAction.kind === "cancel" ? "This stops a queued post only if the worker has not started publishing it." : pendingQueueAction.resolution === "found" ? "You found this post on Mastodon. This is your own report, not a verified platform receipt." : "You could not find this post on Mastodon. Check carefully: a later new post with the same text could create a duplicate if the original exists."}</p><dl className="mt-4 grid gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] p-4 text-[12px]"><div><dt className="font-bold text-[var(--text-secondary)]">Account</dt><dd className="mt-1 break-words">{pendingQueueAction.post.account.username} · {pendingQueueAction.post.instance}</dd></div><div><dt className="font-bold text-[var(--text-secondary)]">Local time</dt><dd className="mt-1">{formatLocalDateTime(pendingQueueAction.post.scheduledFor)}</dd></div><div><dt className="font-bold text-[var(--text-secondary)]">Exact text</dt><dd className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap break-words">{pendingQueueAction.post.text}</dd></div></dl>{queueActionError && <p role="alert" className="mt-4 text-[12px] leading-5 text-[var(--danger)]">{queueActionError}</p>}<div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => { setPendingQueueAction(null); setQueueActionError(null); }} disabled={Boolean(cancelling || resolving || queueChecking)} className="rounded-xl border border-[var(--line)] px-4 py-2.5 text-[12px] font-semibold text-[var(--text-secondary)] disabled:opacity-50">Back</button>{queueActionError && <button type="button" onClick={() => { void checkQueueAction(pendingQueueAction); }} disabled={Boolean(cancelling || resolving || queueChecking)} className="rounded-xl border border-[var(--line)] px-4 py-2.5 text-[12px] font-semibold text-[var(--accent-text)] disabled:opacity-50">Refresh queue</button>}<button type="button" onClick={() => pendingQueueAction.kind === "cancel" ? void cancel(pendingQueueAction.post) : void resolve(pendingQueueAction.post, pendingQueueAction.resolution)} disabled={Boolean(cancelling || resolving || queueChecking)} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[12px] font-bold text-white disabled:opacity-50 ${pendingQueueAction.kind === "cancel" ? "bg-[var(--danger)]" : "gradient-button"}`}>{(cancelling || resolving) && <LoaderCircle size={13} className="animate-spin" />}{pendingQueueAction.kind === "cancel" ? "Confirm cancellation" : pendingQueueAction.resolution === "found" ? "Record found post" : "Record no post found"}</button></div></>}
    </dialog>
    <dialog ref={dialogRef} onCancel={(event) => { if (busy || uncertain) { event.preventDefault(); return; } setPending(null); }} aria-labelledby="mastodon-schedule-review-heading" className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 text-[var(--text)] shadow-2xl backdrop:bg-black/65 sm:p-7">
      {pending && <><h3 id="mastodon-schedule-review-heading" className="text-[18px] font-bold">Confirm real Mastodon schedule</h3><p className="mt-2 text-[12px] leading-5 text-[var(--text-muted)]">Once you confirm, Plypost will send this post automatically from the account below if the background worker is running. You can cancel only while it is still queued.</p><dl className="mt-4 grid gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] p-4 text-[12px]"><div><dt className="font-bold text-[var(--text-secondary)]">Account</dt><dd className="mt-1 break-words">{pending.accountLabel} · {pending.instance}</dd></div><div><dt className="font-bold text-[var(--text-secondary)]">Local time</dt><dd className="mt-1">{formatLocalDateTime(pending.scheduledFor)}</dd></div><div><dt className="font-bold text-[var(--text-secondary)]">Exact text</dt><dd className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap break-words">{pending.text}</dd></div></dl>{!executionEnabled && <p role="alert" className="mt-4 text-[12px] text-[var(--warning)]">Real scheduling is unavailable. Close this review; nothing has been queued.</p>}{actionError && <p role="alert" className="mt-4 text-[12px] text-[var(--danger)]">{actionError}</p>}{uncertain && <p className="mt-2 text-[12px] text-[var(--warning)]">Refresh the queue first. Retrying below uses the same request ID to avoid adding a second copy.</p>}<div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => { setPending(null); setUncertain(false); setActionError(null); }} disabled={busy || uncertain} className="rounded-xl border border-[var(--line)] px-4 py-2.5 text-[12px] font-semibold text-[var(--text-secondary)] disabled:opacity-50">Back</button>{uncertain && <button type="button" onClick={() => { void refresh().catch((cause) => setLoadError(cause instanceof Error ? cause.message : "Could not check the queue.")); }} disabled={busy} className="rounded-xl border border-[var(--line)] px-4 py-2.5 text-[12px] font-semibold text-[var(--accent-text)]">Check queue</button>}<button type="button" onClick={() => void submit()} disabled={busy || !executionEnabled} className="gradient-button inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[12px] font-bold text-white disabled:opacity-50">{busy && <LoaderCircle size={13} className="animate-spin" />}{uncertain ? "Retry same request" : "Confirm real schedule"}</button></div></>}
    </dialog>
  </section>;
}
