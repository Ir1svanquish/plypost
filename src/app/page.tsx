"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  CircleAlert,
  Clock3,
  Copy,
  FilePenLine,
  RotateCcw,
  Send,
  UserRound,
  WandSparkles,
} from "lucide-react";
import { adaptDraft, characterCount, isPlatformId, platformIds, platforms, type PlatformId } from "@/lib/platforms";
import { validatePlatformText } from "@/lib/platform-validation";
import { DraftLibraryPanel } from "@/components/workspace-panels";
import { ServerSchedulePanel } from "@/components/server-schedule-panel";
import { AssistedPublishPanel } from "@/components/assisted-publish-panel";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { AccountPanel } from "@/components/account-panel";
import { PlatformPreview } from "@/components/platform-preview";
import { ImageAttachmentPicker } from "@/components/image-attachments";
import { MastodonLivePanel, isMastodonConnection, type MastodonConnection } from "@/components/mastodon-live-panel";
import { assistedDestinations, type AssistedDestinationId } from "@/lib/assisted";
import { WORKSPACE_KEY, draftTitle, emptyWorkspace, parseWorkspace, type AssistedPost, type SavedDraft, type ScheduledPost } from "@/lib/workspace";

const sampleDraft =
  "A good idea deserves more than a copy-paste post.\n\nShape one message for every corner of the internet. Pick your channels, fine-tune each version, and share with confidence.";
const legacySampleDraft =
  "A good idea deserves more than a copy-paste post.\n\nSocialFlow helps you shape one draft for every corner of the internet. Pick your channels, fine-tune each version, and share with confidence.";
const interimSampleDraft =
  "A good idea deserves more than a copy-paste post.\n\nsoflow helps you shape one draft for every corner of the internet. Pick your channels, fine-tune each version, and share with confidence.";

type Provider = "nvidia" | "nebius";
type WorkspaceView = "compose" | "drafts" | "schedule" | "assisted" | "account";
const viewLabels: Record<WorkspaceView, string> = {
  compose: "Create", drafts: "Drafts", schedule: "Plan", assisted: "Assisted", account: "Account",
};

function viewFromHash(): WorkspaceView {
  const hash = window.location.hash.slice(1);
  if (hash === "activity") return "account";
  return hash === "drafts" || hash === "schedule" || hash === "assisted" || hash === "account" ? hash : "compose";
}
type Receipt = {
  platform: PlatformId;
  id: string;
  status: "simulated";
  publishedAt: string;
  content: string;
};
type Notice = { kind: "success" | "error"; text: string } | null;

const platformGlyphs: Record<PlatformId, string> = {
  bluesky: "✦",
  mastodon: "m",
  linkedin: "in",
  threads: "@",
};

