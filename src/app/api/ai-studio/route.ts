import sharp from "sharp";
import { NextResponse } from "next/server";
import { imageCaptionMessages, styleAnalysisMessages } from "@/lib/ai-prompts";
import { parseExamples, parseGuide, parseGuideResponse, parseImageCaptionResponse } from "@/lib/ai-studio";
import { currentUser, sameOrigin } from "@/lib/server/auth";
import { modelRequestOptions, nebiusConfig } from "@/lib/server/ai-provider";
import { readBoundedJsonObject } from "@/lib/server/bounded-json";
import { getMedia } from "@/lib/server/media";
import { loadVoiceProfile, saveVoiceProfile, deleteVoiceProfile } from "@/lib/server/voice-profile";
import { reserveAiRequest } from "@/lib/server/workspace";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
const VISION_MODEL = "nvidia/Nemotron-3.5-Super-VL";

async function completion(key: string, model: string, messages: ReturnType<typeof styleAnalysisMessages> | ReturnType<typeof imageCaptionMessages>, maxTokens: number) {
  const response = await fetch("https://api.tokenfactory.nebius.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: maxTokens, stream: false,
      ...(model === VISION_MODEL ? {} : modelRequestOptions(model)) }),
    signal: AbortSignal.timeout(45_000), cache: "no-store",
  });
  if (!response.ok) throw new Error(`Nebius returned HTTP ${response.status}. Check the model and quota.`);
  const data: unknown = await response.json();
  const content = (data as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("Nebius returned no usable text.");
  return content;
}

export async function GET(request: Request) {
  const user = currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401, headers });
  return NextResponse.json({ voiceProfile: loadVoiceProfile(user) }, { headers });
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers });
  const user = currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401, headers });
  deleteVoiceProfile(user);
  return NextResponse.json({ voiceProfile: null }, { headers });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers });
  const user = currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401, headers });
  const body = await readBoundedJsonObject(request, 20_000, 18_000);
  if (body.kind === "too-large") return NextResponse.json({ error: "Request is too large." }, { status: 413, headers });
  if (body.kind === "invalid") return NextResponse.json({ error: "Invalid JSON body." }, { status: 400, headers });
  const input = body.value;
  const action = input.action;
  const isPersonal = action === "analyze-style";
  const isReference = action === "analyze-references";
  const isCaption = action === "caption-image";
  if (!isPersonal && !isReference && !isCaption) {
    return NextResponse.json({ error: "Unknown AI action." }, { status: 400, headers });
  }
  const examples = isPersonal || isReference ? parseExamples(input.examples, isPersonal ? 3 : 2, isPersonal ? 6 : 5) : null;
  const media = isCaption && typeof input.mediaId === "string" ? getMedia(user, input.mediaId) : null;
  const context = isCaption && typeof input.context === "string" ? input.context.trim() : "";
  const useVoice = input.useVoice === true;
  const referenceGuide = input.referenceGuide === undefined || input.referenceGuide === null || input.referenceGuide === ""
    ? null : parseGuide(input.referenceGuide);
  if ((isPersonal || isReference) && !examples) {
    return NextResponse.json({ error: `Choose ${isPersonal ? "3–6" : "2–5"} examples, each under 1,800 characters.` }, { status: 400, headers });
  }
  if (isCaption && (!media || Array.from(context).length > 500 ||
      (input.useVoice !== undefined && typeof input.useVoice !== "boolean") ||
      (input.referenceGuide && !referenceGuide))) {
    return NextResponse.json({ error: "Choose one image from your library and keep context under 500 characters." }, { status: 400, headers });
  }
  const config = nebiusConfig();
  if (!config.key) return NextResponse.json({ error: "Set NEBIUS_API_KEY on the server to enable AI." }, { status: 503, headers });
  const quota = reserveAiRequest(user);
  if (!quota.allowed) return NextResponse.json({ error: quota.error }, { status: quota.status, headers });
  try {
    if (isCaption && media) {
      // Images in the private library have already been re-encoded without EXIF. Downsize again for inference.
      const pixels = await sharp(media.bytes).resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 }).toBuffer();
      const imageDataUrl = `data:image/jpeg;base64,${pixels.toString("base64")}`;
      const raw = await completion(config.key, VISION_MODEL,
        imageCaptionMessages(imageDataUrl, context, useVoice ? loadVoiceProfile(user)?.guide ?? null : null, referenceGuide), 700);
      const suggestion = parseImageCaptionResponse(raw);
      if (!suggestion) throw new Error("The vision model did not return a usable caption. Try another image.");
      return NextResponse.json({ ...suggestion, model: VISION_MODEL }, { headers });
    }
    const raw = await completion(config.key, config.model,
      styleAnalysisMessages(examples!, isPersonal ? "personal" : "reference"), 500);
    const guide = parseGuideResponse(raw);
    if (!guide) throw new Error("The model did not return a usable style guide. Try shorter examples.");
    if (isPersonal) return NextResponse.json({ voiceProfile: saveVoiceProfile(user, guide) }, { headers });
    return NextResponse.json({ referenceGuide: guide }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The AI request failed." }, { status: 502, headers });
  }
}
