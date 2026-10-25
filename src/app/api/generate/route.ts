import { NextResponse } from "next/server";
import { parseGeneratedVariants } from "@/lib/generated-variants";
import { variantMessages } from "@/lib/ai-prompts";
import { characterCount } from "@/lib/platforms";
import { currentUser, sameOrigin } from "@/lib/server/auth";
import { modelRequestOptions, providerConfig } from "@/lib/server/ai-provider";
import { aiRateAllowed } from "@/lib/server/workspace";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const user = currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
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
  if (!config.key) {
    return NextResponse.json(
      { error: `Configure ${provider === "nebius" ? "NEBIUS_API_KEY" : "NVIDIA_API_KEY"} in .env.local to enable AI adaptation.` },
      { status: 503 },
    );
  }

  if (!aiRateAllowed(user)) {
    return NextResponse.json({ error: "AI limit reached: 10 requests per hour. Try again later." }, { status: 429 });
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
