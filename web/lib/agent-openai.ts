/** Optional second model provider for anyone who wants a free-tier model.
 *  Any OpenAI-compatible chat-completions endpoint with tool calling works (Groq, Cerebras, Mistral, OpenRouter, a local Ollama).
 *    LLM_PROVIDER=openai-compatible
 *    OPENAI_COMPAT_BASE_URL=https://api.groq.com/openai/v1
 *    OPENAI_COMPAT_API_KEY=...
 *    OPENAI_COMPAT_MODEL=openai/gpt-oss-120b
 *  Read the provider's data-use terms before pointing it at collateral that names customers: free tiers often
 *  reserve the right to train on prompts. Production runs this path (Groq), so runtime is reported as
 *  "openai-compatible" with the model name - it used to say "claude", which made every dashboard
 *  number about "Claude" actually about Groq. */
import { searchAssets, VERTICALS, PRODUCTS, type SearchHit } from "./cards";
import { SYSTEM, toCard, toolPayload, type AskResult } from "./agent";

type Msg = { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string; name?: string };
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

// Lenient schema on purpose: Groq validates tool arguments strictly against the schema, and open models often send
// "Banking" for vertical or "5" for limit. We accept free text and normalise server side (see normalise()).
const toolDef = [{
  type: "function",
  function: {
    name: "search_assets",
    description: "Search Accops sales and marketing collateral (case studies, whitepapers). Returns ranked asset cards with why they matched. "
      + `vertical options: ${Object.keys(VERTICALS).join(", ")}. product options: ${PRODUCTS.join(", ")}. asset_type options: Case Study, Whitepaper.`,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What the salesperson needs, in plain words" },
        asset_type: { type: "string", description: "Case Study or Whitepaper; omit for all" },
        vertical: { type: "string", description: "Industry; omit for all" },
        product: { type: "string", description: "Product; omit for all" },
        audience: { type: "string", description: "internal (default) or external" },
        limit: { type: "string", description: "Max results, 1 to 8" },
      },
      required: ["query"],
    },
  },
}];

function pick(value: unknown, options: string[]): string | undefined {
  const v = String(value ?? "").trim().toLowerCase(); if (!v) return undefined;
  const exact = options.find(o => o.toLowerCase() === v); if (exact) return exact;
  const partial = options.find(o => o.toLowerCase().includes(v) || v.includes(o.toLowerCase().split(" ")[0])); if (partial) return partial;
  const hit = Object.entries(VERTICALS).find(([, words]) => words.some(w => v.includes(w)))?.[0];
  return hit && options.includes(hit) ? hit : undefined;
}
function normalise(input: Record<string, unknown>) {
  return {
    query: String(input.query ?? ""),
    asset_type: pick(input.asset_type, ["Case Study", "Whitepaper"]),
    vertical: pick(input.vertical, Object.keys(VERTICALS)),
    product: pick(input.product, PRODUCTS),
    audience: (String(input.audience ?? "").toLowerCase() === "external" ? "external" : "internal") as "internal" | "external",
    limit: Math.min(Math.max(parseInt(String(input.limit ?? "5"), 10) || 5, 1), 8),
  };
}

export function openAICompatConfigured() {
  return process.env.LLM_PROVIDER === "openai-compatible" && Boolean(process.env.OPENAI_COMPAT_API_KEY && process.env.OPENAI_COMPAT_BASE_URL && process.env.OPENAI_COMPAT_MODEL);
}

/** `deadline` is an absolute ms timestamp. Each call gets whatever time is left, so four slow steps
 *  cannot add up past the route's 60 s limit - where the function would be killed with nothing logged. */
export async function askOpenAICompat(question: string, history: { role: "user" | "assistant"; content: string }[], t0: number, deadline = t0 + 40_000): Promise<AskResult> {
  const base = process.env.OPENAI_COMPAT_BASE_URL!.replace(/\/$/, ""), key = process.env.OPENAI_COMPAT_API_KEY!, model = process.env.OPENAI_COMPAT_MODEL!;
  const messages: Msg[] = [{ role: "system", content: SYSTEM }, ...history.slice(-6).map(h => ({ role: h.role, content: h.content }) as Msg), { role: "user", content: question }];
  const trace: AskResult["trace"] = [];
  const base_ = { runtime: "openai-compatible" as const, model };
  let lastHits: SearchHit[] = [], filters: Record<string, unknown> = {}, calls = 0;
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, tools: toolDef, tool_choice: "auto", temperature: 0.2, max_tokens: 1200 }),
      signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
    });
    if (!r.ok) throw new Error(`${model} returned ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    const m = j.choices?.[0]?.message as Msg | undefined;
    if (!m) throw new Error("empty completion");
    if (!m.tool_calls?.length) {
      trace.push({ step: "model", detail: `${model} (openai-compatible) · ${((Date.now() - t0) / 1000).toFixed(1)}s` });
      const text = (m.content ?? "").trim();
      return { ...base_, text: text || "No answer was produced.", assets: lastHits.slice(0, 3).map(toCard), trace,
        // Gap = "ended up with nothing", not "the first search missed" - the same fix agent.ts got on
        // 8 Sep (the "hysecure datasheet" bug). This path is the one production runs, and it had kept
        // the old rule, so answered questions were still being logged as content gaps.
        intent: calls ? (lastHits.length ? "find_asset" : "gap") : "other", filters, zero: calls > 0 && lastHits.length === 0,
        error: text ? null : { kind: "empty_answer", detail: `${model} finished with no text after ${calls} searches` } };
    }
    messages.push({ role: "assistant", content: m.content ?? null, tool_calls: m.tool_calls });
    for (const tc of m.tool_calls) {
      let raw: Record<string, unknown> = {};
      try { raw = JSON.parse(tc.function.arguments || "{}"); } catch { /* bad JSON from the model: treat as empty */ }
      const input = normalise(raw); if (!input.query) input.query = question;
      calls++; filters = { ...input };
      trace.push({ step: "tool call: search_assets", detail: JSON.stringify(input) });
      const { results: hits, considered } = searchAssets(input);
      if (hits.length) lastHits = hits;
      trace.push({ step: "tool result", detail: `${hits.length} of ${considered} assets` });
      messages.push({ role: "tool", tool_call_id: tc.id, name: "search_assets", content: toolPayload(hits, considered) });
    }
  }
  return { ...base_, text: "The model ran out of steps before answering.", assets: lastHits.slice(0, 3).map(toCard), trace, intent: "other", filters, zero: lastHits.length === 0,
    error: { kind: "step_exhausted", detail: `${model}: 4 steps, ${calls} searches, no final answer` } };
}
