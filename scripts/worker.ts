import { processOneDue, touchWorker } from "../src/lib/server/jobs";
import { mastodonScheduleExecutionEnabled, processOneDueMastodonSchedule, touchMastodonWorker } from "../src/lib/server/mastodon-schedule";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

if (existsSync(".env.local")) loadEnvFile(".env.local");
async function main() {
  console.log("Plypost worker is running. Confirmed Mastodon schedules can publish from the connected account.");
  let stopping = false;
  process.on("SIGINT", () => { stopping = true; });
  process.on("SIGTERM", () => { stopping = true; });

  while (!stopping) {
    try {
      touchWorker();
      const realEnabled = mastodonScheduleExecutionEnabled();
      if (realEnabled) touchMastodonWorker();
      const realRan = realEnabled && await processOneDueMastodonSchedule();
      if (stopping) break;
      const simulatedRan = await processOneDue();
      if (realRan || simulatedRan) continue;
    } catch (error) {
      console.error("Worker error:", error);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

void main();
