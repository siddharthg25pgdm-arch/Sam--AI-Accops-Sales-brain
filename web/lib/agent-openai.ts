/** Optional second model provider for anyone who wants a free-tier model.
 *  Any OpenAI-compatible chat-completions endpoint with tool calling works (Groq, Cerebras, Mistral, OpenRouter, a local Ollama).
 *    LLM_PROVIDER=openai-compatible
 *    OPENAI_COMPAT_BASE_URL=https://api.groq.com/openai/v1
 *    OPENAI_COMPAT_API_KEY=...
 *    OPENAI_COMPAT_MODEL=openai/gpt-oss-120b
 *    OPENAI_COMPAT_FALLBACK_MODEL=openai/gpt-oss-20b   (default; "" disables) - tried when the primary fails, e.g. a 429
 *    OPENAI_COMPAT_REASONING_EFFORT=low                (default for gpt-oss; "" sends none)
 *  Read the provider's data-use terms before pointing it at collateral that names customers: free tiers often
 *  reserve the right to train on prompts. Production runs this path (Groq), so runtime is reported as
 *  "openai-compatible" with the model name - it used to say "claude", which made every dashboard
 *  number about "Claude" actually about Groq. */
import { VERTICALS, PRODUCTS, type SearchHit } from "./cards";
import { SYSTEM, ASSET_TYPES, MAX_SEARCHES, BUDGET_USED, SEED_STEP, runSearch, seedSearch, finish, type AskResult } from "./agent";
import type { AskError } from "./events";

type Msg = { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string; name?: string };
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

// Lenient schema on purpose: Groq validates tool arguments strictly against the schema, and open models often send
// "Banking" for vertical or "datasheet" for asset_type. We accept free text and normalise server side (runSearch).
// No audience or limit parameter: the server decides both (see heuristicFilters), and every option listed
// here is re-sent on every round. A function, not a const: agent.ts and this file import each other,
// so ASSET_TYPES is not initialised yet while this module's top level runs.
const toolDef = () => [{
  type: "function",
  function: {
    name: "search_assets",
    description: "Search Accops sales and marketing collateral. Returns ranked assets with why they matched. "
      + `vertical options: ${Object.keys(VERTICALS).join(", ")}. product options: ${PRODUCTS.join(", ")}. asset_type options: ${ASSET_TYPES.join(", ")}.`,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What the salesperson needs, in plain words" },
        asset_type: { type: "string", description: "Only if the rep names a type. Battlecard = competitive comparison; Brochure includes datasheets" },
        vertical: { type: "string", description: "Industry; omit for all" },
        product: { type: "string", description: "Product; omit for all" },
      },
      required: ["query"],
    },
  },
}];

export function openAICompatConfigured() {
  return process.env.LLM_PROVIDER === "openai-compatible" && Boolean(process.env.OPENAI_COMPAT_API_KEY && process.env.OPENAI_COMPAT_BASE_URL && process.env.OPENAI_COMPAT_MODEL);
}

/** Models to try, in order: the configured one, then the fallback. */
export function compatModels(): string[] {
  const models = [process.env.OPENAI_COMPAT_MODEL ?? "", process.env.OPENAI_COMPAT_FALLBACK_MODEL ?? "openai/gpt-oss-20b"];
  return models.filter((m, i) => m && models.indexOf(m) === i);
}

/** `deadline` is an absolute ms timestamp. Each call gets whatever time is left, so four slow steps
 *  cannot add up past the route's 60 s limit - where the function would be killed with nothing logged.
 *  Throws on a provider failure (rate limit, outage, timeout) so ask() can try the next model. */
