"use client";

import { adaptDraft, platforms, type PlatformId } from "@/lib/platforms";
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
  const invalidSelected = selected.some((id) => !validatePlatformText(id, suggestions[id] ?? "").valid);
  return <section aria-label="Review AI drafts" className="mt-4 rounded-xl border border-[var(--accent-border)] bg-[var(--surface)] p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 className="text-[13px] font-bold text-[var(--text)]">Review before replacing</h3>
        <p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">Compare and edit each suggestion before using it. Changed numbers, weekdays or links start unchecked. Applying a version also selects its platform.</p>
      </div>
      <button type="button" onClick={onDiscard} disabled={busy} className="text-[12px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text)] disabled:opacity-45">Discard suggestions</button>
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
              {!validation.valid && <span className="text-[11px] font-semibold text-[var(--danger)]">{suggestion.trim() ? "Too long" : "Empty suggestion"}</span>}
            </div>
          </div>
          <AiLiteralNotice source={source} suggestion={suggestion} />
          <details className="mt-2">
            <summary className="cursor-pointer text-[11px] font-semibold text-[var(--accent-text)]">Compare and edit</summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div className="min-w-0 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3"><p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-soft)]">Current · highlighted text replaced</p><p className="whitespace-pre-wrap break-words text-[12px] leading-5 text-[var(--text-secondary)]">{highlighted(comparison.before, "current")}</p></div>
              <div className="min-w-0 rounded-lg border border-[var(--accent-border)] bg-[var(--surface)] p-3"><p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--accent-text)]">Suggested · highlighted text new</p><p className="whitespace-pre-wrap break-words text-[12px] leading-5 text-[var(--text)]">{highlighted(comparison.after, "suggested")}</p></div>
            </div>
            <label htmlFor={`ai-suggestion-${id}`} className="mt-3 block text-[11px] font-bold text-[var(--text-secondary)]">Edit suggested version</label>
            <textarea id={`ai-suggestion-${id}`} value={suggestion} onChange={(event) => onEdit(id, event.target.value)} disabled={stale || busy} maxLength={5000} className="mt-1 min-h-28 w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[13px] leading-5 text-[var(--text)] outline-none focus:border-[var(--accent-border)] disabled:opacity-50" />
            <p className={`mt-1 text-right text-[11px] ${validation.valid ? "text-[var(--text-muted)]" : "text-[var(--danger)]"}`}>{validation.count}/{validation.limit} characters{validation.byteCount !== undefined && validation.byteLimit !== undefined ? ` · ${validation.byteCount}/${validation.byteLimit} bytes` : ""}</p>
          </details>
        </div>;
      })}
    </div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-[11px] leading-5 text-[var(--text-soft)]">AI can get facts wrong. Check each suggested version before sharing.</p>
      <button type="button" onClick={onApply} disabled={busy || stale || selected.length === 0 || invalidSelected} className="gradient-button rounded-lg px-4 py-2.5 text-[12px] font-bold text-white disabled:opacity-45">Apply {selected.length} selected {selected.length === 1 ? "version" : "versions"}</button>
    </div>
  </section>;
}
