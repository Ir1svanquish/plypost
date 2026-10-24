const legacyKey = "socialflow-mvp";
const ownerKeyPrefix = "plypost-editor-v2:";

type EditorStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

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
