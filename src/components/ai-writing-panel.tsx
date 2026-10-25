"use client";

import { useEffect, useState } from "react";
import type { VoiceProfile } from "@/lib/ai-studio";

type Props = {
  source: string;
  mediaIds: readonly string[];
  generating: boolean;
  hasReview: boolean;
  onGenerate: (useVoice: boolean, referenceGuide: string | null) => void;
  onInsertCaption: (caption: string) => void;
};

function examplesFromText(text: string): string[] {
  return text.split(/\r?\n\s*---\s*\r?\n/).map((item) => item.trim()).filter(Boolean);
}

async function responseError(response: Response, fallback: string) {
  const body: unknown = await response.json().catch(() => null);
  return body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : fallback;
}

export function AIWritingPanel({ source, mediaIds, generating, hasReview, onGenerate, onInsertCaption }: Props) {
  const [profile, setProfile] = useState<VoiceProfile | null>(null);
  const [useVoice, setUseVoice] = useState(false);
  const [oldPosts, setOldPosts] = useState("");
  const [referencePosts, setReferencePosts] = useState("");
  const [referenceGuide, setReferenceGuide] = useState("");
  const [useReference, setUseReference] = useState(false);
  const [imageContext, setImageContext] = useState("");
  const [imageSuggestion, setImageSuggestion] = useState<{ imageId: string; observations: string; caption: string } | null>(null);
  const [busy, setBusy] = useState<"voice" | "reference" | "image" | null>(null);
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

  async function analyze(kind: "voice" | "reference") {
    const examples = examplesFromText(kind === "voice" ? oldPosts : referencePosts);
    const min = kind === "voice" ? 3 : 2;
    const max = kind === "voice" ? 6 : 5;
    if (examples.length < min || examples.length > max || examples.some((item) => Array.from(item).length > 1800)) {
      setError(`Enter ${min}–${max} examples, each under 1,800 characters, separated by a line with --- .`);
      return;
    }
    setBusy(kind); setError(""); setNotice("");
    try {
      const response = await fetch("/api/ai-studio", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store",
        body: JSON.stringify({ action: kind === "voice" ? "analyze-style" : "analyze-references", examples }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Could not analyze examples."));
      const data = await response.json() as { voiceProfile?: VoiceProfile; referenceGuide?: string };
      if (kind === "voice") {
        if (!data.voiceProfile) throw new Error("No writing style was returned.");
        setProfile(data.voiceProfile); setUseVoice(true); setOldPosts("");
        setNotice("Writing style saved. Your sample posts were not stored in Plypost.");
      } else {
        if (!data.referenceGuide) throw new Error("No reference pattern was returned.");
        setReferenceGuide(data.referenceGuide); setUseReference(true); setReferencePosts("");
        setNotice("Reference pattern is ready. Edit it to choose which parts to borrow.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not analyze examples.");
    } finally { setBusy(null); }
  }

  async function removeProfile() {
    if (!window.confirm("Remove your saved writing style guide? You can analyze old posts again later.")) return;
    setBusy("voice"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/ai-studio", { method: "DELETE", credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response, "Could not remove the style guide."));
      setProfile(null); setUseVoice(false); setNotice("Saved writing style removed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove the style guide.");
    } finally { setBusy(null); }
  }

  async function captionImage() {
    const imageId = mediaIds[0];
    if (!imageId) { setError("Select an image above first."); return; }
    setBusy("image"); setError(""); setNotice(""); setImageSuggestion(null);
    try {
      const response = await fetch("/api/ai-studio", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store",
        body: JSON.stringify({ action: "caption-image", mediaId: imageId, context: imageContext,
          useVoice: useVoice && Boolean(profile), referenceGuide: useReference ? referenceGuide : "" }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Could not describe this image."));
      const data = await response.json() as { observations?: string; caption?: string };
      if (!data.observations || !data.caption) throw new Error("No usable image caption was returned.");
      setImageSuggestion({ imageId, observations: data.observations, caption: data.caption });
      setNotice("Review what the model saw and edit the suggested caption before inserting it.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not describe this image.");
    } finally { setBusy(null); }
  }

  const working = Boolean(busy || generating);
  const reference = useReference && referenceGuide.trim() ? referenceGuide.trim() : null;
  return <details className="mt-6 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3">
    <summary className="cursor-pointer text-[13px] font-bold text-[var(--text-secondary)]">Write with AI <span className="ml-1 text-[11px] font-normal text-[var(--text-soft)]">Optional · Nebius Nemotron</span></summary>
    <div className="mt-4 space-y-4 border-t border-[var(--line)] pt-4">
      <p className="text-[12px] leading-5 text-[var(--text-muted)]">Analyze your voice, draft from an image, or borrow a reference pattern. Nothing is sent until you press an AI button; suggestions need your review.</p>

      <details className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3.5">
        <summary className="cursor-pointer text-[13px] font-bold text-[var(--text)]">Your writing style {profile ? "· saved" : ""}</summary>
        <p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">Paste 3–6 past posts, with a line containing --- between posts. Only a short style guide is saved to your workspace.</p>
        {profile && <div className="mt-3 rounded-lg bg-[var(--accent-soft)] p-3"><p className="text-[11px] font-bold text-[var(--accent-text)]">Saved style guide</p><p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-[var(--text-secondary)]">{profile.guide}</p><div className="mt-2 flex flex-wrap items-center gap-3"><label className="inline-flex items-center gap-2 text-[11px] font-semibold text-[var(--text)]"><input type="checkbox" checked={useVoice} onChange={(event) => setUseVoice(event.target.checked)} /> Use in AI drafts</label><button type="button" onClick={() => void removeProfile()} disabled={working} className="text-[11px] font-semibold text-[var(--danger)] disabled:opacity-50">Remove guide</button></div></div>}
        <label htmlFor="ai-old-posts" className="mt-3 block text-[11px] font-semibold text-[var(--text-secondary)]">Past posts you choose</label>
        <textarea id="ai-old-posts" value={oldPosts} onChange={(event) => setOldPosts(event.target.value)} maxLength={11000} placeholder={"First post\n---\nSecond post\n---\nThird post"} className="mt-1 min-h-24 w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[12px] leading-5 text-[var(--text)]" />
        <button type="button" onClick={() => void analyze("voice")} disabled={working || !oldPosts.trim()} className="mt-2 rounded-lg border border-[var(--accent-border)] px-3 py-2 text-[12px] font-bold text-[var(--accent-text)] disabled:opacity-50">{busy === "voice" ? "Analyzing…" : profile ? "Update style guide" : "Analyze my style"}</button>
      </details>

      <details className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3.5">
        <summary className="cursor-pointer text-[13px] font-bold text-[var(--text)]">Write from an image {mediaIds.length ? `· ${mediaIds.length} selected` : ""}</summary>
        <p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">The first image selected above is resized and sent to Nemotron 3.5 Super VL only when you click. Add context for facts the image cannot show.</p>
        <label htmlFor="ai-image-context" className="mt-3 block text-[11px] font-semibold text-[var(--text-secondary)]">Optional context</label>
        <input id="ai-image-context" value={imageContext} onChange={(event) => setImageContext(event.target.value)} maxLength={500} placeholder="What should the reader know?" className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[12px] text-[var(--text)]" />
        <button type="button" onClick={() => void captionImage()} disabled={working || mediaIds.length === 0} className="mt-2 rounded-lg border border-[var(--accent-border)] px-3 py-2 text-[12px] font-bold text-[var(--accent-text)] disabled:opacity-50">{busy === "image" ? "Looking at image…" : "Draft from selected image"}</button>
        {imageSuggestion && <div className="mt-3 rounded-lg border border-[var(--accent-border)] p-3"><p className="text-[11px] font-bold text-[var(--text-secondary)]">What AI noticed · verify this</p><p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">{imageSuggestion.observations}</p><label htmlFor="ai-image-caption" className="mt-3 block text-[11px] font-bold text-[var(--text-secondary)]">Editable caption</label><textarea id="ai-image-caption" value={imageSuggestion.caption} onChange={(event) => setImageSuggestion({ ...imageSuggestion, caption: event.target.value })} maxLength={3000} className="mt-1 min-h-24 w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[12px] leading-5 text-[var(--text)]" /><button type="button" onClick={() => { onInsertCaption(imageSuggestion.caption.trim()); setImageSuggestion(null); }} disabled={!imageSuggestion.caption.trim() || imageSuggestion.imageId !== mediaIds[0]} className="mt-2 rounded-lg border border-[var(--accent-border)] px-3 py-2 text-[12px] font-bold text-[var(--accent-text)] disabled:opacity-50">{source.trim() ? "Add below my draft" : "Use as my draft"}</button>{imageSuggestion.imageId !== mediaIds[0] && <p className="mt-1 text-[11px] text-[var(--warning)]">The selected image changed. Generate again before using this caption.</p>}</div>}
      </details>

      <details className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3.5">
        <summary className="cursor-pointer text-[13px] font-bold text-[var(--text)]">Reference writing patterns {referenceGuide ? "· ready" : ""}</summary>
        <p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">Paste 2–5 recent public posts you found, separated by --- . Plypost does not verify their popularity or fetch trends. AI extracts reusable structure without copying wording.</p>
        <textarea aria-label="Recent reference posts" value={referencePosts} onChange={(event) => setReferencePosts(event.target.value)} maxLength={9200} placeholder={"Example one\n---\nExample two"} className="mt-3 min-h-24 w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[12px] leading-5 text-[var(--text)]" />
        <button type="button" onClick={() => void analyze("reference")} disabled={working || !referencePosts.trim()} className="mt-2 rounded-lg border border-[var(--accent-border)] px-3 py-2 text-[12px] font-bold text-[var(--accent-text)] disabled:opacity-50">{busy === "reference" ? "Analyzing…" : "Extract pattern"}</button>
        {referenceGuide && <div className="mt-3"><label htmlFor="ai-reference-guide" className="text-[11px] font-bold text-[var(--text-secondary)]">Choose what to borrow · editable</label><textarea id="ai-reference-guide" value={referenceGuide} onChange={(event) => setReferenceGuide(event.target.value)} maxLength={1000} className="mt-1 min-h-20 w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[12px] leading-5 text-[var(--text)]" /><label className="mt-1 inline-flex items-center gap-2 text-[11px] font-semibold text-[var(--text)]"><input type="checkbox" checked={useReference} onChange={(event) => setUseReference(event.target.checked)} /> Use in AI drafts</label></div>}
      </details>

      {error && <p role="alert" className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-[12px] text-[var(--danger)]">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-[var(--positive-soft)] px-3 py-2 text-[12px] text-[var(--positive)]">{notice}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4"><p className="text-[11px] leading-5 text-[var(--text-muted)]">Generate uses only your current draft and the style guides you selected. Review all four versions before applying.</p><button type="button" onClick={() => onGenerate(useVoice && Boolean(profile), reference)} disabled={working || !source.trim()} className="gradient-button inline-flex min-h-10 items-center justify-center rounded-xl px-4 text-[12px] font-bold text-white disabled:opacity-50">{generating ? "Adapting…" : hasReview ? "Regenerate variants" : "Generate platform variants"}</button></div>
    </div>
  </details>;
}
