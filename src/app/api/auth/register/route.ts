import { manageAccount } from "@/lib/server/account-management";
export const runtime = "nodejs";
export const POST = (request: Request) => manageAccount(request, "register");
