/** A workspace can hold a larger set; each destination still has its own rules. */
export const MAX_POST_IMAGES = 20;

export const imageLimits = {
  bluesky: 4,
  mastodon: 4,
  linkedin: 20,
  threads: 20,
  x: 4,
  pinterest: 1,
  youtube: 1,
} as const;

export function imageLimitForDestination(destination: string, hasVideo = false): number {
  const limit = imageLimits[destination as keyof typeof imageLimits] ?? MAX_POST_IMAGES;
  if ((destination === "bluesky" || destination === "pinterest") && hasVideo) return 0;
  return (destination === "x" || destination === "threads") && hasVideo ? limit - 1 : limit;
}

export function imageLimitWarning(destination: string, count: number, hasVideo = false): string | null {
  const limit = imageLimits[destination as keyof typeof imageLimits];
  if (!limit || count <= imageLimitForDestination(destination, hasVideo)) return null;
  if (destination === "bluesky" && hasVideo) return "Bluesky takes a video or images in one post. Choose one format for the handoff; your draft keeps both.";
  if (destination === "pinterest" && hasVideo) return "Pinterest's web editor creates an image Pin or a video Pin. Remove the images or the video from this handoff; your draft keeps both.";
  if (destination === "x" && hasVideo) return "X allows up to 4 media items per post, including the video. Choose 3 or fewer images, or remove the video.";
  if (destination === "threads" && hasVideo) return "Threads allows up to 20 media items per carousel, including the video. Choose 19 or fewer images, or remove the video.";
  if (destination === "youtube") return "YouTube Studio uploads a video with at most one optional custom thumbnail image. Choose one image or none; your draft keeps all images.";
  return `${destination === "x" ? "X" : destination[0].toUpperCase() + destination.slice(1)} accepts up to ${limit} images per post. Choose ${limit} or fewer before publishing there; your draft keeps all ${count}.`;
}

/** Images in a YouTube video handoff are optional thumbnail references, never video frames. */
export function defaultHandoffImageIds(destination: string, draftImageIds: readonly string[], hasVideo = false): string[] {
  if (destination === "youtube") return [];
  if (hasVideo && (destination === "mastodon" || destination === "linkedin")) return [];
  return draftImageIds.slice(0, imageLimitForDestination(destination, hasVideo));
}
