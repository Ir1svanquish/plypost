export type VoiceProfile = { guide: string; updatedAt: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function parseExamples(value: unknown, min: number, max: number): string[] | null {
  if (!Array.isArray(value) || value.length < min || value.length > max) return null;
  const examples: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim() || Array.from(item.trim()).length > 1800) return null;
    examples.push(item.trim());
  }
  return examples;
}

export function parseGuide(value: unknown, max = 1000): string | null {
  if (typeof value !== "string") return null;
  const guide = value.trim();
  return guide && Array.from(guide).length <= max ? guide : null;
}

export function parseVoiceProfile(value: unknown): VoiceProfile | null {
  if (!isRecord(value)) return null;
  const guide = parseGuide(value.guide);
  const updatedAt = value.updatedAt;
  if (!guide || typeof updatedAt !== "string" || !Number.isFinite(Date.parse(updatedAt)) ||
      new Date(updatedAt).toISOString() !== updatedAt) return null;
  return { guide, updatedAt };
}

export function parseGuideResponse(raw: string): string | null {
  if (raw.length > 8000) return null;
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return isRecord(parsed) ? parseGuide(parsed.guide) : null;
  } catch { return null; }
}

export function repeatsLongExcerpt(guide: string, examples: string[]): boolean {
  const normalize = (value: string) => Array.from(value.toLocaleLowerCase().replace(/\s+/g, " "));
  const guideChars = normalize(guide);
  const excerptLength = 24;
  const guideExcerpts = new Set<string>();
  for (let i = 0; i <= guideChars.length - excerptLength; i++) {
    guideExcerpts.add(guideChars.slice(i, i + excerptLength).join(""));
  }
  for (const example of examples) {
    const chars = normalize(example);
    for (let i = 0; i <= chars.length - excerptLength; i++) {
      if (guideExcerpts.has(chars.slice(i, i + excerptLength).join(""))) return true;
    }
  }
  return false;
}

export function parseImageCaptionResponse(raw: string): { observations: string; caption: string } | null {
  if (raw.length > 12000) return null;
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!isRecord(parsed)) return null;
    const observations = parseGuide(parsed.observations, 500);
    const caption = parseGuide(parsed.caption, 3000);
    return observations && caption ? { observations, caption } : null;
  } catch { return null; }
}

export function parseDraftFromNotesResponse(raw: string): string | null {
  if (raw.length > 12000) return null;
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return isRecord(parsed) ? parseGuide(parsed.draft, 3000) : null;
  } catch { return null; }
}

export function isStandaloneQuestion(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= 300 && /^[^.!。！;；\n?？]+[?？]$/.test(trimmed);
}
