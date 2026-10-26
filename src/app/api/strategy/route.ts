import { NextResponse } from "next/server";
import { planMessages } from "@/lib/ai-prompts";
import { parseBrandBrief, parseGeneratedIdeas, validWeekStart, type BrandBrief } from "@/lib/strategy";
import { currentUser, sameOrigin } from "@/lib/server/auth";
import { modelRequestOptions, nebiusConfig } from "@/lib/server/ai-provider";
import {
  approveStrategyIdea, createWeeklyPlan, dismissStrategyIdea, listStrategy, loadBrandBrief,
  saveBrandBriefIfCurrent, StrategyConflictError, updateStrategyIdea,
} from "@/lib/server/strategy";
import { reserveAiRequest } from "@/lib/server/workspace";
import { readBoundedJsonObject } from "@/lib/server/bounded-json";

export const runtime = "nodejs";

const responseHeaders = { "Cache-Control": "no-store" };

function reviewedIdea(input: Record<string, unknown>): Record<string, unknown> {
  const idea = input.expectedIdea;
  if (!idea || typeof idea !== "object" || Array.isArray(idea)) {
    throw new Error("Reload the idea before changing it.");
  }
  return idea as Record<string, unknown>;
}

function reviewedBriefVersion(input: Record<string, unknown>): string | null {
  const expected = input.expectedUpdatedAt;
  if (!Object.hasOwn(input, "expectedUpdatedAt") ||
      (expected !== null && (typeof expected !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(expected) ||
        !Number.isFinite(Date.parse(expected)) || new Date(expected).toISOString() !== expected))) {
    throw new Error("Reload the brand profile before continuing.");
  }
  return expected as string | null;
}

function reviewedBrief(input: Record<string, unknown>): BrandBrief {
  const expected = parseBrandBrief(input.expectedBrief);
  if (!expected) throw new Error("Reload the brand profile before generating ideas.");
  return expected;
}

async function generate(user: string, weekStart: string, expectedBrief: BrandBrief) {
  if (!validWeekStart(weekStart)) {
    return NextResponse.json({ error: "Choose a valid Monday date." }, { status: 400 });
  }
  const brief = loadBrandBrief(user);
  if (!brief) return NextResponse.json({ error: "Save a brand brief before generating a weekly plan." }, { status: 400 });
  if (JSON.stringify(brief) !== JSON.stringify(expectedBrief)) {
    return NextResponse.json({ ...listStrategy(user), error: "Brand profile changed in another window. Review the latest version before generating ideas." },
      { status: 409, headers: responseHeaders });
  }
  const config = nebiusConfig();
  if (!config.key) {
    return NextResponse.json({
      error: "Set NEBIUS_API_KEY on the server to enable AI planning.",
    }, { status: 503 });
  }
  const quota = reserveAiRequest(user);
  if (!quota.allowed) return NextResponse.json({ error: quota.error }, { status: quota.status });
  try {
    // The user approved sending these eight saved brief fields on this explicit Generate action.
    // The date and self-reported outcomes remain local; they are not included in the request.
    const approvedBriefFields = {
      brandName: brief.brandName, description: brief.description, audience: brief.audience,
      goal: brief.goal, voice: brief.voice, facts: brief.facts,
      contentPillars: brief.contentPillars, platforms: brief.platforms,
    };
    const response = await fetch(config.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: planMessages(approvedBriefFields),
        temperature: 0.5,
        max_tokens: 2000,
        stream: false,
        ...modelRequestOptions(config.model),
      }),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    if (!response.ok) {
      return NextResponse.json({
        error: `The Nebius request failed (HTTP ${response.status}). Check the key, model and quota.`,
      }, { status: 502 });
    }
    const data: unknown = await response.json();
    const content = (data as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
    const ideas = typeof content === "string" ? parseGeneratedIdeas(content, brief.platforms) : null;
    if (!ideas) return NextResponse.json({ error: "The model did not return a usable plan. Please try again." }, { status: 502 });
    createWeeklyPlan(user, brief, "nebius", weekStart, ideas);
    return NextResponse.json(listStrategy(user), { headers: responseHeaders });
  } catch (error) {
    if (error instanceof StrategyConflictError) {
      return NextResponse.json({ ...listStrategy(user), error: error.message }, { status: 409, headers: responseHeaders });
    }
    return NextResponse.json({ error: "The model request timed out or could not be completed." }, { status: 502 });
  }
}

export async function GET(request: Request) {
  const user = currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  return NextResponse.json(listStrategy(user), { headers: responseHeaders });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const user = currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  const body = await readBoundedJsonObject(request, 48_000, 16_000);
  if (body.kind === "too-large") return NextResponse.json({ error: "Request is too large." }, { status: 413 });
  if (body.kind === "invalid") return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  const input = body.value;
  try {
    switch (input.action) {
      case "save-brief": {
        const expected = reviewedBriefVersion(input);
        saveBrandBriefIfCurrent(user, input.brief, expected);
        break;
      }
      case "update-idea":
        updateStrategyIdea(user, input.planId, input.ideaId, input.patch, reviewedIdea(input));
        break;
      case "approve-idea": {
        const draft = approveStrategyIdea(user, input.planId, input.ideaId, reviewedIdea(input));
        return NextResponse.json({ ...listStrategy(user), draft }, { headers: responseHeaders });
      }
      case "dismiss-idea":
        dismissStrategyIdea(user, input.planId, input.ideaId, reviewedIdea(input));
        break;
      case "generate":
        if (input.provider !== undefined && input.provider !== "nebius") {
          return NextResponse.json({ error: "Nebius Token Factory is the only AI provider." }, { status: 400 });
        }
        return generate(user, input.weekStart as string, reviewedBrief(input));
      default:
        throw new Error("Unknown strategy action.");
    }
    return NextResponse.json(listStrategy(user), { headers: responseHeaders });
  } catch (error) {
    if (error instanceof StrategyConflictError) {
      return NextResponse.json({ ...listStrategy(user), error: error.message }, { status: 409, headers: responseHeaders });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update strategy." }, { status: 400 });
  }
}
