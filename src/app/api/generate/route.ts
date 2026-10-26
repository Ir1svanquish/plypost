import { NextResponse } from "next/server";
import { parseGeneratedVariants } from "@/lib/generated-variants";
import { variantMessages } from "@/lib/ai-prompts";
import { characterCount, isPlatformId, platformDisplayIds } from "@/lib/platforms";
import { currentUser, sameOrigin } from "@/lib/server/auth";
import { modelRequestOptions, nebiusConfig, readNebiusContent } from "@/lib/server/ai-provider";
import { reserveAiRequest } from "@/lib/server/workspace";
import { loadVoiceProfile } from "@/lib/server/voice-profile";
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
  if (!source || characterCount(source) > 3000 || (input.provider !== undefined && input.provider !== "nebius") ||
      (input.useVoice !== undefined && typeof input.useVoice !== "boolean") ||
      input.referenceGuide !== undefined) {
    return NextResponse.json(
      { error: "Enter up to 3,000 characters. Nebius Token Factory is the only AI provider." },
      { status: 400 },
    );
  }
  if (input.platforms !== undefined && (!Array.isArray(input.platforms) || input.platforms.length < 1 ||
      input.platforms.length > platformDisplayIds.length || !input.platforms.every(isPlatformId) ||
      new Set(input.platforms).size !== input.platforms.length)) {
    return NextResponse.json({ error: "Choose one to four supported platforms." }, { status: 400 });
  }
  const requestedInput = input.platforms as string[] | undefined;
  const requested = requestedInput === undefined ? platformDisplayIds :
    platformDisplayIds.filter((id) => requestedInput.includes(id));
  const voice = input.useVoice ? loadVoiceProfile(user)?.guide : undefined;
  if (input.useVoice && !voice) return NextResponse.json({ error: "Analyze your writing style first, or turn off the voice guide." }, { status: 400 });

  const config = nebiusConfig();
  if (!config.key) {
    return NextResponse.json(
      { error: "Set NEBIUS_API_KEY on the server to enable AI adaptation." },
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
        messages: variantMessages(source, voice, requested),
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
        { error: `The Nebius request failed (HTTP ${response.status}). Check your key, model and quota.` },
        { status: 502 },
      );
    }

    const content = await readNebiusContent(response);
    const parsed = content ? parseGeneratedVariants(content, requested) : null;
    if (!parsed) {
      return NextResponse.json(
        { error: "The model did not return usable drafts for the selected platforms. Please try again." },
        { status: 502 },
      );
    }

    return NextResponse.json(
      { provider: "nebius", ...parsed },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "The model request timed out or could not be completed." },
      { status: 502 },
    );
  }
}
