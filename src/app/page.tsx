"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCheck,
  CircleAlert,
  Clock3,
  Copy,
  Hash,
  FilePenLine,
  Layers3,
  ChevronDown,
  MapPin,
  Plus,
  RotateCcw,
  Smile,
  UserRound,
  Video,
  X,
} from "lucide-react";
import { adaptDraft, characterCount, isPlatformId, platformDisplayIds, platformIds, platforms, type PlatformId } from "@/lib/platforms";
import { validatePlatformText } from "@/lib/platform-validation";
import { compareAiLiterals } from "@/lib/ai-literal-check";
import { DraftLibraryPanel } from "@/components/workspace-panels";
import { ServerSchedulePanel } from "@/components/server-schedule-panel";
import { StrategyPanel } from "@/components/strategy-panel";
import { PostingResultsPanel } from "@/components/posting-results-panel";
import { AssistedPublishPanel } from "@/components/assisted-publish-panel";
import { BatchHandoffPanel, type BatchHandoffItem, type BatchPrepareResult, type BatchReviewState } from "@/components/batch-handoff-panel";
import { WeeklySlotsPanel } from "@/components/weekly-slots-panel";
import { BlueskyMark } from "@/components/bluesky-mark";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { AccountPanel } from "@/components/account-panel";
import { AIReviewPanel } from "@/components/ai-review-panel";
import { CaptionComposer } from "@/components/caption-composer";
import { PlatformPreview } from "@/components/platform-preview";
import { ImageAttachmentPicker } from "@/components/image-attachments";
import { VideoAttachmentPicker } from "@/components/video-attachment-picker";
import { LocalDateField } from "@/components/local-date-time-field";
import { MastodonLivePanel, isMastodonConnection, type MastodonConnection } from "@/components/mastodon-live-panel";
import { BlueskyLivePanel, isBlueskyConnection, type BlueskyConnection } from "@/components/bluesky-live-panel";
import { MastodonSchedulePanel } from "@/components/mastodon-schedule-panel";
import type { RealMastodonSchedule } from "@/lib/plan-agenda";
import { assistedDestinations, assistedOnlyDisplayIds, assistedTextImageOnlyDisplayIds, assistedVideoDisplayIds, type AssistedDestinationId } from "@/lib/assisted";
import { ensureEditorTabId, forkUnreadableEditorCache, isUntouchedStarterCache, otherOwnerEditorCopies, readOwnerEditorCache, removeOwnerEditorCopy, writeOwnerEditorCache, type OtherEditorCopy } from "@/lib/editor-cache";
import { openEditorRecovery, reopenedEditorValue, type EditorRecovery } from "@/lib/editor-recovery";
import { inspectPendingDraftSave, parsePendingDraftSave, sameDraftPayload, type PendingDraftSave } from "@/lib/draft-save-recovery";
import { WorkspaceSnapshotGate } from "@/lib/workspace-snapshot-gate";
import { parseRestoreReceipt, parseWorkspaceResponse } from "@/lib/workspace-response";
import { ShownReminderReceipts } from "@/lib/reminder-receipts";
import { WORKSPACE_KEY, assistedContentSnapshot, assistedDeletionSnapshot, draftTitle, emptyWorkspace, followAutoTitle, hasDraftContent, hasManualReminder, parseWorkspace, validCalendarDate, type AssistedOutcomeInput, type AssistedPost, type AssistedReceiptSnapshot, type SavedDraft, type ScheduledPost } from "@/lib/workspace";
import { MAX_POST_IMAGES, imageLimitForDestination, imageLimitWarning } from "@/lib/media-policy";

const sampleDraft =
  "Our Saturday workshop starts at 2 p.m. Doors open at 1:30. Please bring a laptop.";
const previousSampleDraft =
  "A good idea deserves more than a copy-paste post.\n\nShape one message for every corner of the internet. Pick your channels, fine-tune each version, and share with confidence.";
const legacySampleDraft =
  "A good idea deserves more than a copy-paste post.\n\nSocialFlow helps you shape one draft for every corner of the internet. Pick your channels, fine-tune each version, and share with confidence.";
const interimSampleDraft =
  "A good idea deserves more than a copy-paste post.\n\nsoflow helps you shape one draft for every corner of the internet. Pick your channels, fine-tune each version, and share with confidence.";

type AIReview = {
  generation: number;
  source: string;
  original: Partial<Record<PlatformId, string>>;
  suggestions: Partial<Record<PlatformId, string>>;
  platforms: PlatformId[];
  revision: number;
};
type WorkspaceView = "compose" | "drafts" | "schedule" | "assisted" | "account";
const viewLabels: Record<WorkspaceView, string> = {
  compose: "Create", drafts: "Drafts", schedule: "Plan", assisted: "Assisted", account: "Account",
};

const sidebarItems = [
  { id: "compose", label: "Create", icon: FilePenLine },
  { id: "drafts", label: "Drafts", icon: Layers3 },
  { id: "schedule", label: "Plan", icon: Clock3 },
  { id: "assisted", label: "Assisted", icon: Copy },
  { id: "account", label: "Account", icon: UserRound },
] as const;

function SidebarNavigation({ view, collapsed, onNavigate }: {
  view: WorkspaceView;
  collapsed: boolean;
  onNavigate: (next: WorkspaceView) => void;
}) {
  return <nav className={`mt-4 flex flex-1 flex-col gap-1 ${collapsed ? "lg:mt-12" : ""}`} aria-label="Main navigation">
    {sidebarItems.map(({ id, label, icon: Icon }) => <a
      key={id}
      href={`#${id}`}
      onClick={(event) => { event.preventDefault(); onNavigate(id); }}
      aria-label={label}
      title={collapsed ? label : undefined}
      aria-current={view === id ? "page" : undefined}
      className={`sidebar-link sidebar-subtle flex min-h-10 items-center gap-3 rounded-[10px] px-3 py-2.5 text-[14px] font-medium transition ${id === "account" ? "mt-auto" : ""} ${collapsed ? "lg:justify-center lg:px-0" : ""}`}
    >
      <Icon size={18} className="shrink-0" aria-hidden="true" />
      <span className={collapsed ? "lg:hidden" : ""}>{label}</span>
    </a>)}
  </nav>;
}

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
type Notice = { kind: "success" | "error"; text: string; persistent?: boolean } | null;
type EditorContent = {
  title: string;
  source: string;
  selected: readonly PlatformId[];
  variants: Partial<Record<PlatformId, string>>;
  mediaIds: readonly string[];
  mediaAlt: readonly string[];
  videoId: string | null;
  plannedDate: string;
  placeLabel: string;
};
type EditorOrigin = "starter" | "new" | "planned";
type EditorSwitch = { kind: "new" } | { kind: "draft"; draft: SavedDraft; prepareHandoffs?: boolean } | { kind: "planned"; post: ScheduledPost } | { kind: "assisted"; post: AssistedPost };

