import type { EditorStorage } from "./editor-cache";

const databaseName = "plypost-editor-recovery-v1";
const storeName = "copies";
export type RecoveryRecord = { key: string; value: string | null; updatedAt: number };
export type EditorRecovery = { storage: EditorStorage; close: () => void };

/** Opening an older copy is a new edit in this tab, not an older revision of its empty slot. */
export function reopenedEditorValue(value: string, now: number): string {
  const data: unknown = JSON.parse(value);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid browser copy");
  return JSON.stringify({ ...data, cachedAt: now });
}

/** Another tab can enqueue a stale mirror after a newer edit or removal. */
export function shouldReplaceRecoveryRecord(current: RecoveryRecord | undefined, next: RecoveryRecord): boolean {
  return !current || current.updatedAt < next.updatedAt ||
    (current.updatedAt === next.updatedAt && (current.value !== null || next.value === null));
}

function ownerPrefix(email: string): string {
  return `plypost-editor-v3:${encodeURIComponent(email.trim().toLowerCase())}:`;
}

function cachedAt(value: string): number | null {
  try {
    const data = JSON.parse(value);
    return data && typeof data.cachedAt === "number" && Number.isFinite(data.cachedAt) ? data.cachedAt : null;
  } catch { return null; }
}

/** Replay only newer copies for this owner. Deletion records stop old local copies reappearing. */
export function restoreRecoveryRecords(storage: EditorStorage, email: string, records: unknown[]): void {
  const prefix = ownerPrefix(email);
  for (const item of records) {
    if (!item || typeof item !== "object") continue;
    const record = item as RecoveryRecord;
    if (typeof record.key !== "string" || !record.key.startsWith(prefix) || record.key === prefix ||
        (record.value !== null && typeof record.value !== "string") ||
        typeof record.updatedAt !== "number" || !Number.isFinite(record.updatedAt)) continue;
    const current = storage.getItem(record.key);
    if (current === record.value) continue;
    // Unknown or corrupt local bytes stay available to the existing raw-copy recovery flow.
    const currentTime = current === null ? -Infinity : cachedAt(current);
    if (currentTime === null || currentTime > record.updatedAt ||
        (record.value !== null && currentTime === record.updatedAt)) continue;
    if (record.value === null) storage.removeItem(record.key);
    else storage.setItem(record.key, record.value);
  }
}

/** Keep localStorage's synchronous interface and mirror scoped edits in durable transactions. */
export async function openEditorRecovery(storage: EditorStorage, factory: IDBFactory | undefined,
  email: string, onFailure: () => void): Promise<EditorRecovery> {
  const fallback = { storage, close() {} };
  if (!factory) { onFailure(); return fallback; }
  const prefix = ownerPrefix(email);
  let db: IDBDatabase;
  try {
    db = await new Promise<IDBDatabase>((resolve, reject) => {
      let finished = false;
      const fail = () => { if (!finished) { finished = true; clearTimeout(timer); reject(new Error("Browser recovery unavailable")); } };
      const timer = setTimeout(fail, 1500);
      const request = factory.open(databaseName, 1);
      request.onupgradeneeded = () => {
        if (finished) { request.transaction?.abort(); return; }
        request.result.createObjectStore(storeName, { keyPath: "key" });
      };
      request.onerror = fail;
      request.onblocked = fail;
      request.onsuccess = () => {
        if (finished) { request.result.close(); return; }
        finished = true; clearTimeout(timer); resolve(request.result);
      };
    });
  } catch { onFailure(); return fallback; }

  let closed = false;
  const close = () => { closed = true; db.close(); };
  db.onversionchange = () => { close(); onFailure(); };
  db.onclose = () => { closed = true; onFailure(); };
  const mirror = (key: string, value: string | null) => {
    if (!key.startsWith(prefix)) return;
    if (closed) { onFailure(); return; }
    try {
      // Completion follows the browser's durable write, not localStorage's delayed flush.
      const tx = db.transaction(storeName, "readwrite", { durability: "strict" });
      tx.onabort = onFailure;
      tx.onerror = onFailure;
      const store = tx.objectStore(storeName);
      const next = { key, value, updatedAt: value === null ? Date.now() : cachedAt(value) ?? Date.now() };
      const previous = store.get(key);
      previous.onsuccess = () => {
        if (shouldReplaceRecoveryRecord(previous.result, next)) store.put(next);
      };
    } catch { onFailure(); }
  };

  try {
    const records = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const request = tx.objectStore(storeName).getAll(IDBKeyRange.bound(prefix, prefix + "\uffff"));
      const timer = setTimeout(() => { tx.abort(); reject(new Error("Browser recovery timed out")); }, 1500);
      tx.oncomplete = () => { clearTimeout(timer); resolve(request.result); };
      tx.onabort = tx.onerror = () => { clearTimeout(timer); reject(new Error("Could not read browser recovery")); };
    });
    restoreRecoveryRecords(storage, email, records);
    // Migrate existing scoped copies without removing the original localStorage entries.
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) mirror(key, storage.getItem(key));
    }
  } catch { close(); onFailure(); return fallback; }

  return { close, storage: {
    get length() { return storage.length; },
    key: (index) => storage.key(index),
    getItem: (key) => storage.getItem(key),
    setItem(key, value) { storage.setItem(key, value); mirror(key, value); },
    removeItem(key) { storage.removeItem(key); mirror(key, null); },
  } };
}
