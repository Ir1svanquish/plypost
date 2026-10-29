import Image from "next/image";
import { BlueskyMark } from "./bluesky-mark";
import {
  Bookmark,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Repeat2,
  Send,
  Share2,
  ThumbsUp,
} from "lucide-react";
import { platforms, type PlatformId } from "@/lib/platforms";
import { imageLimits } from "@/lib/media-policy";

type Props = {
  platform: PlatformId;
  text: string;
  count?: number;
  limit?: number;
  mediaIds?: readonly string[];
  mediaAlt?: readonly string[];
};

function PostText({ text, platform }: { text: string; platform: PlatformId }) {
  return (
    <p className="m-0 whitespace-pre-wrap text-[14px] leading-[1.7] text-[var(--text)] [overflow-wrap:anywhere]">
      {text || <span className="text-[var(--text-soft)]">Your {platforms[platform].name} draft will appear here.</span>}
    </p>
  );
}

function PreviewMedia({ mediaIds, mediaAlt }: { mediaIds: readonly string[]; mediaAlt: readonly string[] }) {
  if (mediaIds.length === 0) return null;

  return <div className={`mt-3 grid gap-1 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--field)] ${mediaIds.length === 1 ? "grid-cols-1" : "grid-cols-2"}`} aria-label={`${mediaIds.length} selected draft ${mediaIds.length === 1 ? "image" : "images"}`}>
    {mediaIds.map((id, index) => <div key={id} className={`relative overflow-hidden bg-[var(--surface-muted)] ${mediaIds.length === 1 ? "aspect-[4/3]" : mediaIds.length === 3 && index === 0 ? "col-span-2 aspect-[16/9]" : "aspect-square"}`}>
      <Image unoptimized src={`/api/media/${encodeURIComponent(id)}`} alt={mediaAlt[index] || `Selected draft image ${index + 1} of ${mediaIds.length}`} fill sizes="(max-width: 640px) 90vw, 480px" className="object-cover" />
    </div>)}
  </div>;
}

function BlueskyPreview({ text, mediaIds, mediaAlt }: { text: string; mediaIds: readonly string[]; mediaAlt: readonly string[] }) {
  return (
    <div className="flex gap-3 px-4 py-5 sm:px-5">
      <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1684e8] text-[20px] font-bold text-white"><BlueskyMark size={23} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5 text-[13px] leading-5">
          <strong className="text-[var(--text)]">Your brand</strong>
          <span className="text-[var(--text-muted)]">@yourbrand.bsky.social</span>
          <span className="text-[var(--text-soft)]">· now</span>
        </div>
        <div className="mt-2 min-h-[100px]"><PostText text={text} platform="bluesky" /><PreviewMedia mediaIds={mediaIds} mediaAlt={mediaAlt} /></div>
        <div aria-hidden="true" className="mt-5 flex max-w-[400px] items-center justify-between pr-5 text-[var(--text-muted)]">
          <MessageCircle size={17} strokeWidth={1.8} /><Repeat2 size={18} strokeWidth={1.8} /><Heart size={17} strokeWidth={1.8} /><Share2 size={17} strokeWidth={1.8} />
        </div>
      </div>
      <MoreHorizontal aria-hidden="true" size={18} className="shrink-0 text-[var(--text-soft)]" />
    </div>
  );
}

