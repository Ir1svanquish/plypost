"use client";

import { useEffect, useRef } from "react";
import { adaptDraft, characterCount, platforms, type PlatformId } from "@/lib/platforms";
import { validatePlatformText } from "@/lib/platform-validation";
import { compareText, type TextPart } from "@/lib/text-diff";
import { AiLiteralNotice } from "@/components/ai-literal-notice";

type Props = {
  source: string;
  original: Partial<Record<PlatformId, string>>;
  suggestions: Partial<Record<PlatformId, string>>;
  available: readonly PlatformId[];
  selected: PlatformId[];
  stale: boolean;
  busy: boolean;
  onToggle: (platform: PlatformId) => void;
  onEdit: (platform: PlatformId, text: string) => void;
  onApply: () => void;
  onDiscard: () => void;
};

function highlighted(parts: TextPart[], kind: "current" | "suggested") {
  return parts.map((part, index) => part.changed
    ? <mark key={index} className={`rounded-sm px-0.5 text-[var(--text)] ${kind === "current" ? "bg-[var(--danger-soft)]" : "bg-[var(--accent-soft)]"}`}>{part.text}</mark>
    : <span key={index}>{part.text}</span>);
}

export function AIReviewPanel({ source, original, suggestions, available, selected, stale, busy, onToggle, onEdit, onApply, onDiscard }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const detailsRefs = useRef<Partial<Record<PlatformId, HTMLDetailsElement | null>>>({});
  useEffect(() => { headingRef.current?.focus(); }, []);
  const invalidSelected = selected.some((id) => !validatePlatformText(id, suggestions[id] ?? "").valid);
  return <section aria-label="Review AI drafts" className="mt-4 rounded-xl border border-[var(--accent-border)] bg-[var(--surface)] p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 ref={headingRef} tabIndex={-1} className="text-[13px] font-bold text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">Review before replacing</h3>
        <p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">Suggestions start unchecked. Compare and edit each one, then select only the versions you want to apply. Applying a version also selects its platform.</p>
      </div>
      <button type="button" onClick={onDiscard} disabled={busy} className="text-[13px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text)] disabled:opacity-45">Discard suggestions</button>
    </div>
    {stale && <p role="alert" className="mt-3 rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-[12px] text-[var(--warning)]">The editor changed after these suggestions were generated. Generate again to review the latest draft.</p>}
    <div className="mt-3 space-y-2">
      {available.map((id) => {
        const suggestion = suggestions[id] ?? "";
        const validation = validatePlatformText(id, suggestion);
        const comparison = compareText(original[id] ?? adaptDraft(source, id), suggestion);
        return <div key={id} className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex items-center gap-2 text-[12px] font-semibold text-[var(--text)]">
              <input type="checkbox" checked={selected.includes(id)} onChange={() => onToggle(id)} disabled={stale || busy} className="h-4 w-4 accent-[var(--accent)]" />
              {platforms[id].name}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${comparison.changed ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : "bg-[var(--surface)] text-[var(--text-muted)]"}`}>{comparison.changed ? "Changed" : "No edits"}</span>
              {!validation.valid && <button type="button" onClick={() => { const details = detailsRefs.current[id]; if (details) details.open = true; document.getElementById(`ai-suggestion-${id}`)?.focus(); }} disabled={stale || busy} className="text-[13px] font-semibold text-[var(--danger)] underline underline-offset-2 disabled:opacity-50">{suggestion.trim() ? "Too long · edit" : "Empty suggestion · edit"}</button>}
            </div>
          </div>
          <AiLiteralNotice source={source} suggestion={suggestion} />
          <details ref={(element) => { detailsRefs.current[id] = element; }} className="mt-2">
            <summary className="cursor-pointer text-[11px] font-semibold text-[var(--accent-text)]">Compare and edit</summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div className="min-w-0 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3"><p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-soft)]">Current · highlighted text replaced</p><p className="whitespace-pre-wrap break-words text-[12px] leading-5 text-[var(--text-secondary)]">{highlighted(comparison.before, "current")}</p></div>
              <div className="min-w-0 rounded-lg border border-[var(--accent-border)] bg-[var(--surface)] p-3"><p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--accent-text)]">Suggested · highlighted text new</p><p className="whitespace-pre-wrap break-words text-[12px] leading-5 text-[var(--text)]">{highlighted(comparison.after, "suggested")}</p></div>
            </div>
            <label htmlFor={`ai-suggestion-${id}`} className="mt-3 block text-[11px] font-bold text-[var(--text-secondary)]">Edit {platforms[id].name} suggestion</label>
            <textarea id={`ai-suggestion-${id}`} aria-invalid={!validation.valid} aria-describedby={`ai-suggestion-count-${id}`} value={suggestion} onChange={(event) => { if (characterCount(event.target.value) <= 5000) onEdit(id, event.target.value); }} disabled={stale || busy} className="mt-1 min-h-28 w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[16px] leading-5 text-[var(--text)] outline-none focus:border-[var(--accent-border)] disabled:opacity-50" />
            <p id={`ai-suggestion-count-${id}`} className={`mt-1 text-right text-[11px] ${validation.valid ? "text-[var(--text-muted)]" : "text-[var(--danger)]"}`}>{validation.count}/{validation.limit} characters{validation.byteCount !== undefined && validation.byteLimit !== undefined ? ` · ${validation.byteCount}/${validation.byteLimit} bytes` : ""}</p>
          </details>
        </div>;
      })}
    </div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-[11px] leading-5 text-[var(--text-soft)]">AI can get facts wrong. Check each suggested version before sharing.</p>
      <button type="button" onClick={onApply} disabled={busy || stale || selected.length === 0 || invalidSelected} className="gradient-button rounded-lg px-4 py-2.5 text-[13px] font-bold text-white disabled:opacity-45">Apply {selected.length} selected {selected.length === 1 ? "version" : "versions"}</button>
    </div>
  </section>;
}
