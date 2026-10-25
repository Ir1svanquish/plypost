const legacyKey = "socialflow-mvp";
const ownerKeyPrefix = "plypost-editor-v2:";

type EditorStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

/** Drop only an untouched starter template; a changed title, channel or attachment is user work. */
export function isUntouchedStarterCache(value: unknown, examples: readonly string[], platforms: readonly string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  const selected = data.selected;
  const variants = data.variants;
  return data.editorOrigin === "starter" && typeof data.source === "string" && examples.includes(data.source) &&
    (data.title === "" || data.title === undefined) && (data.currentDraftId === null || data.currentDraftId === undefined) &&
    (data.plannedDate === "" || data.plannedDate === undefined) && (data.videoId === null || data.videoId === undefined) &&
    (data.mediaIds === undefined || Array.isArray(data.mediaIds) && data.mediaIds.length === 0) &&
    (data.mediaAlt === undefined || Array.isArray(data.mediaAlt) && data.mediaAlt.length === 0) &&
    (variants === undefined || Boolean(variants && typeof variants === "object" && !Array.isArray(variants) && Object.keys(variants).length === 0)) &&
    Array.isArray(selected) && selected.length === platforms.length && platforms.every((id) => selected.includes(id));
}

function ownerKey(email: string): string {
  return `${ownerKeyPrefix}${encodeURIComponent(email.trim().toLowerCase())}`;
}

/** The pre-account cache can be claimed once; later owners only read their own editor. */
export function readOwnerEditorCache(storage: EditorStorage, email: string): string | null {
  const saved = storage.getItem(ownerKey(email));
  if (saved !== null) return saved;
  for (let index = 0; index < storage.length; index++) {
    if (storage.key(index)?.startsWith(ownerKeyPrefix)) return null;
  }
  return storage.getItem(legacyKey);
}

export function writeOwnerEditorCache(storage: EditorStorage, email: string, value: string): void {
  storage.setItem(ownerKey(email), value);
  storage.removeItem(legacyKey);
}
