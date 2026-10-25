import { compareAiLiterals } from "@/lib/ai-literal-check";

type Props = { source: string; suggestion: string };

export function AiLiteralNotice({ source, suggestion }: Props) {
  const { missing, added } = compareAiLiterals(source, suggestion);
  if (!missing.length && !added.length) return null;

  return <details className="mt-2 rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-[11px] leading-5 text-[var(--warning)]">
    <summary className="cursor-pointer font-bold">Check details · {missing.length} missing, {added.length} new</summary>
    <div className="mt-2 max-h-36 space-y-1 overflow-y-auto">
      {missing.length > 0 && <p className="break-words">In your source, absent here: {missing.join(", ")}</p>}
      {added.length > 0 && <p className="break-words">New in this suggestion: {added.join(", ")}</p>}
      <p>Only numbers, weekdays, time markers, links, email addresses and tags are compared. Check other claims yourself.</p>
    </div>
  </details>;
}
