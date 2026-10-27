"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { compareText, type TextPart } from "@/lib/text-diff";
import type { ManualAiDestination } from "@/lib/ai-handoff";
import { characterCount } from "@/lib/platforms";
import { AiLiteralNotice } from "@/components/ai-literal-notice";

type Props = {
  destination: ManualAiDestination;
  source: string;
  disabled?: boolean;
  onApply: (text: string) => void;
};

type Suggestion = { destination: ManualAiDestination; source: string; text: string };

function highlighted(parts: TextPart[]) {
  return parts.map((part, index) => part.changed
    ? <mark key={index} className="rounded-sm bg-[var(--accent-soft)] px-0.5 text-[var(--text)]">{part.text}</mark>
    : <span key={index}>{part.text}</span>);
}

export function AIHandoffAssistant({ destination, source, disabled = false, onApply }: Props) {
  const [busy, setBusy] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [error, setError] = useState("");
  const stale = Boolean(suggestion && (suggestion.destination !== destination || suggestion.source !== source.trim()));

  async function generate() {
    const current = source.trim();
    if (busy || disabled || !current || characterCount(current) > 5000) return;
    setBusy(true); setSuggestion(null); setError("");
    try {
      const response = await fetch("/api/ai-handoff", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store",
        body: JSON.stringify({ destination, source: current }),
      });
      const data = await response.json() as { error?: string; destination?: string; suggestion?: string };
      if (!response.ok) throw new Error(data.error || "AI adaptation failed.");
      if (data.destination !== destination || !data.suggestion?.trim()) throw new Error("AI adaptation returned an incomplete draft.");
      setSuggestion({ destination, source, text: data.suggestion });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI adaptation failed.");
    } finally { setBusy(false); }
  }

  const edited = suggestion?.text.trim() ?? "";
  const comparison = suggestion ? compareText(suggestion.source, suggestion.text) : null;
  return <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
    <button type="button" onClick={() => void generate()} disabled={disabled || busy || !source.trim() || characterCount(source) > 5000} className="gradient-button inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-[12px] font-bold text-white disabled:opacity-45"><Sparkles size={14} aria-hidden="true" />{busy ? "Adapting…" : suggestion ? "Regenerate with AI" : "Adapt with AI"}</button>
    <p className="text-[11px] leading-5 text-[var(--text-muted)]">Text + platform to Nebius · review before using</p>
    {error && <p role="alert" className="mt-2 w-full rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-[12px] text-[var(--danger)]">{error}</p>}
    {suggestion && <div className="mt-3 w-full rounded-xl border border-[var(--accent-border)] bg-[var(--surface)] p-3.5">
      <label htmlFor={`ai-handoff-${destination}`} className="text-[12px] font-bold text-[var(--text)]">AI suggestion · editable</label>
      <textarea id={`ai-handoff-${destination}`} value={suggestion.text} onChange={(event) => { if (characterCount(event.target.value) <= 5000) setSuggestion({ ...suggestion, text: event.target.value }); }} disabled={busy || disabled} className="mt-2 min-h-28 w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--field)] p-3 text-[13px] leading-5 text-[var(--text)]" />
      <p className="mt-1 text-[11px] text-[var(--text-muted)]">{characterCount(edited)} / 5,000 characters · Check platform limits and media before posting.</p>
      {stale && <p role="alert" className="mt-2 text-[12px] font-semibold text-[var(--warning)]">The original text changed. Generate again to use the latest version.</p>}
      <AiLiteralNotice source={suggestion.source} suggestion={suggestion.text} />
      {comparison && <details className="mt-2 text-[11px] text-[var(--text-secondary)]"><summary className="cursor-pointer font-semibold text-[var(--accent-text)]">Compare with current text</summary><p className="mt-2 whitespace-pre-wrap break-words leading-5">{highlighted(comparison.after)}</p></details>}
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" onClick={() => { if (!stale && edited) { onApply(edited); setSuggestion(null); setError(""); } }} disabled={busy || disabled || stale || !edited} className="rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-[12px] font-bold text-[var(--accent-text)] disabled:opacity-45">Use this text</button>
        <button type="button" onClick={() => setSuggestion(null)} disabled={busy} className="px-2 py-2 text-[12px] font-semibold text-[var(--text-muted)] disabled:opacity-45">Discard</button>
      </div>
    </div>}
  </div>;
}
