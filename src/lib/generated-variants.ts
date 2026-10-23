import { characterCount, platformIds, platforms, type PlatformId } from "./platforms";

export type OverLimitVariant = { platform: PlatformId; count: number; limit: number };

export function parseGeneratedVariants(content: string): { variants: Record<PlatformId, string>; overLimit: OverLimitVariant[] } | null {
  const json = content.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const value: unknown = JSON.parse(json);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const variants = {} as Record<PlatformId, string>;
    const overLimit: OverLimitVariant[] = [];
    for (const platform of platformIds) {
      const raw = (value as Record<string, unknown>)[platform];
      if (typeof raw !== "string" || !raw.trim()) return null;
      const text = raw.trim();
      const count = characterCount(text);
      if (count > 5000) return null;
      variants[platform] = text;
      const limit = platforms[platform].limit;
      if (count > limit) overLimit.push({ platform, count, limit });
    }
    return { variants, overLimit };
  } catch {
    return null;
  }
}
