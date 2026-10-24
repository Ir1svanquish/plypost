export const assistedIds = [
  "x", "facebook", "instagram", "tiktok", "youtube", "pinterest", "reddit",
  "bluesky", "mastodon", "linkedin", "threads",
] as const;

export type AssistedDestinationId = (typeof assistedIds)[number];
export const assistedTextImageOnlyDisplayIds = ["facebook", "instagram", "x", "reddit", "pinterest"] as const satisfies readonly AssistedDestinationId[];
export const assistedVideoDisplayIds = ["youtube", "tiktok"] as const satisfies readonly AssistedDestinationId[];
export const assistedTextImageDisplayIds = [
  "facebook", "instagram", "linkedin", "threads", "x", "reddit", "pinterest", "bluesky", "mastodon",
] as const satisfies readonly AssistedDestinationId[];
export const assistedOnlyDisplayIds = [
  ...assistedTextImageOnlyDisplayIds, ...assistedVideoDisplayIds,
] as const satisfies readonly AssistedDestinationId[];

export type AssistedDestination = {
  name: string;
  url: string;
  hint: string;
  needsMedia?: boolean;
};

export const assistedDestinations: Record<AssistedDestinationId, AssistedDestination> = {
  x: { name: "X", url: "https://x.com/home", hint: "Open your timeline, then create a post." },
  facebook: { name: "Facebook Page", url: "https://www.facebook.com/", hint: "Switch to the Page you manage before posting." },
  instagram: { name: "Instagram", url: "https://www.instagram.com/", hint: "Add your image or video on Instagram before posting.", needsMedia: true },
  tiktok: { name: "TikTok", url: "https://www.tiktok.com/upload", hint: "Upload your photo or video, then add this caption.", needsMedia: true },
  youtube: { name: "YouTube", url: "https://studio.youtube.com/", hint: "Upload a video in YouTube Studio and use this text as a starting description.", needsMedia: true },
  pinterest: { name: "Pinterest", url: "https://www.pinterest.com/", hint: "Choose a board and add an image or video to your Pin.", needsMedia: true },
  reddit: { name: "Reddit", url: "https://www.reddit.com/submit", hint: "Choose a community and check its posting rules." },
  bluesky: { name: "Bluesky", url: "https://bsky.app/", hint: "Create a post from your Bluesky account." },
  mastodon: { name: "Mastodon", url: "https://joinmastodon.org/", hint: "Open your own Mastodon server to post; this link helps you find it." },
  linkedin: { name: "LinkedIn", url: "https://www.linkedin.com/feed/", hint: "Choose your profile or company Page before posting." },
  threads: { name: "Threads", url: "https://www.threads.com/", hint: "Create a post from your Threads account." },
};

export function missingHandoffMedia(destination: AssistedDestinationId, imageCount: number, hasVideo: boolean): "video" | "photo-or-video" | null {
  if (destination === "youtube") return hasVideo ? null : "video";
  return assistedDestinations[destination].needsMedia && imageCount === 0 && !hasVideo ? "photo-or-video" : null;
}

export function isAssistedDestinationId(value: unknown): value is AssistedDestinationId {
  return typeof value === "string" && assistedIds.includes(value as AssistedDestinationId);
}
