import { characterCount, platformIds, type PlatformId } from "./platforms";
import { validatePlatformText } from "./platform-validation";

export type OverLimitVariant = { platform: PlatformId; count: number; limit: number; byteCount?: number; byteLimit?: number };

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
      if (characterCount(text) > 5000) return null;
      variants[platform] = text;
      const check = validatePlatformText(platform, text);
      if (!check.valid) overLimit.push({
        platform, count: check.count, limit: check.limit,
        ...(check.byteCount !== undefined && check.byteLimit !== undefined && check.byteCount > check.byteLimit
          ? { byteCount: check.byteCount, byteLimit: check.byteLimit } : {}),
      });
    }
    return { variants, overLimit };
  } catch {
    return null;
  }
}
