import Anthropic from "@anthropic-ai/sdk";
import { searchAssets, facetCounts, VERTICALS, PRODUCTS, yearOf, isStale, assetLink, assetLocation, type SearchHit, type Asset } from "./cards";
import { askOpenAICompat, openAICompatConfigured } from "./agent-openai";

export type AskResult = {
  text: string;
  assets: { title: string; asset_type: string; industry: string; why: string; link: string | null; location: string | null; visibility: string; year: string | null; stale: boolean; path: string | null }[];
  trace: { step: string; detail: string }[];
  runtime: "claude" | "local" | "search";
  intent: string;
  filters: Record<string, unknown>;
  zero: boolean;
};

export const SYSTEM = `You are SAM, the sales and marketing brain for Accops, an Indian cybersecurity and digital workspace company
(HySecure ZTNA, HyID MFA/SSO, HyWorks VDI/DaaS, HyLabs, HyDesk, Browser Isolation). You help salespeople find the right
collateral fast and tell them how to use it.

Rules:
- Recommend ONLY assets returned by search_assets. Never invent a document, client or number.
- Call search_assets with sensible filters. **You have at most 3 searches.** If a search returns nothing or nothing
  suitable, do not repeat it with reworded text: drop a filter (asset_type, then product, then vertical) and widen.
  After 3 searches you must answer from what you have, even if the answer is "we do not have this".
- Accops has no battlecards, comparison sheets or decks in this library — only case studies and whitepapers. If asked
  for one, say so plainly and offer the closest case study or whitepaper instead.
- **No asset has a public link yet**, so nothing can be forwarded outside Accops today. When someone asks for
  something to send to a customer, search with audience "internal", recommend the right assets, and add one line:
  these are internal only, so ask marketing to publish before sending. Never search with audience "external" —
  it always returns nothing and is not a real gap.
- Reply shape: one sentence of verdict, then up to three assets. For each: exact title, one line on why it fits THIS ask.
  Do not paste links; the interface renders them from your tool results.
- If nothing fits, say so in the first sentence, offer the two nearest substitutes, and name the gap plainly.
- Client names in case studies are anonymised in outbound use. Refer to clients by descriptor unless the card says the client is named.
- Under 120 words. No greetings, no sign-off.`;

const tools: Anthropic.Tool[] = [{
  name: "search_assets",
  description: "Search Accops sales and marketing collateral (case studies, whitepapers). Returns ranked asset cards with why they matched.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "What the salesperson needs, in plain words: use case, competitor, regulator, persona." },
      asset_type: { type: "string", enum: ["Case Study", "Whitepaper", ""], description: "Optional filter." },
      vertical: { type: "string", enum: [...Object.keys(VERTICALS), ""], description: "Optional industry filter." },
      product: { type: "string", enum: [...PRODUCTS, ""], description: "Optional product filter." },
      audience: { type: "string", enum: ["internal", "external"], description: "external = only assets with a public URL." },
      limit: { type: "integer", minimum: 1, maximum: 8 },
    },
    required: ["query"],
    additionalProperties: false,
  },
  strict: true,
}];

export function toCard(h: SearchHit) {
  const a = h.asset;
  return { title: a.title, asset_type: a.asset_type, industry: a.industry, why: h.why, link: assetLink(a), location: assetLocation(a),
    visibility: a.public_url ? "public" : "internal", year: yearOf(a), stale: isStale(a), path: a.file?.path ?? null };
}
export function toolPayload(hits: SearchHit[], considered: number) {
  return JSON.stringify({ total_considered: considered, results: hits.map(h => ({
    title: h.asset.title, asset_type: h.asset.asset_type, industry: h.asset.industry, client: h.asset.client,
    products: h.asset.products, use_for: h.asset.use_for, brief: (h.asset.brief || h.asset.key_problem || "").slice(0, 300),
    key_outcomes: h.asset.key_outcomes.slice(0, 4), year: yearOf(h.asset), stale: isStale(h.asset),
    visibility: h.asset.public_url ? "public" : "internal", why_match: h.why })) });
}

/** Heuristic slot extraction used by the local fallback and as a hint for logging. */
export function heuristicFilters(q: string) {
  const p = q.toLowerCase();
  const vertical = Object.entries(VERTICALS).find(([, words]) => words.some(w => p.includes(w)))?.[0] ?? "";
  const asset_type = /white ?paper|guide|ebook|pov/.test(p) ? "Whitepaper" : /case stud|proof|reference|customer story|deployment/.test(p) ? "Case Study" : "";
  const product = PRODUCTS.find(x => p.includes(x.toLowerCase())) ?? "";
  const audience: "internal" | "external" = /send to|share with|forward|customer-facing|public|external/.test(p) ? "external" : "internal";
  return { vertical, asset_type, product, audience };
}

export async function ask(question: string, history: { role: "user" | "assistant"; content: string }[] = []): Promise<AskResult> {
  const t0 = Date.now();
  const providerErrors: string[] = [];
  if (openAICompatConfigured()) {
    try { return await askOpenAICompat(question, history, t0); }
    catch (err) { console.error("openai-compatible path failed, falling back", err); providerErrors.push(`${process.env.OPENAI_COMPAT_MODEL}: ${(err as Error).message}`); }
  }
  if (process.env.ANTHROPIC_API_KEY) {
    try { return await askClaude(question, history, t0); }
    catch (err) { console.error("claude path failed, falling back", err); providerErrors.push(`${process.env.CLAUDE_MODEL ?? "claude"}: ${(err as Error).message}`); }
  }
  const local = askLocal(question, t0);
  // Surface provider failures in the trace so a silent fallback is visible in the UI, API and dashboard.
  for (const e of providerErrors) local.trace.unshift({ step: "model provider failed, fell back to retrieval", detail: e.slice(0, 300) });
  return local;
}

