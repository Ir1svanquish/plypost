"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Sparkles } from "lucide-react";
import type { VoiceProfile } from "@/lib/ai-studio";

type Props = {
  source: string;
  mediaIds: readonly string[];
  selectedCount: number;
  generating: boolean;
  hasReview: boolean;
  onGenerate: (useVoice: boolean) => void;
  onInsertCaption: (caption: string) => boolean;
};

function examplesFromText(text: string): string[] {
  return text.split(/\r?\n\s*---\s*\r?\n/).map((item) => item.trim()).filter(Boolean);
}

async function responseError(response: Response, fallback: string) {
  const body: unknown = await response.json().catch(() => null);
  return body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : fallback;
}

export function AIWritingPanel({ source, mediaIds, selectedCount, generating, hasReview, onGenerate, onInsertCaption }: Props) {
  const moreToolsRef = useRef<HTMLDetailsElement>(null);
  const imageToolRef = useRef<HTMLDetailsElement>(null);
  const [profile, setProfile] = useState<VoiceProfile | null>(null);
  const [useVoice, setUseVoice] = useState(false);
  const [guideDraft, setGuideDraft] = useState<string | null>(null);
  const [oldPosts, setOldPosts] = useState("");
  const [selectedImageId, setSelectedImageId] = useState("");
  const [imageContext, setImageContext] = useState("");
  const [imageSuggestion, setImageSuggestion] = useState<{
    imageId: string; context: string; voiceUsed: boolean; voiceUpdatedAt: string | null;
    observations: string; caption: string;
  } | null>(null);
  const [busy, setBusy] = useState<"voice" | "image" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/ai-studio", { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, "Could not load your writing style."));
        return response.json() as Promise<{ voiceProfile: VoiceProfile | null }>;
      })
      .then((data) => { if (!controller.signal.aborted) { setProfile(data.voiceProfile); setUseVoice(Boolean(data.voiceProfile)); } })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load your writing style."); });
    return () => controller.abort();
  }, []);

  async function analyze() {
    const examples = examplesFromText(oldPosts);
    if (examples.length < 3 || examples.length > 6 || examples.some((item) => Array.from(item).length > 1800)) {
      setError("Enter 3–6 examples, each under 1,800 characters, separated by a line with --- .");
      return;
    }
    setBusy("voice"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/ai-studio", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store",
        body: JSON.stringify({ action: "analyze-style", examples }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Could not analyze examples."));
      const data = await response.json() as { voiceProfile?: VoiceProfile };
      if (!data.voiceProfile) throw new Error("No writing style was returned.");
      setProfile(data.voiceProfile); setUseVoice(true); setOldPosts("");
      setGuideDraft(null);
      setNotice("Writing style saved. Your sample posts were not stored in Plypost.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not analyze examples.");
    } finally { setBusy(null); }
  }

  async function saveEditedGuide() {
    const guide = guideDraft?.trim();
    if (!guide || Array.from(guide).length > 1000) { setError("Keep the style guide under 1,000 characters."); return; }
    setBusy("voice"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/ai-studio", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store",
        body: JSON.stringify({ guide }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Could not save the style guide."));
      const data = await response.json() as { voiceProfile?: VoiceProfile };
      if (!data.voiceProfile) throw new Error("No saved style guide was returned.");
      setProfile(data.voiceProfile); setGuideDraft(null);
      setNotice("Your edits to the style guide were saved locally without an AI request.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the style guide.");
    } finally { setBusy(null); }
  }

  async function removeProfile() {
    if (!window.confirm("Remove your saved writing style guide? You can analyze old posts again later.")) return;
    setBusy("voice"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/ai-studio", { method: "DELETE", credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response, "Could not remove the style guide."));
      setProfile(null); setUseVoice(false); setGuideDraft(null); setNotice("Saved writing style removed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove the style guide.");
    } finally { setBusy(null); }
  }

  async function captionImage() {
    const imageId = mediaIds.includes(selectedImageId) ? selectedImageId : mediaIds[0];
    if (!imageId) { setError("Select an image above first."); return; }
    const context = imageContext.trim();
    const voiceUsed = useVoice && Boolean(profile);
    const voiceUpdatedAt = voiceUsed ? profile?.updatedAt ?? null : null;
    setBusy("image"); setError(""); setNotice(""); setImageSuggestion(null);
    try {
      const response = await fetch("/api/ai-studio", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store",
        body: JSON.stringify({ action: "caption-image", mediaId: imageId, context, useVoice: voiceUsed }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Could not describe this image."));
      const data = await response.json() as { observations?: string; caption?: string };
      if (!data.observations || !data.caption) throw new Error("No usable image caption was returned.");
      setImageSuggestion({ imageId, context, voiceUsed, voiceUpdatedAt,
        observations: data.observations, caption: data.caption });
      setNotice("Review what the model saw and edit the suggested caption before inserting it.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not describe this image.");
    } finally { setBusy(null); }
  }

  const working = Boolean(busy || generating);
  const imageId = mediaIds.includes(selectedImageId) ? selectedImageId : mediaIds[0] ?? "";
  const captionInputsMatch = Boolean(imageSuggestion && imageSuggestion.imageId === imageId &&
    imageSuggestion.context === imageContext.trim() && imageSuggestion.voiceUsed === (useVoice && Boolean(profile)) &&
    imageSuggestion.voiceUpdatedAt === (useVoice && profile ? profile.updatedAt : null));
  const captionLength = imageSuggestion ? (source.trim()
    ? `${source.trim()}\n\n${imageSuggestion.caption.trim()}` : imageSuggestion.caption.trim()).length : 0;
  function openImageTool() {
    if (moreToolsRef.current) moreToolsRef.current.open = true;
    if (imageToolRef.current) imageToolRef.current.open = true;
    window.requestAnimationFrame(() => imageToolRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }
  return <div className="mt-4 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2.5"><Sparkles size={19} className="mt-0.5 shrink-0 text-[var(--accent-text)]" aria-hidden="true" /><div><h3 className="text-[13px] font-bold text-[var(--text)]">Write with AI</h3><p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{selectedCount ? `Adapt for ${selectedCount} selected ${selectedCount === 1 ? "platform" : "platforms"}.` : "Choose platforms below, or explore all four."}</p></div></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={openImageTool} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[var(--accent-border)] bg-[var(--surface)] px-3 text-[12px] font-bold text-[var(--accent-text)]"><ImagePlus size={14} aria-hidden="true" />Write from photo</button>
        <button type="button" onClick={() => onGenerate(useVoice && Boolean(profile))} disabled={working || !source.trim()} className="gradient-button inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-[12px] font-bold text-white disabled:opacity-50"><Sparkles size={14} aria-hidden="true" />{generating ? "Adapting…" : hasReview ? "Regenerate" : selectedCount === 1 ? "Generate version" : "Generate versions"}</button>
      </div>
    </div>
    <details ref={moreToolsRef} className="mt-3 border-t border-[var(--accent-border)] pt-3">
      <summary className="cursor-pointer text-[12px] font-semibold text-[var(--accent-text)]">Image caption and writing style</summary>
    <div className="mt-4 space-y-4">
      <p className="text-[12px] leading-5 text-[var(--text-muted)]">Only content you choose is sent to Nebius when you use an AI action. Review suggestions before using them.</p>

      <details className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3.5">
        <summary className="cursor-pointer text-[13px] font-bold text-[var(--text)]">Your writing style {profile ? "· saved" : ""}</summary>
        <p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">Paste 3–6 past posts, with a line containing --- between posts. Only a short style guide is saved to your workspace.</p>
        {profile && <div className="mt-3 rounded-lg bg-[var(--accent-soft)] p-3">
          <p className="text-[11px] font-bold text-[var(--accent-text)]">Saved style guide</p>
          {guideDraft === null ? <p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-[var(--text-secondary)]">{profile.guide}</p>
            : <textarea aria-label="Edit saved style guide" value={guideDraft} onChange={(event) => setGuideDraft(event.target.value)} maxLength={1000} className="mt-2 min-h-24 w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[12px] leading-5 text-[var(--text)]" />}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-[var(--text)]"><input type="checkbox" checked={useVoice} onChange={(event) => setUseVoice(event.target.checked)} /> Use in AI drafts</label>
            {guideDraft === null ? <button type="button" onClick={() => setGuideDraft(profile.guide)} disabled={working} className="text-[11px] font-semibold text-[var(--accent-text)] disabled:opacity-50">Edit guide</button>
              : <><button type="button" onClick={() => void saveEditedGuide()} disabled={working || !guideDraft.trim()} className="text-[11px] font-semibold text-[var(--accent-text)] disabled:opacity-50">Save edits</button><button type="button" onClick={() => setGuideDraft(null)} disabled={working} className="text-[11px] font-semibold text-[var(--text-secondary)] disabled:opacity-50">Cancel</button></>}
            <button type="button" onClick={() => void removeProfile()} disabled={working} className="text-[11px] font-semibold text-[var(--danger)] disabled:opacity-50">Remove guide</button>
          </div>
        </div>}
        <label htmlFor="ai-old-posts" className="mt-3 block text-[11px] font-semibold text-[var(--text-secondary)]">Past posts you choose</label>
        <textarea id="ai-old-posts" value={oldPosts} onChange={(event) => setOldPosts(event.target.value)} maxLength={11000} placeholder={"First post\n---\nSecond post\n---\nThird post"} className="mt-1 min-h-24 w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[12px] leading-5 text-[var(--text)]" />
        <button type="button" onClick={() => void analyze()} disabled={working || !oldPosts.trim()} className="mt-2 rounded-lg border border-[var(--accent-border)] px-3 py-2 text-[12px] font-bold text-[var(--accent-text)] disabled:opacity-50">{busy === "voice" ? "Analyzing…" : profile ? "Update style guide" : "Analyze my style"}</button>
      </details>

      <details ref={imageToolRef} className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3.5">
        <summary className="cursor-pointer text-[13px] font-bold text-[var(--text)]">Write from an image {mediaIds.length ? `· ${mediaIds.length} selected` : ""}</summary>
        <p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">Choose an attached image. It is resized and sent to Nemotron 3.5 Super VL only when you click. Add context for facts the image cannot show.</p>
        {mediaIds.length > 1 && <>
          <label htmlFor="ai-image-choice" className="mt-3 block text-[11px] font-semibold text-[var(--text-secondary)]">Image to analyze</label>
          <select id="ai-image-choice" value={imageId} onChange={(event) => setSelectedImageId(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[12px] text-[var(--text)]">
            {mediaIds.map((id, index) => <option key={id} value={id}>Image {index + 1}</option>)}
          </select>
        </>}
        {mediaIds.length === 0 && <p className="mt-3 text-[11px] text-[var(--text-muted)]">Attach an image above to use this feature.</p>}
        <label htmlFor="ai-image-context" className="mt-3 block text-[11px] font-semibold text-[var(--text-secondary)]">Optional context</label>
        <input id="ai-image-context" value={imageContext} onChange={(event) => setImageContext(event.target.value)} maxLength={500} placeholder="What should the reader know?" className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[12px] text-[var(--text)]" />
        <button type="button" onClick={() => void captionImage()} disabled={working || !imageId} className="mt-2 rounded-lg border border-[var(--accent-border)] px-3 py-2 text-[12px] font-bold text-[var(--accent-text)] disabled:opacity-50">{busy === "image" ? "Looking at image…" : "Draft from selected image"}</button>
        {imageSuggestion && <div className="mt-3 rounded-lg border border-[var(--accent-border)] p-3">
          <p className="text-[11px] font-bold text-[var(--text-secondary)]">What AI noticed · verify this</p>
          <p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">{imageSuggestion.observations}</p>
          <label htmlFor="ai-image-caption" className="mt-3 block text-[11px] font-bold text-[var(--text-secondary)]">Editable caption</label>
          <textarea id="ai-image-caption" value={imageSuggestion.caption} onChange={(event) => setImageSuggestion({ ...imageSuggestion, caption: event.target.value })} maxLength={3000} className="mt-1 min-h-24 w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[12px] leading-5 text-[var(--text)]" />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <button type="button" onClick={() => {
              if (onInsertCaption(imageSuggestion.caption.trim())) { setImageSuggestion(null); setError(""); }
              else setError("Shorten the caption before adding it to this draft.");
            }} disabled={!imageSuggestion.caption.trim() || !captionInputsMatch || captionLength > 3000} className="rounded-lg border border-[var(--accent-border)] px-3 py-2 text-[12px] font-bold text-[var(--accent-text)] disabled:opacity-50">
              {source.trim() ? "Add below my draft" : "Use as my draft"}
            </button>
            <span className="text-[11px] text-[var(--text-muted)]">{captionLength}/3000 draft characters</span>
          </div>
          {!captionInputsMatch && <p className="mt-2 text-[11px] text-[var(--warning)]">The image, context, or writing style changed. Generate again before using this caption.</p>}
          {captionLength > 3000 && <p className="mt-2 text-[11px] text-[var(--warning)]">Shorten the caption or current draft to fit 3,000 characters.</p>}
        </div>}
      </details>

      {error && <p role="alert" className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-[12px] text-[var(--danger)]">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-[var(--positive-soft)] px-3 py-2 text-[12px] text-[var(--positive)]">{notice}</p>}
      <p className="border-t border-[var(--line)] pt-3 text-[11px] leading-5 text-[var(--text-muted)]">The version generator uses your current draft and, if selected, your saved writing style.</p>
    </div>
    </details>
  </div>;
}
