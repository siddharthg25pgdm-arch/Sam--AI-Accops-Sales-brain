import { resolveCaller, unauthorized } from "@/lib/apiauth";
import { apiAsk } from "@/lib/api";
import { compatModels } from "@/lib/agent-openai";

export const maxDuration = 60;
/** POST /api/v1/ask {question, history?: [{role, content}]} */
export async function POST(req: Request) {
  const who = await resolveCaller(req); if (!who) return unauthorized();
  const b = await req.json().catch(() => ({}));
  const question = String(b.question ?? "").trim();
  if (!question) return Response.json({ error: "question is required" }, { status: 400 });
  // Head-to-head evals only: an API token sending test traffic may pin one configured model. Reps
  // (cookie sessions) and real traffic can never choose the model.
  let model: string | undefined;
  if (b.model != null) {
    if (who.via !== "token" || req.headers.get("x-sam-test") !== "1") return Response.json({ error: "model can only be pinned by an API token sending x-sam-test: 1" }, { status: 403 });
    if (!compatModels().includes(String(b.model))) return Response.json({ error: `model must be one of: ${compatModels().join(", ")}` }, { status: 400 });
    model = String(b.model);
  }
  return Response.json(await apiAsk(question, who.id, who.via === "token" ? "api" : "web", Array.isArray(b.history) ? b.history.slice(-6) : [], null, { model }));
}
