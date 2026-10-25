import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { passwordHash } from "../src/lib/server/auth.ts";
import { closeDatabase } from "../src/lib/server/db.ts";
import { saveBrandBrief } from "../src/lib/server/strategy.ts";
import { addSchedule, prepareAssistedBatch, saveDraft, setAssistedStatus } from "../src/lib/server/workspace.ts";

const demoEmail = "demo@plypost.local";
const defaultDemoDir = resolve("data/demo");

type DemoConfig = { email: string; passwordHash: string };

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

/** Create a fresh, entirely synthetic database. Existing demo data is never replaced. */
export function createDemoAt(directory: string): DemoConfig {
  const demoDir = resolve(directory);
  if (existsSync(demoDir)) throw new Error(`Demo directory already exists: ${demoDir}`);
  mkdirSync(dirname(demoDir), { recursive: true });
  mkdirSync(demoDir);

  const password = randomBytes(24).toString("base64url");
  const config = { email: demoEmail, passwordHash: passwordHash(password) };
  const previousDbPath = process.env.PLYPOST_DB_PATH;
  process.env.PLYPOST_DB_PATH = join(demoDir, "plypost.sqlite");
  try {
    saveBrandBrief(demoEmail, {
      brandName: "Northstar Notes (demo)",
      description: "A fictional studio sharing practical notes on creative work.",
      audience: "Independent makers and small teams",
      goal: "Help readers turn a weekly idea into a useful post",
      voice: "Clear, calm, practical",
      facts: "This is synthetic demonstration data, not a real business or account.",
      contentPillars: ["Writing routines", "Small team workflows", "Learning in public"],
      platforms: ["linkedin", "threads", "bluesky", "mastodon"],
    });

    const now = new Date().toISOString();
    const first = saveDraft(demoEmail, {
      id: randomUUID(), title: "[Demo] One idea, three versions",
      source: "A weekly post starts with one useful idea. Write the point first, then adjust the detail and tone for each community.",
      selected: ["linkedin", "threads", "bluesky"],
      variants: {
        linkedin: "A simple weekly publishing habit: start with one useful idea. Write the takeaway first, then add the context your professional audience needs. What helps your team keep posts clear?",
        threads: "One useful idea can become several posts. Start with the point, then make each version sound at home on its platform. What is your writing ritual?",
        bluesky: "Start with one useful idea. Make the point clear, then adapt the tone for each community. What's your weekly writing ritual?",
      },
      plannedDate: daysFromNow(1).slice(0, 10), createdAt: now, updatedAt: now,
    });
    const handoffs = prepareAssistedBatch(demoEmail, first.id, randomUUID(), [
      { destination: "linkedin", scheduledFor: daysFromNow(1), reminderEnabled: true },
      { destination: "threads", scheduledFor: daysFromNow(1), reminderEnabled: false },
      { destination: "bluesky", scheduledFor: now, reminderEnabled: false },
    ]);
    if (!setAssistedStatus(demoEmail, handoffs[2].id, "posted")) throw new Error("Could not seed demo progress.");

    saveDraft(demoEmail, {
      id: randomUUID(), title: "[Demo] Ask a focused question",
      source: "What is one small change that made your writing workflow easier this month?",
      selected: ["bluesky", "mastodon"], variants: {},
      plannedDate: daysFromNow(3).slice(0, 10), createdAt: now, updatedAt: now,
    });
    addSchedule(demoEmail, {
      id: randomUUID(), title: "[Demo] Simulated Threads slot",
      source: "A short note about consistent writing habits.",
      posts: { threads: "A clear idea and a small writing habit can go a long way. What's helped you post more consistently?" },
      scheduledFor: daysFromNow(2), createdAt: now, status: "queued",
    }, "UTC");
  } finally {
    closeDatabase();
    if (previousDbPath === undefined) delete process.env.PLYPOST_DB_PATH;
    else process.env.PLYPOST_DB_PATH = previousDbPath;
  }

  writeFileSync(join(demoDir, "config.json"), JSON.stringify(config, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  writeFileSync(join(demoDir, "login.txt"), `Local demo only\nEmail: ${demoEmail}\nPassword: ${password}\n`, { flag: "wx", mode: 0o600 });
  return config;
}

export function demoEnvironment(directory: string, config: DemoConfig): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PLYPOST_DB_PATH: join(resolve(directory), "plypost.sqlite"),
    PLYPOST_OWNER_EMAIL: config.email,
    PLYPOST_OWNER_PASSWORD_HASH: config.passwordHash,
    PLYPOST_BLUESKY_ORIGIN: "",
    PLYPOST_BLUESKY_SECRET: "",
    PLYPOST_MASTODON_INSTANCE: "",
    PLYPOST_PUBLIC_ORIGIN: "",
    PLYPOST_MASTODON_SECRET: "",
    PLYPOST_MASTODON_SCHEDULE_ENABLED: "false",
    PLYPOST_LOCAL_DEMO_HTTP: "true",
    NVIDIA_API_KEY: "",
    NEBIUS_MODEL: "nvidia/nemotron-3-super-120b-a12b",
  };
}

function loadDemoConfig(directory: string): DemoConfig {
  const data: unknown = JSON.parse(readFileSync(join(directory, "config.json"), "utf8"));
  if (!data || typeof data !== "object" ||
      (data as DemoConfig).email !== demoEmail ||
      typeof (data as DemoConfig).passwordHash !== "string" ||
      !existsSync(join(directory, "plypost.sqlite"))) {
    throw new Error("Demo setup is incomplete. Inspect data/demo before starting.");
  }
  return data as DemoConfig;
}

async function main() {
  const args = process.argv.slice(2);
  const seedOnly = args.length === 1 && args[0] === "--seed-only";
  const production = args[0] === "--production";
  const portArgs = production ? args.slice(1) : args;
  const customPort = portArgs.length === 2 && portArgs[0] === "--port" && /^\d{1,5}$/.test(portArgs[1]);
  if (!seedOnly && portArgs.length > 0 && !customPort) {
    throw new Error("Usage: npm run demo [-- --port 3201], npm run demo:seed, or npm run demo:test-build");
  }
  const port = customPort ? Number(portArgs[1]) : 3187;
  if (port < 1 || port > 65535) throw new Error("Choose a port from 1 to 65535.");
  if (production && !existsSync(resolve(".next/BUILD_ID"))) {
    throw new Error("No production build found. Run npm run build first.");
  }

  if (!existsSync(defaultDemoDir)) {
    createDemoAt(defaultDemoDir);
    console.log("Created a synthetic demo in data/demo.");
  }
  const config = loadDemoConfig(defaultDemoDir);
  console.log("Local demo login is in data/demo/login.txt (Git-ignored). No social account is connected.");
  if (seedOnly) return;

  const nextCli = resolve("node_modules/next/dist/bin/next");
  const nextArgs = production ? ["start"] : ["dev", "--webpack"];
  const child = spawn(process.execPath, [nextCli, ...nextArgs, "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: process.cwd(), env: { ...demoEnvironment(defaultDemoDir, config), NODE_ENV: production ? "production" : "development" }, stdio: "inherit",
  });
  child.on("error", (error) => { console.error("Could not start Next.js:", error.message); process.exitCode = 1; });
  child.on("exit", (code, signal) => { process.exitCode = signal ? 1 : (code ?? 1); });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Could not start the demo.");
    process.exitCode = 1;
  });
}
