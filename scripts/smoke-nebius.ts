import { parseGeneratedVariants } from "../src/lib/generated-variants";
import { planMessages, variantMessages } from "../src/lib/ai-prompts";
import { modelRequestOptions, nebiusConfig } from "../src/lib/server/ai-provider";
import { parseGeneratedIdeas } from "../src/lib/strategy";

const config = nebiusConfig();
if (!config.key) {
  console.error("Set NEBIUS_API_KEY in .env.local before running the Nebius smoke check.");
  process.exitCode = 1;
} else {
  try {
    async function complete(messages: ReturnType<typeof variantMessages> | ReturnType<typeof planMessages>, maxTokens: number) {
      const response = await fetch(config.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model, messages, temperature: 0.2, max_tokens: maxTokens, stream: false,
          ...modelRequestOptions(config.model),
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Token Factory returned HTTP ${response.status}.`);
      const data: unknown = await response.json();
      return (data as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
    }

    const variants = await complete(variantMessages("Our Saturday workshop starts at 2 p.m. Doors open at 1:30. Please bring a laptop."), 1200);
    if (typeof variants !== "string" || !parseGeneratedVariants(variants)) {
      throw new Error("Token Factory returned an unusable four-platform draft.");
    }

    const platforms = ["bluesky", "linkedin"] as const;
    const plan = await complete(planMessages({
      brandName: "Workshop", description: "Small local classes", audience: "New learners",
      goal: "Share useful class ideas", voice: "Clear and friendly",
      facts: "Workshops are held on Saturdays.", contentPillars: ["Learning"], platforms,
    }), 2000);
    if (typeof plan !== "string" || !parseGeneratedIdeas(plan, platforms)) {
      throw new Error("Token Factory returned an unusable weekly plan.");
    }
    console.log(`Nebius Token Factory: OK · ${config.model} · 4 draft variants and a weekly plan`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Nebius smoke check failed.");
    process.exitCode = 1;
  }
}
