import { readBoundedJsonObject } from "./bounded-json";

// This NVIDIA open model is available through Nebius Token Factory's inference API.
export const DEFAULT_NEBIUS_MODEL = "nvidia/nemotron-3-super-120b-a12b";
const MAX_NEBIUS_RESPONSE_BYTES = 256_000;

/** Model output is short; do not buffer an unbounded upstream JSON response. */
export async function readNebiusContent(response: Response): Promise<string | null> {
  const result = await readBoundedJsonObject(response, MAX_NEBIUS_RESPONSE_BYTES);
  if (result.kind !== "ok") return null;
  const choices = result.value.choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return null;
  const message = (choices[0] as { message?: unknown }).message;
  if (!message || typeof message !== "object") return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

export function nebiusConfig() {
  return {
    key: process.env.NEBIUS_API_KEY?.trim(),
    model: DEFAULT_NEBIUS_MODEL,
    url: "https://api.tokenfactory.nebius.com/v1/chat/completions",
  };
}

export function modelRequestOptions(model: string) {
  return /nemotron/i.test(model) ? { chat_template_kwargs: { enable_thinking: false } } : {};
}
