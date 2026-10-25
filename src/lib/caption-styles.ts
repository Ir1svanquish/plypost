export const captionStyles = {
  default: { label: "Default", description: "Clear and natural", instruction: "Write clearly and naturally, without forced personality." },
  personal: { label: "My style", description: "Uses your saved style guide", instruction: "Follow the saved voice guide for tone and rhythm only." },
  direct: { label: "Short & direct", description: "Lead with the point", instruction: "Lead with the central point and keep sentences short. Skip filler." },
  practical: { label: "Useful takeaway", description: "Make the value easy to find", instruction: "Surface a useful takeaway. Use a short list only if the source provides actual steps or tips." },
  conversation: { label: "Conversation starter", description: "Invite a real response", instruction: "End with one specific, relevant question when the source supports it. Avoid engagement bait." },
  behindScenes: { label: "Behind the scenes", description: "Show the real process", instruction: "Describe the process or work in progress only when the source provides it. Never invent backstage details." },
  story: { label: "Mini story", description: "A beginning and a point", instruction: "Use a simple narrative arc only when the source gives a real sequence. Never invent an anecdote or outcome." },
} as const;

export type CaptionStyleId = keyof typeof captionStyles;

export function isCaptionStyleId(value: unknown): value is CaptionStyleId {
  return typeof value === "string" && Object.hasOwn(captionStyles, value);
}
