import { platformIds } from "./platforms";
import { parseWorkspace, type SavedDraft } from "./workspace";

export type PendingDraftSave = {
  snapshot: SavedDraft;
  expectedUpdatedAt: string | null;
  asCopy: boolean;
};

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function sameDraftPayload(left: SavedDraft, right: SavedDraft): boolean {
  return left.title === right.title && left.source === right.source &&
    sameList(left.selected, right.selected) &&
    platformIds.every((id) => left.variants[id] === right.variants[id]) &&
    sameList(left.mediaIds ?? [], right.mediaIds ?? []) &&
    sameList(left.mediaAlt ?? (left.mediaIds ?? []).map(() => ""),
      right.mediaAlt ?? (right.mediaIds ?? []).map(() => "")) &&
    (left.videoId ?? null) === (right.videoId ?? null) &&
    (left.plannedDate ?? "") === (right.plannedDate ?? "") &&
    (left.placeLabel ?? "") === (right.placeLabel ?? "");
}

export function inspectPendingDraftSave(
  pending: PendingDraftSave,
  serverDraft: SavedDraft | undefined,
): "committed" | "not-committed" | "conflict" {
  if (serverDraft && sameDraftPayload(serverDraft, pending.snapshot)) return "committed";
  if (serverDraft?.updatedAt === pending.expectedUpdatedAt ||
      !serverDraft && pending.expectedUpdatedAt === null) return "not-committed";
  return "conflict";
}

/** Cached metadata is only used to reconcile the draft currently open in this browser. */
export function parsePendingDraftSave(value: unknown): PendingDraftSave | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if ((raw.expectedUpdatedAt !== null && typeof raw.expectedUpdatedAt !== "string") ||
      typeof raw.asCopy !== "boolean" || !raw.snapshot || typeof raw.snapshot !== "object" ||
      Array.isArray(raw.snapshot)) return null;
  const snapshot = raw.snapshot as Record<string, unknown>;
  if (typeof snapshot.id !== "string" ||
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(snapshot.id)) return null;
  const parsed = parseWorkspace({ version: 3, drafts: [snapshot], schedule: [], assisted: [] });
  const draft = parsed?.drafts[0];
  if (!draft || draft.id !== snapshot.id) return null;
  return { snapshot: draft, expectedUpdatedAt: raw.expectedUpdatedAt as string | null, asCopy: raw.asCopy };
}
