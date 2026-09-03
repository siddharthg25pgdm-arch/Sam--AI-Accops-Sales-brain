/** Optional second model provider for anyone who wants a free-tier model.
 *  Any OpenAI-compatible chat-completions endpoint with tool calling works (Groq, Cerebras, Mistral, OpenRouter, a local Ollama).
 *    LLM_PROVIDER=openai-compatible
 *    OPENAI_COMPAT_BASE_URL=https://api.groq.com/openai/v1
 *    OPENAI_COMPAT_API_KEY=...
 *    OPENAI_COMPAT_MODEL=llama-3.3-70b-versatile
 *  Read the provider's data-use terms before pointing it at collateral that names customers: free tiers often
 *  reserve the right to train on prompts. Claude remains the default and recommended path. */
import { searchAssets, VERTICALS, PRODUCTS, type SearchHit } from "./cards";
import { SYSTEM, toCard, toolPayload, type AskResult } from "./agent";

type Msg = { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string; name?: string };
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

const toolDef = [{
  type: "function",
  function: {
    name: "search_assets",
    description: "Search Accops sales and marketing collateral (case studies, whitepapers). Returns ranked asset cards with why they matched.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        asset_type: { type: "string", enum: ["Case Study", "Whitepaper", ""] },
        vertical: { type: "string", enum: [...Object.keys(VERTICALS), ""] },
        product: { type: "string", enum: [...PRODUCTS, ""] },
        audience: { type: "string", enum: ["internal", "external"] },
        limit: { type: "integer", minimum: 1, maximum: 8 },
      },
      required: ["query"],
    },
  },
}];

export function openAICompatConfigured() {
  return process.env.LLM_PROVIDER === "openai-compatible" && Boolean(process.env.OPENAI_COMPAT_API_KEY && process.env.OPENAI_COMPAT_BASE_URL && process.env.OPENAI_COMPAT_MODEL);
}

export async function askOpenAICompat(question: string, history: { role: "user" | "assistant"; content: string }[], t0: number): Promise<AskResult> {
  const base = process.env.OPENAI_COMPAT_BASE_URL!.replace(/\/$/, ""), key = process.env.OPENAI_COMPAT_API_KEY!, model = process.env.OPENAI_COMPAT_MODEL!;
  const messages: Msg[] = [{ role: "system", content: SYSTEM }, ...history.slice(-6).map(h => ({ role: h.role, content: h.content }) as Msg), { role: "user", content: question }];
  const trace: AskResult["trace"] = [];
  let lastHits: SearchHit[] = [], filters: Record<string, unknown> = {}, calls = 0, firstZero = false;
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, tools: toolDef, tool_choice: "auto", temperature: 0.2, max_tokens: 1200 }),
    });
    if (!r.ok) throw new Error(`${model} returned ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    const m = j.choices?.[0]?.message as Msg | undefined;
    if (!m) throw new Error("empty completion");
    if (!m.tool_calls?.length) {
      trace.push({ step: "model", detail: `${model} (openai-compatible) · ${((Date.now() - t0) / 1000).toFixed(1)}s` });
      return { text: (m.content ?? "").trim() || "No answer was produced.", assets: lastHits.slice(0, 3).map(toCard), trace, runtime: "claude",
        intent: calls ? (firstZero ? "gap" : "find_asset") : "other", filters, zero: firstZero };
    }
    messages.push({ role: "assistant", content: m.content ?? null, tool_calls: m.tool_calls });
    for (const tc of m.tool_calls) {
      let input: Record<string, string | number> = {};
      try { input = JSON.parse(tc.function.arguments || "{}"); } catch { /* bad JSON from the model: treat as empty */ }
      calls++; filters = { ...input };
      trace.push({ step: "tool call: search_assets", detail: JSON.stringify(input) });
      const { results: hits, considered } = searchAssets({ query: String(input.query ?? question), asset_type: String(input.asset_type ?? "") || undefined,
        vertical: String(input.vertical ?? "") || undefined, product: String(input.product ?? "") || undefined,
        audience: (input.audience as "internal" | "external") || "internal", limit: Number(input.limit ?? 5) });
      if (calls === 1 && hits.length === 0) firstZero = true;
      if (hits.length) lastHits = hits;
      trace.push({ step: "tool result", detail: `${hits.length} of ${considered} assets` });
      messages.push({ role: "tool", tool_call_id: tc.id, name: "search_assets", content: toolPayload(hits, considered) });
    }
  }
  return { text: "The model ran out of steps before answering.", assets: lastHits.slice(0, 3).map(toCard), trace, runtime: "claude", intent: "other", filters, zero: lastHits.length === 0 };
}
