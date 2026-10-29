import { NextResponse } from "next/server";
import { isManualAiDestination, manualHandoffMessages, parseManualHandoffSuggestion } from "@/lib/ai-handoff";
import { characterCount } from "@/lib/platforms";
import { isStandaloneQuestion } from "@/lib/ai-studio";
import { currentUser, sameOrigin } from "@/lib/server/auth";
import { modelRequestOptions, nebiusConfig, readNebiusContent } from "@/lib/server/ai-provider";
import { readBoundedJsonObject } from "@/lib/server/bounded-json";
import { reserveAiRequest } from "@/lib/server/workspace";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const user = currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });

  const body = await readBoundedJsonObject(request, 24_000);
  if (body.kind === "too-large") return NextResponse.json({ error: "Request is too large." }, { status: 413 });
  if (body.kind === "invalid") return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  const { destination, source } = body.value;
  if (!isManualAiDestination(destination) || typeof source !== "string" || !source.trim() ||
      characterCount(source.trim()) > 5000) {
    return NextResponse.json({ error: "Choose a supported manual platform and enter up to 5,000 characters." }, { status: 400 });
  }

  const config = nebiusConfig();
  if (!config.key) return NextResponse.json({ error: "Set NEBIUS_API_KEY on the server to enable AI adaptation." }, { status: 503 });
  const quota = reserveAiRequest(user);
  if (!quota.allowed) return NextResponse.json({ error: quota.error }, { status: quota.status });

  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: manualHandoffMessages(source.trim(), destination),
        temperature: 0.2,
        max_tokens: 1200,
        stream: false,
        ...modelRequestOptions(config.model),
      }),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    if (!response.ok) return NextResponse.json({ error: `The Nebius request failed (HTTP ${response.status}). Check your key, model and quota.` }, { status: 502 });
    const content = await readNebiusContent(response);
    const suggestion = content ? parseManualHandoffSuggestion(content) : null;
    if (!suggestion) return NextResponse.json({ error: "The model did not return a usable draft. Please try again." }, { status: 502 });
    if (isStandaloneQuestion(source) && !isStandaloneQuestion(suggestion)) {
      return NextResponse.json({ error: "The model answered your question instead of rewriting it. Your text was kept. Try again or edit it yourself." }, { status: 502 });
    }
    return NextResponse.json({ destination, suggestion }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "The model request timed out or could not be completed." }, { status: 502 });
  }
}
