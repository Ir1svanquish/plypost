import { passwordHash } from "../src/lib/server/auth";

async function readPassword(): Promise<string> {
  if (process.env.PLYPOST_NEW_PASSWORD) return process.env.PLYPOST_NEW_PASSWORD;
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw new Error("Run this in an interactive terminal or set PLYPOST_NEW_PASSWORD temporarily.");
  process.stdout.write("Choose an owner password (12+ characters): ");
  return new Promise((resolve, reject) => {
    let value = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = () => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write("\n"); };
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\r" || char === "\n") { process.stdin.off("data", onData); finish(); resolve(value); return; }
        if (char === "\u0003") { process.stdin.off("data", onData); finish(); reject(new Error("Cancelled.")); return; }
        if (char === "\u007f" || char === "\b") { value = value.slice(0, -1); continue; }
        if (char >= " ") value += char;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function main() {
  const password = await readPassword();
  if (password.length < 12) {
    console.error("Password must have at least 12 characters.");
    process.exitCode = 1;
  } else {
    console.log(`PLYPOST_OWNER_PASSWORD_HASH=${passwordHash(password)}`);
  }
}

void main();
