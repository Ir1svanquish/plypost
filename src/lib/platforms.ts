export const platformIds = ["bluesky", "mastodon", "linkedin", "threads"] as const;
export type PlatformId = (typeof platformIds)[number];

export type Platform = {
  id: PlatformId;
  name: string;
  handle: string;
  limit: number;
  accent: string;
  hint: string;
};

export const platforms: Record<PlatformId, Platform> = {
  bluesky: {
    id: "bluesky",
    name: "Bluesky",
    handle: "@yourbrand.bsky.social",
    limit: 300,
    accent: "#1684e8",
    hint: "Short and direct",
  },
  mastodon: {
    id: "mastodon",
    name: "Mastodon",
    handle: "@yourbrand@mastodon.social",
    limit: 500,
    accent: "#7965dc",
    hint: "Room for context",
  },
  linkedin: {
    id: "linkedin",
    name: "LinkedIn",
    handle: "Your brand · Company page",
    limit: 3000,
    accent: "#146da8",
    hint: "Professional and considered",
  },
  threads: {
    id: "threads",
    name: "Threads",
    handle: "@yourbrand",
    limit: 500,
    accent: "#202027",
    hint: "Conversational tone",
  },
};

export function isPlatformId(value: unknown): value is PlatformId {
  return typeof value === "string" && platformIds.includes(value as PlatformId);
}

export function characterCount(value: string): number {
  return Array.from(value).length;
}

export function adaptDraft(source: string, platform: PlatformId): string {
  const text = source.trim().replace(/\r\n/g, "\n");
  if (!text) return "";
  switch (platform) {
    case "bluesky":
      return text.replace(/\s*\n\s*/g, " ").replace(/ {2,}/g, " ");
    case "mastodon":
      return text;
    case "linkedin":
      return text.replace(/\n{2,}/g, "\n\n").replace(/(?<=[.!?]) (?=[A-Z])/g, "\n\n");
    case "threads":
      return text.replace(/\n{2,}/g, "\n").replace(/(?<=[.!?]) (?=[A-Z])/g, "\n");
  }
}
