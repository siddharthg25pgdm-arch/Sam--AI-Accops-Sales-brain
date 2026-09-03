import { resolveCaller, unauthorized } from "@/lib/apiauth";
import { apiAsk } from "@/lib/api";

export const maxDuration = 60;
/** POST /api/v1/ask {question, history?: [{role, content}]} */
export async function POST(req: Request) {
  const who = await resolveCaller(req); if (!who) return unauthorized();
  const b = await req.json().catch(() => ({}));
  const question = String(b.question ?? "").trim();
  if (!question) return Response.json({ error: "question is required" }, { status: 400 });
  return Response.json(await apiAsk(question, who.id, who.via === "token" ? "api" : "web", Array.isArray(b.history) ? b.history.slice(-6) : []));
}
