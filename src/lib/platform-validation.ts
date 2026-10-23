import { characterCount, platforms, type PlatformId } from "./platforms";

export type PlatformValidationIssue = {
  code:
    | "empty"
    | "over-character-limit"
    | "over-bluesky-byte-limit"
    | "bluesky-rich-text"
    | "mastodon-instance-limit"
    | "mastodon-url-format"
    | "linkedin-mention"
    | "threads-topic-tag";
  severity: "error" | "warning";
  message: string;
  sourceUrl?: string;
};

export type PlatformValidation = {
  platform: PlatformId;
  count: number;
  limit: number;
  byteCount?: number;
  byteLimit?: number;
  valid: boolean;
  issues: PlatformValidationIssue[];
};

const BLUESKY_POST_LEXICON = "https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/feed/post.json";
const BLUESKY_POST_GUIDE = "https://docs.bsky.app/docs/tutorials/creating-a-post";
const MASTODON_POST_GUIDE = "https://docs.joinmastodon.org/user/posting/";
const MASTODON_INSTANCE_API = "https://docs.joinmastodon.org/entities/Instance/";
const LINKEDIN_POSTS_API = "https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api";
const THREADS_TOPIC_HELP = "https://www.facebook.com/help/instagram/search/?query=hashtags";

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** The count shown for the selected text-only post, before account-specific checks. */
export function platformTextLength(platform: PlatformId, text: string): number {
  if (platform === "bluesky") return [...graphemeSegmenter.segment(text)].length;
  // The Mastodon value is intentionally conservative until its server is known.
  return characterCount(text);
}

/**
 * Local preflight for text-only posts. Warnings describe features the simulated
 * preview cannot resolve; errors are the limits Plypost can actually enforce.
 */
export function validatePlatformText(platform: PlatformId, text: string): PlatformValidation {
  const limit = platforms[platform].limit;
  const count = platformTextLength(platform, text);
  const issues: PlatformValidationIssue[] = [];
  const byteCount = platform === "bluesky" ? new TextEncoder().encode(text).length : undefined;

  if (!text.trim()) {
    issues.push({ code: "empty", severity: "error", message: "Add text before sharing." });
  }

  if (count > limit) {
    issues.push({
      code: "over-character-limit",
      severity: platform === "mastodon" ? "warning" : "error",
      message: platform === "mastodon"
        ? `Mastodon draft is ${count} characters; 500 is a common server default, but your server and its URL rules may differ. Check it there before posting.`
        : `${platforms[platform].name} draft is ${count}/${limit} characters. Shorten it before sharing.`,
      sourceUrl: platform === "bluesky" ? BLUESKY_POST_LEXICON : platform === "mastodon" ? MASTODON_INSTANCE_API : undefined,
    });
  }

  if (platform === "bluesky") {
    if (byteCount !== undefined && byteCount > 3000) {
      issues.push({
        code: "over-bluesky-byte-limit",
        severity: "error",
        message: `Bluesky text is ${byteCount}/3,000 UTF-8 bytes. Some emoji and scripts use multiple bytes.`,
        sourceUrl: BLUESKY_POST_LEXICON,
      });
    }
    if (/(?:^|[\s([{])(?:@[\w.-]+|https?:\/\/\S+|#[\p{L}\p{N}_]+)/iu.test(text)) {
      issues.push({
        code: "bluesky-rich-text",
        severity: "warning",
        message: "Check links, mentions and tags in Bluesky after pasting; this text preview does not resolve their rich-text facets.",
        sourceUrl: BLUESKY_POST_GUIDE,
      });
    }
  }

  if (platform === "mastodon") {
    if ((count >= 450 && count <= limit) || /https?:\/\/\S{24,}/i.test(text)) {
      issues.push({
        code: "mastodon-instance-limit",
        severity: "warning",
        message: "Mastodon limits vary by server, and recognized URLs count as a fixed length. Check the final count on your server.",
        sourceUrl: MASTODON_INSTANCE_API,
      });
    }
    if (/(?:^|\s)www\.[^\s]+/i.test(text)) {
      issues.push({
        code: "mastodon-url-format",
        severity: "warning",
        message: "Start Mastodon links with https:// or http:// so they become links after posting.",
        sourceUrl: MASTODON_POST_GUIDE,
      });
    }
  }

  if (platform === "linkedin" && /(?:^|[\s([{])@[\p{L}\p{N}_][\p{L}\p{N}_.-]*/u.test(text)) {
    issues.push({
      code: "linkedin-mention",
      severity: "warning",
      message: "Check @mentions in LinkedIn before posting; plain text alone does not identify a tagged member or Page.",
      sourceUrl: LINKEDIN_POSTS_API,
    });
  }

  if (platform === "threads" && [...text.matchAll(/(?:^|[\s([{])#[\p{L}\p{N}_]+/gu)].length > 1) {
    issues.push({
      code: "threads-topic-tag",
      severity: "warning",
      message: "Threads allows one topic tag per post. Choose your intended topic in Threads; these hashtags are only draft text.",
      sourceUrl: THREADS_TOPIC_HELP,
    });
  }

  return {
    platform,
    count,
    limit,
    ...(byteCount === undefined ? {} : { byteCount, byteLimit: 3000 }),
    valid: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}
