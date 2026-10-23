import { currentUser, sameOrigin } from "@/lib/server/auth";
import { BackupError, exportPortableBackup, importPortableBackup, MAX_PORTABLE_BACKUP_BYTES } from "@/lib/server/portable-backup";

export const runtime = "nodejs";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
};

async function readBoundedJson(request: Request): Promise<unknown> {
  const claimedLength = request.headers.get("content-length");
  if (claimedLength && /^\d+$/.test(claimedLength) && Number(claimedLength) > MAX_PORTABLE_BACKUP_BYTES) {
    throw new BackupError("Backup exceeds the 128 MiB portable archive limit.", 413);
  }
  if (!request.body) throw new BackupError("Backup file is empty.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PORTABLE_BACKUP_BYTES) {
        await reader.cancel();
        throw new BackupError("Backup exceeds the 128 MiB portable archive limit.", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!total) throw new BackupError("Backup file is empty.");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new BackupError("Backup is not valid UTF-8 JSON."); }
}

export async function GET(request: Request) {
  const user = currentUser(request);
  if (!user) return Response.json({ error: "Sign in to continue." }, { status: 401, headers: privateHeaders });
  try {
    const backup = exportPortableBackup(user);
    const date = new Date().toISOString().slice(0, 10);
    return new Response(backup, {
      headers: {
        ...privateHeaders,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="plypost-portable-${date}.json"`,
      },
    });
  } catch (error) {
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
  try {
    const raw = await readBoundedJson(request);
    const restored = await importPortableBackup(user, raw);
    return Response.json({ restored }, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof BackupError) {
      return Response.json({ error: error.message }, { status: error.status, headers: privateHeaders });
    }
    return Response.json({ error: "Could not import backup." }, { status: 500, headers: privateHeaders });
  }
}
