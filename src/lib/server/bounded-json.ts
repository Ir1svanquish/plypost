type BoundedJsonResult =
  | { kind: "ok"; value: Record<string, unknown> }
  | { kind: "too-large" }
  | { kind: "invalid" };

export async function readBoundedJsonObject(request: Pick<Request, "headers" | "body">, maxBytes: number, maxCharacters?: number): Promise<BoundedJsonResult> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > maxBytes) {
    await request.body?.cancel().catch(() => undefined);
    return { kind: "too-large" };
  }
  if (!request.body) return { kind: "invalid" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { kind: "too-large" };
      }
      chunks.push(value);
    }
  } catch {
    return { kind: "invalid" };
  } finally {
    reader.releaseLock();
  }

  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (maxCharacters !== undefined && raw.length > maxCharacters) return { kind: "too-large" };
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? { kind: "ok", value: value as Record<string, unknown> }
      : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}
