/** The OpenAI-compatible model path: OpenAI itself and/or any OpenAI-compatible chat-completions endpoint
 *  with tool calling (Groq, Cerebras, Mistral, OpenRouter, a local Ollama). Tiers, tried in this order:
 *    1. OpenAI - on when OPENAI_API_KEY is set:
 *         OPENAI_API_KEY=sk-...
 *         OPENAI_MODEL=gpt-6-luna                   (default)
 *         OPENAI_FALLBACK_MODEL=                     (optional second OpenAI model; default none)
 *         OPENAI_REASONING_EFFORT=                   (optional; default per model family, see openAIEffort)
 *         OPENAI_BASE_URL=https://api.openai.com/v1  (default; https://in.api.openai.com/v1 = India data residency)
 *    2. OpenAI-compatible (production: Groq) - on when all of:
 *         LLM_PROVIDER=openai-compatible
 *         OPENAI_COMPAT_BASE_URL=https://api.groq.com/openai/v1
 *         OPENAI_COMPAT_API_KEY=...
 *         OPENAI_COMPAT_MODEL=openai/gpt-oss-120b
 *         OPENAI_COMPAT_FALLBACK_MODEL=openai/gpt-oss-20b   (default; "" disables) - tried when the primary fails, e.g. a 429
 *         OPENAI_COMPAT_REASONING_EFFORT=low                (default for gpt-oss; "" sends none)
 *  then Claude (agent.ts), then retrieval only. A compat base URL on api.openai.com gets OpenAI's request shape.
 *  Read the provider's data-use terms before pointing it at collateral that names customers: free tiers often
 *  reserve the right to train on prompts (OpenAI's API does not by default - docs/TASK-openai-key.md).
 *  Runtime is "openai-compatible" for both tiers, with the model name - it used to say "claude", which made
 *  every dashboard number about "Claude" actually about Groq. The trace's model step names the tier. */
import { VERTICALS, PRODUCTS, type SearchHit } from "./cards";
import { SYSTEM, ASSET_TYPES, MAX_SEARCHES, BUDGET_USED, SEED_STEP, runSearch, seedSearch, searchText, finish, toolPayload, numbering, type AskResult } from "./agent";
import type { AskError } from "./events";
import { cleanKey, redact } from "./redact";

export type Msg = { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string; name?: string };
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

export type Tier = { provider: "openai" | "openai-compatible"; base: string; key: string; models: string[] };

const isOpenAI = (base: string) => /^https:\/\/([a-z0-9-]+\.)*api\.openai\.com(\/|$)/i.test(base);

/** Keys that are set but malformed (pasted twice, line breaks). Such a tier is skipped - never sent as
 *  a header, because fetch's "invalid header value" error echoes the whole key - and the reason is
 *  reported by /api/v1/provider. The reason never contains the key. */
export function keyProblems(): string[] {
  const e = process.env;
  return [cleanKey(e.OPENAI_API_KEY, "OPENAI_API_KEY").problem,
    e.LLM_PROVIDER === "openai-compatible" ? cleanKey(e.OPENAI_COMPAT_API_KEY, "OPENAI_COMPAT_API_KEY").problem : null]
    .filter((p): p is string => Boolean(p));
}

/** Configured model tiers, in the order ask() tries them. */
export function tiers(): Tier[] {
  const e = process.env, out: Tier[] = [];
  const openaiKey = cleanKey(e.OPENAI_API_KEY, "OPENAI_API_KEY").key;
  const compatKey = cleanKey(e.OPENAI_COMPAT_API_KEY, "OPENAI_COMPAT_API_KEY").key;
  if (openaiKey) out.push({ provider: "openai", base: (e.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""), key: openaiKey,
    models: [e.OPENAI_MODEL || "gpt-6-luna", e.OPENAI_FALLBACK_MODEL ?? ""] });
  if (e.LLM_PROVIDER === "openai-compatible" && compatKey && e.OPENAI_COMPAT_BASE_URL && e.OPENAI_COMPAT_MODEL) {
    const base = e.OPENAI_COMPAT_BASE_URL.replace(/\/$/, ""), openai = isOpenAI(base);
    out.push({ provider: openai ? "openai" : "openai-compatible", base, key: compatKey,
      models: [e.OPENAI_COMPAT_MODEL, e.OPENAI_COMPAT_FALLBACK_MODEL ?? (openai ? "" : "openai/gpt-oss-20b")] });
  }
  return out.map(t => ({ ...t, models: t.models.filter(Boolean) }));
}

export function openAICompatConfigured() { return tiers().length > 0; }

/** Models to try, in order, across tiers: OpenAI primary, OpenAI fallback, compat primary, compat fallback. */
export function compatModels(): string[] {
  const models = tiers().flatMap(t => t.models);
  return models.filter((m, i) => models.indexOf(m) === i);
}

/** reasoning_effort for an OpenAI model; null = do not send it. Chat Completions only does function calling
 *  on GPT-6 Sol / Luna with effort "none" (gpt-6-astra and gpt-6.1-sol cannot tool-call there at all - they
 *  would need the Responses API). gpt-5 / -mini / -nano predate "none", o-series has none of it either, and
 *  GPT-4.x is not a reasoning model. Everything newer (gpt-5.1+, gpt-6 sol/luna) takes "none". */
