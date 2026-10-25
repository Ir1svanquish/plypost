import sharp from "sharp";
import { NextResponse } from "next/server";
import { draftFromNotesMessages, imageCaptionMessages, styleAnalysisMessages } from "@/lib/ai-prompts";
import { isCaptionStyleId } from "@/lib/caption-styles";
import { isStandaloneQuestion, parseDraftFromNotesResponse, parseExamples, parseGuide, parseGuideResponse, parseImageCaptionResponse, repeatsLongExcerpt } from "@/lib/ai-studio";
import { currentUser, sameOrigin } from "@/lib/server/auth";
import { modelRequestOptions, nebiusConfig } from "@/lib/server/ai-provider";
import { readBoundedJsonObject } from "@/lib/server/bounded-json";
import { getMedia } from "@/lib/server/media";
import { loadVoiceProfile, saveVoiceProfile, deleteVoiceProfile } from "@/lib/server/voice-profile";
import { reserveAiRequest } from "@/lib/server/workspace";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
const VISION_MODEL = "nvidia/Nemotron-3.5-Super-VL";

async function completion(key: string, model: string, messages: ReturnType<typeof styleAnalysisMessages> | ReturnType<typeof imageCaptionMessages> | ReturnType<typeof draftFromNotesMessages>, maxTokens: number) {
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

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers });
  const user = currentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401, headers });
  const body = await readBoundedJsonObject(request, 2_000);
  if (body.kind === "too-large") return NextResponse.json({ error: "Request is too large." }, { status: 413, headers });
  if (body.kind === "invalid") return NextResponse.json({ error: "Invalid JSON body." }, { status: 400, headers });
  const guide = parseGuide(body.value.guide);
  if (!guide || !loadVoiceProfile(user)) return NextResponse.json({ error: "Choose a saved style guide under 1,000 characters." }, { status: 400, headers });
  return NextResponse.json({ voiceProfile: saveVoiceProfile(user, guide) }, { headers });
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
  const isCaption = action === "caption-image";
  const isDraft = action === "draft-from-notes";
  if ((!isPersonal && !isCaption && !isDraft) || input.referenceGuide !== undefined) {
    return NextResponse.json({ error: "Unknown AI action." }, { status: 400, headers });
  }
  const examples = isPersonal ? parseExamples(input.examples, 3, 6) : null;
  const media = isCaption && typeof input.mediaId === "string" ? getMedia(user, input.mediaId) : null;
  const context = isCaption && typeof input.context === "string" ? input.context.trim() : "";
  const notes = isDraft && typeof input.notes === "string" ? input.notes.trim() : "";
  const style = isCaptionStyleId(input.style) ? input.style : (input.useVoice === true ? "personal" : "default");
  const styleValid = (input.style === undefined || isCaptionStyleId(input.style)) &&
    (input.useVoice === undefined || (typeof input.useVoice === "boolean" && input.useVoice === (style === "personal")));
  const useVoice = style === "personal";
  if (isPersonal && !examples) {
    return NextResponse.json({ error: "Choose 3–6 examples, each under 1,800 characters." }, { status: 400, headers });
  }
  if ((isCaption || isDraft) && !styleValid) {
    return NextResponse.json({ error: "Choose a supported caption style." }, { status: 400, headers });
  }
  if (isCaption && (!media || Array.from(context).length > 3000)) {
    return NextResponse.json({ error: "Choose one image from your library and keep notes under 3,000 characters." }, { status: 400, headers });
  }
  if (isDraft && (!notes || Array.from(notes).length > 3000)) {
    return NextResponse.json({ error: "Write up to 3,000 characters of notes first." }, { status: 400, headers });
  }
  const voiceProfile = (isCaption || isDraft) && useVoice ? loadVoiceProfile(user) : null;
  if ((isCaption || isDraft) && useVoice && !voiceProfile) {
    return NextResponse.json({ error: "Analyze your writing style first, or turn off the voice guide." }, { status: 400, headers });
  }
  const config = nebiusConfig();
  if (!config.key) return NextResponse.json({ error: "Set NEBIUS_API_KEY on the server to enable AI." }, { status: 503, headers });
  const quota = reserveAiRequest(user);
  if (!quota.allowed) return NextResponse.json({ error: quota.error }, { status: quota.status, headers });
  try {
    if (isDraft) {
      const raw = await completion(config.key, config.model,
        draftFromNotesMessages(notes, style, voiceProfile?.guide), 700);
      const draft = parseDraftFromNotesResponse(raw);
      if (!draft) throw new Error("The model did not return a usable post. Try shorter notes.");
      if (isStandaloneQuestion(notes) && !isStandaloneQuestion(draft)) {
        throw new Error("The model added an unsupported answer to your question. Keep the question as written or add facts and try again.");
      }
      return NextResponse.json({ draft, model: config.model }, { headers });
    }
    if (isCaption && media) {
      // Images in the private library have already been re-encoded without EXIF. Downsize again for inference.
      const pixels = await sharp(media.bytes).resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 }).toBuffer();
      const imageDataUrl = `data:image/jpeg;base64,${pixels.toString("base64")}`;
      const raw = await completion(config.key, VISION_MODEL,
        imageCaptionMessages(imageDataUrl, context, voiceProfile?.guide ?? null, style), 700);
      const suggestion = parseImageCaptionResponse(raw);
      if (!suggestion) throw new Error("The vision model did not return a usable caption. Try another image.");
      return NextResponse.json({ ...suggestion, model: VISION_MODEL }, { headers });
    }
    const raw = await completion(config.key, config.model, styleAnalysisMessages(examples!), 500);
    const guide = parseGuideResponse(raw);
    if (!guide) throw new Error("The model did not return a usable style guide. Try shorter examples.");
    if (repeatsLongExcerpt(guide, examples!)) throw new Error("The model repeated part of a sample post. Try again with shorter examples.");
    return NextResponse.json({ voiceProfile: saveVoiceProfile(user, guide) }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The AI request failed." }, { status: 502, headers });
  }
}
