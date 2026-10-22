import { NextResponse } from "next/server";
import { characterCount, platformIds, platforms, type PlatformId } from "@/lib/platforms";

export const runtime = "nodejs";

type Provider = "nebius" | "nvidia";

function providerConfig(provider: Provider) {
  if (provider === "nebius") {
    return {
      key: process.env.NEBIUS_API_KEY,
      model: process.env.NEBIUS_MODEL,
      url: "https://api.tokenfactory.nebius.com/v1/chat/completions",
    };
  }
  return {
    key: process.env.NVIDIA_API_KEY,
    model: process.env.NVIDIA_MODEL || "nvidia/nemotron-3-super-120b-a12b",
    url: "https://integrate.api.nvidia.com/v1/chat/completions",
  };
}

function parseVariants(content: string): Record<PlatformId, string> | null {
  const json = content.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const value: unknown = JSON.parse(json);
    if (!value || typeof value !== "object") return null;
    const variants = {} as Record<PlatformId, string>;
    for (const platform of platformIds) {
      const text = (value as Record<string, unknown>)[platform];
      if (typeof text !== "string" || !text.trim() || characterCount(text) > 5000) return null;
      variants[platform] = text.trim();
    }
    return variants;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "A source draft is required." }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  const source = typeof input.source === "string" ? input.source.trim() : "";
  const provider = input.provider;
  if (!source || characterCount(source) > 3000 || (provider !== "nebius" && provider !== "nvidia")) {
    return NextResponse.json(
      { error: "Enter up to 3,000 characters and choose Nebius or NVIDIA." },
      { status: 400 },
    );
  }

  const config = providerConfig(provider);
  if (!config.key || !config.model) {
    return NextResponse.json(
      { error: `Configure ${provider === "nebius" ? "NEBIUS_API_KEY and NEBIUS_MODEL" : "NVIDIA_API_KEY"} in .env.local to enable AI adaptation.` },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: "system",
            content: `You are a social media editor. Rewrite the user's draft into four distinct platform-native posts. Preserve facts, claims, URLs and intent. Do not invent details. Return ONLY a JSON object with string keys bluesky, mastodon, linkedin and threads. Bluesky: concise, at most ${platforms.bluesky.limit} characters. Mastodon: clear context, at most ${platforms.mastodon.limit} characters. LinkedIn: professional and readable, at most ${platforms.linkedin.limit} characters. Threads: conversational, at most ${platforms.threads.limit} characters. Do not add markdown fences.`,
          },
          { role: "user", content: source },
        ],
        temperature: 0.6,
        max_tokens: 1200,
        stream: false,
        ...(provider === "nvidia" ? { chat_template_kwargs: { enable_thinking: false } } : {}),
      }),
      signal: AbortSignal.timeout(30000),
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `The ${provider === "nebius" ? "Nebius" : "NVIDIA"} request failed (HTTP ${response.status}). Check your key, model and quota.` },
        { status: 502 },
      );
    }

    const data: unknown = await response.json();
    const content = (data as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
    const variants = typeof content === "string" ? parseVariants(content) : null;
    if (!variants) {
      return NextResponse.json(
        { error: "The model did not return four usable drafts. Please try again." },
        { status: 502 },
      );
    }

    return NextResponse.json(
      { provider, variants },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "The model request timed out or could not be completed." },
      { status: 502 },
    );
  }
}
