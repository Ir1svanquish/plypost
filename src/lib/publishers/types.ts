import type { PlatformId } from "@/lib/platforms";

export type PublishReceipt = {
  platform: PlatformId;
  id: string;
  status: "simulated";
  publishedAt: string;
  content: string;
};

export type PublisherAdapter = {
  platform: PlatformId;
  publish: (content: string) => Promise<PublishReceipt>;
};
