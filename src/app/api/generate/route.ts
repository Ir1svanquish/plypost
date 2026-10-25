import { NextResponse } from "next/server";
import { parseGeneratedVariants } from "@/lib/generated-variants";
import { variantMessages } from "@/lib/ai-prompts";
import { characterCount } from "@/lib/platforms";
import { currentUser, sameOrigin } from "@/lib/server/auth";
import { modelRequestOptions, providerConfig } from "@/lib/server/ai-provider";
import { reserveAiRequest } from "@/lib/server/workspace";
import { readBoundedJsonObject } from "@/lib/server/bounded-json";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const user = currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  const body = await readBoundedJsonObject(request, 16_000);
  if (body.kind === "too-large") return NextResponse.json({ error: "Request is too large." }, { status: 413 });
  if (body.kind === "invalid") return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });

  const input = body.value;
  const source = typeof input.source === "string" ? input.source.trim() : "";
  const provider = input.provider;
  if (!source || characterCount(source) > 3000 || (provider !== "nebius" && provider !== "nvidia")) {
    return NextResponse.json(
      { error: "Enter up to 3,000 characters and choose Nebius or NVIDIA." },
      { status: 400 },
    );
  }

  const config = providerConfig(provider);
  if (!config.key) {
    return NextResponse.json(
      { error: `Configure ${provider === "nebius" ? "NEBIUS_API_KEY" : "NVIDIA_API_KEY"} in .env.local to enable AI adaptation.` },
      { status: 503 },
    );
  }

  const quota = reserveAiRequest(user);
  if (!quota.allowed) return NextResponse.json({ error: quota.error }, { status: quota.status });

  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages: variantMessages(source),
        temperature: 0.2,
        max_tokens: 1200,
        stream: false,
        ...modelRequestOptions(config.model),
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
    const parsed = typeof content === "string" ? parseGeneratedVariants(content) : null;
    if (!parsed) {
      return NextResponse.json(
        { error: "The model did not return four usable drafts. Please try again." },
        { status: 502 },
      );
    }

    return NextResponse.json(
      { provider, ...parsed },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "The model request timed out or could not be completed." },
      { status: 502 },
    );
  }
}
