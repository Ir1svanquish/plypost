"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  CircleAlert,
  Clock3,
  Copy,
  FilePenLine,
  History,
  LockKeyhole,
  RotateCcw,
  Send,
  Sparkles,
  WandSparkles,
  Workflow,
} from "lucide-react";
import { adaptDraft, characterCount, isPlatformId, platformIds, platforms, type PlatformId } from "@/lib/platforms";
import { DraftLibraryPanel, SchedulePanel } from "@/components/workspace-panels";
import { AssistedPublishPanel } from "@/components/assisted-publish-panel";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { assistedDestinations, type AssistedDestinationId } from "@/lib/assisted";
import { WORKSPACE_KEY, draftTitle, emptyWorkspace, parseWorkspace, type AssistedPost, type SavedDraft, type ScheduledPost } from "@/lib/workspace";

const sampleDraft =
  "A good idea deserves more than a copy-paste post.\n\nShape one message for every corner of the internet. Pick your channels, fine-tune each version, and share with confidence.";
const legacySampleDraft =
  "A good idea deserves more than a copy-paste post.\n\nSocialFlow helps you shape one draft for every corner of the internet. Pick your channels, fine-tune each version, and share with confidence.";
const interimSampleDraft =
  "A good idea deserves more than a copy-paste post.\n\nsoflow helps you shape one draft for every corner of the internet. Pick your channels, fine-tune each version, and share with confidence.";

type Provider = "nvidia" | "nebius";
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

function formatTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function Home() {
  const [source, setSource] = useState(sampleDraft);
  const [selected, setSelected] = useState<PlatformId[]>([...platformIds]);
  const [active, setActive] = useState<PlatformId>("bluesky");
  const [variants, setVariants] = useState<Partial<Record<PlatformId, string>>>({});
  const [provider, setProvider] = useState<Provider>("nvidia");
  const [notice, setNotice] = useState<Notice>(null);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [activity, setActivity] = useState<Receipt[]>([]);
  const [drafts, setDrafts] = useState<SavedDraft[]>([]);
  const [schedule, setSchedule] = useState<ScheduledPost[]>([]);
  const [assisted, setAssisted] = useState<AssistedPost[]>([]);
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

  useEffect(() => {
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
      }
    } catch {
      // A malformed local draft should never prevent the editor from opening.
    }
    try {
      const workspace = parseWorkspace(JSON.parse(localStorage.getItem(WORKSPACE_KEY) || "null")) ?? emptyWorkspace();
      setDrafts(workspace.drafts);
      setSchedule(workspace.schedule);
      setAssisted(workspace.assisted);
    } catch {
      // Keep the editor usable if the browser holds an invalid workspace backup.
    }
    setHydrated(true);
    if ("Notification" in window) setNotificationPermission(Notification.permission);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem("socialflow-mvp", JSON.stringify({ source, selected, variants, provider, activity, title, currentDraftId }));
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ version: 3, drafts, schedule, assisted }));
      setStorageWarning(false);
    } catch {
      setStorageWarning(true);
    }
  }, [source, selected, variants, provider, activity, title, currentDraftId, drafts, schedule, assisted, hydrated]);

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
    if (!hydrated || !now || notificationPermission !== "granted") return;
    const due = assisted.filter((item) => item.status === "queued" && !item.notifiedAt && Date.parse(item.scheduledFor) <= now);
    if (!due.length) return;
    try {
      new Notification("Plypost publishing reminder", {
        body: due.length === 1 ? `${assistedDestinations[due[0].destination].name}: ${due[0].title}` : `${due.length} posts are ready for your review.`,
        tag: "socialflow-assisted-due",
      });
      const notifiedAt = new Date().toISOString();
      const dueIds = new Set(due.map((item) => item.id));
      setAssisted((current) => current.map((item) => dueIds.has(item.id) ? { ...item, notifiedAt } : item));
    } catch {
      setNotificationPermission("unsupported");
    }
  }, [assisted, hydrated, now, notificationPermission]);

  const textFor = (id: PlatformId) => variants[id] ?? adaptDraft(source, id);
  const currentText = textFor(active);
  const currentCount = characterCount(currentText);
  const invalidSelected = selected.filter(
    (id) => !textFor(id).trim() || characterCount(textFor(id)) > platforms[id].limit,
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
    setGenerating(true);
    setNotice(null);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, provider }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI adaptation failed.");
      setVariants(data.variants);
      setNotice({ kind: "success", text: "Four platform drafts are ready to review and edit." });
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

  function saveDraft() {
    if (!source.trim()) {
      setNotice({ kind: "error", text: "Write a source draft before saving it." });
      return;
    }
    if (!currentDraftId && drafts.length >= 100) {
      setNotice({ kind: "error", text: "The local library is full. Delete an old draft before saving another." });
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
      createdAt: existing?.createdAt ?? stamp,
      updatedAt: stamp,
    };
    setDrafts((current) => [saved, ...current.filter((draft) => draft.id !== saved.id)]);
    setCurrentDraftId(saved.id);
    setTitle(saved.title);
    setNotice({ kind: "success", text: "Draft saved in this browser." });
  }

  function newDraft() {
    setCurrentDraftId(null);
    setTitle("");
    setSource("");
    setVariants({});
    setSelected([...platformIds]);
    setActive("bluesky");
    setNotice(null);
    document.getElementById("compose")?.scrollIntoView({ behavior: "smooth" });
  }

  function loadDraft(draft: SavedDraft) {
    setCurrentDraftId(draft.id);
    setTitle(draft.title);
    setSource(draft.source);
    setSelected(draft.selected);
    setVariants(draft.variants);
    setActive(draft.selected[0] ?? "bluesky");
    setNotice({ kind: "success", text: `Opened “${draft.title}”. Changes will be saved when you click Update draft.` });
    document.getElementById("compose")?.scrollIntoView({ behavior: "smooth" });
  }

  function deleteDraft(id: string) {
    if (!window.confirm("Delete this saved draft from this browser?")) return;
    setDrafts((current) => current.filter((draft) => draft.id !== id));
    if (currentDraftId === id) setCurrentDraftId(null);
    setNotice({ kind: "success", text: "Saved draft deleted. The current editor was kept." });
  }

  function addToPlan() {
    const scheduledFor = new Date(scheduleTime);
    if (!scheduleTime || !Number.isFinite(scheduledFor.getTime()) || scheduledFor.getTime() <= Date.now()) {
      setNotice({ kind: "error", text: "Choose a future local date and time." });
      return;
    }
    if (!source.trim() || selected.length === 0 || invalidSelected.length > 0) {
      setNotice({ kind: "error", text: "Choose destinations and fix empty or over-limit drafts first." });
      return;
    }
    if (schedule.length >= 100) {
      setNotice({ kind: "error", text: "The local plan is full. Remove an old item before adding another." });
      return;
    }
    const post: ScheduledPost = {
      id: crypto.randomUUID(),
      title: draftTitle(title, source),
      source,
      posts: Object.fromEntries(selected.map((id) => [id, textFor(id)])),
      scheduledFor: scheduledFor.toISOString(),
      createdAt: new Date().toISOString(),
      status: "queued",
    };
    setSchedule((current) => [...current, post].sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor)));
    setScheduleTime("");
    setNotice({ kind: "success", text: "Added to your local publishing plan. It will need a manual demo run when due." });
  }

  function loadScheduled(post: ScheduledPost) {
    setCurrentDraftId(null);
    setTitle(post.title);
    setSource(post.source);
    setSelected(platformIds.filter((id) => post.posts[id] !== undefined));
    setVariants({ ...post.posts });
    setActive(platformIds.find((id) => post.posts[id] !== undefined) ?? "bluesky");
    setNotice({ kind: "success", text: "Opened a copy of the planned post. The plan snapshot is unchanged." });
    document.getElementById("compose")?.scrollIntoView({ behavior: "smooth" });
  }

  async function runScheduled(post: ScheduledPost) {
    if (runningId || post.status !== "queued" || Date.parse(post.scheduledFor) > Date.now()) return;
    setRunningId(post.id);
    setNotice(null);
    try {
      const response = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posts: post.posts }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Simulation failed.");
      setActivity((current) => [...data.results, ...current].slice(0, 12));
      setSchedule((current) => current.map((item) => item.id === post.id ? { ...item, status: "simulated", simulatedAt: new Date().toISOString() } : item));
      setNotice({ kind: "success", text: `Simulated ${data.results.length} planned post${data.results.length === 1 ? "" : "s"}. No external platform was contacted.` });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Simulation failed." });
    } finally {
      setRunningId(null);
    }
  }

  function removeScheduled(id: string) {
    if (!window.confirm("Remove this item from your local plan?")) return;
    setSchedule((current) => current.filter((post) => post.id !== id));
    setNotice({ kind: "success", text: "Item removed from your local plan." });
  }

  function exportWorkspace() {
    const backup = new Blob([JSON.stringify({ version: 3, drafts, schedule, assisted }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(backup);
    const link = document.createElement("a");
    link.href = url;
    link.download = `plypost-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importWorkspace(file: File) {
    try {
      if (file.size > 2_000_000) throw new Error("Backup file is too large (2 MB maximum).");
      const workspace = parseWorkspace(JSON.parse(await file.text()));
      if (!workspace) throw new Error("This is not a Plypost workspace backup.");
      if (!window.confirm("Replace saved drafts, the publishing plan, and assisted posts in this browser with this backup?")) return;
      setDrafts(workspace.drafts);
      setSchedule(workspace.schedule);
      setAssisted(workspace.assisted);
      setCurrentDraftId(null);
      setNotice({ kind: "success", text: `Imported ${workspace.drafts.length} drafts, ${workspace.schedule.length} planned items, and ${workspace.assisted.length} assisted posts.` });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not import backup." });
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

  function addAssistedPost() {
    const text = assistText.trim();
    const scheduledFor = assistTime ? new Date(assistTime) : new Date();
    if (!text || characterCount(text) > 5000) {
      setNotice({ kind: "error", text: "Add text of up to 5,000 characters before saving." });
      return;
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
      scheduledFor: scheduledFor.toISOString(),
      createdAt: new Date().toISOString(),
      status: "queued",
      ...(!assistTime ? { notifiedAt: new Date().toISOString() } : {}),
    };
    setAssisted((current) => [...current, item].sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor)));
    setNow(Date.now());
    setAssistTime("");
    setNotice({ kind: "success", text: `Added ${assistedDestinations[assistDestination].name} to your assisted publishing list. You will publish it yourself.` });
  }

  async function copyAssisted(text: string, destination: AssistedDestinationId) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice({ kind: "success", text: `${assistedDestinations[destination].name} text copied. Open the platform and paste it there.` });
    } catch {
      setNotice({ kind: "error", text: "Clipboard access is unavailable. Expand Review saved text to select it manually." });
    }
  }

  function markAssistedPosted(id: string) {
    setAssisted((current) => current.map((item) => item.id === id ? { ...item, status: "posted", postedAt: new Date().toISOString() } : item));
    setNotice({ kind: "success", text: "Marked as posted by you. Plypost did not verify the platform post." });
  }

  function undoAssistedPosted(id: string) {
    setAssisted((current) => current.map((item) => {
      if (item.id !== id) return item;
      const restored: AssistedPost = { ...item, status: "queued" };
      delete restored.postedAt;
      return restored;
    }));
  }

  function removeAssisted(id: string) {
    if (!window.confirm("Remove this assisted post from this browser?")) return;
    setAssisted((current) => current.filter((item) => item.id !== id));
  }

  async function enableNotifications() {
    if (!("Notification" in window)) return;
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission !== "granted") setNotice({ kind: "error", text: "Browser alerts were not enabled. Due posts will still appear in this page." });
  }

  return (
    <div className="app-shell min-h-screen lg:flex">
      <aside className="app-sidebar sidebar-glow hidden w-[248px] shrink-0 flex-col border-r border-white/10 px-5 py-7 text-white lg:sticky lg:top-0 lg:flex lg:h-screen">
        <a href="#compose" className="flex items-center gap-3 px-2" aria-label="Plypost home">
          <span className="gradient-button flex h-10 w-10 items-center justify-center rounded-[11px]"><Workflow size={21} strokeWidth={2.3} /></span>
          <span className="text-[21px] font-bold tracking-[-0.055em]">Plypost<span className="sidebar-accent">.</span></span>
        </a>
        <div className="sidebar-muted mt-12 px-3 text-[11px] font-bold uppercase tracking-[0.17em]">Workspace</div>
        <nav className="mt-4 space-y-1" aria-label="Main navigation">
          <a href="#compose" className="flex items-center gap-3 rounded-[10px] bg-[var(--nav-active)] px-3 py-2.5 text-[14px] font-semibold text-white"><FilePenLine size={18} className="sidebar-accent" /> Composer</a>
          <a href="#drafts" className="sidebar-link sidebar-subtle flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[14px] font-medium transition"><FilePenLine size={18} /> Draft library</a>
          <a href="#schedule" className="sidebar-link sidebar-subtle flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[14px] font-medium transition"><Clock3 size={18} /> Publishing plan</a>
          <a href="#assisted" className="sidebar-link sidebar-subtle flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[14px] font-medium transition"><Copy size={18} /> Assisted publishing</a>
          <a href="#activity" className="sidebar-link sidebar-subtle flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[14px] font-medium transition"><History size={18} /> Activity</a>
        </nav>
        <div className="mt-auto border-t border-white/10 px-2 pt-5">
          <p className="sidebar-muted text-[12px] leading-5">Your drafts live in this browser. Export a backup from the draft library.</p>
          <div className="sidebar-subtle mt-4 flex items-center gap-2 text-[12px]"><span className="h-2 w-2 rounded-full bg-[#91d3ae]" /> Local workspace</div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="app-header sticky top-0 z-30 flex min-h-[66px] items-center justify-between gap-3 border-b px-5 sm:px-8 lg:px-10">
          <div className="flex items-center gap-2.5 lg:hidden"><span className="gradient-button flex h-8 w-8 items-center justify-center rounded-[9px] text-white"><Workflow size={17} /></span><span className="text-[18px] font-bold tracking-[-0.05em]">Plypost<span className="text-[var(--accent-text)]">.</span></span></div>
          <div className="hidden items-center gap-2 text-[13px] text-[var(--text-muted)] lg:flex"><span>Workspace</span><span>/</span><span className="font-semibold text-[var(--text)]">Composer</span></div>
          <div className="ml-auto flex items-center gap-3"><span className="hidden items-center gap-2 rounded-full border border-[var(--line)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-muted)] sm:inline-flex"><span className="h-1.5 w-1.5 rounded-full bg-[var(--positive)]" /> Demo workspace</span><ThemeSwitcher /></div>
        </header>
        <nav className="mobile-nav app-header sticky top-[66px] z-20 flex gap-5 overflow-x-auto border-b px-5 text-[12px] font-semibold text-[var(--text-secondary)] sm:px-8 lg:hidden" aria-label="Mobile navigation">
          <a className="shrink-0 border-b-2 border-[var(--accent)] py-3 text-[var(--accent-text)]" href="#compose">Composer</a>
          <a className="shrink-0 py-3" href="#drafts">Drafts</a>
          <a className="shrink-0 py-3" href="#schedule">Plan</a>
          <a className="shrink-0 py-3" href="#assisted">Assisted</a>
          <a className="shrink-0 py-3" href="#activity">Activity</a>
        </nav>

        <main id="compose" className="app-main section-anchor mx-auto px-5 pb-16 pt-6 sm:px-8 lg:px-10 lg:pt-8">
          <div className="app-hero mb-7 rounded-[18px] px-6 py-7 sm:px-8 sm:py-8">
            <div className="relative z-10 flex flex-wrap items-start justify-between gap-6">
              <div className="max-w-[640px]">
                <div className="mb-3 inline-flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.15em] text-[var(--accent-text)]"><Sparkles size={14} /> Your creative workspace</div>
                <h1 className="text-[30px] font-bold leading-[1.12] tracking-[-0.05em] text-[var(--text)] sm:text-[39px]">One idea. Made for every feed.</h1>
                <p className="mt-3 text-[15px] leading-6 text-[var(--text-secondary)]">Write your message, adapt it for each channel, then choose how to share it.</p>
              </div>
              <div className="hidden items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-[12px] font-medium text-[var(--text-muted)] xl:flex"><LockKeyhole size={14} /> API keys stay on your server</div>
            </div>
            <div className="relative z-10 mt-6 grid grid-cols-3 divide-x divide-[var(--line)] border-t border-[var(--line)] pt-5">
              <a href="#drafts" className="pr-3"><span className="block text-[22px] font-bold tabular-nums text-[var(--text)]">{drafts.length}</span><span className="text-[12px] text-[var(--text-muted)]">Saved drafts</span></a>
              <a href="#schedule" className="px-4"><span className="block text-[22px] font-bold tabular-nums text-[var(--text)]">{schedule.filter((post) => post.status === "queued").length}</span><span className="text-[12px] text-[var(--text-muted)]">Planned</span></a>
              <a href="#assisted" className="pl-4"><span className="block text-[22px] font-bold tabular-nums text-[var(--text)]">{assisted.filter((item) => item.status !== "posted").length}</span><span className="text-[12px] text-[var(--text-muted)]">To share</span></a>
            </div>
          </div>

          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(370px,.95fr)]">
            <div className="space-y-6">
              <section className="panel-border soft-shadow overflow-hidden rounded-[18px] bg-[var(--surface)]" aria-labelledby="draft-heading">
                <div className="flex items-start justify-between border-b border-[var(--line)] px-6 py-5 sm:px-7">
                  <div className="flex items-start gap-3.5"><span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[var(--accent-soft)] text-[13px] font-bold text-[var(--accent-text)]">01</span><div><h2 id="draft-heading" className="text-[17px] font-bold tracking-[-0.025em]">Start with your idea</h2><p className="mt-1 text-[13px] text-[var(--text-muted)]">The message you want to share, in your own words.</p></div></div>
                  <FilePenLine size={18} className="mt-1 text-[var(--text-soft)]" />
                </div>
                <div className="p-6 sm:p-7">
                  <label htmlFor="source-draft" className="mb-3 block text-[13px] font-bold text-[var(--text)]">Your draft</label>
                  <textarea id="source-draft" value={source} onChange={(event) => { setSource(event.target.value); setNotice(null); }} placeholder="What's on your mind? Add a launch update, insight, or idea to share..." maxLength={3000} className="min-h-[194px] w-full resize-y rounded-[15px] border border-[var(--line)] bg-[var(--field)] px-4 py-4 text-[15px] leading-[1.75] text-[var(--text)] outline-none transition placeholder:text-[var(--text-soft)] focus:border-[var(--accent-border)] focus:bg-[var(--surface)] focus:ring-[3px] focus:ring-[var(--accent-soft)]" />
                  <div className="mt-3 flex items-center justify-between text-[12px] text-[var(--text-soft)]"><span>Write naturally. Fine-tune each version on the right.</span><span className="tabular-nums">{characterCount(source)} / 3,000</span></div>
                </div>
              </section>

              <section className="panel-border soft-shadow overflow-hidden rounded-[18px] bg-[var(--surface)]" aria-labelledby="destinations-heading">
                <div className="flex items-start justify-between border-b border-[var(--line)] px-6 py-5 sm:px-7"><div className="flex items-start gap-3.5"><span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[var(--info-soft)] text-[13px] font-bold text-[var(--info)]">02</span><div><h2 id="destinations-heading" className="text-[17px] font-bold tracking-[-0.025em]">Choose destinations</h2><p className="mt-1 text-[13px] text-[var(--text-muted)]">Select where this message should go.</p></div></div><span className="rounded-full bg-[var(--field)] px-2.5 py-1 text-[12px] font-semibold text-[var(--text-muted)]">{selected.length} selected</span></div>
                <div className="grid grid-cols-1 gap-3 p-6 sm:grid-cols-2 sm:p-7">
                  {platformIds.map((id) => {
                    const isSelected = selected.includes(id);
                    return <button key={id} type="button" aria-pressed={isSelected} onClick={() => togglePlatform(id)} className={`flex items-center gap-3 rounded-[15px] border p-3.5 text-left transition ${isSelected ? "border-[var(--accent-border)] bg-[var(--accent-soft)] ring-2 ring-[var(--accent-soft)]" : "border-[var(--line)] bg-[var(--surface)] hover:border-[var(--accent-border)]"}`}><PlatformMark id={id} /><span className="min-w-0 flex-1"><span className="block text-[14px] font-bold text-[var(--text)]">{platforms[id].name}</span><span className="mt-0.5 block truncate text-[12px] text-[var(--text-soft)]">{platforms[id].hint}</span></span><span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border ${isSelected ? "border-[var(--accent-border)] bg-[var(--accent)] text-white" : "border-[var(--line)] bg-[var(--surface)]"}`}>{isSelected && <Check size={13} strokeWidth={3} />}</span></button>;
                  })}
                </div>
              </section>

              <section className="panel-border soft-shadow overflow-hidden rounded-[18px] bg-[var(--surface)]" aria-labelledby="ai-heading">
                <div className="flex items-start gap-3.5 border-b border-[var(--line)] px-6 py-5 sm:px-7"><span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[var(--warning-soft)] text-[13px] font-bold text-[var(--warning)]">03</span><div><h2 id="ai-heading" className="text-[17px] font-bold tracking-[-0.025em]">Adapt with AI <span className="ml-1 rounded-md bg-[var(--accent-soft)] px-1.5 py-1 align-middle text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--accent-text)]">Optional</span></h2><p className="mt-1 text-[13px] text-[var(--text-muted)]">Create four tailored versions with Nemotron.</p></div></div>
                <div className="flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:p-7"><div className="relative min-w-0 flex-1"><label htmlFor="provider" className="mb-2 block text-[12px] font-bold text-[var(--text-secondary)]">AI provider</label><select id="provider" value={provider} onChange={(event) => setProvider(event.target.value as Provider)} className="w-full appearance-none rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 pr-9 text-[14px] font-semibold text-[var(--text)] outline-none focus:border-[var(--accent-border)]"><option value="nvidia">NVIDIA Nemotron</option><option value="nebius">Nebius Token Factory</option></select><ChevronDown size={15} className="pointer-events-none absolute bottom-3.5 right-3.5 text-[var(--text-soft)]" /></div><button type="button" onClick={generateVariants} disabled={generating || !source.trim()} className="gradient-button mt-0 inline-flex h-[45px] shrink-0 items-center justify-center gap-2 rounded-xl px-5 text-[13px] font-bold text-white shadow-lg shadow-indigo-300/40 transition sm:mt-5"><WandSparkles size={16} /> {generating ? "Adapting..." : "Generate variants"}</button></div>
              </section>
            </div>

            <div className="space-y-6 xl:sticky xl:top-6">
              <section className="panel-border soft-shadow overflow-hidden rounded-[18px] bg-[var(--surface)]" aria-labelledby="preview-heading">
                <div className="flex items-center justify-between border-b border-[var(--line)] px-6 py-5 sm:px-7"><div><h2 id="preview-heading" className="text-[17px] font-bold tracking-[-0.025em]">Live preview</h2><p className="mt-1 text-[13px] text-[var(--text-muted)]">See exactly what each draft says.</p></div><span className="flex items-center gap-1.5 rounded-full bg-[var(--positive-soft)] px-2.5 py-1.5 text-[11px] font-bold text-[var(--positive)]"><span className="h-1.5 w-1.5 rounded-full bg-[var(--positive)]" /> LIVE</span></div>
                <div className="mobile-x-scroll flex gap-1 border-b border-[var(--line)] px-4 sm:px-6" role="tablist" aria-label="Platform previews">{platformIds.map((id) => <button key={id} type="button" role="tab" aria-selected={active === id} onClick={() => setActive(id)} className={`relative flex shrink-0 items-center gap-1.5 px-3 py-4 text-[12px] font-semibold transition sm:text-[13px] ${active === id ? "text-[var(--accent-text)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}><span className={`${selected.includes(id) ? "" : "opacity-40"}`}>{platforms[id].name}</span>{active === id && <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-[var(--accent)]" />}</button>)}</div>
                <div className="dot-grid bg-[var(--surface-muted)] p-5 sm:p-7"><div className="mx-auto max-w-[500px] overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--surface)] soft-shadow"><div className="flex items-center gap-3 px-5 pt-5"><PlatformMark id={active} /><div className="min-w-0 flex-1"><div className="text-[14px] font-bold text-[var(--text)]">Your brand <span className="ml-1 text-[11px] text-[var(--text-muted)]">●</span></div><div className="mt-0.5 truncate text-[12px] text-[var(--text-muted)]">{platforms[active].handle} · now</div></div><span className="text-[17px] tracking-[2px] text-[var(--text-soft)]">···</span></div><div className="post-body min-h-[142px] px-5 pb-4 pt-4 text-[14px] leading-[1.75] text-[var(--text)]">{currentText || <span className="text-[var(--text-soft)]">Your {platforms[active].name} preview will appear here.</span>}</div><div className="flex items-center gap-5 border-t border-[var(--line)] px-5 py-3.5 text-[12px] text-[var(--text-soft)]"><span>♡ &nbsp;Like</span><span>◌ &nbsp;Reply</span><span>↗ &nbsp;Share</span></div></div><div className="mt-4 text-center text-[12px] text-[var(--text-soft)]">Preview only · No account connected</div></div>
                <div className="px-6 pb-6 pt-5 sm:px-7 sm:pb-7"><div className="mb-2 flex items-center justify-between"><label htmlFor="platform-draft" className="text-[13px] font-bold text-[var(--text-secondary)]">Edit {platforms[active].name} draft</label><button type="button" onClick={() => setVariants((current) => { const next = { ...current }; delete next[active]; return next; })} disabled={variants[active] === undefined} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent-text)] disabled:opacity-40"><RotateCcw size={12} /> Reset</button></div><textarea id="platform-draft" value={currentText} onChange={(event) => setVariants((current) => ({ ...current, [active]: event.target.value }))} className="min-h-[115px] w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--field)] px-3.5 py-3 text-[13px] leading-[1.65] text-[var(--text-secondary)] outline-none focus:border-[var(--accent-border)] focus:ring-[3px] focus:ring-[var(--accent-soft)]" /><div className="mt-2 flex items-center justify-between"><span className={`text-[12px] ${currentCount > platforms[active].limit ? "font-semibold text-[var(--danger)]" : "text-[var(--text-soft)]"}`}>{currentCount > platforms[active].limit ? "Over platform limit" : variants[active] !== undefined ? "Custom version" : "Adapted from your draft"}</span><span className={`text-[12px] tabular-nums ${currentCount > platforms[active].limit ? "font-bold text-[var(--danger)]" : "text-[var(--text-muted)]"}`}>{currentCount} / {platforms[active].limit}</span></div><button type="button" onClick={copyCurrent} disabled={!currentText} className="mt-4 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--accent-text)] disabled:opacity-40"><Copy size={13} /> Copy this draft</button></div>
              </section>

              <section className="panel-border soft-shadow rounded-[18px] bg-[var(--surface)] p-6 sm:p-7" aria-labelledby="publish-heading"><div className="mb-5 flex items-center justify-between"><div><h2 id="publish-heading" className="text-[17px] font-bold tracking-[-0.025em]">Ready to share?</h2><p className="mt-1 text-[13px] text-[var(--text-muted)]">Review your selected drafts first.</p></div><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-text)]"><Send size={17} /></span></div><div className="mb-5 flex flex-wrap gap-2">{selected.length ? selected.map((id) => <span key={id} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--accent-soft)] px-2.5 py-1.5 text-[12px] font-semibold text-[var(--text-secondary)]"><PlatformMark id={id} size="small" /> {platforms[id].name}</span>) : <span className="text-[13px] text-[var(--text-soft)]">No destinations selected</span>}</div>{invalidSelected.length > 0 && <p className="mb-4 flex items-start gap-1.5 text-[12px] leading-5 text-[var(--danger)]"><CircleAlert size={14} className="mt-0.5 shrink-0" /> Review empty or over-limit drafts: {invalidSelected.map((id) => platforms[id].name).join(", ")}.</p>}<button type="button" onClick={simulatePublish} disabled={!canPublish} className="gradient-button flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-[14px] font-bold text-white shadow-lg shadow-indigo-300/40 transition"><Send size={16} /> {publishing ? "Simulating..." : `Simulate publish to ${selected.length || 0} platform${selected.length === 1 ? "" : "s"}`} <ArrowRight size={15} className="ml-1" /></button><p className="mt-3 text-center text-[12px] text-[var(--text-soft)]">Demo action only. No post leaves this app.</p></section>
            </div>
          </div>

          {notice && <div role="status" className={`fixed bottom-4 left-4 right-4 z-50 flex items-start gap-2 rounded-xl border px-4 py-3 text-[13px] leading-5 shadow-xl sm:left-auto sm:max-w-md ${notice.kind === "success" ? "border-[var(--positive)] bg-[var(--positive-soft)] text-[var(--positive)]" : "border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)]"}`}>{notice.kind === "success" ? <CheckCheck size={16} className="shrink-0" /> : <CircleAlert size={16} className="shrink-0" />}{notice.text}</div>}

          {storageWarning && <div role="alert" className="mt-6 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-[13px] text-[var(--danger)]">Browser storage is unavailable or full. Your changes may not survive a reload. Export your saved library if possible.</div>}

          <DraftLibraryPanel drafts={drafts} title={title} currentDraftId={currentDraftId} onTitleChange={setTitle} onSave={saveDraft} onNew={newDraft} onLoad={loadDraft} onDelete={deleteDraft} onExport={exportWorkspace} onImport={importWorkspace} />
          <SchedulePanel schedule={schedule} value={scheduleTime} now={now} canSchedule={Boolean(scheduleTime && source.trim() && selected.length && invalidSelected.length === 0)} runningId={runningId} onValueChange={setScheduleTime} onAdd={addToPlan} onLoad={loadScheduled} onRun={runScheduled} onRemove={removeScheduled} />
          <AssistedPublishPanel items={assisted} destination={assistDestination} text={assistText} time={assistTime} now={now} notificationPermission={notificationPermission} onDestinationChange={(destination) => { setAssistDestination(destination); setAssistOverride(null); }} onTextChange={setAssistOverride} onTimeChange={setAssistTime} onAdd={addAssistedPost} onCopy={copyAssisted} onMarkPosted={markAssistedPosted} onUndo={undoAssistedPosted} onRemove={removeAssisted} onEnableNotifications={enableNotifications} />
          <section id="activity" className="panel-border soft-shadow mt-8 overflow-hidden rounded-[18px] bg-[var(--surface)]" aria-labelledby="activity-heading"><div className="flex items-center justify-between border-b border-[var(--line)] px-6 py-5 sm:px-7"><div><h2 id="activity-heading" className="text-[17px] font-bold tracking-[-0.025em]">Recent simulations</h2><p className="mt-1 text-[13px] text-[var(--text-muted)]">A local record of your demo publishing runs.</p></div>{activity.length > 0 && <button type="button" onClick={() => setActivity([])} className="text-[12px] font-semibold text-[var(--accent-text)] hover:text-[var(--accent-text)]">Clear history</button>}</div>{activity.length === 0 ? <div className="flex flex-col items-center px-6 py-10 text-center"><span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-text)]"><Clock3 size={20} /></span><p className="text-[14px] font-semibold text-[var(--text-secondary)]">Nothing simulated yet</p><p className="mt-1 text-[12px] text-[var(--text-soft)]">Your demo publishing activity will show up here.</p></div> : <div className="divide-y divide-[var(--line)]">{activity.map((item) => <div key={item.id} className="flex items-center gap-3 px-6 py-3.5 sm:px-7"><PlatformMark id={item.platform} size="small" /><span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold text-[var(--text-secondary)]">{platforms[item.platform].name} <span className="ml-1 rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--accent-text)]">Simulated</span></span><span className="mt-0.5 block truncate text-[12px] text-[var(--text-soft)]">{item.content}</span></span><span className="shrink-0 text-[11px] text-[var(--text-soft)]">{formatTime(item.publishedAt)}</span></div>)}</div>}</section>
        </main>
      </div>
    </div>
  );
}