async function askClaude(question: string, history: { role: "user" | "assistant"; content: string }[], t0: number): Promise<AskResult> {
  const client = new Anthropic();
  const model = process.env.CLAUDE_MODEL ?? "claude-sonnet-5";
  // Effort is supported on Opus/Sonnet 4.6+ and errors on Haiku 4.5, so only send it where it works.
  const effort = /haiku/.test(model) ? {} : { output_config: { effort: "medium" as const } };
  const messages: Anthropic.MessageParam[] = [...history.slice(-6), { role: "user", content: question }];
  const trace: AskResult["trace"] = [];
  let lastHits: SearchHit[] = [], filters: Record<string, unknown> = {}, calls = 0, firstZero = false;
  for (let i = 0; i < 4; i++) {
    const res = await client.messages.create({ model, max_tokens: 2000, system: SYSTEM, tools, messages, ...effort });
    const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || toolUses.length === 0) {
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map(b => b.text).join("\n").trim();
      trace.push({ step: "model", detail: `${model} · ${((Date.now() - t0) / 1000).toFixed(1)}s · ${res.usage.input_tokens} in / ${res.usage.output_tokens} out` });
      return { text: text || "No answer was produced.", assets: lastHits.slice(0, 3).map(toCard), trace, runtime: "claude",
        intent: calls ? (firstZero ? "gap" : "find_asset") : "other", filters, zero: firstZero };
    }
    messages.push({ role: "assistant", content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const input = tu.input as Record<string, string | number>;
      calls++; filters = { ...input };
      trace.push({ step: "tool call: search_assets", detail: JSON.stringify(input) });
      const { results: hits, considered } = searchAssets({ query: String(input.query ?? ""), asset_type: String(input.asset_type ?? "") || undefined,
        vertical: String(input.vertical ?? "") || undefined, product: String(input.product ?? "") || undefined,
        audience: (input.audience as "internal" | "external") || "internal", limit: Number(input.limit ?? 5) });
      if (calls === 1 && hits.length === 0) firstZero = true;
      if (hits.length) lastHits = hits;
      trace.push({ step: "tool result", detail: `${hits.length} of ${considered} assets` });
      results.push({ type: "tool_result", tool_use_id: tu.id, content: toolPayload(hits, considered) });
    }
    messages.push({ role: "user", content: results });
  }
  // Search budget exhausted. Answer from whatever the searches did find rather than showing an error,
  // and treat "nothing found" as a genuine gap so it is logged and reported like any other.
  trace.push({ step: "search budget reached", detail: `${calls} searches; answering from the best results found` });
  const cards = lastHits.slice(0, 3).map(toCard);
  const text = cards.length
    ? `No exact match. The closest ${cards.length === 1 ? "asset" : "assets"} in the library:`
    : "Nothing in the library matches that. The library holds case studies and whitepapers only, so battlecards, comparison sheets and decks are not here. Try an industry or product, or browse the catalogue.";
  return { text, assets: cards, trace, runtime: "claude", intent: cards.length ? "find_asset" : "gap", filters, zero: cards.length === 0 };
}

function askLocal(question: string, t0: number): AskResult {
  const f = heuristicFilters(question);
  const trace: AskResult["trace"] = [{ step: "router (local heuristics)", detail: JSON.stringify(Object.fromEntries(Object.entries(f).filter(([, v]) => v))) }];
  // Nothing is published externally yet, so an external filter would always return nothing. Search internally
  // and tell the user about the restriction instead of reporting a false gap.
  const askedExternal = f.audience === "external";
  let args = { query: question, ...f, audience: "internal" as const, limit: 3 } as Parameters<typeof searchAssets>[0];
  trace.push({ step: "tool call: search_assets", detail: JSON.stringify(args) });
  let { results, considered } = searchAssets(args);
  const exactZero = results.length === 0;
  if (!results.length && (f.asset_type || f.product)) {
    args = { ...args, asset_type: undefined, product: undefined };
    trace.push({ step: "tool call: search_assets (relaxed)", detail: JSON.stringify(args) });
    ({ results, considered } = searchAssets(args));
  }
  trace.push({ step: "tool result", detail: `${results.length} of ${considered} assets` });
  trace.push({ step: "model", detail: `none, retrieval only · ${Date.now() - t0}ms` });
  const label = f.vertical ? ` for ${f.vertical}` : "";
  let text: string;
  const want = [f.vertical, f.product, f.asset_type?.toLowerCase()].filter(Boolean).join(" ");
  if (!results.length) text = `Nothing in the library matches that${label}. Try a broader industry, drop the product, or browse the catalogue on the right.`;
  else if (exactZero) text = `There is no ${want || "exact match"} in the library. Nearest substitutes${label}:`;
  else if (results.length === 1) text = `One asset fits${label}.`;
  else text = `${results.length} assets fit${label}. The first is the closest match.`;
  if (askedExternal && results.length) text += " All of these are internal only, so ask marketing to publish a version before sending it outside Accops.";
  return { text, assets: results.map(toCard), trace, runtime: "local", intent: exactZero ? "gap" : "find_asset", filters: f, zero: exactZero };
}

export function catalogueSummary() { return facetCounts(); }
export type { Asset };
