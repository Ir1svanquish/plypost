import { NextResponse } from "next/server";
import { currentUser, sameOrigin } from "@/lib/server/auth";
import { readBoundedJsonObject } from "@/lib/server/bounded-json";
import { addAssisted, addSchedule, AssistedConflictError, deleteAssisted, deleteDraft, deleteSchedule, DraftConflictError, importLegacyLibrary, importLibrary, listWorkspace, markAssistedNotified, migrateAssisted, migrateLegacyBrowserWorkspace, prepareAssistedBatch, rescheduleAssisted, rescheduleSchedule, retrySchedule, saveDraft, setAssistedOutcome, setAssistedStatus, setDraftTargetDate, updateAssistedImages, updateAssistedMediaAlt, updateAssistedText, updateAssistedVideo } from "@/lib/server/workspace";

export const runtime = "nodejs";
const MAX_WORKSPACE_REQUEST_BYTES = 16 * 1024 * 1024;

export async function GET(request: Request) {
  const user = currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  return NextResponse.json(listWorkspace(user), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const user = currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  const body = await readBoundedJsonObject(request, MAX_WORKSPACE_REQUEST_BYTES);
  if (body.kind === "too-large") return NextResponse.json({ error: "Workspace request is too large." }, { status: 413 });
  if (body.kind === "invalid") return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  const input = body.value;
  let assistedMigration: "imported" | "skipped" | undefined;
  let savedDraftResult: ReturnType<typeof saveDraft> | undefined;
  try {
    switch (input.action) {
      case "save-draft": savedDraftResult = saveDraft(user, input.item, input.expectedUpdatedAt); break;
      case "set-draft-target-date": savedDraftResult = setDraftTargetDate(user, input.id, input.expectedUpdatedAt, input.plannedDate); break;
      case "delete-draft": if (typeof input.id !== "string" || !deleteDraft(user, input.id, input.expectedUpdatedAt)) throw new Error("Draft not found."); break;
      case "add-assisted": addAssisted(user, input.item); break;
      case "prepare-assisted-batch": prepareAssistedBatch(user, input.draftId, input.batchId, input.items, input.requireFreeSlots, input.expectedUpdatedAt); break;
      case "set-assisted-status": if (typeof input.id !== "string" || !setAssistedStatus(user, input.id, input.status, input.postUrl)) throw new Error("Assisted item not found."); break;
      case "set-assisted-outcome": if (typeof input.id !== "string" || !setAssistedOutcome(user, input.id, input.outcome)) throw new Error("Assisted item not found."); break;
      case "reschedule-assisted": if (typeof input.id !== "string" || !rescheduleAssisted(user, input.id, input.expectedScheduledFor, input.scheduledFor)) throw new Error("Assisted item not found."); break;
      case "update-assisted-text": if (typeof input.id !== "string" || !updateAssistedText(user, input.id, input.expectedText, input.text)) throw new Error("Assisted item not found."); break;
      case "update-assisted-video": if (typeof input.id !== "string" || !updateAssistedVideo(user, input.id, input.expectedVideoId, input.videoId)) throw new Error("Assisted item not found."); break;
      case "update-assisted-images": if (typeof input.id !== "string" || !updateAssistedImages(user, input.id, input.expectedMediaIds, input.expectedMediaAlt, input.mediaIds, input.mediaAlt)) throw new Error("Assisted item not found."); break;
      case "update-assisted-media-alt": if (typeof input.id !== "string" || !updateAssistedMediaAlt(user, input.id, input.expectedMediaIds, input.expectedMediaAlt, input.mediaAlt)) throw new Error("Assisted item not found."); break;
      case "mark-assisted-notified": markAssistedNotified(user, input.ids); break;
      case "delete-assisted": if (typeof input.id !== "string" || !deleteAssisted(user, input.id)) throw new Error("Assisted item not found."); break;
      case "migrate-assisted": assistedMigration = migrateAssisted(user, input.items); break;
      case "add-schedule": addSchedule(user, input.item, input.timezone); break;
      case "reschedule-schedule": if (typeof input.id !== "string" || !rescheduleSchedule(user, input.id, input.scheduledFor, input.timezone)) throw new Error("Plan item not found or already running/completed."); break;
      case "delete-schedule": if (typeof input.id !== "string" || !deleteSchedule(user, input.id)) throw new Error("Plan item not found or currently running."); break;
      case "retry-schedule": if (typeof input.id !== "string" || !retrySchedule(user, input.id)) throw new Error("Failed item not found."); break;
      case "import": importLibrary(user, input.backup); break;
      case "import-legacy": importLegacyLibrary(user, input.backup); break;
      case "migrate-browser-workspace": migrateLegacyBrowserWorkspace(user, input.backup); break;
      default: throw new Error("Unknown action.");
    }
  } catch (error) {
    if (error instanceof DraftConflictError) return NextResponse.json({ error: error.message, code: "DRAFT_CONFLICT" }, { status: 409 });
    if (error instanceof AssistedConflictError) return NextResponse.json({ error: error.message, code: "ASSISTED_CONFLICT" }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update workspace." }, { status: 400 });
  }
  return NextResponse.json({ ...listWorkspace(user), ...(savedDraftResult ? { savedDraft: savedDraftResult } : {}),
    ...(assistedMigration ? { assistedMigration } : {}) }, { headers: { "Cache-Control": "no-store" } });
}
