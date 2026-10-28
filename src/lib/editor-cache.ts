const legacyKey = "socialflow-mvp";
const legacyOwnerKeyPrefix = "plypost-editor-v2:";
const ownerKeyPrefix = "plypost-editor-v3:";
const tabIdKey = "plypost-editor-tab-id";
const documentKey = "plypost-editor-document";

type EditorStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
type TabStorage = Pick<Storage, "getItem" | "setItem">;

export type OtherEditorCopy = { tabId: string; value: string; updatedAt: number; preview: string; unreadable?: boolean };

/** Drop only an untouched starter template; a changed title, channel or attachment is user work. */
export function isUntouchedStarterCache(value: unknown, examples: readonly string[], platforms: readonly string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  const selected = data.selected;
  const variants = data.variants;
  return data.editorOrigin === "starter" && typeof data.source === "string" && examples.includes(data.source) &&
    (data.title === "" || data.title === undefined) && (data.currentDraftId === null || data.currentDraftId === undefined) &&
    (data.pendingDraftSave === null || data.pendingDraftSave === undefined) &&
    (data.plannedDate === "" || data.plannedDate === undefined) && (data.videoId === null || data.videoId === undefined) &&
    (data.placeLabel === "" || data.placeLabel === undefined) &&
    (data.mediaIds === undefined || Array.isArray(data.mediaIds) && data.mediaIds.length === 0) &&
    (data.mediaAlt === undefined || Array.isArray(data.mediaAlt) && data.mediaAlt.length === 0) &&
    (variants === undefined || Boolean(variants && typeof variants === "object" && !Array.isArray(variants) && Object.keys(variants).length === 0)) &&
    Array.isArray(selected) && selected.length === platforms.length && platforms.every((id) => selected.includes(id));
}

function legacyOwnerKey(email: string): string {
  return `${legacyOwnerKeyPrefix}${encodeURIComponent(email.trim().toLowerCase())}`;
}

function ownerPrefix(email: string): string {
  return `${ownerKeyPrefix}${encodeURIComponent(email.trim().toLowerCase())}`;
}

function ownerTabKey(email: string, tabId: string): string {
  return `${ownerPrefix(email)}:${tabId}`;
}

/** A reload keeps its editor; a new document copied from another tab gets a separate identity. */
export function ensureEditorTabId(session: TabStorage, documentToken: string, navigationType: string, createId: () => string): string {
  const existing = session.getItem(tabIdKey);
  const sameDocument = session.getItem(documentKey) === documentToken;
  if (existing && (sameDocument || navigationType === "reload" || navigationType === "back_forward")) {
    session.setItem(documentKey, documentToken);
    return existing;
  }
  const next = createId();
  session.setItem(tabIdKey, next);
  session.setItem(documentKey, documentToken);
  return next;
}

/** Start a new cache slot when the current one cannot be read, keeping the original bytes. */
export function forkUnreadableEditorCache(storage: EditorStorage, session: TabStorage, email: string, currentTabId: string,
  documentToken: string, unreadable: string, createId: () => string): { tabId: string; persistent: boolean } {
  if (storage.getItem(ownerTabKey(email, currentTabId)) !== unreadable) {
    // Older caches are removed by a normal write. Copy one into this owner's slots first.
    storage.setItem(ownerTabKey(email, createId()), unreadable);
  }
  const tabId = createId();
  try {
    session.setItem(tabIdKey, tabId);
    session.setItem(documentKey, documentToken);
    return { tabId, persistent: true };
  } catch {
    return { tabId, persistent: false };
  }
}

/** The pre-account cache can be claimed once; later owners only read their own editor. */
export function readOwnerEditorCache(storage: EditorStorage, email: string, tabId: string): string | null {
  const saved = storage.getItem(ownerTabKey(email, tabId));
  if (saved !== null) return saved;
  const previous = storage.getItem(legacyOwnerKey(email));
  if (previous !== null) return previous;
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(legacyOwnerKeyPrefix) || key?.startsWith(ownerKeyPrefix)) return null;
  }
  return storage.getItem(legacyKey);
}

export function writeOwnerEditorCache(storage: EditorStorage, email: string, tabId: string, value: string): void {
  storage.setItem(ownerTabKey(email, tabId), value);
  storage.removeItem(legacyOwnerKey(email));
  storage.removeItem(legacyKey);
}

/** Show recoverable edits without replacing the editor in another open tab. */
export function otherOwnerEditorCopies(storage: EditorStorage, email: string, tabId: string): OtherEditorCopy[] {
  const prefix = `${ownerPrefix(email)}:`;
  const copies: OtherEditorCopy[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(prefix) || key === ownerTabKey(email, tabId)) continue;
    const value = storage.getItem(key);
    if (!value) continue;
    if (value.length > 100_000) {
      copies.push({ tabId: key.slice(prefix.length), value, updatedAt: 0,
        preview: "Large browser copy", unreadable: true });
      continue;
    }
    try {
      const data = JSON.parse(value) as Record<string, unknown>;
      if (data.hasUnsavedWork !== true || typeof data.cachedAt !== "number" || !Number.isFinite(data.cachedAt)) continue;
      const preview = [data.title, data.source, ...Object.values(data.variants && typeof data.variants === "object" ? data.variants : {})]
        .find((item) => typeof item === "string" && item.trim()) as string | undefined;
      copies.push({ tabId: key.slice(prefix.length), value, updatedAt: data.cachedAt,
        preview: Array.from(preview?.trim().replace(/\s+/g, " ") || "Untitled draft").slice(0, 80).join("") });
    } catch {
      copies.push({ tabId: key.slice(prefix.length), value, updatedAt: 0,
        preview: "Unreadable browser copy", unreadable: true });
    }
  }
  return copies.sort((left, right) => Number(Boolean(right.unreadable)) - Number(Boolean(left.unreadable)) ||
    right.updatedAt - left.updatedAt).slice(0, 10);
}

/** Remove only a selected, older copy for this owner; never erase the active editor. */
export function removeOwnerEditorCopy(storage: EditorStorage, email: string, currentTabId: string, copyTabId: string): boolean {
  if (!copyTabId || copyTabId === currentTabId) return false;
  const key = ownerTabKey(email, copyTabId);
  if (storage.getItem(key) === null) return false;
  storage.removeItem(key);
  return true;
}
