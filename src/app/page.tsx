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
import { adaptDraft, characterCount, platformIds, platforms, type PlatformId } from "@/lib/platforms";
import { DraftLibraryPanel, SchedulePanel } from "@/components/workspace-panels";
import { WORKSPACE_KEY, draftTitle, emptyWorkspace, parseWorkspace, type SavedDraft, type ScheduledPost } from "@/lib/workspace";

const sampleDraft =
  "A good idea deserves more than a copy-paste post.\n\nSocialFlow helps you shape one draft for every corner of the internet. Pick your channels, fine-tune each version, and share with confidence.";

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
    bluesky: "bg-[#e6f4ff] text-[#1684e8]",
    mastodon: "bg-[#eeeaff] text-[#6652d4]",
    linkedin: "bg-[#e7f1f8] text-[#176b9f]",
    threads: "bg-[#eeeef1] text-[#1e1f28]",
  };
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-xl font-bold ${colors[id]} ${size === "small" ? "h-7 w-7 text-[13px]" : "h-10 w-10 text-[18px]"}`}
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
        if (typeof data.source === "string") setSource(data.source);
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
    } catch {
      // Keep the editor usable if the browser holds an invalid workspace backup.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem("socialflow-mvp", JSON.stringify({ source, selected, variants, provider, activity, title, currentDraftId }));
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ version: 2, drafts, schedule }));
      setStorageWarning(false);
    } catch {
      setStorageWarning(true);
    }
  }, [source, selected, variants, provider, activity, title, currentDraftId, drafts, schedule, hydrated]);

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

  const textFor = (id: PlatformId) => variants[id] ?? adaptDraft(source, id);
  const currentText = textFor(active);
  const currentCount = characterCount(currentText);
  const invalidSelected = selected.filter(
    (id) => !textFor(id).trim() || characterCount(textFor(id)) > platforms[id].limit,
  );
  const canPublish = selected.length > 0 && invalidSelected.length === 0 && !publishing;

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
    const backup = new Blob([JSON.stringify({ version: 2, drafts, schedule }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(backup);
    const link = document.createElement("a");
    link.href = url;
    link.download = `socialflow-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importWorkspace(file: File) {
    try {
      if (file.size > 2_000_000) throw new Error("Backup file is too large (2 MB maximum).");
      const workspace = parseWorkspace(JSON.parse(await file.text()));
      if (!workspace) throw new Error("This is not a SocialFlow v2 backup.");
      if (!window.confirm("Replace the saved draft library and publishing plan in this browser with this backup?")) return;
      setDrafts(workspace.drafts);
      setSchedule(workspace.schedule);
      setCurrentDraftId(null);
      setNotice({ kind: "success", text: `Imported ${workspace.drafts.length} drafts and ${workspace.schedule.length} planned items.` });
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

  return (
    <div className="min-h-screen lg:flex">
      <aside className="sidebar-glow hidden w-[242px] shrink-0 flex-col bg-[#181a31] px-5 py-7 text-white lg:sticky lg:top-0 lg:flex lg:h-screen">
        <a href="#compose" className="flex items-center gap-3 px-2" aria-label="SocialFlow AI home">
          <span className="gradient-button flex h-10 w-10 items-center justify-center rounded-[13px] shadow-lg shadow-indigo-950/30"><Workflow size={21} strokeWidth={2.5} /></span>
          <span className="text-[19px] font-bold tracking-[-0.04em]">socialflow<span className="text-[#9f93ff]">.</span></span>
        </a>
        <div className="mt-14 px-3 text-[11px] font-bold uppercase tracking-[0.2em] text-[#757b9b]">Workspace</div>
        <nav className="mt-4 space-y-1.5" aria-label="Main navigation">
          <a href="#compose" className="flex items-center gap-3 rounded-xl bg-[#302c61] px-3 py-3 text-[13px] font-semibold text-white"><FilePenLine size={18} className="text-[#aa9bff]" /> Composer <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#a38cff]" /></a>
          <a href="#drafts" className="flex items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-medium text-[#a6aac1] transition hover:bg-white/5 hover:text-white"><FilePenLine size={18} /> Draft library</a>
          <a href="#schedule" className="flex items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-medium text-[#a6aac1] transition hover:bg-white/5 hover:text-white"><Clock3 size={18} /> Publishing plan</a>
          <a href="#activity" className="flex items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-medium text-[#a6aac1] transition hover:bg-white/5 hover:text-white"><History size={18} /> Activity</a>
        </nav>
        <div className="mt-auto">
          <div className="rounded-2xl border border-white/10 bg-white/[.045] p-4">
            <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-[#796cff]/20 text-[#b6aaff]"><Sparkles size={17} /></div>
            <p className="text-[13px] font-semibold">One draft. Four voices.</p>
            <p className="mt-1.5 text-[12px] leading-[1.55] text-[#a5aac2]">Shape your message for every place your audience shows up.</p>
          </div>
          <div className="mt-5 flex items-center gap-2 px-2 text-[11px] text-[#777d9e]"><span className="h-2 w-2 rounded-full bg-[#a999ff]" /> MVP · Simulation mode</div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="flex h-[70px] items-center justify-between border-b border-[#e9eaf0] bg-white px-5 sm:px-8 lg:px-10">
          <div className="flex items-center gap-2.5 lg:hidden"><span className="gradient-button flex h-8 w-8 items-center justify-center rounded-[10px] text-white"><Workflow size={17} /></span><span className="font-bold tracking-[-0.04em]">socialflow<span className="text-[#7364ec]">.</span></span></div>
          <div className="hidden items-center gap-2 text-[13px] text-[#888ca1] lg:flex"><span>Workspace</span><span className="text-[#c4c7d2]">/</span><span className="font-semibold text-[#2b2b3d]">Composer</span></div>
          <div className="flex items-center gap-2 rounded-full border border-[#e5e4f5] bg-[#f6f5ff] px-3 py-1.5 text-[11px] font-semibold text-[#675ae5]"><span className="h-1.5 w-1.5 rounded-full bg-[#796bf1]" /> Simulation mode</div>
        </header>

        <main id="compose" className="mx-auto max-w-[1480px] px-5 pb-16 pt-8 sm:px-8 lg:px-10 lg:pt-10">
          <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#e6e2ff] bg-[#f0edff] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.13em] text-[#6d5ae2]"><Sparkles size={12} /> Your creative workspace</div>
              <h1 className="text-[30px] font-bold tracking-[-0.055em] text-[#1e2035] sm:text-[38px]">Make every post feel native.</h1>
              <p className="mt-2 text-[14px] leading-6 text-[#868a9d]">Write once, tailor for each platform, and preview every version before you share.</p>
            </div>
            <div className="hidden items-center gap-2 text-[12px] text-[#9296a8] xl:flex"><LockKeyhole size={14} /> API keys stay on your server</div>
          </div>

          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(370px,.95fr)]">
            <div className="space-y-6">
              <section className="panel-border soft-shadow overflow-hidden rounded-[22px] bg-white" aria-labelledby="draft-heading">
                <div className="flex items-start justify-between border-b border-[#eff0f4] px-6 py-5 sm:px-7">
                  <div className="flex items-start gap-3.5"><span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#f0edff] text-[12px] font-bold text-[#6a5bea]">01</span><div><h2 id="draft-heading" className="text-[16px] font-bold tracking-[-0.025em]">Start with your idea</h2><p className="mt-1 text-[12px] text-[#989bad]">The message you want to share, in your own words.</p></div></div>
                  <FilePenLine size={18} className="mt-1 text-[#b3b6c6]" />
                </div>
                <div className="p-6 sm:p-7">
                  <label htmlFor="source-draft" className="mb-3 block text-[12px] font-bold text-[#3e4055]">Your draft</label>
                  <textarea id="source-draft" value={source} onChange={(event) => { setSource(event.target.value); setNotice(null); }} placeholder="What's on your mind? Add a launch update, insight, or idea to share..." maxLength={3000} className="min-h-[194px] w-full resize-y rounded-[15px] border border-[#e7e8f0] bg-[#fbfbfe] px-4 py-4 text-[14px] leading-[1.75] text-[#34364a] outline-none transition placeholder:text-[#afb2c0] focus:border-[#9488f4] focus:bg-white focus:ring-[3px] focus:ring-[#efecff]" />
                  <div className="mt-3 flex items-center justify-between text-[11px] text-[#a0a4b4]"><span>Write naturally. Fine-tune each version on the right.</span><span className="tabular-nums">{characterCount(source)} / 3,000</span></div>
                </div>
              </section>

              <section className="panel-border soft-shadow overflow-hidden rounded-[22px] bg-white" aria-labelledby="destinations-heading">
                <div className="flex items-start justify-between border-b border-[#eff0f4] px-6 py-5 sm:px-7"><div className="flex items-start gap-3.5"><span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#eaf4ff] text-[12px] font-bold text-[#498bd4]">02</span><div><h2 id="destinations-heading" className="text-[16px] font-bold tracking-[-0.025em]">Choose destinations</h2><p className="mt-1 text-[12px] text-[#989bad]">Select where this message should go.</p></div></div><span className="rounded-full bg-[#f4f4f8] px-2.5 py-1 text-[11px] font-semibold text-[#84889d]">{selected.length} selected</span></div>
                <div className="grid grid-cols-1 gap-3 p-6 sm:grid-cols-2 sm:p-7">
                  {platformIds.map((id) => {
                    const isSelected = selected.includes(id);
                    return <button key={id} type="button" aria-pressed={isSelected} onClick={() => togglePlatform(id)} className={`flex items-center gap-3 rounded-[15px] border p-3.5 text-left transition ${isSelected ? "border-[#c4bcff] bg-[#f9f8ff] shadow-[0_0_0_2px_#f1eeff]" : "border-[#e9eaf0] bg-white hover:border-[#c9c4ee]"}`}><PlatformMark id={id} /><span className="min-w-0 flex-1"><span className="block text-[13px] font-bold text-[#33354b]">{platforms[id].name}</span><span className="mt-0.5 block truncate text-[11px] text-[#a1a4b3]">{platforms[id].hint}</span></span><span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border ${isSelected ? "border-[#7060ec] bg-[#7060ec] text-white" : "border-[#d5d7e2] bg-white"}`}>{isSelected && <Check size={13} strokeWidth={3} />}</span></button>;
                  })}
                </div>
              </section>

              <section className="panel-border soft-shadow overflow-hidden rounded-[22px] bg-white" aria-labelledby="ai-heading">
                <div className="flex items-start gap-3.5 border-b border-[#eff0f4] px-6 py-5 sm:px-7"><span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#fff3e4] text-[12px] font-bold text-[#d38b3d]">03</span><div><h2 id="ai-heading" className="text-[16px] font-bold tracking-[-0.025em]">Adapt with AI <span className="ml-1 rounded-md bg-[#f3efff] px-1.5 py-1 align-middle text-[9px] font-bold uppercase tracking-[0.08em] text-[#806be5]">Optional</span></h2><p className="mt-1 text-[12px] text-[#989bad]">Create four tailored versions with Nemotron.</p></div></div>
                <div className="flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:p-7"><div className="relative min-w-0 flex-1"><label htmlFor="provider" className="mb-2 block text-[11px] font-bold text-[#676b7f]">AI provider</label><select id="provider" value={provider} onChange={(event) => setProvider(event.target.value as Provider)} className="w-full appearance-none rounded-xl border border-[#e5e6ee] bg-white px-4 py-3 pr-9 text-[13px] font-semibold text-[#3a3d51] outline-none focus:border-[#9488f4]"><option value="nvidia">NVIDIA Nemotron</option><option value="nebius">Nebius Token Factory</option></select><ChevronDown size={15} className="pointer-events-none absolute bottom-3.5 right-3.5 text-[#a0a4b4]" /></div><button type="button" onClick={generateVariants} disabled={generating || !source.trim()} className="gradient-button mt-0 inline-flex h-[45px] shrink-0 items-center justify-center gap-2 rounded-xl px-5 text-[12px] font-bold text-white shadow-lg shadow-indigo-300/40 transition sm:mt-5"><WandSparkles size={16} /> {generating ? "Adapting..." : "Generate variants"}</button></div>
              </section>
            </div>

            <div className="space-y-6 xl:sticky xl:top-6">
              <section className="panel-border soft-shadow overflow-hidden rounded-[22px] bg-white" aria-labelledby="preview-heading">
                <div className="flex items-center justify-between border-b border-[#eff0f4] px-6 py-5 sm:px-7"><div><h2 id="preview-heading" className="text-[16px] font-bold tracking-[-0.025em]">Live preview</h2><p className="mt-1 text-[12px] text-[#989bad]">See exactly what each draft says.</p></div><span className="flex items-center gap-1.5 rounded-full bg-[#ecf9f2] px-2.5 py-1.5 text-[10px] font-bold text-[#319164]"><span className="h-1.5 w-1.5 rounded-full bg-[#39ae73]" /> LIVE</span></div>
                <div className="mobile-x-scroll flex gap-1 border-b border-[#eff0f4] px-4 sm:px-6" role="tablist" aria-label="Platform previews">{platformIds.map((id) => <button key={id} type="button" role="tab" aria-selected={active === id} onClick={() => setActive(id)} className={`relative flex shrink-0 items-center gap-1.5 px-3 py-4 text-[11px] font-semibold transition sm:text-[12px] ${active === id ? "text-[#6657e9]" : "text-[#9296a8] hover:text-[#5a5d70]"}`}><span className={`${selected.includes(id) ? "" : "opacity-40"}`}>{platforms[id].name}</span>{active === id && <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-[#7665ef]" />}</button>)}</div>
                <div className="dot-grid bg-[#fafaff] p-5 sm:p-7"><div className="mx-auto max-w-[500px] overflow-hidden rounded-[18px] border border-[#e8e8f0] bg-white shadow-[0_13px_35px_rgba(34,37,77,.08)]"><div className="flex items-center gap-3 px-5 pt-5"><PlatformMark id={active} /><div className="min-w-0 flex-1"><div className="text-[13px] font-bold text-[#2f3145]">Your brand <span className="ml-1 text-[10px] text-[#9295a7]">●</span></div><div className="mt-0.5 truncate text-[11px] text-[#979aaa]">{platforms[active].handle} · now</div></div><span className="text-[17px] tracking-[2px] text-[#afb1bf]">···</span></div><div className="post-body min-h-[142px] px-5 pb-4 pt-4 text-[13px] leading-[1.75] text-[#414357]">{currentText || <span className="text-[#b1b4c2]">Your {platforms[active].name} preview will appear here.</span>}</div><div className="flex items-center gap-5 border-t border-[#f0f1f5] px-5 py-3.5 text-[11px] text-[#a0a4b2]"><span>♡ &nbsp;Like</span><span>◌ &nbsp;Reply</span><span>↗ &nbsp;Share</span></div></div><div className="mt-4 text-center text-[11px] text-[#aaaebe]">Preview only · No account connected</div></div>
                <div className="px-6 pb-6 pt-5 sm:px-7 sm:pb-7"><div className="mb-2 flex items-center justify-between"><label htmlFor="platform-draft" className="text-[12px] font-bold text-[#4c4f64]">Edit {platforms[active].name} draft</label><button type="button" onClick={() => setVariants((current) => { const next = { ...current }; delete next[active]; return next; })} disabled={variants[active] === undefined} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#8a7ce9] disabled:opacity-40"><RotateCcw size={12} /> Reset</button></div><textarea id="platform-draft" value={currentText} onChange={(event) => setVariants((current) => ({ ...current, [active]: event.target.value }))} className="min-h-[115px] w-full resize-y rounded-xl border border-[#e7e8f0] bg-[#fcfcfe] px-3.5 py-3 text-[12px] leading-[1.65] text-[#424559] outline-none focus:border-[#9488f4] focus:ring-[3px] focus:ring-[#efecff]" /><div className="mt-2 flex items-center justify-between"><span className={`text-[11px] ${currentCount > platforms[active].limit ? "font-semibold text-[#d45a62]" : "text-[#a0a4b4]"}`}>{currentCount > platforms[active].limit ? "Over platform limit" : variants[active] !== undefined ? "Custom version" : "Adapted from your draft"}</span><span className={`text-[11px] tabular-nums ${currentCount > platforms[active].limit ? "font-bold text-[#d45a62]" : "text-[#8f93a5]"}`}>{currentCount} / {platforms[active].limit}</span></div><button type="button" onClick={copyCurrent} disabled={!currentText} className="mt-4 inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#6e60df] disabled:opacity-40"><Copy size={13} /> Copy this draft</button></div>
              </section>

              <section className="panel-border soft-shadow rounded-[22px] bg-white p-6 sm:p-7" aria-labelledby="publish-heading"><div className="mb-5 flex items-center justify-between"><div><h2 id="publish-heading" className="text-[16px] font-bold tracking-[-0.025em]">Ready to share?</h2><p className="mt-1 text-[12px] text-[#989bad]">Review your selected drafts first.</p></div><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f0edff] text-[#7564e9]"><Send size={17} /></span></div><div className="mb-5 flex flex-wrap gap-2">{selected.length ? selected.map((id) => <span key={id} className="inline-flex items-center gap-1.5 rounded-full border border-[#e8e8ef] bg-[#fafafe] px-2.5 py-1.5 text-[11px] font-semibold text-[#5b5e72]"><PlatformMark id={id} size="small" /> {platforms[id].name}</span>) : <span className="text-[12px] text-[#a2a6b4]">No destinations selected</span>}</div>{invalidSelected.length > 0 && <p className="mb-4 flex items-start gap-1.5 text-[11px] leading-5 text-[#c35b64]"><CircleAlert size={14} className="mt-0.5 shrink-0" /> Review empty or over-limit drafts: {invalidSelected.map((id) => platforms[id].name).join(", ")}.</p>}<button type="button" onClick={simulatePublish} disabled={!canPublish} className="gradient-button flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-[13px] font-bold text-white shadow-lg shadow-indigo-300/40 transition"><Send size={16} /> {publishing ? "Simulating..." : `Simulate publish to ${selected.length || 0} platform${selected.length === 1 ? "" : "s"}`} <ArrowRight size={15} className="ml-1" /></button><p className="mt-3 text-center text-[11px] text-[#a5a8b8]">Demo action only. No post leaves this app.</p></section>
            </div>
          </div>

          {notice && <div role="status" className={`fixed bottom-4 left-4 right-4 z-50 flex items-start gap-2 rounded-xl border px-4 py-3 text-[12px] leading-5 shadow-xl sm:left-auto sm:max-w-md ${notice.kind === "success" ? "border-[#bde8cf] bg-[#f2fbf5] text-[#23764d]" : "border-[#f2ced0] bg-[#fff6f6] text-[#a94750]"}`}>{notice.kind === "success" ? <CheckCheck size={16} className="shrink-0" /> : <CircleAlert size={16} className="shrink-0" />}{notice.text}</div>}

          {storageWarning && <div role="alert" className="mt-6 rounded-xl border border-[#f2ced0] bg-[#fff6f6] px-4 py-3 text-[12px] text-[#a94750]">Browser storage is unavailable or full. Your changes may not survive a reload. Export your saved library if possible.</div>}

          <DraftLibraryPanel drafts={drafts} title={title} currentDraftId={currentDraftId} onTitleChange={setTitle} onSave={saveDraft} onNew={newDraft} onLoad={loadDraft} onDelete={deleteDraft} onExport={exportWorkspace} onImport={importWorkspace} />
          <SchedulePanel schedule={schedule} value={scheduleTime} now={now} canSchedule={Boolean(scheduleTime && source.trim() && selected.length && invalidSelected.length === 0)} runningId={runningId} onValueChange={setScheduleTime} onAdd={addToPlan} onLoad={loadScheduled} onRun={runScheduled} onRemove={removeScheduled} />
          <section id="activity" className="panel-border soft-shadow mt-8 overflow-hidden rounded-[22px] bg-white" aria-labelledby="activity-heading"><div className="flex items-center justify-between border-b border-[#eff0f4] px-6 py-5 sm:px-7"><div><h2 id="activity-heading" className="text-[16px] font-bold tracking-[-0.025em]">Recent simulations</h2><p className="mt-1 text-[12px] text-[#989bad]">A local record of your demo publishing runs.</p></div>{activity.length > 0 && <button type="button" onClick={() => setActivity([])} className="text-[11px] font-semibold text-[#8d80dd] hover:text-[#6354db]">Clear history</button>}</div>{activity.length === 0 ? <div className="flex flex-col items-center px-6 py-10 text-center"><span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-[#f1f1fb] text-[#8c8ee1]"><Clock3 size={20} /></span><p className="text-[13px] font-semibold text-[#55586d]">Nothing simulated yet</p><p className="mt-1 text-[11px] text-[#a0a4b4]">Your demo publishing activity will show up here.</p></div> : <div className="divide-y divide-[#f0f1f5]">{activity.map((item) => <div key={item.id} className="flex items-center gap-3 px-6 py-3.5 sm:px-7"><PlatformMark id={item.platform} size="small" /><span className="min-w-0 flex-1"><span className="block text-[12px] font-semibold text-[#46495c]">{platforms[item.platform].name} <span className="ml-1 rounded-full bg-[#f2efff] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#7969d5]">Simulated</span></span><span className="mt-0.5 block truncate text-[11px] text-[#a0a4b4]">{item.content}</span></span><span className="shrink-0 text-[10px] text-[#a8abba]">{formatTime(item.publishedAt)}</span></div>)}</div>}</section>
        </main>
      </div>
    </div>
  );
}
