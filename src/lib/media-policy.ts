/** A workspace can hold a larger set; each destination still has its own rules. */
export const MAX_POST_IMAGES = 20;

export const imageLimits = {
  bluesky: 4,
  mastodon: 4,
  linkedin: 20,
  threads: 20,
  x: 4,
} as const;

export function imageLimitWarning(destination: string, count: number): string | null {
  const limit = imageLimits[destination as keyof typeof imageLimits];
  if (!limit || count <= limit) return null;
  return `${destination === "x" ? "X" : destination[0].toUpperCase() + destination.slice(1)} accepts up to ${limit} images per post. Choose ${limit} or fewer before publishing there; your draft keeps all ${count}.`;
}