export function openAIEffort(model: string): string | null {
  const env = process.env.OPENAI_REASONING_EFFORT;
  if (env !== undefined) return env || null;
  if (/^(gpt-4|gpt-3\.5|chatgpt-)/.test(model)) return null;
  if (/^o\d/.test(model)) return "low";
  if (/^gpt-5(-mini|-nano)?(-\d{4}-\d{2}-\d{2})?$/.test(model)) return "minimal";
  return "none";
}

/** The chat/completions body. The compat (Groq) body is byte-for-byte what production always sent.
 *  OpenAI's differs where its API does: max_completion_tokens (max_tokens is deprecated and rejected by
 *  reasoning models), temperature only when not reasoning (rejected otherwise), reasoning_effort only for
 *  reasoning models, no `name` on tool messages, and store:false. */
export function requestBody(tier: Tier, model: string, messages: Msg[], final: boolean): Record<string, unknown> {
  const tool_choice = final ? "none" : "auto";
  if (tier.provider === "openai-compatible") {
    // gpt-oss spends most of its output on reasoning; "low" is plenty for picking a search and a
    // three-line reply, and it is output tokens that the per-minute limit counts too.
    const effort = process.env.OPENAI_COMPAT_REASONING_EFFORT ?? (/gpt-oss/.test(model) ? "low" : "");
    return { model, messages, tools: toolDef(), tool_choice, temperature: 0.2, max_tokens: 800, ...(effort ? { reasoning_effort: effort } : {}) };
  }
  const effort = openAIEffort(model), thinking = effort !== null && effort !== "none";
  return { model, messages: messages.map(({ name: _name, ...m }) => m), tools: toolDef(), tool_choice,
    ...(thinking ? {} : { temperature: 0.2 }),
    // Reasoning tokens count against max_completion_tokens, so a reasoning effort needs headroom.
    max_completion_tokens: thinking ? 2000 : 800,
    ...(effort !== null ? { reasoning_effort: effort } : {}), store: false };
}

/** `deadline` is an absolute ms timestamp. Each call gets whatever time is left, so four slow steps
 *  cannot add up past the route's 60 s limit - where the function would be killed with nothing logged.
 *  Throws on a provider failure (rate limit, outage, timeout) so ask() can try the next model. */
export async function askOpenAICompat(question: string, history: { role: "user" | "assistant"; content: string }[], t0: number,
  deadline = t0 + 40_000, model = compatModels()[0]): Promise<AskResult> {
  const tier = tiers().find(t => t.models.includes(model));
  if (!tier) throw new Error(`${model}: no configured provider serves this model`);
  const messages: Msg[] = [{ role: "system", content: SYSTEM }, ...history.slice(-4).map(h => ({ role: h.role, content: h.content }) as Msg), { role: "user", content: question }];
  const trace: AskResult["trace"] = [];
  const pool: SearchHit[] = [];
  // The retrieval floor (see seedSearch): the rep's own words, searched before the model says anything.
  const sq = searchText(question, history); // what to search for: a short follow-up carries the previous question
  const seed = seedSearch(sq);
  if (seed) {
    pool.push(...seed.hits);
    trace.push({ step: SEED_STEP, detail: JSON.stringify(seed.input) }, { step: "tool result", detail: `${seed.hits.length} of ${seed.considered} assets${seed.note ? ` - ${seed.note}` : ""}` });
    messages.push({ role: "assistant", content: null, tool_calls: [{ id: "seed", type: "function", function: { name: "search_assets", arguments: JSON.stringify({ query: sq }) } }] },
      { role: "tool", tool_call_id: "seed", name: "search_assets", content: toolPayload(seed.hits, seed.note, numbering(pool)) });
  }
  let filters: Record<string, unknown> = seed ? { ...seed.input } : {}, calls = seed ? 1 : 0, tokens = 0;
  const done = (text: string, error: AskError | null) => {
    trace.push({ step: "model", detail: `${model} (${tier.provider}) · ${((Date.now() - t0) / 1000).toFixed(1)}s · ${tokens} tokens` });
    return finish({ question: sq, turn: question, text, pool, calls, runtime: "openai-compatible", model, trace, filters, error });
  };
  for (let round = 0; ; round++) {
    // The last round runs with tools off, so the model must answer from what it found. Before, it
    // could search on every round and the rep was shown "The model ran out of steps before answering."
    const final = calls >= MAX_SEARCHES || round >= MAX_SEARCHES;
    const r = await fetch(`${tier.base}/chat/completions`, {
      method: "POST", headers: { Authorization: `Bearer ${tier.key}`, "Content-Type": "application/json" },
      body: JSON.stringify(requestBody(tier, model, messages, final)),
      signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
    });
    if (!r.ok) {
      const detail = redact(`${model} returned ${r.status}: ${(await r.text()).slice(0, 200)}`);
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
      const s = runSearch(raw, sq);
      calls++; filters = { ...s.input };
      pool.push(...s.hits);
      trace.push({ step: "tool call: search_assets", detail: JSON.stringify(s.input) }, { step: "tool result", detail: `${s.hits.length} of ${s.considered} assets${s.note ? ` - ${s.note}` : ""}` });
      // Numbered across the whole turn, so a pick means the same result whichever search returned it.
      messages.push({ role: "tool", tool_call_id: tc.id, name: "search_assets", content: toolPayload(s.hits, s.note, numbering(pool)) });
    }
    if (calls >= MAX_SEARCHES) messages.push({ role: "system", content: BUDGET_USED });
  }
}
