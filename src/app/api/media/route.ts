import { NextResponse } from "next/server";
import { currentUser, sameOrigin } from "@/lib/server/auth";
import { createMedia, listMedia, MAX_IMAGE_BYTES, MediaError } from "@/lib/server/media";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + 256 * 1024;
const noStore = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

async function boundedBody(request: Request): Promise<Buffer> {
  const claimedLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(claimedLength) && claimedLength > MAX_REQUEST_BYTES) throw new MediaError("Upload request exceeds 5 MiB.", 413);
  if (!request.body) throw new MediaError("Upload is empty.");
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new MediaError("Upload request exceeds 5 MiB.", 413);
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

export async function GET(request: Request) {
  const user = currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401, headers: noStore });
  return NextResponse.json({ media: listMedia(user) }, { headers: noStore });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStore });
  const user = currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401, headers: noStore });
  const contentType = request.headers.get("content-type") || "";
  if (!/^multipart\/form-data;\s*boundary=/i.test(contentType)) {
    return NextResponse.json({ error: "Upload one image as multipart form data." }, { status: 415, headers: noStore });
  }
  try {
    const body = await boundedBody(request);
    const multipart = new Request(request.url, { method: "POST", headers: { "Content-Type": contentType }, body: new Uint8Array(body) });
    const form = await multipart.formData();
    const entries = [...form.entries()];
    if (entries.length !== 1 || entries[0][0] !== "file" || !(entries[0][1] instanceof File)) {
      throw new MediaError("Upload exactly one image in the file field.");
    }
    const file = entries[0][1] as File;
    if (file.size > MAX_IMAGE_BYTES) throw new MediaError("Image must be no larger than 5 MiB.", 413);
    const result = await createMedia(user, { name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) });
    return NextResponse.json({ media: result.media }, { status: result.created ? 201 : 200, headers: noStore });
  } catch (error) {
    const known = error instanceof MediaError;
    return NextResponse.json({ error: known ? error.message : "Invalid image upload." }, { status: known ? error.status : 400, headers: noStore });
  }
}