function PlatformMark({ id, size = "normal" }: { id: PlatformId; size?: "small" | "normal" }) {
  const colors: Record<PlatformId, string> = {
    bluesky: "bg-[var(--info-soft)] text-[var(--info)]",
    mastodon: "bg-[var(--accent-soft)] text-[var(--accent-text)]",
    linkedin: "bg-[var(--info-soft)] text-[var(--info)]",
    threads: "bg-[var(--surface-muted)] text-[var(--text)]",
  };
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-xl font-bold ${colors[id]} ${size === "small" ? "h-7 w-7 text-[14px]" : "h-10 w-10 text-[18px]"}`}
    >
      {platformGlyphs[id]}
    </span>
  );
}

function WorkspaceApp({ email, onLogout }: { email: string; onLogout: () => void }) {
  const [view, setView] = useState<WorkspaceView>("compose");
  const [source, setSource] = useState(sampleDraft);
  const [selected, setSelected] = useState<PlatformId[]>([...platformIds]);
  const [active, setActive] = useState<PlatformId>("bluesky");
  const [variants, setVariants] = useState<Partial<Record<PlatformId, string>>>({});
  const [mediaIds, setMediaIds] = useState<string[]>([]);
  const [mediaPickerEpoch, setMediaPickerEpoch] = useState(0);
  const mediaPickerEpochRef = useRef(0);
  const mediaBusyRef = useRef(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [aiUndo, setAiUndo] = useState<Partial<Record<PlatformId, string>> | null>(null);
  const editorRevision = useRef(0);
  const [provider, setProvider] = useState<Provider>("nvidia");
  const [notice, setNotice] = useState<Notice>(null);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [activity, setActivity] = useState<Receipt[]>([]);
  const [drafts, setDrafts] = useState<SavedDraft[]>([]);
  const [schedule, setSchedule] = useState<ScheduledPost[]>([]);
  const [assisted, setAssisted] = useState<AssistedPost[]>([]);
  const [assistedBusy, setAssistedBusy] = useState(false);
  const assistedMutation = useRef(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const backupMutation = useRef(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const restoringBackupRef = useRef(false);
  const restoreOverlayRef = useRef<HTMLDivElement>(null);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const initialWorkspaceLoad = useRef(true);
  const pendingNotificationIds = useRef(new Set<string>());
  const [assistDestination, setAssistDestination] = useState<AssistedDestinationId>("x");
  const [assistOverride, setAssistOverride] = useState<string | null>(null);
  const [assistTime, setAssistTime] = useState("");
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [title, setTitle] = useState("");
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const [scheduleTime, setScheduleTime] = useState("");
  const [runningId, setRunningId] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState(false);
  const [now, setNow] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [legacyWorkspace, setLegacyWorkspace] = useState<ReturnType<typeof emptyWorkspace> | null>(null);
  const [auditLog, setAuditLog] = useState<{ action: string; subject_id: string | null; detail: string | null; created_at: string }[]>([]);
  const [workerLastSeen, setWorkerLastSeen] = useState<string | null>(null);
  const [mastodonConnection, setMastodonConnection] = useState<MastodonConnection | null>(null);
  const [mastodonLoading, setMastodonLoading] = useState(true);
  const [mastodonError, setMastodonError] = useState<string | null>(null);

  useEffect(() => {
    const syncView = () => setView(viewFromHash());
    syncView();
    window.addEventListener("hashchange", syncView);
    window.addEventListener("popstate", syncView);
    return () => {
      window.removeEventListener("hashchange", syncView);
      window.removeEventListener("popstate", syncView);
    };
  }, []);

  function openView(next: WorkspaceView) {
    setView(next);
    if (window.location.hash !== `#${next}`) window.history.pushState(null, "", `#${next}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function refreshMastodonConnection() {
    setMastodonLoading(true);
    setMastodonError(null);
    try {
      const response = await fetch("/api/mastodon/connection", { cache: "no-store" });
      const data: unknown = await response.json();
      if (!response.ok || !isMastodonConnection(data)) {
        const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "Could not load Mastodon connection.";
        throw new Error(message);
      }
      setMastodonConnection(data);
    } catch (cause) {
      setMastodonError(cause instanceof Error ? cause.message : "Could not load Mastodon connection.");
    } finally {
      setMastodonLoading(false);
    }
  }

  useEffect(() => {
    void refreshMastodonConnection();
    const refreshOnFocus = () => { void refreshMastodonConnection(); };
    window.addEventListener("focus", refreshOnFocus);
    const url = new URL(window.location.href);
    const result = url.searchParams.get("mastodon");
    if (result === "connected" || result === "error") {
      setNotice(result === "connected"
        ? { kind: "success", text: "Mastodon connection completed. Check the account shown in Account before live posting." }
        : { kind: "error", text: "Mastodon connection did not complete. Open Account to try again." });
      url.searchParams.delete("mastodon");
      window.history.replaceState(null, "", url.toString());
      if (result === "connected") setView("account");
    }
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, []);

  useEffect(() => {
    if (restoringBackup) restoreOverlayRef.current?.focus();
  }, [restoringBackup]);

  async function refreshWorkspace() {
    const response = await fetch("/api/workspace", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load your server workspace.");
    const data = await response.json();
    setDrafts(data.drafts);
    setSchedule(data.schedule);
    setAssisted(data.assisted);
    setAuditLog(data.log);
    setWorkerLastSeen(data.workerLastSeen);
    return data;
  }

  async function changeWorkspace(action: string, extra: Record<string, unknown>) {
    if (restoringBackupRef.current) throw new Error("Wait for the full backup restore to finish.");
    const response = await fetch("/api/workspace", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not update workspace.");
    setDrafts(data.drafts);
    setSchedule(data.schedule);
    setAssisted(data.assisted);
    setAuditLog(data.log);
    setWorkerLastSeen(data.workerLastSeen);
    return data;
  }

  useEffect(() => {
    let browserAssisted: AssistedPost[] = [];
    try {
      const saved = localStorage.getItem("socialflow-mvp");
      if (saved) {
        const data = JSON.parse(saved) as {
          source?: unknown;
          selected?: unknown;
          variants?: unknown;
          provider?: unknown;
          activity?: unknown;
          title?: unknown;
          currentDraftId?: unknown;
          mediaIds?: unknown;
        };
        if (typeof data.source === "string") {
          const hasCustomVariants = data.variants && typeof data.variants === "object" &&
            Object.values(data.variants).some((value) => typeof value === "string");
          const isStarterText = data.source === legacySampleDraft || data.source === interimSampleDraft;
          setSource(isStarterText && !hasCustomVariants && typeof data.currentDraftId !== "string" ? sampleDraft : data.source);
        }
        if (Array.isArray(data.selected)) {
          setSelected(data.selected.filter((id): id is PlatformId => platformIds.includes(id)));
        }
        if (data.variants && typeof data.variants === "object") {
          const safe: Partial<Record<PlatformId, string>> = {};
          for (const id of platformIds) {
            const value = (data.variants as Record<string, unknown>)[id];
            if (typeof value === "string") safe[id] = value;
          }
          setVariants(safe);
        }
        if (data.provider === "nvidia" || data.provider === "nebius") setProvider(data.provider);
        if (Array.isArray(data.activity)) setActivity(data.activity.slice(0, 12));
        if (typeof data.title === "string") setTitle(data.title.slice(0, 120));
        if (typeof data.currentDraftId === "string") setCurrentDraftId(data.currentDraftId);
        if (Array.isArray(data.mediaIds) && data.mediaIds.length <= 4 && data.mediaIds.every((id) => typeof id === "string")) setMediaIds(data.mediaIds);
      }
    } catch {
      // A malformed local draft should never prevent the editor from opening.
    }
    try {
      const workspace = parseWorkspace(JSON.parse(localStorage.getItem(WORKSPACE_KEY) || "null")) ?? emptyWorkspace();
      if (workspace.drafts.length || workspace.schedule.length) setLegacyWorkspace({ ...workspace, assisted: [] });
      browserAssisted = workspace.assisted;
    } catch {
      // Keep the editor usable if the browser holds an invalid workspace backup.
    }
    setHydrated(true);
    if ("Notification" in window) setNotificationPermission(Notification.permission);
    void (async () => {
      try {
        await refreshWorkspace();
        if (browserAssisted.length) {
          await changeWorkspace("migrate-assisted", { items: browserAssisted });
          const previous = parseWorkspace(JSON.parse(localStorage.getItem(WORKSPACE_KEY) || "null")) ?? emptyWorkspace();
          localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ ...previous, assisted: [] }));
        }
        setWorkspaceReady(true);
      } catch {
        setNotice({ kind: "error", text: "Could not load or move browser items into your account. Your browser copy was kept." });
      } finally {
        initialWorkspaceLoad.current = false;
      }
    })();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem("socialflow-mvp", JSON.stringify({ source, selected, variants, mediaIds, provider, activity, title, currentDraftId }));
      setStorageWarning(false);
    } catch {
      setStorageWarning(true);
    }
  }, [source, selected, variants, mediaIds, provider, activity, title, currentDraftId, hydrated]);

  useEffect(() => {
    const timer = window.setInterval(() => { if (!initialWorkspaceLoad.current) void refreshWorkspace().then(() => setWorkspaceReady(true)).catch(() => {}); }, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!hydrated || !workspaceReady || !now || notificationPermission !== "granted") return;
    const due = assisted.filter((item) => item.status === "queued" && !item.notifiedAt && !pendingNotificationIds.current.has(item.id) && Date.parse(item.scheduledFor) <= now);
    if (!due.length) return;
    try {
      new Notification("Plypost publishing reminder", {
        body: due.length === 1 ? `${assistedDestinations[due[0].destination].name}: ${due[0].title}` : `${due.length} posts are ready for your review.`,
        tag: "socialflow-assisted-due",
      });
      for (const item of due) pendingNotificationIds.current.add(item.id);
      void changeWorkspace("mark-assisted-notified", { ids: due.map((item) => item.id) }).catch(() => {
        setNotice({ kind: "error", text: "Reminder was shown, but its status could not be saved. Check the server connection." });
      });
    } catch {
      setNotificationPermission("unsupported");
    }
  }, [assisted, hydrated, workspaceReady, now, notificationPermission]);

  const textFor = (id: PlatformId) => variants[id] ?? adaptDraft(source, id);
  const currentText = textFor(active);
  const currentValidation = validatePlatformText(active, currentText);
  const currentCount = currentValidation.count;
  const invalidSelected = selected.filter(
    (id) => !validatePlatformText(id, textFor(id)).valid,
  );
  const canPublish = selected.length > 0 && invalidSelected.length === 0 && !publishing;
  const suggestedAssistText = isPlatformId(assistDestination) ? textFor(assistDestination) : source;
  const assistText = assistOverride ?? suggestedAssistText;

  function togglePlatform(id: PlatformId) {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
    setActive(id);
    setNotice(null);
  }

  async function generateVariants() {
    if (!source.trim()) {
      setNotice({ kind: "error", text: "Add a source draft before asking AI to adapt it." });
      return;
    }
    if (platformIds.some((id) => variants[id] !== undefined) && !window.confirm("Replace the current platform drafts with new AI versions? You can undo this change afterward.")) return;
    const revisionAtStart = editorRevision.current;
    const previousVariants = { ...variants };
    setGenerating(true);
    setNotice(null);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, provider }),
      });
      const data: { error?: string; variants?: Record<PlatformId, string>; overLimit?: { platform: PlatformId; count: number; limit: number; byteCount?: number; byteLimit?: number }[] } = await response.json();
      if (!response.ok) throw new Error(data.error || "AI adaptation failed.");
      if (!data.variants) throw new Error("AI adaptation returned no drafts.");
      if (editorRevision.current !== revisionAtStart) {
        setNotice({ kind: "error", text: "The editor changed while AI was working, so your edits were kept. Generate again when ready." });
        return;
      }
      setAiUndo(previousVariants);
      setVariants(data.variants);
      const overLimit = data.overLimit ?? [];
      setNotice(overLimit.length ? {
        kind: "error",
        text: `AI drafts are ready, but ${overLimit.map(({ platform, count, limit, byteCount, byteLimit }) =>
          byteCount !== undefined && byteLimit !== undefined
            ? `${platforms[platform].name} is ${byteCount}/${byteLimit} bytes`
            : `${platforms[platform].name} is ${count}/${limit} characters`).join("; ")}. Shorten them before sharing.`,
      } : { kind: "success", text: "Four platform drafts are ready to review and edit." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "AI adaptation failed." });
    } finally {
      setGenerating(false);
    }
  }

  async function simulatePublish() {
    if (!canPublish) return;
    setPublishing(true);
    setNotice(null);
    try {
      const posts = Object.fromEntries(selected.map((id) => [id, textFor(id)]));
      const response = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posts }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Simulation failed.");
      setActivity((current) => [...data.results, ...current].slice(0, 12));
      setNotice({
        kind: "success",
        text: `Simulated ${data.results.length} post${data.results.length === 1 ? "" : "s"}. No external platform was contacted.`,
      });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Simulation failed." });
    } finally {
      setPublishing(false);
    }
  }

  async function saveDraft() {
    if (mediaBusyRef.current) {
      setNotice({ kind: "error", text: "Wait for the image operation to finish before saving this draft." });
      return;
    }
    if (!source.trim()) {
      setNotice({ kind: "error", text: "Write a source draft before saving it." });
      return;
    }
    if (!currentDraftId && drafts.length >= 100) {
      setNotice({ kind: "error", text: "The library is full. Delete an old draft before saving another." });
      return;
    }
    const stamp = new Date().toISOString();
    const existing = drafts.find((draft) => draft.id === currentDraftId);
    const saved: SavedDraft = {
      id: existing?.id ?? crypto.randomUUID(),
      title: draftTitle(title, source),
      source,
      selected: [...selected],
      variants: { ...variants },
      mediaIds: [...mediaIds],
      createdAt: existing?.createdAt ?? stamp,
      updatedAt: stamp,
    };
    try {
      await changeWorkspace("save-draft", { item: saved });
      setCurrentDraftId(saved.id);
      setTitle(saved.title);
      setNotice({ kind: "success", text: "Draft saved to your account." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not save draft." });
    }
  }

  function resetMediaPicker() {
    mediaPickerEpochRef.current += 1;
    setMediaPickerEpoch(mediaPickerEpochRef.current);
    mediaBusyRef.current = false;
    setMediaBusy(false);
  }

  function newDraft() {
    editorRevision.current += 1;
    resetMediaPicker();
    setAiUndo(null);
    setCurrentDraftId(null);
    setTitle("");
    setSource("");
    setVariants({});
    setMediaIds([]);
    setSelected([...platformIds]);
    setActive("bluesky");
    setNotice(null);
    openView("compose");
  }

  function loadDraft(draft: SavedDraft) {
    editorRevision.current += 1;
    resetMediaPicker();
    setAiUndo(null);
    setCurrentDraftId(draft.id);
    setTitle(draft.title);
    setSource(draft.source);
    setSelected(draft.selected);
    setVariants(draft.variants);
    setMediaIds(draft.mediaIds ?? []);
    setActive(draft.selected[0] ?? "bluesky");
    setNotice({ kind: "success", text: `Opened “${draft.title}”. Changes will be saved when you click Update draft.` });
    openView("compose");
  }

  async function deleteDraft(id: string) {
    if (!window.confirm("Delete this saved draft from your account?")) return;
    try {
      await changeWorkspace("delete-draft", { id });
      if (currentDraftId === id) setCurrentDraftId(null);
      setNotice({ kind: "success", text: "Saved draft deleted. The current editor was kept." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not delete draft." });
    }
  }

  async function addToPlan() {
    if (mediaBusyRef.current) {
      setNotice({ kind: "error", text: "Wait for the image operation to finish before adding this plan item." });
      return;
    }
    const scheduledFor = new Date(scheduleTime);
    if (!scheduleTime || !Number.isFinite(scheduledFor.getTime()) || scheduledFor.getTime() <= Date.now() + 10_000) {
      setNotice({ kind: "error", text: "Choose a local date and time at least 10 seconds ahead." });
      return;
    }
    if (!source.trim() || selected.length === 0 || invalidSelected.length > 0) {
      setNotice({ kind: "error", text: "Choose destinations and fix empty or over-limit drafts first." });
      return;
    }
    if (schedule.length >= 100) {
      setNotice({ kind: "error", text: "The plan is full. Remove an old item before adding another." });
      return;
    }
    const post: ScheduledPost = {
      id: crypto.randomUUID(),
      title: draftTitle(title, source),
      source,
      posts: Object.fromEntries(selected.map((id) => [id, textFor(id)])),
      mediaIds: [...mediaIds],
      scheduledFor: scheduledFor.toISOString(),
      createdAt: new Date().toISOString(),
      status: "queued",
    };
    try {
      await changeWorkspace("add-schedule", { item: post, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });
      setScheduleTime("");
      setNotice({ kind: "success", text: "Added to this computer's plan. The worker will simulate it when due." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not add plan item." });
    }
  }

  function loadScheduled(post: ScheduledPost) {
    editorRevision.current += 1;
    resetMediaPicker();
    setAiUndo(null);
    setCurrentDraftId(null);
    setTitle(post.title);
    setSource(post.source);
    setSelected(platformIds.filter((id) => post.posts[id] !== undefined));
    setVariants({ ...post.posts });
    setMediaIds(post.mediaIds ?? []);
    setActive(platformIds.find((id) => post.posts[id] !== undefined) ?? "bluesky");
    setNotice({ kind: "success", text: "Opened a copy of the planned post. The plan snapshot is unchanged." });
    openView("compose");
  }

  async function runScheduled(post: ScheduledPost) {
    if (runningId || post.status !== "failed") return;
    setRunningId(post.id);
    setNotice(null);
    try {
      await changeWorkspace("retry-schedule", { id: post.id });
      setNotice({ kind: "success", text: "Queued for another simulation attempt." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Simulation failed." });
    } finally {
      setRunningId(null);
    }
  }

  async function rescheduleScheduled(post: ScheduledPost, scheduledForIso: string): Promise<void> {
    if (runningId) throw new Error("Another plan update is in progress.");
    setRunningId(post.id);
    try {
      await changeWorkspace("reschedule-schedule", {
        id: post.id,
        scheduledFor: scheduledForIso,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      });
      setNotice({ kind: "success", text: post.receipts?.length
        ? "Moved the remaining simulation to the new time. Existing simulated receipts were kept."
        : "Plan item moved to the new time." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not move plan item." });
      throw error;
    } finally {
      setRunningId(null);
    }
  }

  async function removeScheduled(id: string) {
    if (!window.confirm("Remove this item from your plan?")) return;
    try {
      await changeWorkspace("delete-schedule", { id });
      setNotice({ kind: "success", text: "Item removed from your plan." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not remove item." });
    }
  }

  function exportWorkspace() {
    const backup = new Blob([JSON.stringify({ version: 3, drafts, schedule, assisted }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(backup);
    const link = document.createElement("a");
    link.href = url;
    link.download = `plypost-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice({ kind: "success", text: "Text JSON exported without image files. Use Download full backup to include them." });
  }

  async function downloadFullBackup() {
    if (backupMutation.current) return;
    backupMutation.current = true;
    setBackupBusy(true);
    try {
      const response = await fetch("/api/backup", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Could not prepare the full backup.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `plypost-full-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setNotice({ kind: "success", text: "Full backup downloaded with your saved images. Keep the file private." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not download the full backup." });
    } finally {
      backupMutation.current = false;
      setBackupBusy(false);
    }
  }

  async function restoreFullBackup(file: File) {
    if (backupMutation.current) return;
    if (mediaBusyRef.current) {
      setNotice({ kind: "error", text: "Wait for the current image operation before restoring a backup." });
      return;
    }
    if (!file.size || file.size > 128 * 1024 * 1024) {
      setNotice({ kind: "error", text: "Choose a full backup no larger than 128 MiB." });
      return;
    }
    if (!window.confirm("Replace this account's saved drafts, plan, assisted posts and images with this full backup? This cannot be undone.")) return;
    backupMutation.current = true;
    setBackupBusy(true);
    restoringBackupRef.current = true;
    setRestoringBackup(true);
    let restored = false;
    try {
      const response = await fetch("/api/backup", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: file,
        cache: "no-store", credentials: "same-origin",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Could not restore the full backup.");
      }
      restored = true;
      setCurrentDraftId(null);
      setMediaIds([]);
      resetMediaPicker();
      try { localStorage.setItem(WORKSPACE_KEY, JSON.stringify(emptyWorkspace())); } catch { setStorageWarning(true); }
      setLegacyWorkspace(null);
      await refreshWorkspace();
      setNotice({ kind: "success", text: "Full backup restored. Saved drafts, plans, handoffs and images are available in this account." });
    } catch (error) {
      setNotice({ kind: "error", text: restored
        ? "Full backup was restored, but the view could not refresh. Reload to see the saved work."
        : error instanceof Error ? error.message : "Could not restore the full backup." });
    } finally {
      restoringBackupRef.current = false;
      setRestoringBackup(false);
      backupMutation.current = false;
      setBackupBusy(false);
    }
  }

  async function importWorkspace(file: File) {
    try {
      if (file.size > 2_000_000) throw new Error("Backup file is too large (2 MB maximum).");
      const raw = JSON.parse(await file.text());
      const workspace = parseWorkspace(raw);
      if (!workspace || !Array.isArray(raw.drafts) || !Array.isArray(raw.schedule) ||
          workspace.drafts.length !== raw.drafts.length || workspace.schedule.length !== raw.schedule.length ||
          (raw.version === 3 && (!Array.isArray(raw.assisted) || workspace.assisted.length !== raw.assisted.length))) {
        throw new Error("This backup has invalid or excess records. Nothing was replaced.");
      }
      if (!window.confirm("Replace your account's drafts, publishing plan, and assisted posts with this JSON backup? Images are not in the file, so drafts referencing images require those images in this account's database.")) return;
      await changeWorkspace("import", { backup: raw });
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify(emptyWorkspace()));
      setLegacyWorkspace(null);
      setCurrentDraftId(null);
      setNotice({ kind: "success", text: `Imported ${workspace.drafts.length} drafts, ${workspace.schedule.length} planned items, and ${workspace.assisted.length} assisted posts.` });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not import backup." });
    }
  }

  async function importLegacyWorkspace() {
    if (!legacyWorkspace) return;
    if (!window.confirm("Move the browser's saved drafts and plan into your account? This replaces the account library and overdue queued items may be simulated by the worker.")) return;
    try {
      await changeWorkspace("import-legacy", { backup: legacyWorkspace });
      const previous = parseWorkspace(JSON.parse(localStorage.getItem(WORKSPACE_KEY) || "null")) ?? emptyWorkspace();
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ ...emptyWorkspace(), assisted: previous.assisted }));
      setLegacyWorkspace(null);
      setNotice({ kind: "success", text: "Browser drafts and plan moved into your account." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not import browser data." });
    }
  }

  async function copyCurrent() {
    try {
      await navigator.clipboard.writeText(currentText);
      setNotice({ kind: "success", text: `${platforms[active].name} draft copied to clipboard.` });
    } catch {
      setNotice({ kind: "error", text: "Clipboard access is unavailable in this browser." });
    }
  }

  async function runAssistedAction(action: string, extra: Record<string, unknown>, success: string): Promise<boolean> {
    if (assistedMutation.current) return false;
    assistedMutation.current = true;
    setAssistedBusy(true);
    try {
      await changeWorkspace(action, extra);
      setNotice({ kind: "success", text: success });
      return true;
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not update assisted publishing." });
      return false;
    } finally {
      assistedMutation.current = false;
      setAssistedBusy(false);
    }
  }

  async function addAssistedPost() {
    if (mediaBusyRef.current) {
      setNotice({ kind: "error", text: "Wait for the image operation to finish before saving this handoff." });
      return;
    }
    const text = assistText.trim();
    const scheduledFor = assistTime ? new Date(assistTime) : new Date();
    if (!text || characterCount(text) > 5000) {
      setNotice({ kind: "error", text: "Add text of up to 5,000 characters before saving." });
      return;
    }
    if (isPlatformId(assistDestination)) {
      const validation = validatePlatformText(assistDestination, text);
      if (!validation.valid) {
        setNotice({ kind: "error", text: validation.issues.find((issue) => issue.severity === "error")?.message ?? "Review the platform draft before saving." });
        return;
      }
    }
    if (!Number.isFinite(scheduledFor.getTime()) || (assistTime && scheduledFor.getTime() <= Date.now())) {
      setNotice({ kind: "error", text: "Choose a future reminder time, or leave it blank for now." });
      return;
    }
    if (assisted.length >= 100) {
      setNotice({ kind: "error", text: "The assisted publishing list is full. Remove an old item first." });
      return;
    }
    const item: AssistedPost = {
      id: crypto.randomUUID(),
      title: draftTitle(title, text),
      destination: assistDestination,
      text,
      mediaIds: [...mediaIds],
      scheduledFor: scheduledFor.toISOString(),
      createdAt: new Date().toISOString(),
      status: "queued",
      ...(!assistTime ? { notifiedAt: new Date().toISOString() } : {}),
    };
    if (await runAssistedAction("add-assisted", { item }, `Added ${assistedDestinations[assistDestination].name} to your assisted publishing list. You will publish it yourself.`)) {
      setNow(Date.now());
      setAssistTime("");
    }
  }

  async function copyAssisted(text: string, destination: AssistedDestinationId) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice({ kind: "success", text: `${assistedDestinations[destination].name} text copied. Open the platform and paste it there.` });
    } catch {
      setNotice({ kind: "error", text: "Clipboard access is unavailable. Expand Review saved text to select it manually." });
    }
  }

  async function markAssistedPosted(id: string) {
    await runAssistedAction("set-assisted-status", { id, status: "posted" }, "Marked as posted by you. Plypost did not verify the platform post.");
  }

  async function undoAssistedPosted(id: string) {
    await runAssistedAction("set-assisted-status", { id, status: "queued" }, "Post returned to your assisted publishing checklist.");
  }

  async function removeAssisted(id: string) {
    if (!window.confirm("Remove this assisted post from your account?")) return;
    await runAssistedAction("delete-assisted", { id }, "Assisted post removed from your account.");
  }

  async function enableNotifications() {
    if (!("Notification" in window)) return;
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission !== "granted") setNotice({ kind: "error", text: "Browser alerts were not enabled. Due posts will still appear in this page." });
  }

  return (
    <>
    <div inert={restoringBackup} className="app-shell min-h-screen lg:flex">
      <aside className="app-sidebar sidebar-glow hidden w-[232px] shrink-0 flex-col border-r px-4 py-7 lg:sticky lg:top-0 lg:flex lg:h-screen">
        <a href="#compose" onClick={(event) => { event.preventDefault(); openView("compose"); }} className="flex items-center gap-3 px-2" aria-label="Plypost home">
          <Image src="/plypost-mark.svg" alt="" width={40} height={40} className="h-10 w-10 shrink-0" />
          <span className="text-[21px] font-bold tracking-[-0.055em]">Plypost<span className="sidebar-accent">.</span></span>
        </a>
        <div className="sidebar-muted mt-12 px-3 text-[11px] font-bold uppercase tracking-[0.17em]">Workspace</div>
        <nav className="mt-4 space-y-1" aria-label="Main navigation">
          <a href="#compose" onClick={(event) => { event.preventDefault(); openView("compose"); }} aria-current={view === "compose" ? "page" : undefined} className="sidebar-link sidebar-subtle flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[14px] font-medium transition"><FilePenLine size={18} /> Create</a>
          <a href="#drafts" onClick={(event) => { event.preventDefault(); openView("drafts"); }} aria-current={view === "drafts" ? "page" : undefined} className="sidebar-link sidebar-subtle flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[14px] font-medium transition"><FilePenLine size={18} /> Drafts <span className="ml-auto text-[11px] tabular-nums opacity-70">{drafts.length}</span></a>
          <a href="#schedule" onClick={(event) => { event.preventDefault(); openView("schedule"); }} aria-current={view === "schedule" ? "page" : undefined} className="sidebar-link sidebar-subtle flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[14px] font-medium transition"><Clock3 size={18} /> Plan</a>
          <a href="#assisted" onClick={(event) => { event.preventDefault(); openView("assisted"); }} aria-current={view === "assisted" ? "page" : undefined} className="sidebar-link sidebar-subtle flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[14px] font-medium transition"><Copy size={18} /> Assisted</a>
          <a href="#account" onClick={(event) => { event.preventDefault(); openView("account"); }} aria-current={view === "account" ? "page" : undefined} className="sidebar-link sidebar-subtle flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[14px] font-medium transition"><UserRound size={18} /> Account</a>
        </nav>
        <div className="sidebar-footer mt-auto border-t px-3 pt-5">
          <p className="sidebar-muted text-[12px] leading-5">Your space for drafts, plans and assisted posts.</p>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="app-header sticky top-0 z-30 flex min-h-[66px] items-center justify-between gap-3 border-b px-5 sm:px-8 lg:px-10">
          <div className="flex items-center gap-2.5 lg:hidden"><Image src="/plypost-mark.svg" alt="" width={32} height={32} className="h-8 w-8 shrink-0" /><span className="text-[18px] font-bold tracking-[-0.05em]">Plypost<span className="text-[var(--accent-text)]">.</span></span></div>
          <div className="hidden items-center gap-2 text-[13px] text-[var(--text-muted)] lg:flex"><span>Workspace</span><span>/</span><span className="font-semibold text-[var(--text)]">{viewLabels[view]}</span></div>
          <div className="ml-auto flex items-center gap-3"><ThemeSwitcher /><button type="button" onClick={() => openView("account")} aria-label="Open account" className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] text-[var(--text-secondary)]"><UserRound size={17} /></button></div>
        </header>
        <nav className="mobile-nav app-header sticky top-[66px] z-20 flex gap-5 overflow-x-auto border-b px-5 text-[12px] font-semibold text-[var(--text-secondary)] sm:px-8 lg:hidden" aria-label="Mobile navigation">
          <a className="shrink-0 py-3" href="#compose" onClick={(event) => { event.preventDefault(); openView("compose"); }} aria-current={view === "compose" ? "page" : undefined}>Create</a>
          <a className="shrink-0 py-3" href="#drafts" onClick={(event) => { event.preventDefault(); openView("drafts"); }} aria-current={view === "drafts" ? "page" : undefined}>Drafts</a>
          <a className="shrink-0 py-3" href="#schedule" onClick={(event) => { event.preventDefault(); openView("schedule"); }} aria-current={view === "schedule" ? "page" : undefined}>Plan</a>
          <a className="shrink-0 py-3" href="#assisted" onClick={(event) => { event.preventDefault(); openView("assisted"); }} aria-current={view === "assisted" ? "page" : undefined}>Assisted</a>
          <a className="shrink-0 py-3" href="#account" onClick={(event) => { event.preventDefault(); openView("account"); }} aria-current={view === "account" ? "page" : undefined}>Account</a>
        </nav>

        <main className="app-main mx-auto px-5 pb-16 pt-6 sm:px-8 lg:px-10 lg:pt-8">
          {view === "schedule" && schedule.some((post) => post.status === "queued") && (!workerLastSeen || now - Date.parse(workerLastSeen) > 30_000) && <div role="status" className="mb-5 rounded-xl border border-[var(--warning)] bg-[var(--warning-soft)] px-4 py-3 text-[13px] text-[var(--warning)]">Simulation worker is offline. Start <code>npm run worker</code> on this computer to process scheduled items.</div>}
          {legacyWorkspace && <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] px-4 py-3 text-[13px] text-[var(--text-secondary)]"><span>Found {legacyWorkspace.drafts.length} browser drafts and {legacyWorkspace.schedule.length} planned items from the earlier version.</span><button type="button" onClick={importLegacyWorkspace} className="font-bold text-[var(--accent-text)]">Move into account →</button></div>}
          {view === "compose" && <div id="compose" className="section-anchor">
          <div className="mb-6">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--accent-text)]">Create</p>
            <h1 className="text-[29px] font-bold tracking-[-0.045em] text-[var(--text)] sm:text-[34px]">Shape your next post</h1>
            <p className="mt-1 text-[14px] text-[var(--text-muted)]">Write once, choose channels, then review each version.</p>
          </div>
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(370px,.95fr)]">
            <div className="min-w-0 space-y-6">
              <section className="panel-border soft-shadow overflow-hidden rounded-[18px] bg-[var(--surface)]" aria-labelledby="draft-heading">
                <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-6 py-5 sm:px-7">
                  <div><h2 id="draft-heading" className="text-[17px] font-bold tracking-[-0.025em]">Draft editor</h2><p className="mt-1 text-[13px] text-[var(--text-muted)]">Your message and its destinations, in one place.</p></div>
                  <button type="button" onClick={newDraft} className="shrink-0 text-[12px] font-semibold text-[var(--accent-text)]">New draft</button>
                </div>
                <div className="p-6 sm:p-7">
                  <label htmlFor="draft-name" className="mb-2 block text-[12px] font-bold text-[var(--text-secondary)]">Draft name <span className="font-normal text-[var(--text-soft)]">(optional)</span></label>
                  <input id="draft-name" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="Give this idea a name" className="mb-5 w-full rounded-xl border border-[var(--line)] bg-[var(--field)] px-4 py-3 text-[14px] outline-none focus:border-[var(--accent-border)]" />
                  <label htmlFor="source-draft" className="mb-2 block text-[13px] font-bold text-[var(--text)]">Your message</label>
                  <textarea id="source-draft" value={source} onChange={(event) => { editorRevision.current += 1; setSource(event.target.value); setNotice(null); }} placeholder="What's on your mind? Add a launch update, insight, or idea to share..." maxLength={3000} className="min-h-[194px] w-full resize-y rounded-[15px] border border-[var(--line)] bg-[var(--field)] px-4 py-4 text-[15px] leading-[1.75] text-[var(--text)] outline-none transition placeholder:text-[var(--text-soft)] focus:border-[var(--accent-border)] focus:bg-[var(--surface)] focus:ring-[3px] focus:ring-[var(--accent-soft)]" />
                  <div className="mt-2 flex items-center justify-between text-[12px] text-[var(--text-soft)]"><span>Fine-tune each version in the preview.</span><span className="tabular-nums">{characterCount(source)} / 3,000</span></div>
                  <ImageAttachmentPicker
                    key={mediaPickerEpoch}
                    selectedIds={mediaIds}
                    disabled={restoringBackup}
                    onChange={(ids) => { if (mediaPickerEpochRef.current === mediaPickerEpoch) setMediaIds(ids); }}
                    onBusyChange={(busy) => {
                      if (mediaPickerEpochRef.current !== mediaPickerEpoch) return;
                      mediaBusyRef.current = busy;
                      setMediaBusy(busy);
                    }}
                  />
                  <div className="mt-6 border-t border-[var(--line)] pt-5">
                    <div className="mb-3 flex items-center justify-between"><h3 className="text-[13px] font-bold text-[var(--text)]">Destinations</h3><span className="text-[12px] text-[var(--text-muted)]">{selected.length} selected</span></div>
                    <div role="group" aria-label="Destinations" className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                      {platformIds.map((id) => {
                        const isSelected = selected.includes(id);
                        return <button key={id} type="button" aria-pressed={isSelected} onClick={() => togglePlatform(id)} className={`inline-flex min-w-0 items-center gap-1.5 rounded-xl border px-2 py-2 text-[12px] font-semibold transition sm:gap-2 sm:px-3 ${isSelected ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--text)]" : "border-[var(--line)] bg-[var(--field)] text-[var(--text-muted)] hover:border-[var(--accent-border)]"}`}><PlatformMark id={id} size="small" /><span className="min-w-0 truncate">{platforms[id].name}</span><span className={`ml-auto hidden h-4 w-4 shrink-0 items-center justify-center rounded border sm:flex ${isSelected ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--line)]"}`}>{isSelected && <Check size={11} strokeWidth={3} />}</span></button>;
                      })}
                    </div>
                  </div>
                  <details className="mt-6 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3">
                    <summary className="cursor-pointer text-[13px] font-bold text-[var(--text-secondary)]">Adapt with AI <span className="ml-1 text-[11px] font-normal text-[var(--text-soft)]">Optional · Nemotron</span></summary>
                    <div className="mt-4 flex flex-col gap-3 border-t border-[var(--line)] pt-4 sm:flex-row sm:items-end"><div className="relative min-w-0 flex-1"><label htmlFor="provider" className="mb-2 block text-[12px] font-bold text-[var(--text-secondary)]">AI provider</label><select id="provider" value={provider} onChange={(event) => setProvider(event.target.value as Provider)} className="w-full appearance-none rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 pr-9 text-[14px] font-semibold text-[var(--text)] outline-none focus:border-[var(--accent-border)]"><option value="nvidia">NVIDIA Nemotron</option><option value="nebius">Nebius Token Factory</option></select><ChevronDown size={15} className="pointer-events-none absolute bottom-3.5 right-3.5 text-[var(--text-soft)]" /></div><button type="button" onClick={generateVariants} disabled={generating || !source.trim()} className="gradient-button inline-flex h-[45px] shrink-0 items-center justify-center gap-2 rounded-xl px-5 text-[13px] font-bold text-white"><WandSparkles size={16} /> {generating ? "Adapting..." : "Generate variants"}</button></div>
                    {aiUndo && <button type="button" onClick={() => { editorRevision.current += 1; setVariants(aiUndo); setAiUndo(null); setNotice({ kind: "success", text: "Previous platform drafts restored." }); }} className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--accent-text)]"><RotateCcw size={13} /> Undo AI changes</button>}
                  </details>
                  <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-5"><button type="button" onClick={saveDraft} disabled={!source.trim() || mediaBusy} className="gradient-button inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-bold text-white"><FilePenLine size={15} />{mediaBusy ? "Working with images…" : currentDraftId ? "Update draft" : "Save draft"}</button><button type="button" onClick={() => openView("drafts")} className="text-[12px] font-semibold text-[var(--accent-text)]">View draft library →</button></div>
                </div>
              </section>
            </div>

            <div className="min-w-0 space-y-6 xl:sticky xl:top-6">
              <section className="panel-border soft-shadow overflow-hidden rounded-[18px] bg-[var(--surface)]" aria-labelledby="preview-heading">
                <div className="flex items-center justify-between border-b border-[var(--line)] px-6 py-5 sm:px-7"><div><h2 id="preview-heading" className="text-[17px] font-bold tracking-[-0.025em]">Platform preview</h2><p className="mt-1 text-[13px] text-[var(--text-muted)]">Review your text before sharing.</p></div><span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1.5 text-[11px] font-bold text-[var(--accent-text)]">EXAMPLE</span></div>
                <div className="mobile-x-scroll flex gap-1 border-b border-[var(--line)] px-4 sm:px-6" role="tablist" aria-label="Platform previews">{platformIds.map((id) => <button key={id} type="button" role="tab" aria-selected={active === id} onClick={() => setActive(id)} className={`relative flex shrink-0 items-center gap-1.5 px-3 py-4 text-[12px] font-semibold transition sm:text-[13px] ${active === id ? "text-[var(--accent-text)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}><span className={`${selected.includes(id) ? "" : "opacity-40"}`}>{platforms[id].name}</span>{active === id && <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-[var(--accent)]" />}</button>)}</div>
                <div className="dot-grid bg-[var(--surface-muted)] p-5 sm:p-7"><PlatformPreview platform={active} text={currentText} count={currentCount} limit={platforms[active].limit} /></div>
                {currentValidation.issues.length > 0 && <div role="status" className="space-y-2 px-6 pt-5 sm:px-7">
                  {currentValidation.issues.map((issue) => <p key={issue.code} className={`flex items-start gap-2 rounded-lg px-3 py-2 text-[12px] leading-5 ${issue.severity === "error" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--warning-soft)] text-[var(--warning)]"}`}>
                    <CircleAlert size={14} className="mt-0.5 shrink-0" />
                    <span>{issue.message}{issue.sourceUrl && <a href={issue.sourceUrl} target="_blank" rel="noopener noreferrer" className="ml-1 underline underline-offset-2">Platform guidance</a>}</span>
                  </p>)}
                </div>}
                <div className="px-6 pb-6 pt-5 sm:px-7 sm:pb-7"><div className="mb-2 flex items-center justify-between"><label htmlFor="platform-draft" className="text-[13px] font-bold text-[var(--text-secondary)]">Edit {platforms[active].name} draft</label><button type="button" onClick={() => { editorRevision.current += 1; setAiUndo(null); setVariants((current) => { const next = { ...current }; delete next[active]; return next; }); }} disabled={variants[active] === undefined} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent-text)] disabled:opacity-40"><RotateCcw size={12} /> Reset</button></div><textarea id="platform-draft" value={currentText} onChange={(event) => { editorRevision.current += 1; setAiUndo(null); setVariants((current) => ({ ...current, [active]: event.target.value })); }} className="min-h-[115px] w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--field)] px-3.5 py-3 text-[13px] leading-[1.65] text-[var(--text-secondary)] outline-none focus:border-[var(--accent-border)] focus:ring-[3px] focus:ring-[var(--accent-soft)]" /><div className="mt-2 flex items-center justify-between"><span className={`text-[12px] ${!currentValidation.valid ? "font-semibold text-[var(--danger)]" : "text-[var(--text-soft)]"}`}>{!currentValidation.valid ? "Needs attention" : variants[active] !== undefined ? "Custom version" : "Adapted from your draft"}</span><span className={`text-[12px] tabular-nums ${!currentValidation.valid ? "font-bold text-[var(--danger)]" : "text-[var(--text-muted)]"}`}>{currentCount} / {platforms[active].limit}</span></div><button type="button" onClick={copyCurrent} disabled={!currentText} className="mt-4 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--accent-text)] disabled:opacity-40"><Copy size={13} /> Copy this draft</button></div>
              </section>

              <section className="panel-border soft-shadow rounded-[18px] bg-[var(--surface)] p-6 sm:p-7" aria-labelledby="publish-heading"><div className="mb-5 flex items-center justify-between"><div><h2 id="publish-heading" className="text-[17px] font-bold tracking-[-0.025em]">Ready to share?</h2><p className="mt-1 text-[13px] text-[var(--text-muted)]">Review your selected drafts first.</p></div><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-text)]"><Send size={17} /></span></div><div className="mb-5 flex flex-wrap gap-2">{selected.length ? selected.map((id) => <span key={id} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--accent-soft)] px-2.5 py-1.5 text-[12px] font-semibold text-[var(--text-secondary)]"><PlatformMark id={id} size="small" /> {platforms[id].name}</span>) : <span className="text-[13px] text-[var(--text-soft)]">No destinations selected</span>}</div>{invalidSelected.length > 0 && <p className="mb-4 flex items-start gap-1.5 text-[12px] leading-5 text-[var(--danger)]"><CircleAlert size={14} className="mt-0.5 shrink-0" /> Review empty or over-limit drafts: {invalidSelected.map((id) => platforms[id].name).join(", ")}.</p>}<button type="button" onClick={simulatePublish} disabled={!canPublish} className="gradient-button flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-[14px] font-bold text-white shadow-lg shadow-indigo-300/40 transition"><Send size={16} /> {publishing ? "Simulating..." : `Simulate publish to ${selected.length || 0} platform${selected.length === 1 ? "" : "s"}`} <ArrowRight size={15} className="ml-1" /></button><p className="mt-3 text-center text-[12px] text-[var(--text-soft)]">The simulation button above never posts to a social platform.</p></section>
              {selected.includes("mastodon") && <MastodonLivePanel connection={mastodonConnection} connectionLoading={mastodonLoading} connectionError={mastodonError} selected active={active === "mastodon"} text={textFor("mastodon")} imageCount={mediaIds.length} mediaBusy={mediaBusy} onOpenAccount={() => openView("account")} />}
            </div>
          </div>
          </div>}

          {notice && <div role="status" className={`fixed bottom-4 left-4 right-4 z-50 flex items-start gap-2 rounded-xl border px-4 py-3 text-[13px] leading-5 shadow-xl sm:left-auto sm:max-w-md ${notice.kind === "success" ? "border-[var(--positive)] bg-[var(--positive-soft)] text-[var(--positive)]" : "border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)]"}`}>{notice.kind === "success" ? <CheckCheck size={16} className="shrink-0" /> : <CircleAlert size={16} className="shrink-0" />}{notice.text}</div>}

          {storageWarning && <div role="alert" className="mt-6 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-[13px] text-[var(--danger)]">Browser storage is unavailable. Unsaved editor text and assisted checklists may not survive a reload.</div>}

          {view === "drafts" && <div>
            <div className="mb-2"><p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--accent-text)]">Drafts</p><h1 className="text-[29px] font-bold tracking-[-0.045em] text-[var(--text)] sm:text-[34px]">Saved ideas</h1><p className="mt-1 text-[14px] text-[var(--text-muted)]">Pick up a post you started earlier, or keep a backup.</p></div>
            <DraftLibraryPanel drafts={drafts} currentDraftId={currentDraftId} onNew={newDraft} onLoad={loadDraft} onDelete={deleteDraft} onExport={exportWorkspace} onImport={importWorkspace} onFullExport={downloadFullBackup} onFullImport={restoreFullBackup} backupBusy={backupBusy} />
          </div>}
          {view === "schedule" && <div>
            <div className="mb-6"><p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--accent-text)]">Plan</p><h1 className="text-[29px] font-bold tracking-[-0.045em] text-[var(--text)] sm:text-[34px]">Publishing plan</h1><p className="mt-1 text-[14px] text-[var(--text-muted)]">Schedule a snapshot of the draft currently in your editor.</p></div>
            <div className="panel-border soft-shadow flex flex-wrap items-center justify-between gap-3 rounded-[18px] bg-[var(--surface)] px-6 py-4 sm:px-7"><div className="min-w-0"><p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-soft)]">Current draft</p><p className="mt-1 truncate text-[14px] font-semibold text-[var(--text)]">{source.trim() ? draftTitle(title, source) : "No draft yet"}</p><p className="mt-1 text-[12px] text-[var(--text-muted)]">{selected.length} destinations · {mediaIds.length} {mediaIds.length === 1 ? "image" : "images"}</p></div><button type="button" onClick={() => openView("compose")} className="text-[12px] font-semibold text-[var(--accent-text)]">Edit draft →</button></div>
            <ServerSchedulePanel schedule={schedule} value={scheduleTime} now={now} canSchedule={Boolean(!mediaBusy && scheduleTime && source.trim() && selected.length && invalidSelected.length === 0 && new Date(scheduleTime).getTime() > now + 10_000)} runningId={runningId} onValueChange={setScheduleTime} onAdd={addToPlan} onLoad={loadScheduled} onRun={runScheduled} onReschedule={rescheduleScheduled} onRemove={removeScheduled} />
          </div>}
          {view === "assisted" && <div>
            <div className="mb-2"><p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--accent-text)]">Assisted</p><h1 className="text-[29px] font-bold tracking-[-0.045em] text-[var(--text)] sm:text-[34px]">Publish with a handoff</h1><p className="mt-1 text-[14px] text-[var(--text-muted)]">Prepare text and reminders for platforms you post to yourself.</p></div>
            <AssistedPublishPanel items={assisted} destination={assistDestination} text={assistText} time={assistTime} now={now} busy={assistedBusy} mediaBusy={mediaBusy} imageCount={mediaIds.length} notificationPermission={notificationPermission} onDestinationChange={(destination) => { setAssistDestination(destination); setAssistOverride(null); }} onTextChange={setAssistOverride} onTimeChange={setAssistTime} onAdd={addAssistedPost} onCopy={copyAssisted} onMarkPosted={markAssistedPosted} onUndo={undoAssistedPosted} onRemove={removeAssisted} onEnableNotifications={enableNotifications} onEditImages={() => openView("compose")} />
          </div>}
          {view === "account" && <AccountPanel email={email} auditLog={auditLog} activity={activity} onClearActivity={() => setActivity([])} onLogout={onLogout} mastodonConnection={mastodonConnection} mastodonLoading={mastodonLoading} mastodonError={mastodonError} onRefreshMastodon={refreshMastodonConnection} />}
        </main>
      </div>
    </div>
    {restoringBackup && <div ref={restoreOverlayRef} tabIndex={-1} role="alertdialog" aria-modal="true" aria-label="Restoring full backup" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-5 outline-none">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 text-center shadow-2xl">
        <p className="text-[17px] font-bold text-[var(--text)]">Restoring your workspace…</p>
        <p className="mt-2 text-[13px] leading-6 text-[var(--text-muted)]">Please wait while drafts, plans and images are checked and restored.</p>
      </div>
    </div>}
    </>
  );
}

