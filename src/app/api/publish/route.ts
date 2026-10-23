import { NextResponse } from "next/server";
import { isPlatformId, type PlatformId } from "@/lib/platforms";
import { validatePlatformText } from "@/lib/platform-validation";
import { publishers } from "@/lib/publishers";
import { currentUser, sameOrigin } from "@/lib/server/auth";
import { audit } from "@/lib/server/db";

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
    const check = validatePlatformText(platform, content);
    if (!check.valid) {
      return NextResponse.json(
        { error: check.issues.filter((issue) => issue.severity === "error").map((issue) => issue.message).join(" ") },
        { status: 400 },
      );
    }
    validated.push({ platform, content });
  }

  const results = await Promise.all(
    validated.map(({ platform, content }) => publishers[platform].publish(content)),
  );
  audit(user, "publish.simulated", undefined, results.map((result) => result.platform).join(","));

  return NextResponse.json(
    { mode: "simulation", results },
    { headers: { "Cache-Control": "no-store" } },
  );
}
