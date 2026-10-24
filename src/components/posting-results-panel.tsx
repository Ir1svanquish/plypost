"use client";

import { ArrowRight } from "lucide-react";
import { assistedDestinations } from "@/lib/assisted";
import { characterCount } from "@/lib/platforms";
import type { AssistedPost } from "@/lib/workspace";

type Props = {
  posts: AssistedPost[];
  onOpenRecord: (post: AssistedPost) => void;
  onReuseText: (post: AssistedPost) => void;
};

const metricLabels = { views: "Views", likes: "Likes", replies: "Replies" } as const;

export function PostingResultsPanel({ posts, onOpenRecord, onReuseText }: Props) {
  const posted = posts.filter((post) => post.status === "posted")
    .sort((a, b) => Date.parse(b.postedAt ?? b.createdAt) - Date.parse(a.postedAt ?? a.createdAt));
  const recorded = posted.filter((post) => post.outcome)
    .sort((a, b) => Date.parse(b.outcome!.recordedAt) - Date.parse(a.outcome!.recordedAt));
  const missing = posted.find((post) => !post.outcome);

  if (posted.length === 0) return null;

  return <details className="panel-border soft-shadow mt-6 overflow-hidden rounded-[18px] bg-[var(--surface)]">
    <summary className="cursor-pointer px-5 py-4 text-[13px] font-bold text-[var(--text)] sm:px-7">
      Posting results <span className="ml-1 font-normal text-[var(--text-muted)]">· {recorded.length} of {posted.length} posted handoffs recorded</span>
    </summary>
    <div className="space-y-4 border-t border-[var(--line)] px-5 py-5 sm:px-7">
      <p className="text-[12px] leading-5 text-[var(--text-muted)]">These counts and notes are entered by you. Plypost does not verify them or send them to the AI provider. Different platforms count views and interactions differently.</p>
      {recorded.length === 0 ? <p className="rounded-xl bg-[var(--surface-muted)] px-4 py-3 text-[12px] text-[var(--text-muted)]">No results recorded yet. After publishing a handoff, open its posted record to add a count or a note.</p> :
        <div className="space-y-3">{recorded.slice(0, 5).map((post) => <article key={post.id} className="rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="text-[11px] font-semibold text-[var(--text-muted)]">{assistedDestinations[post.destination].name} · Entered {new Date(post.outcome!.recordedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</p><h3 className="mt-1 break-words text-[13px] font-bold text-[var(--text)]">{post.title || post.text}</h3></div></div>
          <div className="mt-2 flex flex-wrap gap-2">{(Object.keys(metricLabels) as (keyof typeof metricLabels)[]).filter((key) => post.outcome?.[key] !== undefined).map((key) => <span key={key} className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)]">{metricLabels[key]} {post.outcome![key]?.toLocaleString()}</span>)}</div>
          {post.outcome?.notes && <p className="mt-2 whitespace-pre-wrap break-words text-[12px] leading-5 text-[var(--text-secondary)]">{post.outcome.notes}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2"><button type="button" onClick={() => onOpenRecord(post)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent-text)]">Open record <ArrowRight size={13} aria-hidden="true" /></button>{characterCount(post.text) <= 3000 ? <button type="button" onClick={() => onReuseText(post)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent-text)]">Start a new draft from this text <ArrowRight size={13} aria-hidden="true" /></button> : <span className="text-[11px] text-[var(--text-muted)]">Text is over the draft limit; open the record to copy it.</span>}</div>
        </article>)}{recorded.length > 5 && <p className="text-[11px] text-[var(--text-muted)]">Showing the five most recently entered results. Older results remain in Assisted.</p>}</div>}
      {missing && <button type="button" onClick={() => onOpenRecord(missing)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent-text)]">Add results to a posted handoff <ArrowRight size={13} aria-hidden="true" /></button>}
    </div>
  </details>;
}