function MastodonPreview({ text, mediaIds, mediaAlt }: { text: string; mediaIds: readonly string[]; mediaAlt: readonly string[] }) {
  return (
    <div className="border-l-[3px] border-[var(--accent)]">
      <div className="flex gap-3 px-4 pb-2 pt-5 sm:px-5">
        <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-[#6255bf] text-[24px] font-black leading-none text-white">m</span>
        <div className="min-w-0 flex-1 text-[13px] leading-5">
          <div className="flex flex-wrap items-baseline gap-x-1.5"><strong className="text-[var(--text)]">Your brand</strong><span className="text-[var(--text-muted)]">@yourbrand@mastodon.social</span></div>
          <span className="text-[12px] text-[var(--text-soft)]">Public post · now</span>
        </div>
        <MoreHorizontal aria-hidden="true" size={18} className="shrink-0 text-[var(--text-soft)]" />
      </div>
      <div className="min-h-[100px] px-4 py-3 sm:px-5"><PostText text={text} platform="mastodon" /><PreviewMedia mediaIds={mediaIds} mediaAlt={mediaAlt} /></div>
      <div aria-hidden="true" className="flex items-center justify-between border-t border-[var(--line)] px-5 py-3 text-[var(--text-muted)]">
        <MessageCircle size={17} strokeWidth={1.8} /><Repeat2 size={18} strokeWidth={1.8} /><Heart size={17} strokeWidth={1.8} /><Bookmark size={17} strokeWidth={1.8} /><Share2 size={17} strokeWidth={1.8} />
      </div>
    </div>
  );
}

function LinkedInPreview({ text, mediaIds, mediaAlt }: { text: string; mediaIds: readonly string[]; mediaAlt: readonly string[] }) {
  return (
    <div>
      <div className="flex gap-3 px-4 pb-3 pt-5 sm:px-5">
        <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[7px] bg-[#0a66c2] text-[17px] font-bold text-white">in</span>
        <div className="min-w-0 flex-1 text-[13px] leading-5">
          <strong className="block text-[var(--text)]">Your brand</strong>
          <span className="block text-[12px] text-[var(--text-muted)]">Company page · Public</span>
          <span className="block text-[11px] text-[var(--text-soft)]">Just now · 🌐</span>
        </div>
        <MoreHorizontal aria-hidden="true" size={18} className="shrink-0 text-[var(--text-soft)]" />
      </div>
      <div className="min-h-[110px] px-4 pb-5 sm:px-5"><PostText text={text} platform="linkedin" /><PreviewMedia mediaIds={mediaIds} mediaAlt={mediaAlt} /></div>
      <div className="mx-4 border-t border-[var(--line)] sm:mx-5" />
      <div aria-hidden="true" className="grid grid-cols-4 gap-1 px-2 py-3 text-center text-[11px] font-semibold text-[var(--text-muted)] sm:text-[11px]">
        <span className="flex flex-col items-center gap-1 sm:flex-row sm:justify-center"><ThumbsUp size={16} />Like</span>
        <span className="flex flex-col items-center gap-1 sm:flex-row sm:justify-center"><MessageCircle size={16} />Comment</span>
        <span className="flex flex-col items-center gap-1 sm:flex-row sm:justify-center"><Repeat2 size={17} />Repost</span>
        <span className="flex flex-col items-center gap-1 sm:flex-row sm:justify-center"><Send size={16} />Send</span>
      </div>
    </div>
  );
}

function ThreadsPreview({ text, mediaIds, mediaAlt }: { text: string; mediaIds: readonly string[]; mediaAlt: readonly string[] }) {
  return (
    <div className="flex gap-3 px-4 py-5 sm:px-5">
      <div className="flex shrink-0 flex-col items-center">
        <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--text)] text-[18px] font-bold text-[var(--surface)]">P</span>
        <span aria-hidden="true" className="mt-2 w-px flex-1 bg-[var(--line)]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[13px]"><strong className="text-[var(--text)]">yourbrand</strong><span className="text-[var(--text-soft)]">· now</span><MoreHorizontal aria-hidden="true" size={18} className="ml-auto text-[var(--text-soft)]" /></div>
        <div className="mt-2 min-h-[112px]"><PostText text={text} platform="threads" /><PreviewMedia mediaIds={mediaIds} mediaAlt={mediaAlt} /></div>
        <div aria-hidden="true" className="mt-5 flex items-center gap-5 text-[var(--text)]"><Heart size={18} strokeWidth={1.9} /><MessageCircle size={18} strokeWidth={1.9} /><Repeat2 size={18} strokeWidth={1.9} /><Send size={18} strokeWidth={1.9} /></div>
        <p className="mb-0 mt-3 text-[12px] text-[var(--text-soft)]">0 replies · 0 likes</p>
      </div>
    </div>
  );
}

/** An illustrative post card; no account data or live metrics are implied. */
export function PlatformPreview({ platform, text, count, limit, mediaIds = [], mediaAlt = [] }: Props) {
  const shownIds = mediaIds.slice(0, imageLimits[platform]);
  const shownAlt = mediaAlt.slice(0, shownIds.length);
  return (
    <figure className="mx-auto w-full max-w-[520px]">
      <div aria-label={`${platforms[platform].name} example post`} className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--surface)] shadow-sm">
        {platform === "bluesky" && <BlueskyPreview text={text} mediaIds={shownIds} mediaAlt={shownAlt} />}
        {platform === "mastodon" && <MastodonPreview text={text} mediaIds={shownIds} mediaAlt={shownAlt} />}
        {platform === "linkedin" && <LinkedInPreview text={text} mediaIds={shownIds} mediaAlt={shownAlt} />}
        {platform === "threads" && <ThreadsPreview text={text} mediaIds={shownIds} mediaAlt={shownAlt} />}
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center justify-center gap-x-2 text-center text-[11px] text-[var(--text-soft)]">
        <span>Illustrative preview{mediaIds.length > 0 ? ` · ${shownIds.length} of ${mediaIds.length} local images shown` : " · No live platform data"}</span>
        {typeof count === "number" && typeof limit === "number" && <span className="tabular-nums">· {count} / {limit} {platform === "bluesky" ? "graphemes" : "characters"}</span>}
      </figcaption>
    </figure>
  );
}
