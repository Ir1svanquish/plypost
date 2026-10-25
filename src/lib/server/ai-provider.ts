export type AIProvider = "nebius" | "nvidia";

// This NVIDIA open model is available through Nebius Token Factory's inference API.
export const DEFAULT_NEBIUS_MODEL = "nvidia/nemotron-3-super-120b-a12b";

export function providerConfig(provider: AIProvider) {
  if (provider === "nebius") return {
    key: process.env.NEBIUS_API_KEY?.trim(),
    model: process.env.NEBIUS_MODEL?.trim() || DEFAULT_NEBIUS_MODEL,
    url: "https://api.tokenfactory.nebius.com/v1/chat/completions",
  };
  return {
    key: process.env.NVIDIA_API_KEY?.trim(),
    model: process.env.NVIDIA_MODEL?.trim() || DEFAULT_NEBIUS_MODEL,
    url: "https://integrate.api.nvidia.com/v1/chat/completions",
  };
}

export function modelRequestOptions(model: string) {
  return /nemotron/i.test(model) ? { chat_template_kwargs: { enable_thinking: false } } : {};
}
