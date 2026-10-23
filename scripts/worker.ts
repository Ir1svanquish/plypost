import { processOneDue, touchWorker } from "../src/lib/server/jobs";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

if (existsSync(".env.local")) loadEnvFile(".env.local");
async function main() {
  console.log("Plypost simulation worker is running. No social platform will be contacted.");
  let stopping = false;
  process.on("SIGINT", () => { stopping = true; });
  process.on("SIGTERM", () => { stopping = true; });

  while (!stopping) {
    try {
      touchWorker();
      const ran = await processOneDue();
      if (ran) continue;
    } catch (error) {
      console.error("Worker error:", error);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

void main();
