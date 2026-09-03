import { resolveCaller, unauthorized } from "@/lib/apiauth";

/** GET /api/v1/provider (admin cookie or API token): which model provider is configured, whether it answers,
 *  and which models the key can use. Server side only, the key never leaves the function. */
export async function GET(req: Request) {
  const who = await resolveCaller(req); if (!who) return unauthorized();
  const provider = process.env.LLM_PROVIDER === "openai-compatible" && process.env.OPENAI_COMPAT_API_KEY ? "openai-compatible" : process.env.ANTHROPIC_API_KEY ? "anthropic" : "none";
  const out: Record<string, unknown> = { provider, model: provider === "openai-compatible" ? process.env.OPENAI_COMPAT_MODEL : provider === "anthropic" ? (process.env.CLAUDE_MODEL ?? "claude-sonnet-5") : null };
  if (provider === "openai-compatible") {
    const base = (process.env.OPENAI_COMPAT_BASE_URL ?? "").replace(/\/$/, ""), key = process.env.OPENAI_COMPAT_API_KEY!;
    out.base_url = base;
    try {
      const r = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` } });
      const j = await r.json();
      out.models = r.ok ? (j.data ?? []).map((m: { id: string }) => m.id).sort() : { http: r.status, error: j.error?.message ?? j };
    } catch (e) { out.models = { error: (e as Error).message }; }
    try {
      const r = await fetch(`${base}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: process.env.OPENAI_COMPAT_MODEL, messages: [{ role: "user", content: "Reply with the single word ok." }], max_tokens: 5 }) });
      const j = await r.json();
      out.configured_model_test = r.ok ? { ok: true, reply: j.choices?.[0]?.message?.content } : { ok: false, http: r.status, error: j.error?.message ?? j };
    } catch (e) { out.configured_model_test = { ok: false, error: (e as Error).message }; }
  }
  return Response.json(out);
}
