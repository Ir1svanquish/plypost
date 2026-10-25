import { currentUser } from "@/lib/server/auth";
import { streamHandoffPackage, HandoffPackageError } from "@/lib/server/handoff-package";

export const runtime = "nodejs";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
};

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const user = currentUser(request);
  if (!user) return Response.json({ error: "Sign in to continue." }, { status: 401, headers: privateHeaders });
  const { id } = await context.params;
  try {
    const { stream, filename } = streamHandoffPackage(user, id);
    return new Response(stream, {
      headers: {
        ...privateHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof HandoffPackageError) {
      return Response.json({ error: error.message }, { status: error.status, headers: privateHeaders });
    }
    return Response.json({ error: "Could not prepare this handoff." }, { status: 500, headers: privateHeaders });
  }
}
