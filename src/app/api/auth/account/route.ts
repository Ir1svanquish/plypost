import { manageAccount } from "@/lib/server/account-management";
import { readBoundedJsonObject } from "@/lib/server/bounded-json";
import { currentUser } from "@/lib/server/auth";
import { database } from "@/lib/server/db";
export const runtime = "nodejs";
export function GET(request: Request) {
  const email = currentUser(request);
  const headers = { "Cache-Control": "no-store" };
  if (!email) return Response.json({ error: "Sign in to continue." }, { status: 401, headers });
  const account = database().prepare("SELECT created_at,recovery_hash IS NOT NULL AS recovery_ready FROM accounts WHERE email=?").get(email);
  const usage = database().prepare("SELECT COUNT(*) AS count FROM ai_usage WHERE user_id=? AND created_at>=?").get(email, new Date(Date.now() - 86400000).toISOString());
  return Response.json({ email, account, usage }, { headers });
}
export async function POST(request: Request) {
  const input = await readBoundedJsonObject(request, 4096);
  if (input.kind !== "ok") return Response.json({ error: "Invalid request." }, { status: 400 });
  const action = input.value.action;
  if (action !== "password" && action !== "recovery-code" && action !== "sessions") return Response.json({ error: "Unknown action." }, { status: 400 });
  const replay = new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(input.value) });
  return manageAccount(replay, action);
}
