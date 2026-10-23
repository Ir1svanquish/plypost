import { NextResponse } from "next/server";
import { currentUser, sameOrigin } from "@/lib/server/auth";
import { addAssisted, addSchedule, deleteAssisted, deleteDraft, deleteSchedule, importLegacyLibrary, importLibrary, listWorkspace, markAssistedNotified, migrateAssisted, retrySchedule, saveDraft, setAssistedStatus } from "@/lib/server/workspace";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  return NextResponse.json(listWorkspace(user), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const user = currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  let input: { action?: string; item?: unknown; id?: unknown; ids?: unknown; status?: unknown; items?: unknown; timezone?: unknown; backup?: unknown };
  try { input = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  let assistedMigration: "imported" | "skipped" | undefined;
  try {
    switch (input.action) {
      case "save-draft": saveDraft(user, input.item); break;
      case "delete-draft": if (typeof input.id !== "string" || !deleteDraft(user, input.id)) throw new Error("Draft not found."); break;
      case "add-assisted": addAssisted(user, input.item); break;
      case "set-assisted-status": if (typeof input.id !== "string" || !setAssistedStatus(user, input.id, input.status)) throw new Error("Assisted item not found."); break;
      case "mark-assisted-notified": markAssistedNotified(user, input.ids); break;
      case "delete-assisted": if (typeof input.id !== "string" || !deleteAssisted(user, input.id)) throw new Error("Assisted item not found."); break;
      case "migrate-assisted": assistedMigration = migrateAssisted(user, input.items); break;
      case "add-schedule": addSchedule(user, input.item, input.timezone); break;
      case "delete-schedule": if (typeof input.id !== "string" || !deleteSchedule(user, input.id)) throw new Error("Plan item not found or currently running."); break;
      case "retry-schedule": if (typeof input.id !== "string" || !retrySchedule(user, input.id)) throw new Error("Failed item not found."); break;
      case "import": importLibrary(user, input.backup); break;
      case "import-legacy": importLegacyLibrary(user, input.backup); break;
      default: throw new Error("Unknown action.");
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update workspace." }, { status: 400 });
  }
  return NextResponse.json({ ...listWorkspace(user), ...(assistedMigration ? { assistedMigration } : {}) }, { headers: { "Cache-Control": "no-store" } });
}
