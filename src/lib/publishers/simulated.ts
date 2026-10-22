import type { PlatformId } from "@/lib/platforms";
import type { PublisherAdapter } from "./types";

export function simulatedAdapter(platform: PlatformId): PublisherAdapter {
  return {
    platform,
    async publish(content) {
      return {
        platform,
        id: `sim_${crypto.randomUUID()}`,
        status: "simulated",
        publishedAt: new Date().toISOString(),
        content,
      };
    },
  };
}
