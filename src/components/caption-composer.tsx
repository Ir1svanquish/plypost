"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { AiLiteralNotice } from "@/components/ai-literal-notice";
import { parseVoiceProfile, type VoiceProfile } from "@/lib/ai-studio";
import { captionStyles, type CaptionStyleId } from "@/lib/caption-styles";
import { characterCount } from "@/lib/platforms";

type Props = {
  source: string;
  revision: number;
  editorEpoch: number;
  profileRefreshEpoch: number;
  mediaIds: readonly string[];
  videoId: string | null;
  selectedCount: number;
  generating: boolean;
  hasReview: boolean;
  onGenerate: (useVoice: boolean) => void;
  onUseDraft: (draft: string, expectedSource: string, expectedRevision: number) => boolean;
};

type Suggestion = {
  source: string; revision: number; imageId: string | null; style: CaptionStyleId;
  voiceUpdatedAt: string | null; observations: string | null; draft: string;
};

const captionReadyNotice = "Check the facts and edit the suggestion before using it.";

function examplesFromText(text: string): string[] {
  return text.split(/\r?\n\s*---\s*\r?\n/).map((item) => item.trim()).filter(Boolean);
}

async function responseError(response: Response, fallback: string) {
  const body: unknown = await response.json().catch(() => null);
  return body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : fallback;
}

