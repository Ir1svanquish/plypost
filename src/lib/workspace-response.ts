import { parseWorkspace, type AssistedPost, type SavedDraft, type ScheduledPost } from "./workspace";

type AuditEntry = { action: string; subject_id: string | null; detail: string | null; created_at: string };

export type WorkspaceResponse = {
  drafts: SavedDraft[];
  schedule: ScheduledPost[];
  assisted: AssistedPost[];
  log: AuditEntry[];
  workerLastSeen: string | null;
  workspaceRevision: string;
  savedDraft?: SavedDraft;
  assistedMigration?: "imported" | "skipped";
};

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** A partial success body must never replace the current workspace in the browser. */
export function parseWorkspaceResponse(value: unknown): WorkspaceResponse | null {
  if (!record(value) || !Array.isArray(value.drafts) || !Array.isArray(value.schedule) ||
      !Array.isArray(value.assisted) || !Array.isArray(value.log) ||
      !/^[a-f0-9]{64}$/.test(String(value.workspaceRevision ?? "")) ||
      (value.workerLastSeen !== null && typeof value.workerLastSeen !== "string")) return null;
  const workspace = parseWorkspace({ version: 3, drafts: value.drafts, schedule: value.schedule, assisted: value.assisted });
  if (!workspace || workspace.drafts.length !== value.drafts.length ||
      workspace.schedule.length !== value.schedule.length || workspace.assisted.length !== value.assisted.length) return null;
  if (value.savedDraft !== undefined) {
    const parsed = parseWorkspace({ version: 3, drafts: [value.savedDraft], schedule: [], assisted: [] });
    if (!parsed || parsed.drafts.length !== 1) return null;
  }
  return value as unknown as WorkspaceResponse;
}

export type RestoreReceipt = { drafts: number; jobs: number; assisted: number; media: number; videos: number };

/** Only the server's complete restore receipt confirms a destructive import. */
export function parseRestoreReceipt(value: unknown): RestoreReceipt | null {
  if (!record(value) || !record(value.restored)) return null;
  const counts = value.restored;
  if (!["drafts", "jobs", "assisted", "media", "videos"].every((key) =>
    Number.isSafeInteger(counts[key]) && (counts[key] as number) >= 0)) return null;
  return counts as unknown as RestoreReceipt;
}
