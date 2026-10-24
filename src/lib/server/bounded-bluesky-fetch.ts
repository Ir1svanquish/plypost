/** Bound untrusted AT Protocol metadata and OAuth responses before SDK schema validation. */
export const MAX_BLUESKY_RESPONSE_BYTES = 256 * 1024;

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
    const limited = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > maxBytes) {
          controller.error(new Error("Bluesky response exceeded the allowed size."));
          return;
        }
        controller.enqueue(chunk);
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