export async function askOpenAICompat(question: string, history: { role: "user" | "assistant"; content: string }[], t0: number,
  deadline = t0 + 40_000, model = process.env.OPENAI_COMPAT_MODEL!): Promise<AskResult> {
  const base = process.env.OPENAI_COMPAT_BASE_URL!.replace(/\/$/, ""), key = process.env.OPENAI_COMPAT_API_KEY!;
  // gpt-oss spends most of its output on reasoning; "low" is plenty for picking a search and a
  // three-line reply, and it is output tokens that the per-minute limit counts too.
  const effort = process.env.OPENAI_COMPAT_REASONING_EFFORT ?? (/gpt-oss/.test(model) ? "low" : "");
  const messages: Msg[] = [{ role: "system", content: SYSTEM }, ...history.slice(-4).map(h => ({ role: h.role, content: h.content }) as Msg), { role: "user", content: question }];
  const trace: AskResult["trace"] = [];
  const pool: SearchHit[] = [];
  // The retrieval floor (see seedSearch): the rep's own words, searched before the model says anything.
  const seed = seedSearch(question);
  if (seed) {
    pool.push(...seed.hits);
    trace.push({ step: SEED_STEP, detail: JSON.stringify(seed.input) }, { step: "tool result", detail: `${seed.hits.length} of ${seed.considered} assets${seed.note ? ` - ${seed.note}` : ""}` });
    messages.push({ role: "assistant", content: null, tool_calls: [{ id: "seed", type: "function", function: { name: "search_assets", arguments: JSON.stringify({ query: question }) } }] },
      { role: "tool", tool_call_id: "seed", name: "search_assets", content: seed.payload });
  }
  let filters: Record<string, unknown> = seed ? { ...seed.input } : {}, calls = seed ? 1 : 0, tokens = 0;
  const done = (text: string, error: AskError | null) => {
    trace.push({ step: "model", detail: `${model} (openai-compatible) · ${((Date.now() - t0) / 1000).toFixed(1)}s · ${tokens} tokens` });
    return finish({ question, text, pool, calls, runtime: "openai-compatible", model, trace, filters, error });
  };
  for (let round = 0; ; round++) {
    // The last round runs with tools off, so the model must answer from what it found. Before, it
    // could search on every round and the rep was shown "The model ran out of steps before answering."
    const final = calls >= MAX_SEARCHES || round >= MAX_SEARCHES;
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, tools: toolDef(), tool_choice: final ? "none" : "auto", temperature: 0.2, max_tokens: 800,
        ...(effort ? { reasoning_effort: effort } : {}) }),
      signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
    });
    if (!r.ok) {
      const detail = `${model} returned ${r.status}: ${(await r.text()).slice(0, 200)}`;
      // A rate limit or an outage is for the next model in the chain. Anything else on the forced
      // round (Groq can 400 with "tool choice is none, but model called a tool") is answered from
      // what the searches already found, not thrown away.
      if (final && r.status !== 429 && r.status < 500) return done("", { kind: "step_exhausted", detail });
      throw new Error(detail);
    }
    const j = await r.json();
    tokens += j.usage?.total_tokens ?? 0;
    const m = j.choices?.[0]?.message as Msg | undefined;
    if (!m) throw new Error(`${model}: empty completion`);
    if (final || !m.tool_calls?.length) {
      // A tool call on the forced round is not an answer; finish() writes one from the real results.
      const text = m.tool_calls?.length ? "" : (m.content ?? "").trim();
      return done(text, text ? null : { kind: final ? "step_exhausted" : "empty_answer", detail: `${model} finished with no text after ${calls} searches` });
    }
    messages.push({ role: "assistant", content: m.content ?? null, tool_calls: m.tool_calls });
    for (const tc of m.tool_calls) {
      let raw: Record<string, unknown> = {};
      try { raw = JSON.parse(tc.function.arguments || "{}"); } catch { /* bad JSON from the model: treat as empty */ }
      // Parallel calls past the budget get told so rather than run: every result is re-sent each round.
      if (calls >= MAX_SEARCHES) { messages.push({ role: "tool", tool_call_id: tc.id, name: "search_assets", content: JSON.stringify({ note: BUDGET_USED }) }); continue; }
      const s = runSearch(raw, question);
      calls++; filters = { ...s.input };
      pool.push(...s.hits);
      trace.push({ step: "tool call: search_assets", detail: JSON.stringify(s.input) }, { step: "tool result", detail: `${s.hits.length} of ${s.considered} assets${s.note ? ` - ${s.note}` : ""}` });
      messages.push({ role: "tool", tool_call_id: tc.id, name: "search_assets", content: s.payload });
    }
    if (calls >= MAX_SEARCHES) messages.push({ role: "system", content: BUDGET_USED });
  }
}
