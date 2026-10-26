import { currentUser, sameOrigin } from "@/lib/server/auth";
import { BackupError, streamPortableBackup, importPortableBackup } from "@/lib/server/portable-backup";
import { parsePortableBackupRequest } from "@/lib/server/portable-backup-stream";

export const runtime = "nodejs";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
};
let backupOperationActive = false;

function busyResponse() {
  return Response.json({ error: "Another full backup is in progress. Try again when it finishes." },
    { status: 409, headers: privateHeaders });
}

function releaseAfterDownload(source: ReadableStream<Uint8Array>, release: () => void) {
  const reader = source.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) { release(); controller.close(); }
        else controller.enqueue(next.value);
      } catch (error) { release(); controller.error(error); }
    },
    async cancel(reason) {
      try { await reader.cancel(reason); }
      finally { release(); }
    },
  }, { highWaterMark: 0 });
}

export async function GET(request: Request) {
  const user = currentUser(request);
  if (!user) return Response.json({ error: "Sign in to continue." }, { status: 401, headers: privateHeaders });
  if (backupOperationActive) return busyResponse();
  backupOperationActive = true;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    backupOperationActive = false;
    request.signal.removeEventListener("abort", release);
  };
  request.signal.addEventListener("abort", release, { once: true });
  if (request.signal.aborted) {
    release();
    return Response.json({ error: "Backup request was cancelled." }, { status: 400, headers: privateHeaders });
  }
  try {
    const backup = releaseAfterDownload(streamPortableBackup(user), release);
    const date = new Date().toISOString().slice(0, 10);
    return new Response(backup, {
      headers: {
        ...privateHeaders,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="plypost-portable-${date}.json"`,
      },
    });
  } catch (error) {
    release();
    if (error instanceof BackupError) {
      return Response.json({ error: error.message }, { status: error.status, headers: privateHeaders });
    }
    return Response.json({ error: "Could not export backup." }, { status: 500, headers: privateHeaders });
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403, headers: privateHeaders });
  const user = currentUser(request);
  if (!user) return Response.json({ error: "Sign in to continue." }, { status: 401, headers: privateHeaders });
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) {
    return Response.json({ error: "Upload a Plypost portable JSON backup." }, { status: 415, headers: privateHeaders });
  }
  if (backupOperationActive) return busyResponse();
  backupOperationActive = true;
  try {
    const raw = await parsePortableBackupRequest(request);
    const restored = await importPortableBackup(user, raw);
    return Response.json({ restored }, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof BackupError) {
      return Response.json({ error: error.message }, { status: error.status, headers: privateHeaders });
    }
    return Response.json({ error: "Could not import backup." }, { status: 500, headers: privateHeaders });
  } finally { backupOperationActive = false; }
}
