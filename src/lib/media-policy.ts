/** A workspace can hold a larger set; each destination still has its own rules. */
export const MAX_POST_IMAGES = 20;

export const imageLimits = {
  bluesky: 4,
  mastodon: 4,
  linkedin: 20,
  threads: 20,
  x: 4,
  pinterest: 1,
} as const;

export function imageLimitForDestination(destination: string, hasVideo = false): number {
  const limit = imageLimits[destination as keyof typeof imageLimits] ?? MAX_POST_IMAGES;
  return destination === "x" && hasVideo ? limit - 1 : limit;
}

export function imageLimitWarning(destination: string, count: number, hasVideo = false): string | null {
  const limit = imageLimits[destination as keyof typeof imageLimits];
  if (!limit || count <= imageLimitForDestination(destination, hasVideo)) return null;
  if (destination === "x" && hasVideo) return "X allows up to 4 media items per post, including the video. Choose 3 or fewer images, or remove the video.";
  return `${destination === "x" ? "X" : destination[0].toUpperCase() + destination.slice(1)} accepts up to ${limit} images per post. Choose ${limit} or fewer before publishing there; your draft keeps all ${count}.`;
}
