import { NextResponse } from "next/server";
import { characterCount, isPlatformId, platforms, type PlatformId } from "@/lib/platforms";
import { publishers } from "@/lib/publishers";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || !("posts" in body)) {
    return NextResponse.json({ error: "Posts are required." }, { status: 400 });
  }

  const posts = body.posts;
  if (!posts || typeof posts !== "object" || Array.isArray(posts)) {
    return NextResponse.json({ error: "Posts must be a platform-to-text object." }, { status: 400 });
  }

  const entries = Object.entries(posts);
  if (entries.length === 0 || entries.length > 4) {
    return NextResponse.json({ error: "Select between one and four destinations." }, { status: 400 });
  }

  const validated: { platform: PlatformId; content: string }[] = [];
  for (const [platform, value] of entries) {
    if (!isPlatformId(platform) || typeof value !== "string") {
      return NextResponse.json({ error: "Unknown destination or invalid content." }, { status: 400 });
    }
    const content = value.trim();
    if (!content || characterCount(content) > platforms[platform].limit) {
      return NextResponse.json(
        { error: `${platforms[platform].name} needs text within its ${platforms[platform].limit}-character limit.` },
        { status: 400 },
      );
    }
    validated.push({ platform, content });
  }

  const results = await Promise.all(
    validated.map(({ platform, content }) => publishers[platform].publish(content)),
  );

  return NextResponse.json(
    { mode: "simulation", results },
    { headers: { "Cache-Control": "no-store" } },
  );
}