function sameItems(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function samePlatforms(left: readonly PlatformId[], right: readonly PlatformId[]): boolean {
  return platformIds.every((id) => left.includes(id) === right.includes(id));
}

function editorTitleSource(source: string, variants: Partial<Record<PlatformId, string>>): string {
  return source.trim() || platformDisplayIds.map((id) => variants[id]?.trim()).find(Boolean) || "";
}

function sameEditorContent(left: EditorContent, right: EditorContent | SavedDraft): boolean {
  return left.title === right.title && left.source === right.source &&
    samePlatforms(left.selected, right.selected) && sameItems(left.mediaIds, right.mediaIds ?? []) &&
    left.videoId === (right.videoId ?? null) &&
    left.plannedDate === (right.plannedDate ?? "") &&
    left.placeLabel.trim() === (right.placeLabel ?? "") &&
    sameItems(left.mediaAlt.map((value) => value.trim()), (right.mediaAlt ?? (right.mediaIds ?? []).map(() => "")).map((value) => value.trim())) &&
    platformIds.every((id) => left.variants[id] === right.variants[id]);
}

function hasUnsavedEditorChanges(editor: EditorContent, currentDraftId: string | null, drafts: SavedDraft[], origin: EditorOrigin): boolean {
  if (currentDraftId) {
    const saved = drafts.find((draft) => draft.id === currentDraftId);
    return !saved || !sameEditorContent(editor, saved);
  }
  if (origin === "planned") return true;
  return !sameEditorContent(editor, {
    title: "", source: "",
    selected: [], variants: {}, mediaIds: [], mediaAlt: [], videoId: null, plannedDate: "", placeLabel: "",
  });
}

const platformGlyphs: Record<PlatformId, string> = {
  bluesky: "",
  mastodon: "m",
  linkedin: "in",
  threads: "@",
};

function PlatformMark({ id, size = "normal" }: { id: PlatformId; size?: "small" | "normal" }) {
  const colors: Record<PlatformId, string> = {
    bluesky: "text-[#1684e8]",
    mastodon: "text-[#7779e9]",
    linkedin: "text-[#0a66c2]",
    threads: "text-[var(--text)]",
  };
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center font-bold ${colors[id]} ${size === "small" ? "h-6 w-6 text-[16px]" : "h-10 w-10 text-[20px]"}`}
    >
      {id === "bluesky" ? <BlueskyMark size={size === "small" ? 18 : 22} /> : platformGlyphs[id]}
    </span>
  );
}

function WorkspaceApp({ email, onLogout, logoutBusy, logoutError }: { email: string; onLogout: () => Promise<void>; logoutBusy: boolean; logoutError: string }) {
  const [view, setView] = useState<WorkspaceView>("compose");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const mobileSidebarRef = useRef<HTMLElement>(null);
  const mobileSidebarCloseRef = useRef<HTMLButtonElement>(null);
  const mobileHeaderToggleRef = useRef<HTMLButtonElement>(null);
  const [source, setSource] = useState("");
  const [selected, setSelected] = useState<PlatformId[]>([]);
  const [active, setActive] = useState<PlatformId>(platformDisplayIds[0]);
  const [variants, setVariants] = useState<Partial<Record<PlatformId, string>>>({});
  const [mediaIds, setMediaIds] = useState<string[]>([]);
  const [showAttachments, setShowAttachments] = useState(false);
  const [mediaAltById, setMediaAltById] = useState<Record<string, string>>({});
  const [videoId, setVideoId] = useState<string | null>(null);
  const [plannedDate, setPlannedDate] = useState("");
  const [placeLabel, setPlaceLabel] = useState("");
  const [showPlaceField, setShowPlaceField] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const sourceInputRef = useRef<HTMLTextAreaElement>(null);
  const draftDetailsRef = useRef<HTMLDetailsElement>(null);
  const videoBusyRef = useRef(false);
  const [videoBusy, setVideoBusy] = useState(false);
  const [mediaPickerEpoch, setMediaPickerEpoch] = useState(0);
  const mediaPickerEpochRef = useRef(0);
  const mediaBusyRef = useRef(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [aiUndo, setAiUndo] = useState<Partial<Record<PlatformId, string>> | null>(null);
  const [aiReview, setAiReview] = useState<AIReview | null>(null);
  const aiReviewGeneration = useRef(0);
  const [aiApplyIds, setAiApplyIds] = useState<PlatformId[]>([]);
  const editorRevision = useRef(0);
  const [notice, setNotice] = useState<Notice>(null);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [activity, setActivity] = useState<Receipt[]>([]);
  const [drafts, setDrafts] = useState<SavedDraft[]>([]);
  const [schedule, setSchedule] = useState<ScheduledPost[]>([]);
  const [realMastodonSchedules, setRealMastodonSchedules] = useState<RealMastodonSchedule[]>([]);
  const [realMastodonQueueError, setRealMastodonQueueError] = useState<string | null>(null);
  const [assisted, setAssisted] = useState<AssistedPost[]>([]);
  const [assistedBusy, setAssistedBusy] = useState(false);
  const [focusedAssistedId, setFocusedAssistedId] = useState<string | null>(null);
  const assistedMutation = useRef(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [strategyRefreshEpoch, setStrategyRefreshEpoch] = useState(0);
  const [slotsRefreshEpoch, setSlotsRefreshEpoch] = useState(0);
  const [strategyDirty, setStrategyDirty] = useState(false);
  const [assistedPanelDirty, setAssistedPanelDirty] = useState(false);
  const backupMutation = useRef(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const restoringBackupRef = useRef(false);
  const restoreAbortRef = useRef<AbortController | null>(null);
  const [restoreCancelRequested, setRestoreCancelRequested] = useState(false);
  const [restoreReceiptConfirmed, setRestoreReceiptConfirmed] = useState(false);
  const restoreOverlayRef = useRef<HTMLDivElement>(null);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const workspaceSnapshotGate = useRef(new WorkspaceSnapshotGate());
  const initialWorkspaceLoad = useRef(true);
  const pendingNotificationIds = useRef(new ShownReminderReceipts());
  const notificationSyncWarned = useRef(false);
  const [assistDestination, setAssistDestination] = useState<AssistedDestinationId>(assistedOnlyDisplayIds[0]);
  const [assistOverrides, setAssistOverrides] = useState<Partial<Record<AssistedDestinationId, string>>>({});
  const [assistTime, setAssistTime] = useState("");
  const [openAssistedComposer, setOpenAssistedComposer] = useState(false);
  const [collapseAssistedComposerToken, setCollapseAssistedComposerToken] = useState(0);
  const [openAssistedVideoGroup, setOpenAssistedVideoGroup] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [title, setTitle] = useState("");
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const [currentDraftVersion, setCurrentDraftVersion] = useState<string | null>(null);
  const [batchLaunch, setBatchLaunch] = useState<{ draft: SavedDraft; token: number } | null>(null);
  const [batchReviewState, setBatchReviewState] = useState<BatchReviewState>({ dirty: false, busy: false });
  const batchLaunchCounter = useRef(0);
  const [draftConflict, setDraftConflict] = useState(false);
  const [editorOrigin, setEditorOrigin] = useState<EditorOrigin>("starter");
  const [pendingEditorSwitch, setPendingEditorSwitch] = useState<EditorSwitch | null>(null);
  const [switchSaving, setSwitchSaving] = useState(false);
  const switchSavingRef = useRef(false);
  const [draftSaveBusy, setDraftSaveBusy] = useState(false);
  const draftSaveBusyRef = useRef(false);
  const [pendingDraftSave, setPendingDraftSave] = useState<PendingDraftSave | null>(null);
  const switchDialogRef = useRef<HTMLDialogElement>(null);
  const legacyReviewRef = useRef<HTMLDialogElement>(null);
  const [scheduleTime, setScheduleTime] = useState("");
  const [runningId, setRunningId] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState(false);
  const [recovery, setRecovery] = useState<EditorRecovery | null>(null);
  const [recoveryWarning, setRecoveryWarning] = useState(false);
  const [unreadableEditorCopy, setUnreadableEditorCopy] = useState<string | null>(null);
  const editorCacheWriteBlockedRef = useRef(false);
  const editorCacheLoadedRef = useRef(false);
  const editorTabIdRef = useRef<string | null>(null);
  const editorTabIdPersistentRef = useRef(true);
  const [otherEditorCopies, setOtherEditorCopies] = useState<OtherEditorCopy[]>([]);
  const [now, setNow] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [legacyWorkspace, setLegacyWorkspace] = useState<ReturnType<typeof emptyWorkspace> | null>(null);
  const [legacyStorageError, setLegacyStorageError] = useState(false);
  const [legacyReviewOpen, setLegacyReviewOpen] = useState(false);
  const [legacyImportBusy, setLegacyImportBusy] = useState(false);
  const [legacyImportError, setLegacyImportError] = useState<string | null>(null);
  const [auditLog, setAuditLog] = useState<{ action: string; subject_id: string | null; detail: string | null; created_at: string }[]>([]);
  const [workerLastSeen, setWorkerLastSeen] = useState<string | null>(null);
  const [mastodonConnection, setMastodonConnection] = useState<MastodonConnection | null>(null);
  const [mastodonLoading, setMastodonLoading] = useState(true);
  const [mastodonError, setMastodonError] = useState<string | null>(null);
  const [blueskyConnection, setBlueskyConnection] = useState<BlueskyConnection | null>(null);
  const [blueskyLoading, setBlueskyLoading] = useState(true);
  const [blueskyError, setBlueskyError] = useState<string | null>(null);
  const mediaAlt = mediaIds.map((id) => mediaAltById[id] ?? "");
  const editorContent: EditorContent = { title, source, selected, variants, mediaIds, mediaAlt, videoId, plannedDate, placeLabel };
  const editorContentRef = useRef(editorContent);
  editorContentRef.current = editorContent;
  const currentDraftIdRef = useRef(currentDraftId);
  currentDraftIdRef.current = currentDraftId;
  const canSaveEditor = hasDraftContent(editorContent) && (!plannedDate || validCalendarDate(plannedDate));
  const editorDirty = hasUnsavedEditorChanges(editorContent, currentDraftId, drafts, editorOrigin);
  const assistedDirty = assistedPanelDirty || Boolean(assistTime) || Object.keys(assistOverrides).length > 0;
  const currentSavedDraft = currentDraftId ? drafts.find((draft) => draft.id === currentDraftId) ?? null : null;
  const needsDraftRecovery = !pendingDraftSave && (draftConflict || Boolean(currentDraftId && workspaceReady &&
    currentSavedDraft?.updatedAt !== currentDraftVersion));

  useEffect(() => {
    if (view !== "compose" || !batchLaunch || currentDraftId !== batchLaunch.draft.id) return;
    const frame = window.requestAnimationFrame(() => document.getElementById("batch-handoff-heading")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    return () => window.cancelAnimationFrame(frame);
  }, [view, batchLaunch, currentDraftId]);

  useEffect(() => {
    const dialog = switchDialogRef.current;
    if (pendingEditorSwitch && dialog && !dialog.open) dialog.showModal();
  }, [pendingEditorSwitch]);

  useEffect(() => {
    const dialog = legacyReviewRef.current;
    if (legacyReviewOpen && dialog && !dialog.open) dialog.showModal();
    if (!legacyReviewOpen && dialog?.open) dialog.close();
  }, [legacyReviewOpen]);

  useEffect(() => {
    if (!hydrated || !(editorDirty || strategyDirty || assistedDirty || pendingDraftSave || batchReviewState.dirty || batchReviewState.busy)) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [editorDirty, strategyDirty, assistedDirty, pendingDraftSave, batchReviewState, hydrated]);

  useEffect(() => {
    const syncView = () => {
      const next = viewFromHash();
      if (next !== "assisted") { setOpenAssistedComposer(false); setOpenAssistedVideoGroup(false); }
      setView(next);
      setMobileSidebarOpen(false);
    };
    syncView();
    window.addEventListener("hashchange", syncView);
    window.addEventListener("popstate", syncView);
    return () => {
      window.removeEventListener("hashchange", syncView);
      window.removeEventListener("popstate", syncView);
    };
  }, []);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => { if (desktop.matches) setMobileSidebarOpen(false); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  useEffect(() => {
    if (!mobileSidebarOpen) return;
    mobileSidebarCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileSidebarOpen(false);
        window.requestAnimationFrame(() => mobileHeaderToggleRef.current?.focus());
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = mobileSidebarRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]");
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileSidebarOpen]);

  function openView(next: WorkspaceView, scrollTop = true) {
    if (next !== "assisted") { setOpenAssistedComposer(false); setOpenAssistedVideoGroup(false); }
    setMobileSidebarOpen(false);
    setView(next);
    if (window.location.hash !== `#${next}`) window.history.pushState(null, "", `#${next}`);
    if (scrollTop) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openManualComposer(destination?: AssistedDestinationId) {
    if (videoBusyRef.current) { setNotice({ kind: "error", text: "Wait for the video upload before preparing a post." }); return; }
    setFocusedAssistedId(null);
    setOpenAssistedComposer(true);
    setOpenAssistedVideoGroup(destination ? assistedVideoDisplayIds.some((id) => id === destination) : false);
    if (destination) setAssistDestination(destination);
    openView("assisted");
  }

  function openRealMastodonSchedule(item: RealMastodonSchedule) {
    const target = document.getElementById(`mastodon-schedule-${item.clientRequestId}`);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    target?.focus({ preventScroll: true });
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

  async function refreshBlueskyConnection() {
    setBlueskyLoading(true);
    setBlueskyError(null);
    try {
      const response = await fetch("/api/bluesky/connection", { cache: "no-store" });
      const data: unknown = await response.json();
      if (!response.ok || !isBlueskyConnection(data)) {
        const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "Could not load Bluesky connection.";
        throw new Error(message);
      }
      setBlueskyConnection(data);
    } catch (cause) {
      setBlueskyError(cause instanceof Error ? cause.message : "Could not load Bluesky connection.");
    } finally {
      setBlueskyLoading(false);
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
    void refreshBlueskyConnection();
    const refreshOnFocus = () => { void refreshBlueskyConnection(); };
    window.addEventListener("focus", refreshOnFocus);
    const url = new URL(window.location.href);
    const result = url.searchParams.get("bluesky");
    if (result === "connected" || result === "error") {
      setNotice(result === "connected"
        ? { kind: "success", text: "Bluesky connection completed. Check the account ID in Account before live posting." }
        : { kind: "error", text: "Bluesky connection did not complete. Open Account to try again." });
      url.searchParams.delete("bluesky");
      window.history.replaceState(null, "", url.toString());
      setView("account");
    }
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, []);

  useEffect(() => {
    if (restoringBackup) restoreOverlayRef.current?.focus();
  }, [restoringBackup]);

  async function refreshWorkspace(retryStale = true) {
    const data = await workspaceSnapshotGate.current.read(async () => {
      const response = await fetch("/api/workspace", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load your server workspace.");
      const body: unknown = await response.json().catch(() => {
        const failure = new Error(response.status >= 500
          ? "The server is temporarily unavailable. Your editor is unchanged; retry when it recovers."
          : "The server returned an unreadable response. Your editor is unchanged.") as Error & { status?: number };
        failure.status = response.status;
        throw failure;
      });
      const data = parseWorkspaceResponse(body);
      if (!data) throw new Error("The server returned an incomplete workspace. Your editor is unchanged; reload and check your saved work.");
      return data;
    }, retryStale ? 3 : 1);
    setDrafts(data.drafts);
    setSchedule(data.schedule);
    setAssisted(data.assisted);
    setAuditLog(data.log);
    setWorkerLastSeen(data.workerLastSeen);
    return data;
  }

  async function changeWorkspace(action: string, extra: Record<string, unknown>) {
    if (restoringBackupRef.current) throw new Error("Wait for the full backup restore to finish.");
    const ticket = workspaceSnapshotGate.current.beginWrite();
    let succeeded = false;
    let applySnapshot = () => {};
    try {
      const response = await fetch("/api/workspace", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const body: unknown = await response.json().catch(() => {
        const failure = new Error(response.status >= 500
          ? "The server is temporarily unavailable. Your editor is unchanged; retry when it recovers."
          : "The server returned an unreadable response. Your editor is unchanged.") as Error & { status?: number };
        failure.status = response.status;
        throw failure;
      });
      if (!response.ok) {
        const errorBody = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
        const failure = new Error(typeof errorBody?.error === "string" ? errorBody.error : "Could not update workspace.") as Error & { code?: string; status?: number };
        failure.status = response.status;
        if (typeof errorBody?.code === "string") failure.code = errorBody.code;
        throw failure;
      }
      const data = parseWorkspaceResponse(body);
      if (!data) {
        const failure = new Error("The server returned an incomplete workspace response. Your editor is unchanged; check saved work before retrying.") as Error & { status?: number };
        failure.status = response.status;
        throw failure;
      }
      applySnapshot = () => {
        setDrafts(data.drafts);
        setSchedule(data.schedule);
        setAssisted(data.assisted);
        setAuditLog(data.log);
        setWorkerLastSeen(data.workerLastSeen);
      };
      succeeded = true;
      return data;
    } finally {
      const { apply, refresh } = workspaceSnapshotGate.current.endWrite(ticket, succeeded);
      if (apply) applySnapshot();
      if (refresh) void refreshWorkspace().catch(() => {});
    }
  }

  async function syncShownReminders() {
    const result = await pendingNotificationIds.current.flush((ids) => changeWorkspace("mark-assisted-notified", { ids }));
    if (result === "saved") notificationSyncWarned.current = false;
    if (result === "failed" && pendingNotificationIds.current.size && !notificationSyncWarned.current) {
      notificationSyncWarned.current = true;
      setNotice({ kind: "error", text: "Reminder was shown, but its status could not be saved. Plypost will retry while this page stays open." });
    }
  }

  useEffect(() => {
    let active = true;
    let connection: EditorRecovery | undefined;
    // Access storage lazily so a privacy-mode exception still reaches the existing warning path.
    const storage = {
      get length() { return localStorage.length; },
      key: (index: number) => localStorage.key(index),
      getItem: (key: string) => localStorage.getItem(key),
      setItem: (key: string, value: string) => localStorage.setItem(key, value),
      removeItem: (key: string) => localStorage.removeItem(key),
    };
    let factory: IDBFactory | undefined;
    try { factory = window.indexedDB; } catch { setRecoveryWarning(true); }
    void openEditorRecovery(storage, factory, email, () => { if (active) setRecoveryWarning(true); }).then((opened) => {
      connection = opened;
      if (active) setRecovery(opened);
      else opened.close();
    });
    return () => { active = false; connection?.close(); };
  }, [email]);

  useEffect(() => {
    if (!recovery || editorCacheLoadedRef.current) return;
    editorCacheLoadedRef.current = true;
    try {
      const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      editorTabIdRef.current = ensureEditorTabId(sessionStorage, String(performance.timeOrigin), navigation?.type ?? "navigate", () => crypto.randomUUID());
    } catch {
      editorTabIdRef.current = crypto.randomUUID();
      editorTabIdPersistentRef.current = false;
      setStorageWarning(true);
    }
    let saved: string | null = null;
    try {
      saved = readOwnerEditorCache(recovery.storage, email, editorTabIdRef.current);
      if (saved) {
        const data = JSON.parse(saved) as {
          source?: unknown;
          selected?: unknown;
          variants?: unknown;
          activity?: unknown;
          title?: unknown;
          currentDraftId?: unknown;
          currentDraftVersion?: unknown;
          mediaIds?: unknown;
          mediaAlt?: unknown;
          videoId?: unknown;
          plannedDate?: unknown;
          placeLabel?: unknown;
          editorOrigin?: unknown;
          pendingDraftSave?: unknown;
        };
        const untouchedStarter = isUntouchedStarterCache(data,
          [sampleDraft, previousSampleDraft, legacySampleDraft, interimSampleDraft], platformIds);
        if (typeof data.source === "string") setSource(untouchedStarter ? "" : data.source);
        if (Array.isArray(data.selected) && !untouchedStarter) {
          const cachedSelected = data.selected.filter((id): id is PlatformId => platformIds.includes(id));
          setSelected(cachedSelected);
          setActive(platformDisplayIds.find((id) => cachedSelected.includes(id)) ?? platformDisplayIds[0]);
        }
        if (data.variants && typeof data.variants === "object") {
          const safe: Partial<Record<PlatformId, string>> = {};
          for (const id of platformIds) {
            const value = (data.variants as Record<string, unknown>)[id];
            if (typeof value === "string") safe[id] = value;
          }
          setVariants(safe);
        }
        if (Array.isArray(data.activity)) setActivity(data.activity.slice(0, 12));
        if (typeof data.title === "string") setTitle(Array.from(data.title).slice(0, 120).join(""));
        const pending = parsePendingDraftSave(data.pendingDraftSave);
        if (typeof data.currentDraftId === "string") {
          setCurrentDraftId(data.currentDraftId);
          if (typeof data.currentDraftVersion === "string") setCurrentDraftVersion(data.currentDraftVersion);
          else if (!pending) setDraftConflict(true);
        }
        if (Array.isArray(data.mediaIds) && data.mediaIds.length <= MAX_POST_IMAGES && data.mediaIds.every((id) => typeof id === "string")) {
          setMediaIds(data.mediaIds);
          const cachedAlt = data.mediaAlt;
          if (Array.isArray(cachedAlt) && cachedAlt.length === data.mediaIds.length &&
              cachedAlt.every((value) => typeof value === "string" && value.length <= 500 &&
                !Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))) {
            setMediaAltById(Object.fromEntries(data.mediaIds.map((id, index) => [id, cachedAlt[index]])));
          }
        }
        if (typeof data.videoId === "string" && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(data.videoId)) setVideoId(data.videoId);
        if (typeof data.plannedDate === "string" && data.plannedDate.length <= 10 && /^[\d-]*$/.test(data.plannedDate)) setPlannedDate(data.plannedDate);
        if (typeof data.placeLabel === "string" && data.placeLabel.length <= 120 && Array.from(data.placeLabel).every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)) setPlaceLabel(data.placeLabel);
        if (data.editorOrigin === "starter" || data.editorOrigin === "new" || data.editorOrigin === "planned") setEditorOrigin(data.editorOrigin);
        if (pending && (data.currentDraftId === null || data.currentDraftId === undefined ||
            pending.snapshot.id === data.currentDraftId || pending.asCopy)) setPendingDraftSave(pending);
      }
    } catch {
      if (saved !== null) {
        setUnreadableEditorCopy(saved);
        try {
          const fork = forkUnreadableEditorCache(recovery.storage, sessionStorage, email, editorTabIdRef.current,
            String(performance.timeOrigin), saved, () => crypto.randomUUID());
          editorTabIdRef.current = fork.tabId;
          editorTabIdPersistentRef.current = fork.persistent;
        } catch {
          editorCacheWriteBlockedRef.current = true;
          setStorageWarning(true);
        }
      } else {
        editorCacheWriteBlockedRef.current = true;
        setStorageWarning(true);
      }
    }
    try {
      const saved = localStorage.getItem(WORKSPACE_KEY);
      if (saved) {
        const raw = JSON.parse(saved) as Record<string, unknown>;
        const workspace = parseWorkspace(raw);
        if (!workspace || !Array.isArray(raw?.drafts) || !Array.isArray(raw?.schedule) ||
            workspace.drafts.length !== raw.drafts.length || workspace.schedule.length !== raw.schedule.length ||
            (raw.version === 3 && (!Array.isArray(raw.assisted) || workspace.assisted.length !== raw.assisted.length))) {
          setLegacyStorageError(true);
        } else if (workspace.drafts.length || workspace.schedule.length || workspace.assisted.length) {
          setLegacyWorkspace(workspace);
        }
      }
    } catch {
      setLegacyStorageError(true);
    }
    setHydrated(true);
    if ("Notification" in window) setNotificationPermission(Notification.permission);
    void (async () => {
      try {
        await refreshWorkspace();
        setWorkspaceReady(true);
      } catch {
        setNotice({ kind: "error", text: "Could not load or move browser items into your account. Your browser copy was kept." });
      } finally {
        initialWorkspaceLoad.current = false;
      }
    })();
  }, [recovery]);

  useEffect(() => {
    const refreshCopies = () => {
      const tabId = editorTabIdRef.current;
      if (!tabId || !recovery) return;
      try { setOtherEditorCopies(otherOwnerEditorCopies(recovery.storage, email, tabId)); }
      catch { setOtherEditorCopies([]); }
    };
    refreshCopies();
    window.addEventListener("storage", refreshCopies);
    return () => window.removeEventListener("storage", refreshCopies);
  }, [email, hydrated, recovery]);

  function recoverEditorCopy(copy: OtherEditorCopy) {
    if (editorDirty || needsDraftRecovery || pendingDraftSave || strategyDirty || assistedDirty || batchReviewState.dirty || batchReviewState.busy || draftSaveBusyRef.current ||
        mediaBusyRef.current || videoBusyRef.current || generating || restoringBackupRef.current) {
      setNotice({ kind: "error", text: "Save or discard the current changes before opening another browser copy." });
      return;
    }
    try {
      const tabId = editorTabIdRef.current;
      if (!tabId || !recovery) throw new Error("Editor storage is not ready.");
      writeOwnerEditorCache(recovery.storage, email, tabId, reopenedEditorValue(copy.value, Date.now()));
      window.location.reload();
    } catch {
      setNotice({ kind: "error", text: "Could not open that browser copy. Its original copy was kept." });
    }
  }

  function discardEditorCopy(copy: OtherEditorCopy) {
    if (!window.confirm("Remove this browser copy? It may contain edits not saved to your account. Open and check it first if you are unsure.")) return;
    try {
      const tabId = editorTabIdRef.current;
      if (!tabId || !recovery || !removeOwnerEditorCopy(recovery.storage, email, tabId, copy.tabId)) throw new Error("Browser copy is unavailable.");
      setOtherEditorCopies(otherOwnerEditorCopies(recovery.storage, email, tabId));
    } catch {
      setNotice({ kind: "error", text: "Could not remove that browser copy. Refresh and check whether it is still listed." });
    }
  }

  function persistEditorCache(pending: PendingDraftSave | null) {
    if (editorCacheWriteBlockedRef.current) throw new Error("Unreadable browser copy could not be preserved.");
    const tabId = editorTabIdRef.current;
    if (!tabId || !recovery) throw new Error("Editor storage is not ready.");
    writeOwnerEditorCache(recovery.storage, email, tabId, JSON.stringify({ source, selected, variants, mediaIds, mediaAlt, videoId,
      plannedDate, placeLabel, activity, title, currentDraftId, currentDraftVersion, editorOrigin, pendingDraftSave: pending,
      hasUnsavedWork: editorDirty || needsDraftRecovery || Boolean(pending), cachedAt: Date.now() }));
  }

  useEffect(() => {
    if (!hydrated) return;
    try {
      persistEditorCache(pendingDraftSave);
      setStorageWarning(!editorTabIdPersistentRef.current);
    } catch {
      setStorageWarning(true);
    }
  }, [source, selected, variants, mediaIds, mediaAltById, videoId, plannedDate, placeLabel, activity, title, currentDraftId, currentDraftVersion, editorOrigin, pendingDraftSave, editorDirty, needsDraftRecovery, hydrated, email]);

  function downloadBrowserCopy(value: string) {
    const url = URL.createObjectURL(new Blob([value], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "plypost-browser-copy.txt";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  useEffect(() => {
    const timer = window.setInterval(() => { if (!initialWorkspaceLoad.current) void refreshWorkspace(false).then(() => setWorkspaceReady(true)).catch(() => {}); }, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!notice || notice.persistent) return;
    const timer = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!hydrated || !workspaceReady || !now || notificationPermission !== "granted") return;
    const due = assisted.filter((item) => item.status === "queued" && hasManualReminder(item) && !item.notifiedAt && !pendingNotificationIds.current.has(item.id) && Date.parse(item.scheduledFor) <= now);
    if (!due.length) return;
    try {
      new Notification("Plypost publishing reminder", {
        body: due.length === 1 ? `${assistedDestinations[due[0].destination].name}: ${due[0].title}` : `${due.length} posts are ready for your review.`,
        tag: "socialflow-assisted-due",
      });
      pendingNotificationIds.current.markShown(due.map((item) => item.id));
      void syncShownReminders();
    } catch {
      setNotificationPermission("unsupported");
    }
  }, [assisted, hydrated, workspaceReady, now, notificationPermission]);

  useEffect(() => {
    if (workspaceReady && now && pendingNotificationIds.current.size) void syncShownReminders();
  }, [workspaceReady, now]);

  useEffect(() => {
    for (const id of pendingNotificationIds.current.ids()) {
      const item = assisted.find((entry) => entry.id === id);
      if (!item || item.status !== "queued" || !hasManualReminder(item) || item.notifiedAt || Date.parse(item.scheduledFor) > now) {
        pendingNotificationIds.current.remove(id);
      }
    }
  }, [assisted, now]);

  const textFor = (id: PlatformId) => variants[id] ?? adaptDraft(source, id);
  const currentText = textFor(active);
  const currentValidation = validatePlatformText(active, currentText);
  const currentCount = currentValidation.count;
  const showBlueskyLive = Boolean(blueskyConnection?.configured || blueskyConnection?.connected);
  const showMastodonLive = Boolean(mastodonConnection?.configured || mastodonConnection?.connected);
  const showMastodonQueue = showMastodonLive || realMastodonSchedules.length > 0;
  const invalidSelected = selected.filter(
    (id) => !validatePlatformText(id, textFor(id)).valid,
  );
  const canPublish = selected.length > 0 && invalidSelected.length === 0 && !publishing;
  const suggestedAssistText = isPlatformId(assistDestination) ? textFor(assistDestination) : source;
  const assistText = assistOverrides[assistDestination] ?? suggestedAssistText;
  const assistTextIsCustom = assistOverrides[assistDestination] !== undefined;

  function setAssistedComposerText(value: string) {
    setAssistOverrides((current) => {
      const next = { ...current };
      if (value === suggestedAssistText) delete next[assistDestination];
      else next[assistDestination] = value;
      return next;
    });
  }

  function resetAssistedComposerText() {
    setAssistOverrides((current) => {
      const next = { ...current };
      delete next[assistDestination];
      return next;
    });
  }

  function togglePlatform(id: PlatformId) {
    editorRevision.current += 1;
    const next = selected.includes(id) ? selected.filter((item) => item !== id) :
      platformDisplayIds.filter((item) => selected.includes(item) || item === id);
    setSelected(next);
    setActive(next.includes(id) ? id : platformDisplayIds.find((item) => next.includes(item)) ?? id);
    setNotice(null);
  }

  async function generateVariants(useVoice = false) {
    if (!source.trim()) {
      setNotice({ kind: "error", text: "Add a source draft before asking AI to adapt it." });
      return;
    }
    const revisionAtStart = editorRevision.current;
    const previousVariants = { ...variants };
    const requested = selected.length ? platformDisplayIds.filter((id) => selected.includes(id)) : [...platformDisplayIds];
    setGenerating(true);
    setNotice(null);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, useVoice, platforms: requested }),
      });
      const data: { error?: string; variants?: Partial<Record<PlatformId, string>> } = await response.json();
      if (!response.ok) throw new Error(data.error || "AI adaptation failed.");
      if (!data.variants || requested.some((id) => !data.variants?.[id]?.trim())) throw new Error("AI adaptation returned incomplete drafts.");
      if (editorRevision.current !== revisionAtStart) {
        setNotice({ kind: "error", text: "The editor changed while AI was working, so your edits were kept. Generate again when ready." });
        return;
      }
      setAiReview({ generation: ++aiReviewGeneration.current, source, original: previousVariants, suggestions: data.variants, platforms: requested, revision: revisionAtStart });
      setAiApplyIds([]);
      setNotice({ kind: "success", text: `${requested.length} ${requested.length === 1 ? "suggestion is" : "suggestions are"} ready. Compare below, then select each version you want to apply.` });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "AI adaptation failed." });
    } finally {
      setGenerating(false);
    }
  }

  function applyAIReview() {
    if (!aiReview || generating || aiApplyIds.length === 0) return;
    if (editorRevision.current !== aiReview.revision || source !== aiReview.source ||
        platformIds.some((id) => variants[id] !== aiReview.original[id])) {
      setNotice({ kind: "error", text: "The editor changed after AI generated these suggestions. Generate again before applying them." });
      return;
    }
    const chosen = aiReview.platforms.filter((id) => aiApplyIds.includes(id) && aiReview.suggestions[id]);
    if (chosen.length === 0) return;
    const invalid = chosen.filter((id) => !validatePlatformText(id, aiReview.suggestions[id] ?? "").valid);
    if (invalid.length) {
      setNotice({ kind: "error", text: `Edit or deselect ${invalid.map((id) => platforms[id].name).join(", ")} before applying; the suggested text is empty or over its limit.` });
      return;
    }
    const previous = { ...variants };
    const next = { ...variants };
    for (const id of chosen) next[id] = aiReview.suggestions[id];
    editorRevision.current += 1;
    setAiUndo(previous);
    setVariants(next);
    const nextSelected = platformDisplayIds.filter((id) => selected.includes(id) || chosen.includes(id));
    setSelected(nextSelected);
    setActive(chosen[0]);
    setAiReview(null);
    setNotice({ kind: "success", text: `Applied ${chosen.length} selected ${chosen.length === 1 ? "version" : "versions"}. Check facts and tone before sharing.` });
    requestAnimationFrame(() => document.getElementById("platform-draft")?.focus());
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

  async function saveDraft(preserveTitle = false, asCopy = false): Promise<SavedDraft | null> {
    if (draftSaveBusyRef.current) {
      setNotice({ kind: "error", text: "Wait for the current draft save to finish." });
      return null;
    }
    if (mediaBusyRef.current) {
      setNotice({ kind: "error", text: "Wait for the image operation to finish before saving this draft." });
      return null;
    }
    if (videoBusyRef.current) {
      setNotice({ kind: "error", text: "Wait for the video operation to finish before saving this draft." });
      return null;
    }
    if (!hasDraftContent(editorContentRef.current)) {
      setNotice({ kind: "error", text: "Add a title, caption, platform text, image or video before saving." });
      return null;
    }
    if (plannedDate && !validCalendarDate(plannedDate)) {
      setNotice({ kind: "error", text: "Enter a real target date as YYYY-MM-DD, or clear it." });
      return null;
    }
    if ((!currentDraftId || asCopy) && drafts.length >= 100 && !pendingDraftSave) {
      setNotice({ kind: "error", text: "The library is full. Delete an old draft before saving another." });
      return null;
    }
    const stamp = new Date().toISOString();
    const existing = drafts.find((draft) => draft.id === currentDraftId);
    const titleSource = editorTitleSource(source, variants);
    const savedTitle = draftTitle(title, titleSource);
    const copyMode = pendingDraftSave?.asCopy ?? asCopy;
    const saveId = pendingDraftSave?.snapshot.id ?? (!copyMode && currentDraftId ? currentDraftId : crypto.randomUUID());
    const saved: SavedDraft = {
      id: saveId, title: copyMode ? `${savedTitle.slice(0, 113)} (copy)` : savedTitle,
      source, selected: [...selected], variants: { ...variants },
      mediaIds: [...mediaIds], mediaAlt: mediaAlt.map((value) => value.trim()),
      ...(videoId ? { videoId } : {}), ...(plannedDate ? { plannedDate } : {}),
      ...(placeLabel.trim() ? { placeLabel: placeLabel.trim() } : {}),
      createdAt: !copyMode && existing ? existing.createdAt : stamp, updatedAt: stamp,
    };
    const revisionAtStart = editorRevision.current;
    draftSaveBusyRef.current = true;
    setDraftSaveBusy(true);
    let attempt = pendingDraftSave;
    try {
      let expectedUpdatedAt: string | null = copyMode || !currentDraftId ? null : currentDraftVersion ?? "untracked";
      if (pendingDraftSave) {
        let latest: Awaited<ReturnType<typeof refreshWorkspace>>;
        try { latest = await refreshWorkspace(); }
        catch {
          setNotice({ kind: "error", text: "Could not check the earlier save yet. Your editor is still here; retry when the service responds." });
          return null;
        }
        const serverDraft = (latest.drafts as SavedDraft[]).find((draft) => draft.id === pendingDraftSave.snapshot.id);
        const result = inspectPendingDraftSave(pendingDraftSave, serverDraft);
        if (result === "conflict") {
          setCurrentDraftId(pendingDraftSave.snapshot.id);
          setCurrentDraftVersion(pendingDraftSave.expectedUpdatedAt);
          setDraftConflict(true);
          setPendingDraftSave(null);
          setNotice({ kind: "error", text: "This draft changed elsewhere while the save result was uncertain. Your editor is intact; review the latest version or save a copy." });
          return null;
        }
        if (result === "committed" && serverDraft) {
          setCurrentDraftId(serverDraft.id);
          setCurrentDraftVersion(serverDraft.updatedAt);
          setDraftConflict(false);
          setEditorOrigin("new");
          if (sameDraftPayload(serverDraft, saved)) {
            setPendingDraftSave(null);
            if (!preserveTitle && editorRevision.current === revisionAtStart) setTitle(serverDraft.title);
            setNotice({ kind: "success", text: editorRevision.current === revisionAtStart
              ? "Earlier save confirmed. The draft is in your account."
              : "An earlier version was saved. Your newer edits remain unsaved." });
            return serverDraft;
          }
          expectedUpdatedAt = serverDraft.updatedAt;
        } else {
          expectedUpdatedAt = pendingDraftSave.expectedUpdatedAt;
        }
      }
      if (editorRevision.current !== revisionAtStart) {
        setNotice({ kind: "error", text: "The editor changed while checking the earlier save. Your new edits are here; review and retry." });
        return null;
      }
      attempt = { snapshot: saved, expectedUpdatedAt, asCopy: copyMode };
      try { persistEditorCache(attempt); setStorageWarning(!editorTabIdPersistentRef.current); }
      catch { setStorageWarning(true); }
      setPendingDraftSave(attempt);
      const data = await changeWorkspace("save-draft", { item: saved,
        expectedUpdatedAt });
      const stored = data.savedDraft as SavedDraft | undefined;
      if (!stored || stored.id !== saved.id) throw new Error("The draft was saved, but its version could not be confirmed. Reload before editing it again.");
      setCurrentDraftId(saved.id);
      setCurrentDraftVersion(stored.updatedAt);
      setDraftConflict(false);
      setPendingDraftSave(null);
      setEditorOrigin("new");
      if (!preserveTitle && editorRevision.current === revisionAtStart) setTitle(saved.title);
      setNotice({ kind: "success", text: editorRevision.current === revisionAtStart
        ? "Draft saved to your account."
        : "An earlier version was saved. Your newer edits remain unsaved." });
      return stored;
    } catch (error) {
      const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
      const uncertain = status === undefined || status === 409 ||
        typeof status === "number" && (status >= 500 || status >= 200 && status < 300);
      if (uncertain && attempt) {
        const checkedAttempt = attempt;
        try {
          const latest = await refreshWorkspace();
          const serverDraft = (latest.drafts as SavedDraft[]).find((draft) => draft.id === checkedAttempt.snapshot.id);
          const result = inspectPendingDraftSave(checkedAttempt, serverDraft);
          if (result === "committed" && serverDraft) {
            setCurrentDraftId(serverDraft.id);
            setCurrentDraftVersion(serverDraft.updatedAt);
            setDraftConflict(false);
            setPendingDraftSave(null);
            setEditorOrigin("new");
            if (!preserveTitle && editorRevision.current === revisionAtStart) setTitle(serverDraft.title);
            setNotice({ kind: "success", text: editorRevision.current === revisionAtStart
              ? "Draft saved to your account."
              : "An earlier version was saved. Your newer edits remain unsaved." });
            return serverDraft;
          }
          if (result === "conflict") {
            setCurrentDraftId(checkedAttempt.snapshot.id);
            setCurrentDraftVersion(checkedAttempt.expectedUpdatedAt);
            setDraftConflict(true);
            setPendingDraftSave(null);
            setNotice({ kind: "error", text: "This draft changed elsewhere. Your editor is intact; review the latest version or save a copy." });
            return null;
          }
        } catch { /* Keep the same draft ID until the server can confirm the outcome. */ }
        setNotice({ kind: "error", text: "Save not confirmed. Your edits are still here. Retry when the service responds; Plypost will check before writing again." });
        return null;
      }
      setPendingDraftSave(null);
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not save draft." });
      return null;
    } finally {
      draftSaveBusyRef.current = false;
      setDraftSaveBusy(false);
    }
  }

  async function prepareEditorHandoffs() {
    if (draftSaveBusyRef.current || mediaBusyRef.current || videoBusyRef.current || restoringBackupRef.current) return;
    if (batchReviewState.dirty || batchReviewState.busy) {
      setNotice({ kind: "error", text: "Finish or discard the open handoff review before starting another." });
      return;
    }
    if (needsDraftRecovery) {
      setNotice({ kind: "error", text: "This draft changed in another window. Review the latest version or save your edits as a new draft first." });
      return;
    }
    if (!editorDirty && currentSavedDraft && !pendingDraftSave) {
      batchLaunchCounter.current += 1;
      setBatchLaunch({ draft: currentSavedDraft, token: batchLaunchCounter.current });
      return;
    }
    const originalRevision = editorRevision.current;
    const originalContent = editorContentRef.current;
    const stored = await saveDraft();
    if (!stored) return;
    const normalizedContent = { ...originalContent, title: stored.title };
    if (editorRevision.current !== originalRevision ||
        (!sameEditorContent(editorContentRef.current, originalContent) && !sameEditorContent(editorContentRef.current, normalizedContent))) {
      setNotice({ kind: "error", text: "The draft was saved, but you changed the editor while it was saving. Review and save the newer edits before preparing posts." });
      return;
    }
    batchLaunchCounter.current += 1;
    setBatchLaunch({ draft: stored, token: batchLaunchCounter.current });
  }

  function resetMediaPicker() {
    mediaPickerEpochRef.current += 1;
    setMediaPickerEpoch(mediaPickerEpochRef.current);
    mediaBusyRef.current = false;
    setMediaBusy(false);
  }

  function applyEditorSwitch(next: EditorSwitch) {
    editorRevision.current += 1;
    setBatchReviewState({ dirty: false, busy: false });
    setPendingDraftSave(null);
    resetMediaPicker();
    setAiUndo(null);
    setAiReview(null);
    const prepareHandoffs = next.kind === "draft" && Boolean(next.prepareHandoffs);
    if (prepareHandoffs && next.kind === "draft") {
      batchLaunchCounter.current += 1;
      setBatchLaunch({ draft: next.draft, token: batchLaunchCounter.current });
    } else {
      setBatchLaunch(null);
    }
    if (next.kind === "new") {
      setCurrentDraftId(null);
      setCurrentDraftVersion(null);
      setDraftConflict(false);
      setEditorOrigin("new");
      setTitle("");
      setSource("");
      setVariants({});
      setMediaIds([]);
      setMediaAltById({});
      setVideoId(null);
      setPlannedDate("");
      setPlaceLabel("");
      setSelected([]);
      setActive(platformDisplayIds[0]);
      setNotice(null);
    } else if (next.kind === "draft") {
      const { draft } = next;
      setCurrentDraftId(draft.id);
      setCurrentDraftVersion(draft.updatedAt);
      setDraftConflict(false);
      setEditorOrigin("new");
      setTitle(draft.title);
      setSource(draft.source);
      setSelected([...draft.selected]);
      setVariants({ ...draft.variants });
      setMediaIds([...(draft.mediaIds ?? [])]);
      setMediaAltById(Object.fromEntries((draft.mediaIds ?? []).map((id, index) => [id, draft.mediaAlt?.[index] ?? ""])));
      setVideoId(draft.videoId ?? null);
      setPlannedDate(draft.plannedDate ?? "");
      setPlaceLabel(draft.placeLabel ?? "");
      setActive(platformDisplayIds.find((id) => draft.selected.includes(id)) ?? platformDisplayIds[0]);
      setNotice({ kind: "success", text: `Opened “${draft.title}”. Changes will be saved when you click Update draft.` });
    } else if (next.kind === "planned") {
      const { post } = next;
      setCurrentDraftId(null);
      setCurrentDraftVersion(null);
      setDraftConflict(false);
      setEditorOrigin("planned");
      setTitle(post.title);
      setSource(post.source);
      setSelected(platformIds.filter((id) => post.posts[id] !== undefined));
      setVariants({ ...post.posts });
      setMediaIds([...(post.mediaIds ?? [])]);
      setMediaAltById(Object.fromEntries((post.mediaIds ?? []).map((id, index) => [id, post.mediaAlt?.[index] ?? ""])));
      setVideoId(null);
      setPlannedDate("");
      setPlaceLabel(post.placeLabel ?? "");
      setActive(platformDisplayIds.find((id) => post.posts[id] !== undefined) ?? platformDisplayIds[0]);
      setNotice({ kind: "success", text: "Opened a copy of the planned post. The plan snapshot is unchanged." });
    } else {
      const { post } = next;
      setCurrentDraftId(null);
      setCurrentDraftVersion(null);
      setDraftConflict(false);
      setEditorOrigin("new");
      setTitle(post.title);
      setSource(post.text);
      setSelected(isPlatformId(post.destination) ? [post.destination] : []);
      setVariants(isPlatformId(post.destination) ? { [post.destination]: post.text } : {});
      setMediaIds([]);
      setMediaAltById({});
      setVideoId(null);
      setPlannedDate("");
      setPlaceLabel(post.placeLabel ?? "");
      setActive(isPlatformId(post.destination) ? post.destination : platformDisplayIds[0]);
      setNotice({ kind: "success", text: "Started an unsaved draft from your posted text. Review and rewrite it before sharing; media was not copied." });
    }
    openView("compose", !prepareHandoffs);
  }

  function requestEditorSwitch(next: EditorSwitch) {
    if (switchSavingRef.current) return;
    if (batchReviewState.busy) {
      setNotice({ kind: "error", text: "Wait for the handoff review to finish before changing drafts." });
      return;
    }
    if (draftSaveBusyRef.current || mediaBusyRef.current || videoBusyRef.current || generating || restoringBackupRef.current) {
      setNotice({ kind: "error", text: draftSaveBusyRef.current
        ? "Wait for the current draft save to finish before changing drafts."
        : mediaBusyRef.current ? "Wait for the image operation to finish before changing drafts."
        : videoBusyRef.current ? "Wait for the video operation to finish before changing drafts."
        : generating ? "Wait for AI adaptation to finish before changing drafts."
        : "Wait for backup restoration to finish before changing drafts." });
      return;
    }
    if (batchReviewState.dirty && !window.confirm("Change drafts and discard the unconfirmed handoff review? The saved draft will stay unchanged.")) return;
    if (editorDirty || pendingDraftSave) {
      setPendingEditorSwitch(next);
      return;
    }
    applyEditorSwitch(next);
  }

  function newDraft() { requestEditorSwitch({ kind: "new" }); }

  function loadDraft(draft: SavedDraft) { requestEditorSwitch({ kind: "draft", draft }); }

  function prepareDraftHandoffs(draft: SavedDraft) { requestEditorSwitch({ kind: "draft", draft, prepareHandoffs: true }); }

  async function openLatestDraft() {
    if (!currentDraftId) return;
    try {
      const data = await refreshWorkspace();
      const latest = (data.drafts as SavedDraft[]).find((draft) => draft.id === currentDraftId);
      if (!latest) { setNotice({ kind: "error", text: "This draft was deleted elsewhere. Save your editor text as a new draft if you want to keep it." }); return; }
      requestEditorSwitch({ kind: "draft", draft: latest });
    } catch {
      setNotice({ kind: "error", text: "Could not load the latest saved draft. Your editor text is still here." });
    }
  }

  async function saveAndSwitch() {
    if (!pendingEditorSwitch || switchSavingRef.current) return;
    const target = pendingEditorSwitch;
    const originalContent = editorContentRef.current;
    const originalRevision = editorRevision.current;
    switchSavingRef.current = true;
    setSwitchSaving(true);
    try {
      if (!await saveDraft(true, needsDraftRecovery)) {
        setPendingEditorSwitch(null);
        openView("compose");
        return;
      }
      if (editorRevision.current !== originalRevision || !sameEditorContent(editorContentRef.current, originalContent)) {
        setPendingEditorSwitch(null);
        setNotice({ kind: "error", text: "The earlier version was saved, but the editor changed during saving. Your new edits were kept; review them before changing drafts." });
        openView("compose");
        return;
      }
      if (target.kind === "draft") {
        const refreshed = await refreshWorkspace();
        if (editorRevision.current !== originalRevision || !sameEditorContent(editorContentRef.current, originalContent)) {
          setPendingEditorSwitch(null);
          setNotice({ kind: "error", text: "The editor changed while the next draft was loading. Your new edits were kept; review them before changing drafts." });
          openView("compose");
          return;
        }
        const latest = (refreshed.drafts as SavedDraft[]).find((draft) => draft.id === target.draft.id);
        if (!latest) throw new Error("The target draft was deleted. Your current changes were saved; choose another draft.");
        setPendingEditorSwitch(null);
        applyEditorSwitch({ ...target, draft: latest });
      } else {
        setPendingEditorSwitch(null);
        applyEditorSwitch(target);
      }
    } catch (error) {
      setPendingEditorSwitch(null);
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not open the target draft after saving." });
      openView("compose");
    } finally {
      switchSavingRef.current = false;
      setSwitchSaving(false);
    }
  }

  async function deleteDraft(id: string, expectedUpdatedAt: string) {
    if (!window.confirm("Delete this saved draft from your account?")) return;
    try {
      await changeWorkspace("delete-draft", { id, expectedUpdatedAt });
      if (currentDraftId === id) { setCurrentDraftId(null); setCurrentDraftVersion(null); setDraftConflict(false); setPendingDraftSave(null); }
      setNotice({ kind: "success", text: "Saved draft deleted. The current editor was kept." });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "DRAFT_CONFLICT") {
        void refreshWorkspace().catch(() => {});
      }
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not delete draft." });
    }
  }

  async function setDraftTargetDate(draft: SavedDraft, nextDate: string | null): Promise<void> {
    if (draftSaveBusyRef.current || restoringBackupRef.current) throw new Error("Wait for the current save or backup restore to finish.");
    if (nextDate !== null && !validCalendarDate(nextDate)) throw new Error("Enter a real target date as YYYY-MM-DD.");
    const editingThisDraft = currentDraftIdRef.current === draft.id;
    if (editingThisDraft && (editorDirty || needsDraftRecovery)) throw new Error("Save or resolve the open draft's changes before changing its target day here.");
    const revisionAtStart = editorRevision.current;
    try {
      const data = await changeWorkspace("set-draft-target-date", { id: draft.id, expectedUpdatedAt: draft.updatedAt, plannedDate: nextDate });
      const saved = data.savedDraft as SavedDraft | undefined;
      if (!saved || saved.id !== draft.id) throw new Error("The target day changed, but its saved version could not be confirmed. Reload before editing this draft.");
      if (editingThisDraft && currentDraftIdRef.current === draft.id) {
        if (editorRevision.current === revisionAtStart) {
          setPlannedDate(saved.plannedDate ?? "");
          setCurrentDraftVersion(saved.updatedAt);
          setNotice({ kind: "success", text: nextDate ? "Draft target day saved. No reminder or post was created." : "Draft target day removed." });
        } else {
          setDraftConflict(true);
          setNotice({ kind: "error", text: "Target day saved, but the editor changed while saving. Review those edits before updating this draft again." });
        }
      } else {
        setNotice({ kind: "success", text: nextDate ? "Draft target day saved. No reminder or post was created." : "Draft target day removed." });
      }
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "DRAFT_CONFLICT") {
        void refreshWorkspace().catch(() => {});
      }
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not update this draft's target day." });
      throw error;
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
      mediaAlt: mediaAlt.map((value) => value.trim()),
      ...(placeLabel.trim() ? { placeLabel: placeLabel.trim() } : {}),
      scheduledFor: scheduledFor.toISOString(),
      createdAt: new Date().toISOString(),
      status: "queued",
    };
    try {
      await changeWorkspace("add-schedule", { item: post, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });
      setScheduleTime("");
      setNotice({ kind: "success", text: "Added to the publishing plan. A running worker will simulate it when due." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not add plan item." });
    }
  }

  function loadScheduled(post: ScheduledPost) {
    requestEditorSwitch({ kind: "planned", post });
  }

  async function runScheduled(post: ScheduledPost) {
    if (runningId || post.status !== "failed") return;
    setRunningId(post.id);
    setNotice(null);
    try {
      await changeWorkspace("retry-schedule", { id: post.id, expectedRevision: post.revision });
      setNotice({ kind: "success", text: "Queued for another simulation attempt." });
    } catch (error) {
      if ((error as { code?: string }).code === "SCHEDULE_CONFLICT") void refreshWorkspace().catch(() => {});
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
        expectedRevision: post.revision,
        scheduledFor: scheduledForIso,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      });
      setNotice({ kind: "success", text: post.receipts?.length
        ? "Moved the remaining simulation to the new time. Existing simulated receipts were kept."
        : "Plan item moved to the new time." });
    } catch (error) {
      if ((error as { code?: string }).code === "SCHEDULE_CONFLICT") await refreshWorkspace().catch(() => {});
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not move plan item." });
      throw error;
    } finally {
      setRunningId(null);
    }
  }

  async function rescheduleAssistedPost(post: AssistedPost, scheduledForIso: string | null): Promise<void> {
    if (assistedMutation.current) throw new Error("Another handoff update is in progress.");
    assistedMutation.current = true;
    setAssistedBusy(true);
    try {
      await changeWorkspace("reschedule-assisted", {
        id: post.id, expectedScheduledFor: post.scheduledFor, scheduledFor: scheduledForIso,
      });
      setNotice({ kind: "success", text: scheduledForIso === null ? "Reminder removed. This handoff stays on your checklist." : hasManualReminder(post) ? "Manual reminder moved. Its text and media were kept." : "Reminder added to this handoff." });
    } catch (error) {
      if ((error as { code?: string }).code === "ASSISTED_CONFLICT") {
        await refreshWorkspace().catch(() => {});
      }
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not move manual reminder." });
      throw error;
    } finally {
      assistedMutation.current = false;
      setAssistedBusy(false);
    }
  }

  async function removeScheduled(post: ScheduledPost) {
    if (!window.confirm("Remove this item from your plan?")) return;
    try {
      await changeWorkspace("delete-schedule", { id: post.id, expectedRevision: post.revision });
      setNotice({ kind: "success", text: "Item removed from your plan." });
    } catch (error) {
      if ((error as { code?: string }).code === "SCHEDULE_CONFLICT") await refreshWorkspace().catch(() => {});
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
    setNotice({ kind: "success", text: "Text JSON exported without image or video files. Use Download full backup to include them." });
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
      setNotice({ kind: "success", text: "Full backup downloaded with your saved images and videos. Keep the file private." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not download the full backup." });
    } finally {
      backupMutation.current = false;
      setBackupBusy(false);
    }
  }

  async function restoreFullBackup(file: File) {
    if (backupMutation.current) return;
    if (draftSaveBusyRef.current || pendingDraftSave || assistedMutation.current || batchReviewState.busy) {
      setNotice({ kind: "error", text: "Finish the current save or handoff update before restoring a backup." });
      return;
    }
    if (mediaBusyRef.current) {
      setNotice({ kind: "error", text: "Wait for the current image operation before restoring a backup." });
      return;
    }
    if (videoBusyRef.current) {
      setNotice({ kind: "error", text: "Wait for the current video operation before restoring a backup." });
      return;
    }
    if (!file.size || file.size > 192 * 1024 * 1024) {
      setNotice({ kind: "error", text: "Choose a full backup no larger than 192 MiB." });
      return;
    }
    backupMutation.current = true;
    setBackupBusy(true);
    let restored = false;
    let restoreRequested = false;
    let confirmedRejection = false;
    try {
      const latest = await refreshWorkspace();
      if (typeof latest.workspaceRevision !== "string") throw new Error("Could not verify the current workspace. Reload and try again.");
      const unsavedWarning = `${editorDirty ? " Your unsaved editor changes will be discarded." : ""}${batchReviewState.dirty ? " Your unconfirmed handoff review will be lost." : ""}${strategyDirty ? " Your unsaved brand profile or AI idea edits will be lost." : ""}${assistedDirty ? " Your unsaved manual posting edits will be lost." : ""}`;
      if (!window.confirm(`Replace this account's saved drafts, brand profile, AI weekly plans, publishing plan, assisted posts (including results), images, and videos with this full backup?${unsavedWarning} This cannot be undone.`)) return;
      restoringBackupRef.current = true;
      setRestoringBackup(true);
      setRestoreReceiptConfirmed(false);
      const restoreController = new AbortController();
      restoreAbortRef.current = restoreController;
      restoreRequested = true;
      const response = await fetch("/api/backup", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Plypost-Workspace-Revision": latest.workspaceRevision }, body: file,
        cache: "no-store", credentials: "same-origin", signal: restoreController.signal,
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        confirmedRejection = response.status >= 400 && response.status < 500;
        const errorBody = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
        throw new Error(typeof errorBody?.error === "string" ? errorBody.error : "Could not restore the full backup.");
      }
      if (!parseRestoreReceipt(body)) throw new Error("Restore response was incomplete.");
      restored = true;
      restoreAbortRef.current = null;
      setRestoreReceiptConfirmed(true);
      setCurrentDraftId(null);
      setCurrentDraftVersion(null);
      setBatchLaunch(null);
      setBatchReviewState({ dirty: false, busy: false });
      setDraftConflict(false);
      setPendingDraftSave(null);
      setEditorOrigin("new");
      setTitle("");
      setSource("");
      setSelected([]);
      setVariants({});
      setMediaIds([]);
      setMediaAltById({});
      setVideoId(null);
      setPlannedDate("");
      setPlaceLabel("");
      resetMediaPicker();
      try { localStorage.setItem(WORKSPACE_KEY, JSON.stringify(emptyWorkspace())); } catch { setStorageWarning(true); }
      setLegacyWorkspace(null);
      await refreshWorkspace();
      setStrategyRefreshEpoch((epoch) => epoch + 1);
      setSlotsRefreshEpoch((epoch) => epoch + 1);
      setNotice({ kind: "success", text: "Full backup restored. Saved drafts, weekly slots, brand plans, handoffs, results, images, and videos are available in this account." });
    } catch (error) {
      setNotice({ kind: "error", persistent: restored || restoreRequested && !confirmedRejection, text: restored
        ? "Full backup was restored, but the view could not refresh. Reload to see the saved work."
        : restoreRequested && !confirmedRejection
          ? "Restore result not confirmed. Reload and inspect your saved work before trying again."
          : error instanceof Error ? error.message : "Could not restore the full backup." });
    } finally {
      restoreAbortRef.current = null;
      setRestoreCancelRequested(false);
      setRestoreReceiptConfirmed(false);
      restoringBackupRef.current = false;
      setRestoringBackup(false);
      backupMutation.current = false;
      setBackupBusy(false);
    }
  }

  async function importWorkspace(file: File) {
    if (backupMutation.current) return;
    if (draftSaveBusyRef.current || pendingDraftSave || assistedMutation.current || batchReviewState.busy) {
      setNotice({ kind: "error", text: "Finish the current save or handoff update before importing a backup." });
      return;
    }
    backupMutation.current = true;
    setBackupBusy(true);
    let importRequested = false;
    try {
      if (file.size > 2_000_000) throw new Error("Backup file is too large (2 MB maximum).");
      const raw = JSON.parse(await file.text());
      const workspace = parseWorkspace(raw);
      if (!workspace || !Array.isArray(raw.drafts) || !Array.isArray(raw.schedule) ||
          workspace.drafts.length !== raw.drafts.length || workspace.schedule.length !== raw.schedule.length ||
          (raw.version === 3 && (!Array.isArray(raw.assisted) || workspace.assisted.length !== raw.assisted.length))) {
        throw new Error("This backup has invalid or excess records. Nothing was replaced.");
      }
      const latest = await refreshWorkspace();
      if (typeof latest.workspaceRevision !== "string") throw new Error("Could not verify the current workspace. Reload and try again.");
      if (!window.confirm(`Replace your account's drafts, publishing plan, and assisted posts with this text-only JSON backup? Your saved brand profile remains, but AI weekly plans are cleared. Images are not in this file, so image references must already exist in this account.${editorDirty ? " Your unsaved editor changes will be discarded." : ""}${batchReviewState.dirty ? " Your unconfirmed handoff review will be lost." : ""}${strategyDirty ? " Unsaved brand profile or AI idea edits will be lost." : ""}${assistedDirty ? " Unsaved manual posting edits will be lost." : ""}`)) return;
      importRequested = true;
      await changeWorkspace("import", { backup: raw, expectedRevision: latest.workspaceRevision });
      try { localStorage.setItem(WORKSPACE_KEY, JSON.stringify(emptyWorkspace())); } catch { setStorageWarning(true); }
      setLegacyWorkspace(null);
      setCurrentDraftId(null);
      setCurrentDraftVersion(null);
      setBatchLaunch(null);
      setBatchReviewState({ dirty: false, busy: false });
      setDraftConflict(false);
      setPendingDraftSave(null);
      setEditorOrigin("new");
      setTitle("");
      setSource("");
      setSelected([]);
      setVariants({});
      setMediaIds([]);
      setMediaAltById({});
      setVideoId(null);
      setPlannedDate("");
      setPlaceLabel("");
      resetMediaPicker();
      setStrategyRefreshEpoch((epoch) => epoch + 1);
      setNotice({ kind: "success", text: `Imported ${workspace.drafts.length} drafts, ${workspace.schedule.length} planned items, and ${workspace.assisted.length} assisted posts. AI weekly plans were cleared; your saved brand profile remains.` });
    } catch (error) {
      const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
      const uncertain = status === undefined || typeof status === "number" && (status >= 500 || status >= 200 && status < 300);
      setNotice({ kind: "error", persistent: importRequested && uncertain, text: importRequested && uncertain
        ? "Import result not confirmed. Reload and inspect your saved work before trying again."
        : error instanceof Error ? error.message : "Could not import backup." });
    } finally {
      backupMutation.current = false;
      setBackupBusy(false);
    }
  }

  async function importLegacyWorkspace() {
    if (!legacyWorkspace || legacyImportBusy) return;
    const replaceSaved = legacyWorkspace.drafts.length > 0 || legacyWorkspace.schedule.length > 0;
    if (replaceSaved && batchReviewState.busy) {
      setLegacyImportError("Wait for the handoff review to finish before moving browser data.");
      return;
    }
    setLegacyImportBusy(true);
    setLegacyImportError(null);
    try {
      const latest = await refreshWorkspace();
      if (typeof latest.workspaceRevision !== "string") throw new Error("Could not verify the current workspace. Reload and try again.");
      await changeWorkspace("migrate-browser-workspace", { backup: legacyWorkspace, expectedRevision: latest.workspaceRevision });
      setLegacyWorkspace(null);
      setLegacyReviewOpen(false);
      if (replaceSaved) {
        setCurrentDraftId(null);
        setCurrentDraftVersion(null);
        setBatchLaunch(null);
        setBatchReviewState({ dirty: false, busy: false });
        setDraftConflict(false);
        setPendingDraftSave(null);
        setStrategyRefreshEpoch((epoch) => epoch + 1);
      }
      try { localStorage.setItem(WORKSPACE_KEY, JSON.stringify(emptyWorkspace())); }
      catch { setStorageWarning(true); }
      setNotice({ kind: "success", text: replaceSaved ? "Older browser drafts and plans replaced the account copies. Hand-offs were merged." : "Older browser hand-offs were added. Existing account data was kept." });
    } catch (error) {
      setLegacyImportError(error instanceof Error ? error.message : "Could not import browser data.");
    } finally {
      setLegacyImportBusy(false);
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
      if ((error as { code?: string }).code === "ASSISTED_CONFLICT") await refreshWorkspace().catch(() => {});
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not update assisted publishing." });
      return false;
    } finally {
      assistedMutation.current = false;
      setAssistedBusy(false);
    }
  }

  async function addAssistedPost(videoId?: string, selectedMediaIds?: string[]): Promise<boolean> {
    if (mediaBusyRef.current) {
      setNotice({ kind: "error", text: "Wait for the image operation to finish before saving this handoff." });
      return false;
    }
    const text = assistText.trim();
    const scheduledFor = assistTime ? new Date(assistTime) : new Date();
    if (!text || characterCount(text) > 5000) {
      setNotice({ kind: "error", text: "Add text of up to 5,000 characters before saving." });
      return false;
    }
    if (isPlatformId(assistDestination)) {
      const validation = validatePlatformText(assistDestination, text);
      if (!validation.valid) {
        setNotice({ kind: "error", text: validation.issues.find((issue) => issue.severity === "error")?.message ?? "Review the platform draft before saving." });
        return false;
      }
    }
    if (!Number.isFinite(scheduledFor.getTime()) || (assistTime && scheduledFor.getTime() <= Date.now())) {
      setNotice({ kind: "error", text: "Choose a future reminder time, or leave it blank for now." });
      return false;
    }
    if (assisted.length >= 100) {
      setNotice({ kind: "error", text: "The assisted publishing list is full. Remove an old item first." });
      return false;
    }
    const handoffMediaIds = selectedMediaIds ?? mediaIds.slice(0, imageLimitForDestination(assistDestination, Boolean(videoId)));
    if (handoffMediaIds.length > imageLimitForDestination(assistDestination, Boolean(videoId)) ||
        new Set(handoffMediaIds).size !== handoffMediaIds.length ||
        handoffMediaIds.some((id) => !mediaIds.includes(id))) {
      setNotice({ kind: "error", text: "Review the selected images for this platform before saving." });
      return false;
    }
    const item: AssistedPost = {
      id: crypto.randomUUID(),
      title: draftTitle(title, text),
      destination: assistDestination,
      text,
      mediaIds: [...handoffMediaIds],
      mediaAlt: handoffMediaIds.map((id) => mediaAlt[mediaIds.indexOf(id)]?.trim() ?? ""),
      ...(placeLabel.trim() ? { placeLabel: placeLabel.trim() } : {}),
      ...(videoId ? { videoId } : {}),
      scheduledFor: scheduledFor.toISOString(),
      ...(!assistTime ? { reminderEnabled: false } : {}),
      createdAt: new Date().toISOString(),
      status: "queued",
    };
    if (await runAssistedAction("add-assisted", { item }, `Added ${assistedDestinations[assistDestination].name} to your assisted publishing list. You will publish it yourself.`)) {
      setNow(Date.now());
      setAssistTime("");
      setAssistOverrides((current) => {
        const next = { ...current };
        delete next[assistDestination];
        return next;
      });
      return true;
    }
    return false;
  }

  async function prepareAssistedBatch(draftId: string, expectedUpdatedAt: string, batchId: string, items: BatchHandoffItem[], requireFreeSlots: boolean): Promise<BatchPrepareResult> {
    if (editorDirty || currentDraftId !== draftId || mediaBusyRef.current || videoBusyRef.current || draftSaveBusyRef.current) {
      setNotice({ kind: "error", text: "Save your latest draft changes before preparing handoffs." });
      return "rejected";
    }
    if (assistedMutation.current) return "rejected";
    assistedMutation.current = true;
    setAssistedBusy(true);
    try {
      await changeWorkspace("prepare-assisted-batch", { draftId, expectedUpdatedAt, batchId, items, requireFreeSlots });
      setNotice({ kind: "success", text: `Prepared ${items.length} manual ${items.length === 1 ? "handoff" : "handoffs"} from your saved draft. Nothing was posted.` });
      setNow(Date.now());
      return "prepared";
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not prepare handoffs." });
      const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
      if (status === 409) void refreshWorkspace().catch(() => undefined);
      return typeof status === "number" && status >= 400 && status < 500 ? "rejected" : "uncertain";
    } finally {
      assistedMutation.current = false;
      setAssistedBusy(false);
    }
  }

  async function copyAssisted(text: string, destination: AssistedDestinationId, mode: "saved" | "editing" | "conflict" | "removed") {
    try {
      await navigator.clipboard.writeText(text);
      setNotice({ kind: "success", text: mode === "removed"
        ? "Unsaved text copied. Put it in a new draft before closing this temporary copy."
        : mode === "conflict"
          ? "Unsaved text copied. Review the latest handoff before saving or publishing it."
        : mode === "editing"
          ? "Current edit copied. Save it in Plypost before marking the post as published."
          : `${assistedDestinations[destination].name} text copied. Open the platform and paste it there.` });
    } catch {
      setNotice({ kind: "error", text: "Clipboard access is unavailable. Open Post details to select the text manually." });
    }
  }

  async function markAssistedPosted(post: AssistedPost, postUrl?: string) {
    return runAssistedAction("set-assisted-status", { id: post.id, status: "posted", expectedContent: assistedContentSnapshot(post),
      ...(postUrl ? { postUrl } : {}) }, "Marked as posted by you. Plypost did not verify the platform post.");
  }

  async function updateAssistedPostUrl(id: string, postUrl: string | null, expectedReceipt: AssistedReceiptSnapshot): Promise<boolean> {
    return runAssistedAction("set-assisted-status", { id, status: "posted", postUrl, expectedReceipt }, postUrl === null
      ? "Recorded link removed. Your posted mark and completion time were kept."
      : "Recorded link saved. Plypost did not verify the platform post.");
  }

  async function updateAssistedSavedText(id: string, expectedText: string, text: string): Promise<boolean> {
    if (assistedMutation.current) return false;
    assistedMutation.current = true;
    setAssistedBusy(true);
    try {
      await changeWorkspace("update-assisted-text", { id, expectedText, text });
      setNotice({ kind: "success", text: "Saved handoff text updated. Its reminder, media and source draft were kept." });
      return true;
    } catch (error) {
      if ((error as { code?: string }).code === "ASSISTED_CONFLICT") {
        await refreshWorkspace().catch(() => {});
      }
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not update saved handoff text." });
      return false;
    } finally {
      assistedMutation.current = false;
      setAssistedBusy(false);
    }
  }

  async function updateAssistedVideo(id: string, expectedVideoId: string | null, videoId: string | null): Promise<boolean> {
    if (assistedMutation.current) return false;
    assistedMutation.current = true;
    setAssistedBusy(true);
    try {
      await changeWorkspace("update-assisted-video", { id, expectedVideoId, videoId });
      setNotice({ kind: "success", text: videoId ? "Video attached to this handoff." : "Video removed from this handoff." });
      return true;
    } catch (error) {
      if ((error as { code?: string }).code === "ASSISTED_CONFLICT") await refreshWorkspace().catch(() => {});
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not update the handoff video." });
      return false;
    } finally {
      assistedMutation.current = false;
      setAssistedBusy(false);
    }
  }

  async function updateAssistedImages(id: string, expectedMediaIds: string[], expectedMediaAlt: string[], mediaIds: string[], mediaAlt: string[]): Promise<boolean> {
    if (assistedMutation.current) return false;
    assistedMutation.current = true;
    setAssistedBusy(true);
    try {
      await changeWorkspace("update-assisted-images", { id, expectedMediaIds, expectedMediaAlt, mediaIds, mediaAlt });
      setNotice({ kind: "success", text: "Images updated for this handoff. Its text, reminder and source draft were kept." });
      return true;
    } catch (error) {
      if ((error as { code?: string }).code === "ASSISTED_CONFLICT") await refreshWorkspace().catch(() => {});
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not update handoff images." });
      return false;
    } finally {
      assistedMutation.current = false;
      setAssistedBusy(false);
    }
  }

  async function updateAssistedDescriptions(id: string, expectedMediaIds: string[], expectedMediaAlt: string[], nextMediaAlt: string[]): Promise<boolean> {
    if (assistedMutation.current) return false;
    assistedMutation.current = true;
    setAssistedBusy(true);
    try {
      await changeWorkspace("update-assisted-media-alt", { id, expectedMediaIds, expectedMediaAlt, mediaAlt: nextMediaAlt });
      setNotice({ kind: "success", text: "Image descriptions updated for this handoff. Its images, reminder and source draft were kept." });
      return true;
    } catch (error) {
      if ((error as { code?: string }).code === "ASSISTED_CONFLICT") await refreshWorkspace().catch(() => {});
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not update image descriptions." });
      return false;
    } finally {
      assistedMutation.current = false;
      setAssistedBusy(false);
    }
  }

  async function updateAssistedOutcome(id: string, outcome: AssistedOutcomeInput | null, expectedReceipt: AssistedReceiptSnapshot): Promise<boolean> {
    return runAssistedAction("set-assisted-outcome", { id, outcome, expectedReceipt }, outcome
      ? "Your self-reported result was saved. Plypost did not verify these metrics with the platform."
      : "Your self-reported result was removed.");
  }

  async function undoAssistedPosted(id: string, expectedReceipt: AssistedReceiptSnapshot) {
    return runAssistedAction("set-assisted-status", { id, status: "queued", expectedReceipt, confirmRecordRemoval: true }, "Post returned to your assisted publishing checklist.");
  }

  async function removeAssisted(post: AssistedPost) {
    if (!window.confirm("Remove this assisted post from your account?")) return;
    await runAssistedAction("delete-assisted", { id: post.id, expectedState: assistedDeletionSnapshot(post) }, "Assisted post removed from your account.");
  }

  async function enableNotifications() {
    if (!("Notification" in window)) return;
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission !== "granted") setNotice({ kind: "error", text: "Browser alerts were not enabled. Due posts will still appear in this page." });
  }

  async function requestSignOut() {
    if (logoutBusy) return;
    if (draftSaveBusy || switchSaving || assistedBusy || backupBusy || restoringBackup || mediaBusy || videoBusy || legacyImportBusy || batchReviewState.busy) {
      setNotice({ kind: "error", text: "Wait for the current save, restore or upload to finish before signing out." });
      return;
    }
    const unsaved = [
      editorDirty && "draft edits",
      batchReviewState.dirty && "unconfirmed handoff review edits",
      strategyDirty && "brand profile or AI idea edits",
      assistedDirty && "manual posting edits",
      pendingDraftSave && "an unconfirmed draft save",
    ].filter(Boolean);
    if (unsaved.length && !window.confirm(`Sign out and leave ${unsaved.join(", ")}? These changes will not be saved automatically.`)) return;
    await onLogout();
  }

  if (!hydrated) return <div role="status" className="app-shell flex min-h-screen items-center justify-center text-[14px] text-[var(--text-muted)]">Opening workspace…</div>;

  return (
    <>
    <div inert={restoringBackup} className="app-shell min-h-screen lg:flex">
      <aside id="desktop-sidebar" className={`app-sidebar sticky top-0 hidden h-screen shrink-0 flex-col py-5 transition-[width,padding] duration-200 lg:flex ${sidebarCollapsed ? "w-[72px] px-3" : "w-[228px] px-4"}`}>
        <button type="button" onClick={() => setSidebarCollapsed((current) => !current)} aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!sidebarCollapsed} className={`flex w-full items-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${sidebarCollapsed ? "justify-center" : "gap-3 px-2"}`} title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
          <Image src="/plypost-mark.svg" alt="" width={40} height={40} className="h-10 w-10 shrink-0" />
          {!sidebarCollapsed && <span className="text-[22px] font-semibold tracking-[-0.05em]">Plypost<span className="sidebar-accent">.</span></span>}
        </button>
        {!sidebarCollapsed && <div className="sidebar-muted mt-10 px-3 text-[12px] font-medium">Workspace</div>}
        <SidebarNavigation view={view} collapsed={sidebarCollapsed} onNavigate={(next) => { if (next === "assisted") setFocusedAssistedId(null); openView(next); }} />
      </aside>

      {mobileSidebarOpen && <>
        <button type="button" aria-label="Close navigation" onClick={() => { setMobileSidebarOpen(false); window.requestAnimationFrame(() => mobileHeaderToggleRef.current?.focus()); }} className="fixed inset-0 z-40 bg-slate-950/50 lg:hidden" />
        <aside ref={mobileSidebarRef} id="mobile-sidebar" role="dialog" aria-modal="true" aria-label="Navigation" className="app-sidebar fixed inset-y-0 left-0 z-50 flex w-[min(82vw,280px)] flex-col overflow-y-auto border-r px-4 py-7 shadow-2xl lg:hidden">
          <button ref={mobileSidebarCloseRef} type="button" onClick={() => { setMobileSidebarOpen(false); window.requestAnimationFrame(() => mobileHeaderToggleRef.current?.focus()); }} aria-label="Close sidebar" className="flex items-center gap-3 rounded-lg px-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">
            <Image src="/plypost-mark.svg" alt="" width={40} height={40} className="h-10 w-10 shrink-0" />
            <span className="text-[21px] font-bold tracking-[-0.055em]">Plypost<span className="sidebar-accent">.</span></span>
          </button>
          <div className="sidebar-muted mt-10 px-3 text-[12px] font-medium">Workspace</div>
          <SidebarNavigation view={view} collapsed={false} onNavigate={(next) => { if (next === "assisted") setFocusedAssistedId(null); openView(next); }} />
        </aside>
      </>}

      <div inert={mobileSidebarOpen} className="min-w-0 flex-1">
        <header className="app-header sticky top-0 z-30 flex min-h-[56px] items-center justify-between gap-3 px-5 sm:px-8 lg:px-10">
          <button ref={mobileHeaderToggleRef} type="button" onClick={() => setMobileSidebarOpen(true)} aria-label="Open sidebar" aria-expanded={mobileSidebarOpen} className="flex items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] lg:hidden"><Image src="/plypost-mark.svg" alt="" width={32} height={32} className="h-8 w-8 shrink-0" /><span className="text-[18px] font-bold tracking-[-0.05em]">Plypost<span className="text-[var(--accent-text)]">.</span></span></button>
          <div className="hidden items-center gap-2 text-[13px] text-[var(--text-muted)] lg:flex"><span>Workspace</span><span>/</span><span className="font-semibold text-[var(--text)]">{viewLabels[view]}</span></div>
          <div className="ml-auto flex items-center gap-3"><ThemeSwitcher /><button type="button" onClick={() => openView("account")} aria-label="Open account" className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] text-[var(--text-secondary)]"><UserRound size={17} /></button></div>
        </header>

        <main className="app-main mx-auto px-5 pb-16 pt-6 sm:px-8 lg:px-10 lg:pt-8">
          {legacyStorageError && <div role="alert" className="mb-5 rounded-xl border border-[var(--warning)] bg-[var(--warning-soft)] px-4 py-3 text-[13px] text-[var(--warning)]">Older browser data could not be validated. It was left unchanged; check it before clearing this browser's storage.</div>}
          {view !== "compose" && (batchReviewState.dirty || batchReviewState.busy) && <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] px-4 py-3 text-[13px] text-[var(--text-secondary)]"><span>Your unconfirmed handoff review is still open in Create.</span><button type="button" onClick={() => openView("compose")} className="font-bold text-[var(--accent-text)]">Continue review →</button></div>}
          {legacyWorkspace && <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] px-4 py-3 text-[13px] text-[var(--text-secondary)]"><span>Found {legacyWorkspace.drafts.length} drafts, {legacyWorkspace.schedule.length} planned items and {legacyWorkspace.assisted.length} assisted items in older browser storage. Review before moving them into this account.</span><button type="button" onClick={() => { setLegacyImportError(null); setLegacyReviewOpen(true); }} className="font-bold text-[var(--accent-text)]">Review migration →</button></div>}
          {(view === "compose" || batchReviewState.dirty || batchReviewState.busy) && <div id="compose" hidden={view !== "compose"} className="section-anchor compose-workspace mx-auto max-w-[1180px]">
          <div className="compose-title-row mb-7 flex flex-wrap items-center justify-between gap-3">
            <div><h1 className="text-[28px] font-semibold tracking-[-0.035em] text-[var(--text)]">Create a post</h1></div>
            <button type="button" onClick={newDraft} className="compose-new-draft inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-[13px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"><Plus size={16} aria-hidden="true" />New draft</button>
          </div>
          {otherEditorCopies.length > 0 && <details className="compose-recovery mb-5 text-[13px] text-[var(--text-secondary)]">
            <summary className="cursor-pointer font-semibold text-[var(--text)]">{otherEditorCopies.length} recoverable browser {otherEditorCopies.length === 1 ? "copy" : "copies"}</summary>
            <p className="mt-2 text-[12px] text-[var(--text-muted)]">Copies may come from another tab or a closed session. Save current edits first; opening a copy keeps its original. Download unreadable copies to inspect their raw text.</p>
            <ul className="mt-2 divide-y divide-[var(--line)]">{otherEditorCopies.map((copy) => <li key={copy.tabId} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="min-w-0 truncate" title={copy.preview}>{copy.preview}</span>
              <span className="flex shrink-0 items-center gap-3">{copy.unreadable
                ? <button type="button" onClick={() => downloadBrowserCopy(copy.value)} className="font-semibold text-[var(--accent-text)]">Download raw copy</button>
                : <button type="button" onClick={() => recoverEditorCopy(copy)} className="font-semibold text-[var(--accent-text)]">Open copy</button>}<button type="button" onClick={() => discardEditorCopy(copy)} className="font-semibold text-[var(--danger)]">Remove copy</button></span>
            </li>)}</ul>
          </details>}
          {unreadableEditorCopy !== null && <div role="alert" className="mb-5 rounded-xl border border-[var(--warning)] bg-[var(--warning-soft)] px-4 py-3 text-[13px] leading-5 text-[var(--warning)]">A browser editor copy could not be read. Its original text was kept. <button type="button" onClick={() => downloadBrowserCopy(unreadableEditorCopy)} className="font-bold underline underline-offset-2">Download raw copy</button> and keep the file private.{editorCacheWriteBlockedRef.current && " Browser autosave is unavailable until storage works again; save new work to your account."}</div>}
          <div className="compose-workspace-grid">
              <section className="compose-editor min-w-0" aria-labelledby="draft-heading">
                <h2 id="draft-heading" className="sr-only">{currentDraftId ? "Edit draft" : "New post"}</h2>
                <div className="compose-editor-body">
                  <div className="compose-channels">
                    <div className="compose-channel-heading"><h3 className="text-[13px] font-medium text-[var(--text-muted)]">Post to</h3></div>
                    <div role="group" aria-label="Editable photo and text destinations" className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                      {platformDisplayIds.map((id) => {
                        const isSelected = selected.includes(id);
                        return <button key={id} type="button" aria-pressed={isSelected} onClick={() => togglePlatform(id)} className={`channel-choice inline-flex min-h-9 min-w-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition ${isSelected ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]" : "border-[var(--line)] bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"}`}><PlatformMark id={id} size="small" /><span className="min-w-0 truncate">{platforms[id].name}</span>{isSelected && <Check size={15} strokeWidth={2.4} className="ml-auto shrink-0 text-[var(--accent-text)]" aria-hidden="true" />}</button>;
                      })}
                    </div>
                    {selected.map((id) => imageLimitWarning(id, mediaIds.length, Boolean(videoId))).filter((warning): warning is string => Boolean(warning)).map((warning) => <p key={warning} role="status" className="mt-2 flex items-start gap-1.5 rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-[12px] leading-5 text-[var(--warning)]"><CircleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />{warning}</p>)}
                    <details className="compose-other-channels mt-3">
                      <summary className="cursor-pointer text-[12px] font-semibold text-[var(--text-secondary)]">More channels</summary>
                      <p className="mb-2 mt-4 text-[12px] font-medium text-[var(--text-muted)]">Manual posting · Photo and text</p>
                    <div role="group" aria-label="Manual photo and text destinations" className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                      {assistedTextImageOnlyDisplayIds.map((id) => <button key={id} type="button" onClick={() => openManualComposer(id)} aria-label={`Prepare a manual post for ${assistedDestinations[id].name}`} className="inline-flex min-w-0 items-center justify-between gap-1.5 rounded-xl border border-[var(--line)] bg-[var(--field)] px-2 py-2 text-[13px] font-semibold text-[var(--text-secondary)] transition hover:border-[var(--accent-border)] hover:text-[var(--accent-text)] sm:px-3 sm:text-[13px]"><span className="truncate">{id === "facebook" ? "Facebook" : assistedDestinations[id].name}</span><ArrowRight size={13} className="shrink-0" aria-hidden="true" /></button>)}
                    </div>
                    <div className="mt-4 border-t border-[var(--line)] pt-4">
                      <h4 className="mb-2 text-[11px] font-semibold text-[var(--text-muted)]">Video</h4>
                      <div role="group" aria-label="Video-first destinations" className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                        {assistedVideoDisplayIds.map((id) => <button key={id} type="button" onClick={() => openManualComposer(id)} className="inline-flex min-w-0 items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[13px] font-semibold text-[var(--text-secondary)] transition hover:border-[var(--accent-border)] hover:text-[var(--accent-text)]"><span className="truncate">{assistedDestinations[id].name}</span><ArrowRight size={13} className="shrink-0" aria-hidden="true" /></button>)}
                      </div>
                    </div>
                    </details>
                  </div>
                  <label htmlFor="source-draft" className="sr-only">Your message</label>
                  <div className="compose-writing-surface relative">
                    <textarea ref={sourceInputRef} id="source-draft" value={source} onChange={(event) => { const nextSource = event.target.value; if (characterCount(nextSource) > 3000) { setNotice({ kind: "error", text: "The source draft can have up to 3,000 characters." }); return; } editorRevision.current += 1; setTitle((current) => followAutoTitle(current, editorTitleSource(source, variants), editorTitleSource(nextSource, variants))); setSource(nextSource); setNotice(null); }} placeholder="What would you like to share?" className="compose-textarea w-full resize-y border-0 bg-transparent px-0 py-1 text-[19px] leading-[1.65] text-[var(--text)] placeholder:text-[var(--text-soft)]" />

                  </div>
                  <div className="compose-extras flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Post extras">                    <button type="button" aria-label="Add photo or video" title="Add photo or video" aria-expanded={showAttachments} aria-controls="draft-media-panel" onClick={() => setShowAttachments((open) => !open)} className="compose-media-button inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"><Plus size={16} aria-hidden="true" />{mediaIds.length || videoId ? `${mediaIds.length} ${mediaIds.length === 1 ? "photo" : "photos"}${videoId ? " · 1 video" : ""}` : "Media"}</button>
                    <button type="button" onClick={() => setShowEmojiPicker((open) => !open)} aria-label="Insert emoji" aria-expanded={showEmojiPicker} className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--accent-text)]"><Smile size={19} aria-hidden="true" /></button>
                    <button type="button" onClick={() => setShowPlaceField((open) => !open)} aria-label="Add place note" aria-expanded={showPlaceField || Boolean(placeLabel)} className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--accent-text)]"><MapPin size={19} aria-hidden="true" /></button>
                    <button type="button" onClick={() => { if (draftDetailsRef.current) { draftDetailsRef.current.open = true; draftDetailsRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" }); } }} aria-label="Set target day" className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--accent-text)]"><Clock3 size={19} aria-hidden="true" /></button>
                    <button type="button" onClick={() => { const input = sourceInputRef.current; const start = input?.selectionStart ?? source.length; const end = input?.selectionEnd ?? start; const next = `${source.slice(0, start)}#${source.slice(end)}`; if (characterCount(next) > 3000) return; editorRevision.current += 1; setTitle((current) => followAutoTitle(current, editorTitleSource(source, variants), editorTitleSource(next, variants))); setSource(next); requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(start + 1, start + 1); }); }} aria-label="Insert hashtag" className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--accent-text)]"><Hash size={19} aria-hidden="true" /></button>
                  </div>
                  <span className="tabular-nums text-[12px] text-[var(--text-soft)]">{characterCount(source)} / 3,000</span>
                  </div>
                  {showEmojiPicker && <div className="mt-2 flex flex-wrap gap-1 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] p-2" aria-label="Choose an emoji">{["😀", "😂", "😍", "🙌", "👏", "❤️", "🔥", "✨", "🎉", "💡", "📣", "📍", "✅", "🚀", "👀", "🤝"].map((emoji) => <button key={emoji} type="button" onClick={() => { const input = sourceInputRef.current; const start = input?.selectionStart ?? source.length; const end = input?.selectionEnd ?? start; const next = `${source.slice(0, start)}${emoji}${source.slice(end)}`; if (characterCount(next) > 3000) return; editorRevision.current += 1; setTitle((current) => followAutoTitle(current, editorTitleSource(source, variants), editorTitleSource(next, variants))); setSource(next); setShowEmojiPicker(false); requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(start + emoji.length, start + emoji.length); }); }} aria-label={`Insert ${emoji}`} className="rounded-lg px-2 py-1.5 text-[20px] hover:bg-[var(--surface-hover)]">{emoji}</button>)}</div>}{/* taste-skill-ignore: functional emoji picker */}
                  {(showPlaceField || placeLabel) && <div className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] p-3"><label htmlFor="draft-place" className="block text-[12px] font-semibold text-[var(--text-secondary)]">Place note <span className="font-normal text-[var(--text-soft)]">· optional</span></label><input id="draft-place" value={placeLabel} onChange={(event) => { editorRevision.current += 1; setPlaceLabel(Array.from(event.target.value).filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join("")); }} maxLength={120} placeholder="e.g. Central, Hong Kong" className="mt-2 w-full rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[16px] text-[var(--text)] outline-none focus:border-[var(--accent-border)]" /><p className="mt-1.5 text-[11px] text-[var(--text-soft)]">Saved as a reminder for manual publishing. No location is read from your device or tagged automatically.</p></div>}
                  {(mediaIds.length > 0 || videoId) && <ul aria-label="Attached media" className="media-strip mt-2 flex gap-2 overflow-x-auto pb-2">
                    {mediaIds.map((id, index) => <li key={id} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface-muted)]">
                      <Image unoptimized src={`/api/media/${encodeURIComponent(id)}?thumb=1`} alt={`Attached photo ${index + 1}`} fill sizes="64px" className="object-cover" />
                      <button type="button" aria-label={`Remove photo ${index + 1} from draft`} title="Remove from draft" disabled={mediaBusy || restoringBackup} onClick={() => { editorRevision.current += 1; setMediaIds((current) => current.filter((item) => item !== id)); }} className="absolute right-0.5 top-0.5 rounded-full bg-black/70 p-1 text-white hover:bg-black disabled:opacity-50"><X size={12} aria-hidden="true" /></button>
                    </li>)}
                    {videoId && <li className="relative flex h-16 min-w-24 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-3 text-[11px] font-semibold text-[var(--text-secondary)]"><Video size={17} aria-hidden="true" />Video
                      <button type="button" aria-label="Remove video from draft" title="Remove from draft" disabled={videoBusy || restoringBackup} onClick={() => { editorRevision.current += 1; setVideoId(null); }} className="absolute right-0.5 top-0.5 rounded-full bg-[var(--surface)] p-1 text-[var(--text-secondary)] hover:text-[var(--danger)] disabled:opacity-50"><X size={12} aria-hidden="true" /></button>
                    </li>}
                  </ul>}
                  <div id="draft-media-panel" hidden={!showAttachments} className="mt-3 rounded-xl border border-[var(--line)] px-4 pb-4">
                    <div className="mt-3"><ImageAttachmentPicker
                    key={mediaPickerEpoch}
                    selectedIds={mediaIds}
                    descriptions={mediaAltById}
                    disabled={restoringBackup}
                    onChange={(ids) => { if (mediaPickerEpochRef.current === mediaPickerEpoch) { editorRevision.current += 1; setMediaIds(ids); } }}
                    onDescriptionChange={(id, description) => { if (mediaPickerEpochRef.current === mediaPickerEpoch) { editorRevision.current += 1; setMediaAltById((current) => ({ ...current, [id]: description })); } }}
                    onBusyChange={(busy) => {
                      if (mediaPickerEpochRef.current !== mediaPickerEpoch) return;
                      mediaBusyRef.current = busy;
                      setMediaBusy(busy);
                    }}
                    /></div>
                    <div className="mt-4"><VideoAttachmentPicker selectedId={videoId} onChange={(id) => { editorRevision.current += 1; setVideoId(id); }} onBusyChange={(busy) => { videoBusyRef.current = busy; setVideoBusy(busy); }} disabled={restoringBackup} /></div>
                  </div>
                  <CaptionComposer source={source} revision={editorRevision.current} editorEpoch={mediaPickerEpoch} profileRefreshEpoch={strategyRefreshEpoch} mediaIds={mediaIds} videoId={videoId} selectedCount={selected.length} generating={generating} hasReview={Boolean(aiReview)}
                    onGenerate={(useVoice) => { void generateVariants(useVoice); }}
                    onUseDraft={(draft, expectedSource, expectedRevision) => {
                      if (source !== expectedSource || editorRevision.current !== expectedRevision || !draft || characterCount(draft) > 3000) return false;
                      editorRevision.current += 1;
                      setTitle((current) => followAutoTitle(current, editorTitleSource(source, variants), editorTitleSource(draft, variants)));
                      setSource(draft);
                      setAiReview(null);
                      setNotice({ kind: "success", text: "AI draft added. Check the wording and facts before sharing." });
                      return true;
                    }} />
                  {aiReview && <AIReviewPanel key={aiReview.generation}
                    source={aiReview.source}
                    original={aiReview.original}
                    suggestions={aiReview.suggestions}
                    available={aiReview.platforms}
                    selected={aiApplyIds}
                    stale={editorRevision.current !== aiReview.revision || source !== aiReview.source ||
                      platformIds.some((id) => variants[id] !== aiReview.original[id])}
                    busy={generating}
                    onToggle={(id) => setAiApplyIds((current) => current.includes(id)
                      ? current.filter((item) => item !== id)
                      : aiReview.platforms.filter((item) => current.includes(item) || item === id))}
                    onEdit={(id, text) => {
                      setAiReview((current) => current ? { ...current, suggestions: { ...current.suggestions, [id]: text } } : current);
                      const details = compareAiLiterals(source, text);
                      if (details.missing.length || details.added.length) setAiApplyIds((current) => current.filter((item) => item !== id));
                    }}
                    onApply={applyAIReview}
                    onDiscard={() => { setAiReview(null); setNotice(null); requestAnimationFrame(() => sourceInputRef.current?.focus()); }}
                  />}
                  {aiUndo && <button type="button" onClick={() => { editorRevision.current += 1; setVariants(aiUndo); setAiUndo(null); setAiReview(null); setNotice({ kind: "success", text: "Previous platform drafts restored." }); }} className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--accent-text)]"><RotateCcw size={13} /> Undo AI changes</button>}
                  <div className="compose-footer">
                  <details ref={draftDetailsRef} className="compose-details">
                    <summary className="cursor-pointer text-[13px] text-[var(--text-secondary)]">Details{plannedDate ? ` · ${plannedDate}` : ""}</summary>
                    <label htmlFor="draft-name" className="mb-2 mt-4 block text-[12px] font-bold text-[var(--text-secondary)]">Draft name <span className="font-normal text-[var(--text-soft)]">(optional)</span></label>
                    <input id="draft-name" value={title} onChange={(event) => { if (characterCount(event.target.value) > 120) return; editorRevision.current += 1; setTitle(event.target.value); }} placeholder="Give this idea a name" className="w-full rounded-xl border border-[var(--line)] bg-[var(--field)] px-4 py-3 text-[16px] outline-none focus:border-[var(--accent-border)]" />
                    <div className="mt-3"><LocalDateField id="draft-planned-date" label="Target day" value={plannedDate} onChange={(next) => { editorRevision.current += 1; setPlannedDate(next); }} /></div>
                  </details>
                  {needsDraftRecovery && currentDraftId && <div role="alert" className="mt-6 rounded-xl border border-[var(--warning)] bg-[var(--warning-soft)] px-4 py-3 text-[12px] leading-5 text-[var(--warning)]"><p className="font-bold">This draft changed in another window or was deleted.</p><p className="mt-1">Your current editor text is still here. Save it as a new draft, or open the latest saved version after reviewing any unsaved changes.</p><div className="mt-3 flex flex-wrap gap-3"><button type="button" onClick={() => { void saveDraft(false, true); }} disabled={!canSaveEditor || mediaBusy || videoBusy || draftSaveBusy} className="font-bold underline underline-offset-2 disabled:opacity-50">Save as new draft</button><button type="button" onClick={() => { void openLatestDraft(); }} disabled={draftSaveBusy} className="font-bold underline underline-offset-2 disabled:opacity-50">Open latest saved version</button></div></div>}
                  {pendingDraftSave && <div role="status" className="mt-6 rounded-xl border border-[var(--warning)] bg-[var(--warning-soft)] px-4 py-3 text-[12px] leading-5 text-[var(--warning)]"><p className="font-bold">Save result not confirmed</p><p className="mt-1">Your editor content is still here. Check the save below when the service responds; Plypost will verify it before writing again.</p></div>}
                  {invalidSelected.length > 0 && <p className="mt-4 flex items-start gap-1.5 text-[12px] leading-5 text-[var(--danger)]"><CircleAlert size={14} className="mt-0.5 shrink-0" /> Review empty or over-limit drafts: {invalidSelected.map((id) => platforms[id].name).join(", ")}.</p>}
                  <div className="compose-actions mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
                    <button type="button" onClick={() => { void saveDraft(); }} disabled={!canSaveEditor || mediaBusy || videoBusy || draftSaveBusy || needsDraftRecovery} className="inline-flex min-h-10 items-center rounded-lg border border-[var(--line)] px-4 text-[13px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50">{mediaBusy ? "Working with images…" : videoBusy ? "Working with video…" : draftSaveBusy ? "Saving…" : pendingDraftSave ? "Check save" : currentDraftId ? "Update draft" : "Save draft"}</button>
                    <button type="button" onClick={() => void prepareEditorHandoffs()} disabled={!canSaveEditor || !(source.trim() || platformDisplayIds.some((id) => variants[id]?.trim())) || mediaBusy || videoBusy || draftSaveBusy || restoringBackup || needsDraftRecovery} className="compose-review-button inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-5 text-[13px] font-semibold disabled:opacity-45">{draftSaveBusy ? "Saving…" : "Review posts"}<ArrowRight size={14} /></button>
                  </div>
                  <div className="compose-save-status mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12px] text-[var(--text-muted)]"><p>Only published after your review.</p>{(editorDirty || pendingDraftSave) && <span role="status" className={pendingDraftSave ? "text-[var(--warning)]" : ""}>{pendingDraftSave ? "Save unconfirmed" : "Unsaved changes"}</span>}</div>
                  </div>
                </div>
              </section>
              <section className="compose-preview min-w-0" aria-labelledby="preview-heading"><div className="compose-preview-content">
                <div className="compose-preview-heading flex items-center justify-between gap-3"><h2 id="preview-heading" className="text-[14px] font-semibold text-[var(--text)]">Post preview</h2><span className="text-[12px] text-[var(--text-muted)]">{selected.length ? `${selected.length} ${selected.length === 1 ? "version" : "versions"}` : "No channel selected"}</span></div>
                {selected.length > 0 ? <>
                <div className="preview-tabs mobile-x-scroll flex gap-1 border-b border-[var(--line)]" role="tablist" aria-label="Platform previews">{platformDisplayIds.filter((id) => selected.includes(id)).map((id) => <button key={id} type="button" role="tab" aria-selected={active === id} onClick={() => setActive(id)} className={`relative flex shrink-0 items-center gap-1.5 px-3 py-4 text-[13px] font-semibold transition sm:text-[13px] ${active === id ? "text-[var(--accent-text)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}>{platforms[id].name}{active === id && <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-[var(--accent)]" />}</button>)}</div>
                {currentValidation.issues.length > 0 && <div role="status" className="space-y-2 pt-5">
                  {currentValidation.issues.map((issue) => <p key={issue.code} className={`flex items-start gap-2 rounded-lg px-3 py-2 text-[12px] leading-5 ${issue.severity === "error" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--warning-soft)] text-[var(--warning)]"}`}>
                    <CircleAlert size={14} className="mt-0.5 shrink-0" />
                    <span>{issue.message}{issue.sourceUrl && <a href={issue.sourceUrl} target="_blank" rel="noopener noreferrer" className="ml-1 underline underline-offset-2">Platform guidance</a>}</span>
                  </p>)}
                </div>}
                <div className="pt-6">
                  <PlatformPreview platform={active} text={currentText} count={currentCount} limit={platforms[active].limit} mediaIds={mediaIds} mediaAlt={mediaAlt} />
                  <details className="platform-text-editor mt-5 border-t border-[var(--line)] pt-4">
                    <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 text-[13px] font-medium text-[var(--text-secondary)] [&::-webkit-details-marker]:hidden"><FilePenLine size={15} aria-hidden="true" /><span className="flex-1">Edit {platforms[active].name} version</span><ChevronDown size={15} aria-hidden="true" /></summary>
                    <div className="pt-3">
                  <div className="mb-2 flex items-center justify-between"><label htmlFor="platform-draft" className="text-[13px] font-bold text-[var(--text-secondary)]">{platforms[active].name} text</label><button type="button" onClick={() => { const next = { ...variants }; delete next[active]; editorRevision.current += 1; setAiUndo(null); setTitle((current) => followAutoTitle(current, editorTitleSource(source, variants), editorTitleSource(source, next))); setVariants(next); }} disabled={variants[active] === undefined} className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--accent-text)] disabled:opacity-40"><RotateCcw size={12} /> Reset</button></div>
                  <textarea id="platform-draft" value={currentText} onChange={(event) => { const next = { ...variants, [active]: event.target.value }; editorRevision.current += 1; setAiUndo(null); setTitle((current) => followAutoTitle(current, editorTitleSource(source, variants), editorTitleSource(source, next))); setVariants(next); }} className="min-h-[160px] w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--field)] px-3.5 py-3 text-[16px] leading-[1.65] text-[var(--text-secondary)] outline-none focus:border-[var(--accent-border)] focus:ring-[3px] focus:ring-[var(--accent-soft)]" />
                  <div className="mt-2 flex items-center justify-between"><span className={`text-[12px] ${!currentValidation.valid ? "font-semibold text-[var(--danger)]" : "text-[var(--text-soft)]"}`}>{!currentValidation.valid ? "Needs attention" : variants[active] !== undefined ? "Custom version" : "Adapted from your draft"}</span><span className={`text-[12px] tabular-nums ${!currentValidation.valid ? "font-bold text-[var(--danger)]" : "text-[var(--text-muted)]"}`}>{currentCount} / {platforms[active].limit}</span></div>
                  <button type="button" onClick={copyCurrent} disabled={!currentText} className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--accent-text)] disabled:opacity-40"><Copy size={13} /> Copy this draft</button>
                    </div>
                  </details>
                </div>
                </> : <div className="preview-empty"><p className="text-[20px] font-medium tracking-[-0.02em] text-[var(--text)]">See it before you share.</p><p className="max-w-[250px] text-[14px] leading-6 text-[var(--text-muted)]">Select a channel to see how your words and photos will appear.</p><div className="preview-channel-starts" aria-label="Start a channel preview">{platformDisplayIds.map((id) => <button key={id} type="button" onClick={() => togglePlatform(id)} aria-label={`Preview on ${platforms[id].name}`}><PlatformMark id={id} size="small" /><span>{platforms[id].name}</span><ArrowRight size={14} aria-hidden="true" /></button>)}</div></div>}
              </div></section>
              {showBlueskyLive && selected.includes("bluesky") && active === "bluesky" && <BlueskyLivePanel connection={blueskyConnection} connectionLoading={blueskyLoading} connectionError={blueskyError} selected active text={textFor("bluesky")} imageCount={mediaIds.length} mediaBusy={mediaBusy} onOpenAccount={() => openView("account")} />}
              {showMastodonLive && selected.includes("mastodon") && active === "mastodon" && <><MastodonLivePanel connection={mastodonConnection} connectionLoading={mastodonLoading} connectionError={mastodonError} selected active text={textFor("mastodon")} imageCount={mediaIds.length} mediaBusy={mediaBusy} onOpenAccount={() => openView("account")} /><button type="button" onClick={() => openView("schedule")} className="text-left text-[13px] font-semibold text-[var(--accent-text)]">See Mastodon scheduling status in Plan →</button></>}
              {batchLaunch && (currentDraftId === batchLaunch.draft.id || batchReviewState.dirty || batchReviewState.busy) && <BatchHandoffPanel key={`${batchLaunch.draft.id}:${batchLaunch.token}`} startExpanded draft={batchLaunch.draft} stale={!currentSavedDraft || currentSavedDraft.updatedAt !== batchLaunch.draft.updatedAt} existing={assisted} now={now} editorDirty={editorDirty} busy={assistedBusy || draftSaveBusy || restoringBackup} mediaBusy={mediaBusy || videoBusy} onPrepare={prepareAssistedBatch} onOpenAssisted={() => { setFocusedAssistedId(null); setOpenAssistedComposer(false); setCollapseAssistedComposerToken((token) => token + 1); openView("assisted"); }} onOpenLatest={currentSavedDraft ? () => void openLatestDraft() : undefined} onStateChange={setBatchReviewState} />}
          </div>
              <details className="mt-4 px-1 text-[12px] text-[var(--text-muted)]"><summary className="cursor-pointer font-semibold">More actions</summary><div className="mt-3 flex flex-wrap items-center gap-4"><button type="button" onClick={() => openView("drafts")} className="font-semibold text-[var(--accent-text)]">Draft library</button><button type="button" onClick={() => openManualComposer()} className="font-semibold text-[var(--accent-text)]">Prepare one manual post</button><button type="button" onClick={simulatePublish} disabled={!canPublish} className="font-semibold text-[var(--accent-text)] disabled:opacity-45">{publishing ? "Simulating…" : "Run demo simulation"}</button></div></details>
          </div>}

          {notice && <div role={notice.persistent ? "alert" : "status"} className={`fixed bottom-4 left-4 right-4 z-50 flex items-start gap-2 rounded-xl border px-4 py-3 text-[13px] leading-5 shadow-xl sm:left-auto sm:max-w-md ${notice.kind === "success" ? "border-[var(--positive)] bg-[var(--positive-soft)] text-[var(--positive)]" : "border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)]"}`}>{notice.kind === "success" ? <CheckCheck size={16} className="shrink-0" /> : <CircleAlert size={16} className="shrink-0" />}<span className="min-w-0 flex-1">{notice.text}</span>{notice.persistent && <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notice" className="shrink-0 rounded p-0.5 hover:bg-black/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"><X size={15} aria-hidden="true" /></button>}</div>}

          {storageWarning ? <div role="alert" className="mt-6 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-[13px] text-[var(--danger)]">Browser storage is unavailable. Unsaved editor text may not survive a reload. Items already saved to your account remain in the database.</div> : recoveryWarning && <p role="status" className="mt-5 text-[12px] text-[var(--text-muted)]">Browser recovery is limited. Save important changes to your account.</p>}

          {view === "drafts" && <div>
            <div className="mb-2"><h1 className="text-[26px] font-semibold tracking-[-0.035em] text-[var(--text)] sm:text-[30px]">Saved ideas</h1><p className="mt-1 text-[14px] text-[var(--text-muted)]">Pick up a post you started earlier.</p></div>
            <DraftLibraryPanel drafts={drafts} assisted={assisted} currentDraftId={currentDraftId} onNew={newDraft} onLoad={loadDraft} onPrepare={prepareDraftHandoffs} onOpenAssisted={(item) => { setFocusedAssistedId(item.id); openView("assisted"); }} onDelete={deleteDraft} />
          </div>}
          <div hidden={view !== "schedule"}>
            <div className="mb-6"><h1 className="text-[26px] font-semibold tracking-[-0.035em] text-[var(--text)] sm:text-[30px]">Publishing plan</h1><p className="mt-1 text-[14px] text-[var(--text-muted)]">{showMastodonQueue ? "Plan drafts, manual handoffs and connected Mastodon posts." : "Plan drafts and manual handoffs in one place."}</p></div>
            <div className="panel-border soft-shadow flex flex-wrap items-center justify-between gap-3 rounded-[18px] bg-[var(--surface)] px-6 py-4 sm:px-7"><div className="min-w-0"><p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-soft)]">Current draft</p><p className="mt-1 truncate text-[14px] font-semibold text-[var(--text)]">{canSaveEditor ? draftTitle(title, source.trim() || platformDisplayIds.map((id) => variants[id]?.trim()).find(Boolean) || "") : "No draft yet"}</p><p className="mt-1 text-[12px] text-[var(--text-muted)]">{selected.length} destinations · {mediaIds.length} {mediaIds.length === 1 ? "image" : "images"}</p></div><button type="button" onClick={() => openView("compose")} className="text-[13px] font-semibold text-[var(--accent-text)]">Edit draft →</button></div>
            <ServerSchedulePanel drafts={drafts} schedule={schedule} assisted={assisted} realMastodon={realMastodonSchedules} showRealMastodon={showMastodonQueue} realQueueError={realMastodonQueueError} value={scheduleTime} now={now} workerLastSeen={workerLastSeen} canSchedule={Boolean(!mediaBusy && scheduleTime && source.trim() && selected.length && invalidSelected.length === 0 && new Date(scheduleTime).getTime() > now + 10_000)} runningId={runningId} onValueChange={setScheduleTime} onAdd={addToPlan} onLoad={loadScheduled} onRun={runScheduled} onReschedule={rescheduleScheduled} onRescheduleAssisted={rescheduleAssistedPost} onRemove={removeScheduled} onOpenAssisted={(item) => { setFocusedAssistedId(item.id); openView("assisted"); }} onOpenDraft={loadDraft} onPrepareDraft={prepareDraftHandoffs} onSetDraftTargetDate={setDraftTargetDate} onOpenRealMastodon={openRealMastodonSchedule} onPrepareManual={(localTime) => { setFocusedAssistedId(null); setAssistTime(localTime); setOpenAssistedComposer(true); openView("assisted"); }} />
            <PostingResultsPanel posts={assisted} onOpenRecord={(item) => { setFocusedAssistedId(item.id); openView("assisted"); }} onReuseText={(item) => requestEditorSwitch({ kind: "assisted", post: item })} />
            <details className="mt-6"><summary className="cursor-pointer rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-[13px] font-bold text-[var(--text-secondary)]">Weekly posting slots · set recurring times for manual handoffs</summary><div className="mt-3"><WeeklySlotsPanel key={slotsRefreshEpoch} /></div></details>
            <div hidden={!showMastodonQueue}><MastodonSchedulePanel items={realMastodonSchedules} onItemsChange={setRealMastodonSchedules} onLoadErrorChange={setRealMastodonQueueError} connection={mastodonConnection} connectionLoading={mastodonLoading} connectionError={mastodonError} selected={selected.includes("mastodon")} text={textFor("mastodon")} imageCount={mediaIds.length} mediaBusy={mediaBusy} now={now} visible={view === "schedule"} workerLastSeen={workerLastSeen} onOpenAccount={() => openView("account")} onOpenEditor={() => openView("compose")} /></div>
            <div className="mt-6"><StrategyPanel drafts={drafts} assisted={assisted} refreshToken={strategyRefreshEpoch} onDirtyChange={setStrategyDirty} onDraftApproved={() => { void refreshWorkspace().catch(() => setNotice({ kind: "error", text: "The idea was approved, but the draft library could not refresh. Reload this page to see it." })); }} onOpenDraft={loadDraft} onOpenAssisted={(item) => { setFocusedAssistedId(item.id); openView("assisted"); }} /></div>
          </div>
          <div hidden={view !== "assisted"}>
            <div className="mb-2"><h1 className="text-[26px] font-semibold tracking-[-0.035em] text-[var(--text)] sm:text-[30px]">Manual posting</h1><p className="mt-1 text-[14px] text-[var(--text-muted)]">Review your checklist and finish each post in its own app.</p></div>
            <AssistedPublishPanel items={assisted} drafts={drafts} active={view === "assisted"} focusItemId={focusedAssistedId ?? undefined} startExpanded={openAssistedComposer} collapseComposerToken={collapseAssistedComposerToken} startWithVideoGroup={openAssistedVideoGroup} destination={assistDestination} text={assistText} customText={assistTextIsCustom} time={assistTime} now={now} workspaceReady={workspaceReady} busy={assistedBusy} mediaBusy={mediaBusy} sourceMediaIds={mediaIds} sourceMediaAlt={mediaAlt} initialVideoId={videoId} notificationPermission={notificationPermission} onDestinationChange={setAssistDestination} onTextChange={setAssistedComposerText} onResetText={resetAssistedComposerText} onTimeChange={setAssistTime} onDirtyChange={setAssistedPanelDirty} onAdd={addAssistedPost} onSetReminder={rescheduleAssistedPost} onCopy={copyAssisted} onMarkPosted={markAssistedPosted} onUpdateText={updateAssistedSavedText} onUpdateVideo={updateAssistedVideo} onUpdateImages={updateAssistedImages} onUpdateDescriptions={updateAssistedDescriptions} onUpdatePostUrl={updateAssistedPostUrl} onUpdateOutcome={updateAssistedOutcome} onUndo={undoAssistedPosted} onRemove={removeAssisted} onEnableNotifications={enableNotifications} onEditImages={() => openView("compose")} onOpenSourceDraft={loadDraft} mastodonInstance={mastodonConnection?.configured ? mastodonConnection.instance : undefined} />
          </div>
          {view === "account" && <AccountPanel email={email} auditLog={auditLog} activity={activity} onClearActivity={() => setActivity([])} onLogout={requestSignOut} logoutBusy={logoutBusy} logoutError={logoutError} mastodonConnection={mastodonConnection} mastodonLoading={mastodonLoading} mastodonError={mastodonError} onRefreshMastodon={refreshMastodonConnection} blueskyConnection={blueskyConnection} blueskyLoading={blueskyLoading} blueskyError={blueskyError} onRefreshBluesky={refreshBlueskyConnection} editorDirty={editorDirty} onExport={exportWorkspace} onImport={importWorkspace} onFullExport={downloadFullBackup} onFullImport={restoreFullBackup} backupBusy={backupBusy} />}
        </main>
      </div>
    </div>
    {restoringBackup && <div ref={restoreOverlayRef} tabIndex={-1} role="alertdialog" aria-modal="true" aria-label="Restoring full backup" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-5 outline-none">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 text-center shadow-2xl">
        <p className="text-[17px] font-bold text-[var(--text)]">{restoreReceiptConfirmed ? "Updating your workspace…" : restoreCancelRequested ? "Stopping restore…" : "Restoring your workspace…"}</p>
        <p className="mt-2 text-[13px] leading-6 text-[var(--text-muted)]">{restoreReceiptConfirmed ? "The backup was restored. Loading your saved work now." : "Large backups can take a few minutes. Keep this tab open while the file is checked and restored."}</p>
        {!restoreReceiptConfirmed && <><button type="button" disabled={restoreCancelRequested} onClick={() => { const controller = restoreAbortRef.current; if (controller) { setRestoreCancelRequested(true); controller.abort(); } }} className="mt-5 rounded-xl border border-[var(--line)] px-4 py-2 text-[13px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50">Stop and check result</button>
        <p className="mt-2 text-[11px] leading-5 text-[var(--text-soft)]">If you stop, reload and check your saved work before trying again.</p></>}
      </div>
    </div>}
    {legacyWorkspace && <dialog ref={legacyReviewRef} onCancel={(event) => { event.preventDefault(); if (!legacyImportBusy) setLegacyReviewOpen(false); }} aria-labelledby="legacy-review-title" aria-describedby="legacy-review-description" className="fixed inset-0 m-auto max-h-[85vh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 text-[var(--text)] shadow-2xl backdrop:bg-black/65 sm:p-7">
      <h2 id="legacy-review-title" className="text-[19px] font-bold tracking-[-0.025em]">Review older browser data</h2>
      <p id="legacy-review-description" className="mt-3 text-[13px] leading-6 text-[var(--text-muted)]">This browser copy has no account label. Check the items below before moving them into <strong className="text-[var(--text)]">{email}</strong>.</p>
      <p className="mt-3 rounded-xl border border-[var(--warning)] bg-[var(--warning-soft)] px-3 py-2 text-[12px] leading-5 text-[var(--warning)]">
        {legacyWorkspace.drafts.length || legacyWorkspace.schedule.length
          ? `Importing replaces this account’s drafts and publishing plan, and clears its AI weekly plans. Existing assisted items stay; missing browser items are added. Due queued plans may be simulated by the worker.${batchReviewState.dirty ? " Your unconfirmed handoff review will be lost." : ""}${strategyDirty ? " Unsaved brand profile or AI idea edits will be lost." : ""}${assistedDirty ? " Unsaved manual posting edits will be lost." : ""}`
          : "Importing adds missing assisted items. This account’s drafts, publishing plan, AI weekly plans and assisted items stay in place."}
      </p>
      <div className="mt-5 max-h-[40vh] space-y-5 overflow-y-auto pr-1">
        {legacyWorkspace.drafts.length > 0 && <section aria-label="Older drafts"><h3 className="text-[12px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">Drafts · {legacyWorkspace.drafts.length}</h3><ul className="mt-2 space-y-2">{legacyWorkspace.drafts.map((draft) => <li key={draft.id} className="rounded-lg border border-[var(--line)] px-3 py-2"><p className="truncate text-[13px] font-semibold">{draftTitle(draft.title, draft.source)}</p><p className="mt-1 line-clamp-2 text-[12px] text-[var(--text-muted)]">{draft.source}</p></li>)}</ul></section>}
        {legacyWorkspace.schedule.length > 0 && <section aria-label="Older planned posts"><h3 className="text-[12px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">Publishing plan · {legacyWorkspace.schedule.length}</h3><ul className="mt-2 space-y-2">{legacyWorkspace.schedule.map((post) => <li key={post.id} className="rounded-lg border border-[var(--line)] px-3 py-2"><p className="truncate text-[13px] font-semibold">{draftTitle(post.title, post.source)}</p><p className="mt-1 text-[12px] text-[var(--text-muted)]">{new Date(post.scheduledFor).toLocaleString("en-US")} · {Object.keys(post.posts).join(", ")}</p></li>)}</ul></section>}
        {legacyWorkspace.assisted.length > 0 && <section aria-label="Older assisted items"><h3 className="text-[12px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">Assisted items · {legacyWorkspace.assisted.length}</h3><ul className="mt-2 space-y-2">{legacyWorkspace.assisted.map((item) => <li key={item.id} className="rounded-lg border border-[var(--line)] px-3 py-2"><p className="truncate text-[13px] font-semibold">{item.title || item.text}</p><p className="mt-1 text-[12px] text-[var(--text-muted)]">{assistedDestinations[item.destination].name} · {hasManualReminder(item) ? new Date(item.scheduledFor).toLocaleString("en-US") : "No reminder"}</p><p className="mt-1 line-clamp-2 text-[12px] text-[var(--text-muted)]">{item.text}</p></li>)}</ul></section>}
      </div>
      {legacyImportError && <p role="alert" className="mt-4 rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-[12px] text-[var(--danger)]">{legacyImportError} The browser copy was kept.</p>}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => setLegacyReviewOpen(false)} disabled={legacyImportBusy} className="rounded-lg px-3 py-2.5 text-[13px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50">Keep in browser</button>
        <button type="button" onClick={() => { void importLegacyWorkspace(); }} disabled={legacyImportBusy} className="gradient-button rounded-lg px-3 py-2.5 text-[13px] font-bold text-white disabled:opacity-50">{legacyImportBusy ? "Moving…" : "Move into this account"}</button>
      </div>
    </dialog>}
    {pendingEditorSwitch && <dialog ref={switchDialogRef} onCancel={(event) => { event.preventDefault(); if (!switchSaving) setPendingEditorSwitch(null); }} aria-labelledby="unsaved-editor-title" aria-describedby="unsaved-editor-description" className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 text-[var(--text)] shadow-2xl backdrop:bg-black/65 sm:p-7">
      <h2 id="unsaved-editor-title" className="text-[19px] font-bold tracking-[-0.025em]">{pendingDraftSave ? "Check this save" : "Unsaved changes"}</h2>
      <p id="unsaved-editor-description" className="mt-3 text-[13px] leading-6 text-[var(--text-muted)]">{pendingDraftSave ? "The last save has not been confirmed. Check it before" : "Your current text, platform versions, and image choices have changed. Save your edits before"} {pendingEditorSwitch.kind === "new" ? "starting a new draft" : pendingEditorSwitch.kind === "draft" ? `opening “${pendingEditorSwitch.draft.title}”` : pendingEditorSwitch.kind === "planned" ? "opening a copy of this planned post" : "starting a draft from a posted handoff"}{". "}{pendingDraftSave ? "Discarding here also clears the pending check." : needsDraftRecovery ? "If the saved draft changed elsewhere, save your edits as a new draft." : ""}</p>
      {!canSaveEditor && <p className="mt-3 rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-[12px] leading-5 text-[var(--warning)]">Add a title, caption, platform text or image before saving.</p>}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button type="button" autoFocus onClick={() => setPendingEditorSwitch(null)} disabled={switchSaving} className="rounded-lg px-3 py-2.5 text-[13px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50">Keep editing</button>
        <button type="button" onClick={() => { const target = pendingEditorSwitch; setPendingEditorSwitch(null); applyEditorSwitch(target); }} disabled={switchSaving} className="rounded-lg border border-[var(--danger)] px-3 py-2.5 text-[13px] font-semibold text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-50">Discard changes</button>
        <button type="button" onClick={() => { void saveAndSwitch(); }} disabled={switchSaving || !canSaveEditor} className="gradient-button rounded-lg px-3 py-2.5 text-[13px] font-bold text-white disabled:opacity-50">{switchSaving ? "Saving and opening…" : pendingDraftSave ? "Check save and continue" : needsDraftRecovery ? "Save as new and continue" : "Save and continue"}</button>
      </div>
    </dialog>}
    </>
  );
}