export function CaptionComposer({ source, revision, editorEpoch, profileRefreshEpoch, mediaIds, videoId, selectedCount, generating, hasReview, onGenerate, onUseDraft }: Props) {
  const [profile, setProfile] = useState<VoiceProfile | null>(null);
  const [profileStatus, setProfileStatus] = useState<"loading" | "ready" | "error">("loading");
  const [profileRetry, setProfileRetry] = useState(0);
  const [style, setStyle] = useState<CaptionStyleId>("default");
  const [guideDraft, setGuideDraft] = useState<string | null>(null);
  const [guideBaseVersion, setGuideBaseVersion] = useState<string | null>(null);
  const [oldPosts, setOldPosts] = useState("");
  const [selectedImageId, setSelectedImageId] = useState("");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [busy, setBusy] = useState<"voice" | "caption" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const captionRequest = useRef<AbortController | null>(null);
  const captionRequestId = useRef(0);
  const currentEditorEpoch = useRef(editorEpoch);
  currentEditorEpoch.current = editorEpoch;

  useEffect(() => {
    captionRequestId.current += 1;
    captionRequest.current?.abort();
    captionRequest.current = null;
    setBusy((current) => current === "caption" ? null : current);
    setSuggestion(null);
    setSelectedImageId("");
    setError("");
    setNotice("");
  }, [editorEpoch]);

  useEffect(() => () => captionRequest.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    setProfileStatus("loading");
    fetch("/api/ai-studio", { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, "Could not load your writing style."));
        return response.json() as Promise<{ voiceProfile: VoiceProfile | null }>;
      })
      .then((data) => { if (!controller.signal.aborted) {
        setProfile(data.voiceProfile);
        if (!data.voiceProfile) setStyle("default");
        setProfileStatus("ready");
      } })
      .catch(() => { if (!controller.signal.aborted) setProfileStatus("error"); });
    return () => controller.abort();
  }, [profileRefreshEpoch, profileRetry]);

  async function profileWriteError(response: Response, fallback: string): Promise<string> {
    const body: unknown = await response.json().catch(() => null);
    if (response.status === 409 && body && typeof body === "object" && "voiceProfile" in body) {
      const latest = body.voiceProfile === null ? null : parseVoiceProfile(body.voiceProfile);
      setProfile(latest);
      setProfileStatus("ready");
      if (!latest) setStyle("default");
    }
    return body && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? body.error : fallback;
  }

  async function analyze() {
    if (profileStatus !== "ready" || busy || guideDraft !== null) return;
    const examples = examplesFromText(oldPosts);
    if (examples.length < 3 || examples.length > 6 || examples.some((item) => Array.from(item).length > 1800)) {
      setError("Enter 3–6 past posts, each under 1,800 characters, separated by a line with --- ."); return;
    }
    setBusy("voice"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/ai-studio", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store",
        body: JSON.stringify({ action: "analyze-style", examples, expectedUpdatedAt: profile?.updatedAt ?? null }),
      });
      if (!response.ok) throw new Error(await profileWriteError(response, "Could not analyze examples."));
      const data = await response.json() as { voiceProfile?: VoiceProfile };
      if (!data.voiceProfile) throw new Error("No writing style was returned.");
      setProfile(data.voiceProfile); setOldPosts(""); setGuideDraft(null); setGuideBaseVersion(null); setStyle("personal");
      setNotice("Style guide saved. Your sample posts were not stored in Plypost.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not analyze examples."); }
    finally { setBusy(null); }
  }

  async function saveEditedGuide() {
    if (profileStatus !== "ready" || !profile || !guideBaseVersion || busy) return;
    if (guideBaseVersion !== profile.updatedAt) {
      setError("The saved guide changed. Compare it with your edit below before choosing which wording to keep.");
      return;
    }
    const guide = guideDraft?.trim();
    if (!guide || Array.from(guide).length > 1000) { setError("Keep the style guide under 1,000 characters."); return; }
    setBusy("voice"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/ai-studio", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store",
        body: JSON.stringify({ guide, expectedUpdatedAt: guideBaseVersion }),
      });
      if (!response.ok) throw new Error(await profileWriteError(response, "Could not save the style guide."));
      const data = await response.json() as { voiceProfile?: VoiceProfile };
      if (!data.voiceProfile) throw new Error("No saved style guide was returned.");
      setProfile(data.voiceProfile); setGuideDraft(null); setGuideBaseVersion(null); setNotice("Your edited style guide was saved without an AI request.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save the style guide."); }
    finally { setBusy(null); }
  }

  async function removeProfile() {
    if (profileStatus !== "ready" || !profile || busy) return;
    if (!window.confirm(`Remove your saved writing style guide?${guideDraft !== null ? " Your unsaved guide edits will also be discarded." : ""} You can analyze old posts again later.`)) return;
    setBusy("voice"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/ai-studio", { method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: profile.updatedAt }), credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(await profileWriteError(response, "Could not remove the style guide."));
      setProfile(null); setStyle("default"); setGuideDraft(null); setGuideBaseVersion(null); setNotice("Saved writing style removed.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not remove the style guide."); }
    finally { setBusy(null); }
  }

  const imageId = mediaIds.includes(selectedImageId) ? selectedImageId : mediaIds[0] ?? null;
  const working = Boolean(busy || generating);
  const guideConflict = guideDraft !== null && profile !== null && guideBaseVersion !== profile.updatedAt;
  const canGenerate = Boolean(imageId || source.trim()) && (style !== "personal" || profileStatus === "ready" && Boolean(profile));
  const suggestionCurrent = Boolean(suggestion && suggestion.source === source && suggestion.revision === revision &&
    suggestion.imageId === imageId && suggestion.style === style &&
    suggestion.voiceUpdatedAt === (style === "personal" ? profile?.updatedAt ?? null : null));
  const shownNotice = suggestion && !suggestionCurrent && notice === captionReadyNotice ? "" : notice;

  async function generateCaption() {
    if (!canGenerate || working) return;
    const sourceAtStart = source;
    const revisionAtStart = revision;
    const editorEpochAtStart = editorEpoch;
    const voiceUpdatedAt = style === "personal" ? profile?.updatedAt ?? null : null;
    const controller = new AbortController();
    const requestId = ++captionRequestId.current;
    captionRequest.current = controller;
    setBusy("caption"); setError(""); setNotice(""); setSuggestion(null);
    try {
      const response = await fetch("/api/ai-studio", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify(imageId
          ? { action: "caption-image", mediaId: imageId, context: source.trim(), style }
          : { action: "draft-from-notes", notes: source.trim(), style }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Could not generate a caption."));
      const data = await response.json() as { draft?: string; caption?: string; observations?: string };
      if (controller.signal.aborted || captionRequestId.current !== requestId || currentEditorEpoch.current !== editorEpochAtStart) return;
      const draft = imageId ? data.caption : data.draft;
      if (!draft?.trim()) throw new Error("No usable caption was returned.");
      setSuggestion({ source: sourceAtStart, revision: revisionAtStart, imageId, style,
        voiceUpdatedAt, observations: imageId ? data.observations ?? null : null, draft });
      setNotice(captionReadyNotice);
    } catch (cause) {
      if (!controller.signal.aborted && captionRequestId.current === requestId && currentEditorEpoch.current === editorEpochAtStart)
        setError(cause instanceof Error ? cause.message : "Could not generate a caption.");
    } finally {
      if (captionRequestId.current === requestId) { captionRequest.current = null; setBusy(null); }
    }
  }

  return <section aria-label="AI writing tools" className="mt-3">
    <details className="rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] p-3 sm:p-4">
      <summary className="gradient-button flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-4 text-[13px] font-bold text-white [&::-webkit-details-marker]:hidden"><span className="inline-flex items-center gap-2"><Sparkles size={16} aria-hidden="true" />Generate caption</span><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="mt-4 space-y-4">
        <p className="text-[12px] leading-5 text-[var(--text-muted)]">Uses the notes above and one selected photo. A video can stay attached, but AI does not read its frames. Nothing is sent until you click Generate suggestion.</p>
        <fieldset><legend className="text-[12px] font-bold text-[var(--text)]">Writing style</legend>
          {([[["default", "personal"], "Start here"], [["direct", "practical", "conversation", "behindScenes", "story"], "Other styles"]] as const).map(([ids, heading]) => <div key={heading} className="mt-3">
            <p className="text-[11px] font-semibold text-[var(--text-muted)]">{heading}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">{ids.map((id) => <label key={id} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2.5 ${style === id ? "border-[var(--accent-border)] bg-[var(--surface)]" : "border-[var(--line)] bg-[var(--surface-muted)]"}`}>
              <input type="radio" name="caption-style" value={id} checked={style === id} onChange={() => setStyle(id)} disabled={working || (id === "personal" && (profileStatus !== "ready" || !profile))} className="mt-0.5 accent-[var(--accent)] disabled:opacity-40" />
              <span><span className="block text-[12px] font-bold text-[var(--text)]">{captionStyles[id].label}{id === "personal" && !profile ? " · set up first" : ""}</span><span className="block text-[11px] leading-4 text-[var(--text-muted)]">{captionStyles[id].description}</span></span>
            </label>)}</div>
          </div>)}
        </fieldset>
        <details className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
          <summary className="cursor-pointer text-[12px] font-semibold text-[var(--accent-text)]">Set up my style {profile ? "· saved" : "· from 3–6 past posts"}</summary>
          <p className="mt-2 text-[11px] leading-5 text-[var(--text-muted)]">Paste posts you choose, separated by a line with --- . Only the derived guide is saved. Personal style must be set up before selection.</p>
          {profileStatus === "loading" && <p role="status" className="mt-2 text-[11px] text-[var(--text-muted)]">Loading your saved style guide…</p>}
          {profileStatus === "error" && <p role="alert" className="mt-2 text-[11px] text-[var(--danger)]">Could not check the saved style guide. <button type="button" onClick={() => setProfileRetry((value) => value + 1)} className="font-semibold underline underline-offset-2">Retry</button></p>}
          {profile && <div className="mt-3 rounded-lg bg-[var(--accent-soft)] p-3"><p className="text-[11px] font-bold text-[var(--accent-text)]">Saved style guide</p>
            {guideDraft === null ? <p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-[var(--text-secondary)]">{profile.guide}</p> : <>
              {guideConflict && <div role="alert" className="mt-2 rounded-lg border border-[var(--warning)] bg-[var(--surface)] p-2.5 text-[11px] leading-5 text-[var(--warning)]"><p className="font-bold">This guide changed elsewhere. Latest saved version:</p><p className="mt-1 whitespace-pre-wrap text-[var(--text-secondary)]">{profile.guide}</p><div className="mt-2 flex flex-wrap gap-3"><button type="button" onClick={() => { setGuideDraft(profile.guide); setGuideBaseVersion(profile.updatedAt); setError(""); }} className="font-semibold underline underline-offset-2">Use latest wording</button><button type="button" onClick={() => { setGuideBaseVersion(profile.updatedAt); setError(""); }} className="font-semibold underline underline-offset-2">Keep my wording</button></div></div>}
              <textarea aria-label="Edit saved style guide" value={guideDraft} onChange={(event) => { if (characterCount(event.target.value) <= 1000) setGuideDraft(event.target.value); }} className="mt-2 min-h-24 w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[12px] leading-5 text-[var(--text)]" />
            </>}
            <div className="mt-2 flex flex-wrap items-center gap-3">{guideDraft === null ? <button type="button" onClick={() => { setGuideDraft(profile.guide); setGuideBaseVersion(profile.updatedAt); }} disabled={working || profileStatus !== "ready"} className="text-[11px] font-semibold text-[var(--accent-text)] disabled:opacity-50">Edit guide</button> : <><button type="button" onClick={() => void saveEditedGuide()} disabled={working || profileStatus !== "ready" || guideConflict || !guideDraft.trim()} className="text-[11px] font-semibold text-[var(--accent-text)] disabled:opacity-50">Save edits</button><button type="button" onClick={() => { setGuideDraft(null); setGuideBaseVersion(null); }} disabled={working} className="text-[11px] font-semibold text-[var(--text-secondary)] disabled:opacity-50">Cancel</button></>}
              <button type="button" onClick={() => void removeProfile()} disabled={working || profileStatus !== "ready"} className="text-[11px] font-semibold text-[var(--danger)] disabled:opacity-50">Remove guide</button></div>
          </div>}
          {!profile && guideDraft !== null && <div className="mt-3 rounded-lg bg-[var(--warning-soft)] p-3"><p className="text-[11px] font-semibold text-[var(--warning)]">The saved guide was removed elsewhere. Your unsaved wording is below so you can copy it.</p><textarea aria-label="Unsaved style guide to copy" value={guideDraft} readOnly className="mt-2 min-h-24 w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[12px] leading-5 text-[var(--text)]" /><button type="button" onClick={() => setGuideDraft(null)} className="mt-2 text-[11px] font-semibold text-[var(--text-secondary)]">Dismiss</button></div>}
          <label htmlFor="ai-old-posts" className="mt-3 block text-[11px] font-semibold text-[var(--text-secondary)]">Past posts you choose</label>
          <textarea id="ai-old-posts" value={oldPosts} onChange={(event) => { if (characterCount(event.target.value) <= 11000) setOldPosts(event.target.value); }} placeholder={"First post\n---\nSecond post\n---\nThird post"} className="mt-1 min-h-24 w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[12px] leading-5 text-[var(--text)]" />
          <button type="button" onClick={() => void analyze()} disabled={working || profileStatus !== "ready" || guideDraft !== null || !oldPosts.trim()} className="mt-2 rounded-lg border border-[var(--accent-border)] px-3 py-2 text-[12px] font-bold text-[var(--accent-text)] disabled:opacity-50">{busy === "voice" ? "Analyzing…" : profile ? "Update my style" : "Analyze my style"}</button>
          {guideDraft !== null && <p className="mt-1 text-[11px] text-[var(--text-muted)]">Save or cancel guide edits before analyzing more posts.</p>}
        </details>
        {mediaIds.length > 1 && <div><label htmlFor="ai-image-choice" className="block text-[11px] font-semibold text-[var(--text-secondary)]">Photo to describe</label><select id="ai-image-choice" value={imageId ?? ""} onChange={(event) => setSelectedImageId(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[12px] text-[var(--text)]">{mediaIds.map((id, index) => <option key={id} value={id}>Photo {index + 1}</option>)}</select></div>}
        {videoId && !imageId && <p className="text-[11px] text-[var(--text-muted)]">Video attached. Add a short description above to generate text; the video file is not sent to AI.</p>}
        {imageId && <p className="text-[11px] text-[var(--text-muted)]">One selected photo will be resized and sent to Nemotron 3.5 Super VL, along with your notes if present.</p>}
        <button type="button" onClick={() => void generateCaption()} disabled={working || !canGenerate} className="gradient-button min-h-10 rounded-lg px-4 text-[12px] font-bold text-white disabled:opacity-50">{busy === "caption" ? "Generating…" : "Generate suggestion"}</button>
        {!canGenerate && <p className="text-[11px] text-[var(--text-muted)]">Add notes or a photo to start.{style === "personal" && !profile ? " Analyze past posts to use My style." : ""}</p>}
        {error && <p role="alert" className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-[12px] text-[var(--danger)]">{error}</p>}
        {shownNotice && <p role="status" className="rounded-lg bg-[var(--positive-soft)] px-3 py-2 text-[12px] text-[var(--positive)]">{shownNotice}</p>}
        {suggestion && <div className="rounded-lg border border-[var(--accent-border)] bg-[var(--surface)] p-3">
          <div className="flex items-center justify-between gap-2"><p className="text-[12px] font-bold text-[var(--text)]">Review suggested caption</p><button type="button" onClick={() => { setSuggestion(null); setNotice(""); }} className="text-[11px] font-semibold text-[var(--text-muted)]">Discard</button></div>
          {suggestion.observations && <div className="mt-2 rounded-lg bg-[var(--surface-muted)] p-2.5"><p className="text-[11px] font-bold text-[var(--text-secondary)]">What AI noticed · verify this</p><p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">{suggestion.observations}</p></div>}
          {suggestion.source.trim() && <AiLiteralNotice source={suggestion.source} suggestion={suggestion.draft} />}
          <label htmlFor="ai-caption-suggestion" className="mt-3 block text-[11px] font-bold text-[var(--text-secondary)]">Caption · editable</label>
          <textarea id="ai-caption-suggestion" value={suggestion.draft} onChange={(event) => { if (characterCount(event.target.value) <= 3000) setSuggestion({ ...suggestion, draft: event.target.value }); }} className="mt-1 min-h-28 w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[13px] leading-5 text-[var(--text)]" />
          {!suggestionCurrent && <p role="alert" className="mt-2 text-[11px] text-[var(--warning)]">The editor, photo or style changed. Generate again before using this suggestion.</p>}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><span className="text-[11px] text-[var(--text-muted)]">{Array.from(suggestion.draft).length}/3000 characters</span><button type="button" onClick={() => { if (onUseDraft(suggestion.draft.trim(), suggestion.source, suggestion.revision)) { setSuggestion(null); setError(""); } else setError("The editor changed or the suggestion is too long. Generate again."); }} disabled={working || !suggestionCurrent || !suggestion.draft.trim()} className="rounded-lg border border-[var(--accent-border)] px-3 py-2 text-[12px] font-bold text-[var(--accent-text)] disabled:opacity-50">Use this caption</button></div>
          <p className="mt-2 text-[11px] text-[var(--text-muted)]">This replaces the text above. Attached media stays with the draft.</p>
        </div>}
        <div className="border-t border-[var(--accent-border)] pt-3"><button type="button" onClick={() => onGenerate(style === "personal" && Boolean(profile))} disabled={working || !source.trim()} className="text-[12px] font-semibold text-[var(--accent-text)] disabled:opacity-50">{generating ? "Adapting…" : hasReview ? "Regenerate platform versions" : selectedCount ? "Adapt for selected platforms" : "Explore four platform versions"}</button><p className="mt-1 text-[11px] text-[var(--text-muted)]">Uses the current editor text. Platform suggestions appear below for review.</p></div>
      </div>
    </details>
  </section>;
}
