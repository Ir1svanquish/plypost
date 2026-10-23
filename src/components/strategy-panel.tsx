"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Check, ChevronDown, Lightbulb, Pencil, Sparkles, X } from "lucide-react";
import { platformIds, platforms, type PlatformId } from "@/lib/platforms";
import type { BrandBrief, StrategyIdea, WeeklyPlan } from "@/lib/strategy";
import type { AssistedPost, SavedDraft } from "@/lib/workspace";

type BriefForm = Omit<BrandBrief, "updatedAt" | "contentPillars"> & { pillarsText: string };
type StrategyPayload = { brief: BrandBrief | null; plans: WeeklyPlan[]; draft?: SavedDraft; error?: string };
type BusyAction = "save-brief" | "generate" | "update-idea" | "approve-idea" | "dismiss-idea" | null;

const emptyBrief: BriefForm = {
  brandName: "", description: "", audience: "", goal: "", voice: "", facts: "",
  pillarsText: "", platforms: [...platformIds],
};

function asForm(brief: BrandBrief | null): BriefForm {
  return brief ? {
    brandName: brief.brandName, description: brief.description, audience: brief.audience,
    goal: brief.goal, voice: brief.voice, facts: brief.facts,
    pillarsText: brief.contentPillars.join("\n"), platforms: [...brief.platforms],
  } : { ...emptyBrief, platforms: [...platformIds] };
}

function normalizedBrief(form: BriefForm): Omit<BrandBrief, "updatedAt"> {
  return {
    brandName: form.brandName.trim(), description: form.description.trim(),
    audience: form.audience.trim(), goal: form.goal.trim(), voice: form.voice.trim(),
    facts: form.facts.trim(), contentPillars: form.pillarsText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
    platforms: platformIds.filter((id) => form.platforms.includes(id)),
  };
}

function localMonday(date: Date): string {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
}

function weekChoices(): { value: string; label: string }[] {
  const monday = localMonday(new Date());
  const [year, month, day] = monday.split("-").map(Number);
  return Array.from({ length: 5 }, (_, index) => {
    const date = new Date(year, month - 1, day + index * 7);
    return { value: localMonday(date), label: `${index === 0 ? "This week" : index === 1 ? "Next week" : `In ${index} weeks`} · ${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` };
  });
}

function togglePlatform(current: PlatformId[], id: PlatformId): PlatformId[] {
  return current.includes(id) ? current.filter((item) => item !== id) : platformIds.filter((item) => current.includes(item) || item === id);
}

function briefIsDirty(form: BriefForm, saved: BrandBrief | null): boolean {
  return JSON.stringify(normalizedBrief(form)) !== JSON.stringify(normalizedBrief(asForm(saved)));
}