export default function Home() {
  const [session, setSession] = useState<{ email: string | null; configured: boolean } | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState("");

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
    if (logoutBusy) return;
    setLogoutBusy(true);
    setLogoutError("");
    try {
      try {
        await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(10_000) });
      } catch { /* The response may be lost after the server removed the session. */ }
      const response = await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error("Sign-out could not be checked.");
      const latest: unknown = await response.json();
      if (!latest || typeof latest !== "object" || !("email" in latest) || latest.email !== null) {
        throw new Error("The session is still active.");
      }
      setSession({ email: null, configured: "configured" in latest && typeof latest.configured === "boolean" ? latest.configured : true });
    } catch {
      setLogoutError("Sign-out was not confirmed. Retry and wait for the sign-in screen before leaving this device.");
    } finally {
      setLogoutBusy(false);
    }
  }

  if (session?.email) return <WorkspaceApp key={session.email} email={session.email} onLogout={signOut} logoutBusy={logoutBusy} logoutError={logoutError} />;
  return <div className="app-shell flex min-h-screen items-center justify-center px-5 py-10"><div className="panel-border soft-shadow w-full max-w-md rounded-[22px] bg-[var(--surface)] p-8">
    <div className="mb-7 flex items-center gap-3"><Image src="/plypost-mark.svg" alt="" width={44} height={44} className="h-11 w-11 shrink-0" /><span className="text-[25px] font-bold tracking-[-0.05em]">Plypost<span className="text-[var(--accent-text)]">.</span></span></div>
    <h1 className="text-[22px] font-bold text-[var(--text)]">Sign in to Plypost</h1>
    <p className="mt-2 text-[13px] leading-5 text-[var(--text-muted)]">Open your drafts, media and posting plan.</p>
    {!session?.configured && session !== null ? <p role="alert" className="mt-5 rounded-xl bg-[var(--warning-soft)] p-3 text-[13px] text-[var(--warning)]">Owner sign-in is not configured. Follow the setup steps in README.md.</p> : <form onSubmit={signIn} className="mt-7 space-y-4">
      <div><label htmlFor="login-email" className="mb-1.5 block text-[12px] font-bold text-[var(--text-secondary)]">Email</label><input id="login-email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-xl border border-[var(--line)] bg-[var(--field)] px-4 py-3 text-[16px] outline-none focus:border-[var(--accent-border)]" /></div>
      <div><label htmlFor="login-password" className="mb-1.5 block text-[12px] font-bold text-[var(--text-secondary)]">Password</label><input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border border-[var(--line)] bg-[var(--field)] px-4 py-3 text-[16px] outline-none focus:border-[var(--accent-border)]" /></div>
      <button type="submit" disabled={busy || session === null} className="gradient-button w-full rounded-xl py-3 text-[14px] font-bold text-white disabled:opacity-50">{busy ? "Signing in..." : "Sign in"}</button>
    </form>}
    {error && <p role="alert" className="mt-4 text-[13px] text-[var(--danger)]">{error}</p>}
    <div className="mt-6 flex justify-end"><ThemeSwitcher /></div>
  </div></div>;
}
