import sharp from "sharp";
import { imageCaptionMessages } from "../src/lib/ai-prompts";
import { parseImageCaptionResponse } from "../src/lib/ai-studio";

const key = process.env.NEBIUS_API_KEY?.trim();
if (!key) throw new Error("Set NEBIUS_API_KEY in .env.local first.");

const image = await sharp({ create: { width: 80, height: 60, channels: 3, background: "#3684c8" } })
  .jpeg({ quality: 80 }).toBuffer();
const response = await fetch("https://api.tokenfactory.nebius.com/v1/chat/completions", {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "nvidia/Nemotron-3.5-Super-VL",
    messages: imageCaptionMessages(`data:image/jpeg;base64,${image.toString("base64")}`, "A synthetic blue rectangle for a connection test.", null),
    temperature: 0.2, max_tokens: 700, stream: false,
  }),
  signal: AbortSignal.timeout(45_000), cache: "no-store",
});
if (!response.ok) throw new Error(`Vision request returned HTTP ${response.status}.`);
const data: unknown = await response.json();
const content = (data as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
const parsed = typeof content === "string" ? parseImageCaptionResponse(content) : null;
if (!parsed) throw new Error("Vision model did not return the expected caption shape.");
process.stdout.write(`Vision model responded with ${parsed.observations.length} observation characters and ${parsed.caption.length} caption characters.\n`);
