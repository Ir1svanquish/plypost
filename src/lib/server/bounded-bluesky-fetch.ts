/** Bound untrusted AT Protocol metadata and OAuth responses before SDK schema validation. */
export const MAX_BLUESKY_RESPONSE_BYTES = 256 * 1024;
export const MAX_BLUESKY_JSON_ARRAY_ITEMS = 256;
const MAX_BLUESKY_JSON_NODES = 4096;

function checkJsonShape(chunks: Uint8Array[]): void {
  const body = Buffer.concat(chunks).toString("utf8").trimStart();
  if (!body.startsWith("{") && !body.startsWith("[")) return;
  let root: unknown;
  try { root = JSON.parse(body); }
  catch { return; } // The SDK will report malformed JSON as usual.
  const pending: unknown[] = [root];
  let visited = 0;
  while (pending.length) {
    if (++visited > MAX_BLUESKY_JSON_NODES) throw new Error("Bluesky response contains too many JSON values.");
    const value = pending.pop();
    if (Array.isArray(value)) {
      if (value.length > MAX_BLUESKY_JSON_ARRAY_ITEMS) throw new Error("Bluesky response contains too many array items.");
      for (const item of value) pending.push(item);
    } else if (value && typeof value === "object") {
      for (const item of Object.values(value)) pending.push(item);
    }
  }
}

export function limitBlueskyResponseBytes(fetcher: typeof fetch, maxBytes = MAX_BLUESKY_RESPONSE_BYTES): typeof fetch {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError("Invalid Bluesky response limit.");
  return async (input, init) => {
    const response = await fetcher(input, init);
    if (!response.body) return response;
    const declared = response.headers.get("content-length");
    if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
      await response.body.cancel().catch(() => {});
      throw new Error("Bluesky response exceeded the allowed size.");
    }
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    const limited = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > maxBytes) {
          controller.error(new Error("Bluesky response exceeded the allowed size."));
          return;
        }
        chunks.push(chunk);
      },
      flush(controller) {
        checkJsonShape(chunks);
        for (const chunk of chunks) controller.enqueue(chunk);
      },
    }));
    const safe = new Response(limited, response);
    // Response(url) is otherwise reset by the constructor. Keep metadata used
    // by SDK callers while replacing only the body stream.
    Object.defineProperties(safe, {
      url: { value: response.url },
      redirected: { value: response.redirected },
      type: { value: response.type },
    });
    return safe;
  };
}

export const boundedBlueskyFetch = limitBlueskyResponseBytes(globalThis.fetch);