export function StrategyPanel({ drafts, assisted, onDraftApproved, onOpenDraft, onOpenAssisted, onDirtyChange, refreshToken = 0 }: {
  drafts: SavedDraft[];
  assisted: AssistedPost[];
  onDraftApproved: (draft: SavedDraft) => void;
  onOpenDraft: (draft: SavedDraft) => void;
  onOpenAssisted: (item: AssistedPost) => void;
  onDirtyChange: (dirty: boolean) => void;
  refreshToken?: number;
}) {
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [brief, setBrief] = useState<BrandBrief | null>(null);
  const [form, setForm] = useState<BriefForm>(() => asForm(null));
  const [profileOpen, setProfileOpen] = useState(true);
  const [plans, setPlans] = useState<WeeklyPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [weekStart, setWeekStart] = useState(() => localMonday(new Date()));
  const [provider, setProvider] = useState<"nvidia" | "nebius">("nvidia");
  const [busy, setBusy] = useState<BusyAction>(null);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [editingIdeaId, setEditingIdeaId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editSeed, setEditSeed] = useState("");
  const [editPlatforms, setEditPlatforms] = useState<PlatformId[]>([]);
  const [newDrafts, setNewDrafts] = useState<Record<string, SavedDraft>>({});
  const dirtyBrief = briefIsDirty(form, brief);
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? plans[0];
  const editingIdea = selectedPlan?.ideas.find((idea) => idea.id === editingIdeaId);
  const dirtyIdea = Boolean(editingIdea && (
    editTitle !== editingIdea.title || editSeed !== editingIdea.seed ||
    JSON.stringify(editPlatforms) !== JSON.stringify(editingIdea.platforms)
  ));
  const choices = weekChoices();

  useEffect(() => {
    onDirtyChange(dirtyBrief || dirtyIdea);
  }, [dirtyBrief, dirtyIdea, onDirtyChange]);

  useEffect(() => {
    setNewDrafts((current) => {
      const remaining = Object.fromEntries(Object.entries(current).filter(([id]) => !drafts.some((draft) => draft.id === id)));
      return Object.keys(remaining).length === Object.keys(current).length ? current : remaining;
    });
  }, [drafts]);

  useEffect(() => {
    if (!dirtyBrief && !dirtyIdea) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyBrief, dirtyIdea]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const response = await fetch("/api/strategy", { cache: "no-store", signal: controller.signal });
        const data = await response.json() as StrategyPayload;
        if (!response.ok) throw new Error(data.error || "Could not load your AI plan.");
        if (controller.signal.aborted) return;
        setBrief(data.brief);
        setForm(asForm(data.brief));
        setPlans(data.plans);
        setNewDrafts({});
        setSelectedPlanId(data.plans[0]?.id ?? "");
        setProfileOpen(!data.brief);
        setEditingIdeaId(null);
        setMessage(null);
      } catch (error) {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Could not load your AI plan.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [refreshToken, reloadKey]);

  async function mutate(action: Exclude<BusyAction, null>, body: Record<string, unknown>): Promise<StrategyPayload | null> {
    if (busy) return null;
    setBusy(action);
    setMessage(null);
    try {
      const response = await fetch("/api/strategy", {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      const data = await response.json() as StrategyPayload;
      if (!response.ok) throw new Error(data.error || "Could not update your AI plan.");
      setBrief(data.brief);
      setPlans(data.plans);
      return data;
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not update your AI plan." });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function saveBrief() {
    const candidate = normalizedBrief(form);
    if (!candidate.brandName || !candidate.audience || !candidate.goal || !candidate.voice || !candidate.contentPillars.length || !candidate.platforms.length) {
      setMessage({ kind: "error", text: "Add a brand name, audience, goal, voice, at least one content pillar and one platform." });
      return;
    }
    if (candidate.contentPillars.length > 5 || candidate.contentPillars.some((pillar) => Array.from(pillar).length > 120) ||
      new Set(candidate.contentPillars.map((pillar) => pillar.toLocaleLowerCase())).size !== candidate.contentPillars.length) {
      setMessage({ kind: "error", text: "Use one to five distinct content pillars, each under 120 characters." });
      return;
    }
    const data = await mutate("save-brief", { brief: candidate });
    if (!data) return;
    setForm(asForm(data.brief));
    setMessage({ kind: "success", text: "Brand profile saved. New plans will use this version; existing plans keep their original profile." });
    setProfileOpen(false);
  }

  async function generate() {
    if (dirtyIdea) {
      setMessage({ kind: "error", text: "Save or cancel your idea edits before generating another plan." });
      return;
    }
    if (dirtyBrief) {
      setMessage({ kind: "error", text: "Save your brand profile before generating a plan." });
      setProfileOpen(true);
      return;
    }
    const data = await mutate("generate", { provider, weekStart });
    if (!data) return;
    setSelectedPlanId(data.plans[0]?.id ?? "");
    setEditingIdeaId(null);
    setMessage({ kind: "success", text: "Ideas generated for review. Nothing was scheduled or published." });
  }

  function startEditing(idea: StrategyIdea) {
    if (dirtyIdea && !window.confirm("Discard your unsaved changes to this idea?")) return;
    setEditingIdeaId(idea.id);
    setEditTitle(idea.title);
    setEditSeed(idea.seed);
    setEditPlatforms([...idea.platforms]);
    setMessage(null);
  }

  async function saveIdea(idea: StrategyIdea) {
    if (!selectedPlan) return;
    if (!editTitle.trim() || !editSeed.trim() || editPlatforms.length === 0) {
      setMessage({ kind: "error", text: "Add a title, draft text and at least one platform." });
      return;
    }
    const data = await mutate("update-idea", { planId: selectedPlan.id, ideaId: idea.id, patch: {
      title: editTitle.trim(), seed: editSeed.trim(), platforms: editPlatforms,
    } });
    if (!data) return;
    setEditingIdeaId(null);
    setMessage({ kind: "success", text: "Idea saved. Review it once more before approving." });
  }

  async function approveIdea(idea: StrategyIdea) {
    if (!selectedPlan) return;
    if (editingIdeaId === idea.id && dirtyIdea) {
      setMessage({ kind: "error", text: "Save or discard your edits before approving this idea." });
      return;
    }
    const data = await mutate("approve-idea", { planId: selectedPlan.id, ideaId: idea.id });
    if (!data) return;
    if (data.draft) {
      setNewDrafts((current) => ({ ...current, [data.draft!.id]: data.draft! }));
      onDraftApproved(data.draft);
    }
    setMessage({ kind: "success", text: "Approved as a saved draft. Open it to adapt each platform version; nothing was scheduled or published." });
  }

  async function dismissIdea(idea: StrategyIdea) {
    if (!selectedPlan) return;
    if (editingIdeaId === idea.id && dirtyIdea && !window.confirm("Discard your unsaved edits and dismiss this idea?")) return;
    const data = await mutate("dismiss-idea", { planId: selectedPlan.id, ideaId: idea.id });
    if (!data) return;
    setEditingIdeaId(null);
    setMessage({ kind: "success", text: "Idea dismissed. It remains in the plan for reference." });
  }

  return <section id="strategy" className="section-anchor panel-border soft-shadow overflow-hidden rounded-[18px] bg-[var(--surface)]" aria-labelledby="strategy-heading" aria-busy={loading || busy !== null}>
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] px-5 py-5 sm:px-7">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-text)]"><Sparkles size={18} aria-hidden="true" /></span>
        <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--accent-text)]">AI planning</p><h2 id="strategy-heading" className="mt-0.5 text-[18px] font-bold tracking-[-0.025em] text-[var(--text)]">From goal to weekly ideas</h2><p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">Set your direction, review up to three ideas, then approve only the drafts you want.</p></div>
      </div>
      {brief && !loading && <span className="rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-1.5 text-[11px] font-bold text-[var(--accent-text)]">Profile saved</span>}
    </div>
    {loading ? <p role="status" className="px-5 py-8 text-[13px] text-[var(--text-muted)] sm:px-7">Loading your plan…</p> : loadError ? <div role="alert" className="px-5 py-7 text-[13px] text-[var(--danger)] sm:px-7">{loadError}<button type="button" onClick={() => setReloadKey((key) => key + 1)} className="ml-2 font-bold underline">Try again</button></div> : <div className="space-y-6 p-5 sm:p-7">
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-muted)]">
        <button type="button" onClick={() => setProfileOpen((value) => !value)} aria-expanded={profileOpen} aria-controls="strategy-brief-form" className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left sm:px-5">
          <span className="min-w-0"><span className="block text-[13px] font-bold text-[var(--text)]">Brand profile {dirtyBrief && <span className="ml-1 text-[11px] font-semibold text-[var(--warning)]">· Unsaved changes</span>}</span><span className="mt-0.5 block truncate text-[12px] text-[var(--text-muted)]">{brief ? `${brief.brandName} · ${brief.goal}` : "Add the details that should guide each weekly plan."}</span></span>
          <ChevronDown size={17} aria-hidden="true" className={`shrink-0 text-[var(--text-soft)] transition-transform ${profileOpen ? "rotate-180" : ""}`} />
        </button>
        {profileOpen && <div id="strategy-brief-form" className="grid gap-4 border-t border-[var(--line)] p-4 sm:grid-cols-2 sm:p-5">
          <label className="block text-[12px] font-semibold text-[var(--text-secondary)]">Brand or account name <span className="text-[var(--danger)]">*</span><input value={form.brandName} onChange={(event) => setForm({ ...form, brandName: event.target.value })} maxLength={80} disabled={busy !== null} placeholder="Your brand" className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--field)] px-3 py-2.5 text-[13px] text-[var(--text)]" /></label>
          <label className="block text-[12px] font-semibold text-[var(--text-secondary)]">Audience <span className="text-[var(--danger)]">*</span><input value={form.audience} onChange={(event) => setForm({ ...form, audience: event.target.value })} maxLength={500} disabled={busy !== null} placeholder="Who do you want to reach?" className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--field)] px-3 py-2.5 text-[13px] text-[var(--text)]" /></label>
          <label className="block text-[12px] font-semibold text-[var(--text-secondary)]">Goal <span className="text-[var(--danger)]">*</span><input value={form.goal} onChange={(event) => setForm({ ...form, goal: event.target.value })} maxLength={500} disabled={busy !== null} placeholder="What should these posts achieve?" className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--field)] px-3 py-2.5 text-[13px] text-[var(--text)]" /></label>
          <label className="block text-[12px] font-semibold text-[var(--text-secondary)]">Voice <span className="text-[var(--danger)]">*</span><input value={form.voice} onChange={(event) => setForm({ ...form, voice: event.target.value })} maxLength={500} disabled={busy !== null} placeholder="e.g. practical, warm, concise" className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--field)] px-3 py-2.5 text-[13px] text-[var(--text)]" /></label>
          <label className="block text-[12px] font-semibold text-[var(--text-secondary)] sm:col-span-2">What you offer <span className="font-normal text-[var(--text-soft)]">(optional)</span><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={2000} rows={2} disabled={busy !== null} placeholder="A short description of the product or project" className="mt-1.5 w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--field)] px-3 py-2.5 text-[13px] text-[var(--text)]" /></label>
          <label className="block text-[12px] font-semibold text-[var(--text-secondary)]">Content pillars <span className="text-[var(--danger)]">*</span><span className="block font-normal text-[var(--text-soft)]">One topic per line, up to five</span><textarea value={form.pillarsText} onChange={(event) => setForm({ ...form, pillarsText: event.target.value })} rows={3} disabled={busy !== null} placeholder={"Product tips\nLessons learned"} className="mt-1.5 w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--field)] px-3 py-2.5 text-[13px] text-[var(--text)]" /></label>
          <label className="block text-[12px] font-semibold text-[var(--text-secondary)]">Confirmed facts and constraints <span className="font-normal text-[var(--text-soft)]">(optional)</span><span className="block font-normal text-[var(--text-soft)]">Only give AI claims you can verify.</span><textarea value={form.facts} onChange={(event) => setForm({ ...form, facts: event.target.value })} maxLength={3000} rows={3} disabled={busy !== null} placeholder="Facts to use, claims to avoid, or a source URL" className="mt-1.5 w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--field)] px-3 py-2.5 text-[13px] text-[var(--text)]" /></label>
          <fieldset className="sm:col-span-2" disabled={busy !== null}><legend className="mb-2 text-[12px] font-semibold text-[var(--text-secondary)]">Platforms <span className="text-[var(--danger)]">*</span></legend><div className="flex flex-wrap gap-2">{platformIds.map((id) => <label key={id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-semibold ${form.platforms.includes(id) ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]" : "border-[var(--line)] bg-[var(--field)] text-[var(--text-secondary)]"}`}><input type="checkbox" checked={form.platforms.includes(id)} onChange={() => setForm({ ...form, platforms: togglePlatform(form.platforms, id) })} className="accent-[var(--accent)]" />{platforms[id].name}</label>)}</div></fieldset>
          <div className="flex flex-wrap items-center justify-end gap-3 sm:col-span-2"><span className="mr-auto text-[11px] leading-5 text-[var(--text-soft)]">Stored in your account. Only this saved brand profile is sent to the chosen AI provider when you click Generate ideas; posting results stay local.</span><button type="button" onClick={() => { setForm(asForm(brief)); setMessage(null); }} disabled={!dirtyBrief || busy !== null} className="rounded-lg px-3 py-2 text-[12px] font-semibold text-[var(--text-secondary)] disabled:opacity-45">Discard edits</button><button type="button" onClick={() => void saveBrief()} disabled={!dirtyBrief || busy !== null} className="gradient-button rounded-lg px-4 py-2.5 text-[12px] font-bold text-white disabled:opacity-45">{busy === "save-brief" ? "Saving…" : "Save profile"}</button></div>
        </div>}
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5 lg:flex-row lg:items-end">
        <div className="min-w-0 flex-1"><h3 className="text-[14px] font-bold text-[var(--text)]">Make a weekly plan</h3><p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">AI suggests up to three topics from your saved profile. You decide what becomes a draft.</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-[12px] font-semibold text-[var(--text-secondary)]">Week<select value={weekStart} onChange={(event) => setWeekStart(event.target.value)} disabled={busy !== null} className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--field)] px-3 py-2.5 text-[13px] text-[var(--text)]">{choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select></label><label className="text-[12px] font-semibold text-[var(--text-secondary)]">AI provider<select value={provider} onChange={(event) => setProvider(event.target.value as "nvidia" | "nebius")} disabled={busy !== null} className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--field)] px-3 py-2.5 text-[13px] text-[var(--text)]"><option value="nvidia">NVIDIA Nemotron</option><option value="nebius">Nebius</option></select></label></div><p className="mt-3 text-[11px] leading-5 text-[var(--text-soft)]">Clicking Generate sends your saved brand profile to the selected AI provider. Self-reported posting results and metrics are not sent.</p></div>
        <button type="button" onClick={() => void generate()} disabled={!brief || dirtyBrief || busy !== null} className="gradient-button inline-flex shrink-0 items-center justify-center gap-2 rounded-xl px-5 py-3 text-[13px] font-bold text-white disabled:opacity-45"><Sparkles size={16} aria-hidden="true" />{busy === "generate" ? "Generating…" : "Generate ideas"}</button>
      </div>
      {!brief && <p className="rounded-xl bg-[var(--info-soft)] px-4 py-3 text-[12px] leading-5 text-[var(--info)]">Save your brand profile to start. No example ideas are shown in place of real AI results.</p>}
      {dirtyBrief && <p className="rounded-xl bg-[var(--warning-soft)] px-4 py-3 text-[12px] leading-5 text-[var(--warning)]">Your profile has unsaved changes. Save them before generating ideas.</p>}
      {message && <p role={message.kind === "error" ? "alert" : "status"} className={`rounded-xl px-4 py-3 text-[12px] leading-5 ${message.kind === "error" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--positive-soft)] text-[var(--positive)]"}`}>{message.text}</p>}

      <div className="border-t border-[var(--line)] pt-5">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="text-[15px] font-bold text-[var(--text)]">Ideas to review</h3><p className="mt-1 text-[12px] text-[var(--text-muted)]">Only your approved ideas become saved drafts.</p></div>{plans.length > 0 && <label className="w-full text-[11px] font-semibold text-[var(--text-secondary)] sm:w-auto">Plan<select value={selectedPlan?.id ?? ""} onChange={(event) => { if (dirtyIdea && !window.confirm("Discard your unsaved idea edits?")) return; setSelectedPlanId(event.target.value); setEditingIdeaId(null); }} className="mt-1 block w-full min-w-0 rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[12px] text-[var(--text)] sm:w-60">{plans.map((plan) => <option key={plan.id} value={plan.id}>Week of {plan.weekStart} · {new Date(plan.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</option>)}</select></label>}</div>
        {!selectedPlan ? <div className="mt-4 flex items-start gap-3 rounded-xl border border-dashed border-[var(--line)] bg-[var(--surface-muted)] p-5 text-[12px] leading-5 text-[var(--text-muted)]"><Lightbulb size={17} className="mt-0.5 shrink-0 text-[var(--accent-text)]" aria-hidden="true" />Your generated ideas will appear here for review.</div> : <div className="mt-4 space-y-3"><p className="text-[11px] text-[var(--text-soft)]">Created {new Date(selectedPlan.createdAt).toLocaleString("en-US")} · {selectedPlan.provider === "nebius" ? "Nebius" : "NVIDIA Nemotron"} · profile snapshot saved with this plan</p>{selectedPlan.ideas.map((idea, index) => {
          const isEditing = editingIdeaId === idea.id && idea.status === "proposed";
          const draft = (idea.draftId && (drafts.find((item) => item.id === idea.draftId) ?? newDrafts[idea.draftId])) || null;
          const handoffs = idea.draftId ? assisted.filter((item) => item.sourceDraftId === idea.draftId) : [];
          const postedCount = handoffs.filter((item) => item.status === "posted").length;
          return <article key={idea.id} className={`rounded-2xl border p-4 sm:p-5 ${idea.status === "dismissed" ? "border-[var(--line)] bg-[var(--surface-muted)] opacity-75" : "border-[var(--line)] bg-[var(--surface)]"}`}>
            <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--text-soft)]">Idea {index + 1}</p><h4 className="mt-1 break-words text-[15px] font-bold text-[var(--text)]">{idea.title}</h4></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${idea.status === "approved" ? "bg-[var(--positive-soft)] text-[var(--positive)]" : idea.status === "dismissed" ? "bg-[var(--surface-muted)] text-[var(--text-muted)]" : "bg-[var(--accent-soft)] text-[var(--accent-text)]"}`}>{idea.status === "approved" ? "Approved draft" : idea.status === "dismissed" ? "Dismissed" : "Needs review"}</span></div>
            {idea.angle && <p className="mt-2 text-[12px] leading-5 text-[var(--text-secondary)]"><span className="font-bold">Angle:</span> {idea.angle}</p>}
            {idea.rationale && <p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]"><span className="font-bold">Why:</span> {idea.rationale}</p>}
            {isEditing ? <div className="mt-4 space-y-3 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] p-4"><label className="block text-[12px] font-semibold text-[var(--text-secondary)]">Title<input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} maxLength={120} disabled={busy !== null} className="mt-1.5 w-full rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[13px] text-[var(--text)]" /></label><label className="block text-[12px] font-semibold text-[var(--text-secondary)]">Source draft<textarea value={editSeed} onChange={(event) => setEditSeed(event.target.value)} maxLength={3000} rows={5} disabled={busy !== null} className="mt-1.5 w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[13px] leading-5 text-[var(--text)]" /></label><fieldset disabled={busy !== null}><legend className="mb-2 text-[12px] font-semibold text-[var(--text-secondary)]">Destinations</legend><div className="flex flex-wrap gap-2">{platformIds.map((id) => <label key={id} className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]"><input type="checkbox" checked={editPlatforms.includes(id)} onChange={() => setEditPlatforms(togglePlatform(editPlatforms, id))} className="accent-[var(--accent)]" />{platforms[id].name}</label>)}</div></fieldset><div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={() => { setEditingIdeaId(null); setMessage(null); }} disabled={busy !== null} className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-[12px] font-semibold text-[var(--text-secondary)]"><X size={14} aria-hidden="true" />Cancel</button><button type="button" onClick={() => void saveIdea(idea)} disabled={busy !== null || !dirtyIdea} className="gradient-button rounded-lg px-4 py-2 text-[12px] font-bold text-white disabled:opacity-45">{busy === "update-idea" ? "Saving…" : "Save idea"}</button></div></div> : <><p className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-[var(--surface-muted)] p-3 text-[12px] leading-5 text-[var(--text-secondary)]">{idea.seed}</p><div className="mt-3 flex flex-wrap gap-1.5">{idea.platforms.map((id) => <span key={id} className="rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-secondary)]">{platforms[id].name}</span>)}</div></>}
            {idea.status === "proposed" && !isEditing && <div className="mt-4 flex flex-wrap items-center justify-end gap-2"><button type="button" onClick={() => startEditing(idea)} disabled={busy !== null} className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-[12px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-45"><Pencil size={13} aria-hidden="true" />Edit</button><button type="button" onClick={() => void dismissIdea(idea)} disabled={busy !== null} className="rounded-lg px-3 py-2 text-[12px] font-semibold text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:opacity-45">Dismiss</button><button type="button" onClick={() => void approveIdea(idea)} disabled={busy !== null} className="gradient-button inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12px] font-bold text-white disabled:opacity-45"><Check size={14} aria-hidden="true" />{busy === "approve-idea" ? "Approving…" : "Approve to draft"}</button></div>}
            {idea.status === "approved" && <div className="mt-4 flex flex-wrap items-center justify-between gap-2"><div className="text-[11px] leading-5 text-[var(--text-soft)]"><p>Approval saved a draft. Review its platform versions in Create.</p><p>{handoffs.length} manual {handoffs.length === 1 ? "handoff" : "handoffs"} prepared · {postedCount} marked posted by you</p></div><div className="flex flex-wrap items-center gap-3">{handoffs.length > 0 && <button type="button" onClick={() => onOpenAssisted(handoffs.find((item) => item.status === "queued") ?? handoffs[0])} className="inline-flex items-center gap-1 text-[12px] font-bold text-[var(--accent-text)]">View handoffs <ArrowRight size={13} aria-hidden="true" /></button>}{draft ? <button type="button" onClick={() => onOpenDraft(draft)} className="inline-flex items-center gap-1 text-[12px] font-bold text-[var(--accent-text)]">Open draft <ArrowRight size={13} aria-hidden="true" /></button> : <span className="text-[11px] text-[var(--warning)]">Draft is no longer in the library.</span>}</div></div>}
          </article>;
        })}</div>}
      </div>
      <p className="border-t border-[var(--line)] pt-4 text-[11px] leading-5 text-[var(--text-soft)]">AI ideas can be inaccurate. Check every claim before approval. Approval saves a draft only; publishing and scheduling are separate actions. Self-reported posting results stay local and are not used for AI planning yet.</p>
    </div>}
  </section>;
}