export default function Home() {
  const [session, setSession] = useState<{ email: string | null; configured: boolean } | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json())
      .then(setSession)
      .catch(() => setError("Could not reach the server."));
  }, []);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Sign-in failed.");
      setSession({ email: data.email, configured: true });
      setPassword("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed.");
    } finally { setBusy(false); }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    setSession({ email: null, configured: true });
  }

  if (session?.email) return <WorkspaceApp email={session.email} onLogout={signOut} />;
  return <div className="app-shell flex min-h-screen items-center justify-center px-5 py-10"><div className="panel-border soft-shadow w-full max-w-md rounded-[22px] bg-[var(--surface)] p-8">
    <div className="mb-7 flex items-center gap-3"><Image src="/plypost-mark.svg" alt="" width={44} height={44} className="h-11 w-11 shrink-0" /><span className="text-[25px] font-bold tracking-[-0.05em]">Plypost<span className="text-[var(--accent-text)]">.</span></span></div>
    <h1 className="text-[22px] font-bold text-[var(--text)]">Your workspace, ready when you are.</h1>
    <p className="mt-2 text-[13px] leading-5 text-[var(--text-muted)]">Sign in to save drafts and run scheduled simulations on this computer.</p>
    {!session?.configured && session !== null ? <p role="alert" className="mt-5 rounded-xl bg-[var(--warning-soft)] p-3 text-[13px] text-[var(--warning)]">Owner sign-in is not configured. Follow the setup steps in README.md.</p> : <form onSubmit={signIn} className="mt-7 space-y-4">
      <div><label htmlFor="login-email" className="mb-1.5 block text-[12px] font-bold text-[var(--text-secondary)]">Email</label><input id="login-email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-xl border border-[var(--line)] bg-[var(--field)] px-4 py-3 text-[14px] outline-none focus:border-[var(--accent-border)]" /></div>
      <div><label htmlFor="login-password" className="mb-1.5 block text-[12px] font-bold text-[var(--text-secondary)]">Password</label><input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border border-[var(--line)] bg-[var(--field)] px-4 py-3 text-[14px] outline-none focus:border-[var(--accent-border)]" /></div>
      <button type="submit" disabled={busy || session === null} className="gradient-button w-full rounded-xl py-3 text-[14px] font-bold text-white disabled:opacity-50">{busy ? "Signing in..." : "Sign in"}</button>
    </form>}
    {error && <p role="alert" className="mt-4 text-[13px] text-[var(--danger)]">{error}</p>}
    <div className="mt-6 flex justify-end"><ThemeSwitcher /></div>
  </div></div>;
}
