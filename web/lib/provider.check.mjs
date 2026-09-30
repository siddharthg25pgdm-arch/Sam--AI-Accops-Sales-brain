/** ponytail: one runnable check for the provider contract, with every network call stubbed.
 *  node lib/provider.check.mjs   (from web/)  ->  throws if any of these break:
 *    1. Groq's request body is byte-identical to the one production always sent
 *    2. OpenAI gets its own shape per model family (max_completion_tokens, temperature only when not
 *       reasoning, reasoning_effort only where valid, no `name` on tool messages, store:false)
 *    3. order: OpenAI primary -> OpenAI fallback -> Groq primary -> Groq fallback -> retrieval, each with its own key
 *    4. the answering model is recorded (model field + trace names the tier)
 *    5. GET /api/v1/provider reports every tier, pings each model with the real body, never returns a key */
import assert from "node:assert";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@": web } });

const GROQ = { LLM_PROVIDER: "openai-compatible", OPENAI_COMPAT_BASE_URL: "https://api.groq.com/openai/v1",
  OPENAI_COMPAT_API_KEY: "gsk_stub_GROQ", OPENAI_COMPAT_MODEL: "openai/gpt-oss-120b" };
const OPENAI_VARS = ["OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_FALLBACK_MODEL", "OPENAI_REASONING_EFFORT", "OPENAI_BASE_URL",
  "OPENAI_COMPAT_FALLBACK_MODEL", "OPENAI_COMPAT_REASONING_EFFORT", "ANTHROPIC_API_KEY"];
const env = (extra = {}) => { for (const k of OPENAI_VARS) delete process.env[k]; Object.assign(process.env, GROQ, extra); };
Object.assign(process.env, { SUPABASE_URL: "https://stub.supabase.co", SUPABASE_SERVICE_KEY: "stub", SAM_API_TOKENS: "check:tok_check" });
env();

// ---- stubbed network: empty Supabase, and per-host scripted models
let calls = [], script = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const host = u.includes("api.openai.com") ? "openai" : u.includes("api.groq.com") ? "groq" : null;
  if (!host) return Response.json([]); // supabase: no registry rows, no cards, event writes accepted
  if (u.endsWith("/models")) return Response.json({ data: [{ id: "gpt-6-luna" }, { id: "openai/gpt-oss-120b" }] });
  const body = JSON.parse(init.body);
  calls.push({ host, body, auth: init.headers.Authorization });
  const step = script.shift() ?? (() => ({ role: "assistant", content: "ok" }));
  const out = step(body);
  if (out.status) return new Response(JSON.stringify({ error: { message: out.text ?? "err" } }), { status: out.status });
  return Response.json({ model: body.model, choices: [{ message: out }], usage: { total_tokens: 42 } });
};
const run = (steps) => { script = [...steps]; calls = []; };

const { tiers, compatModels, requestBody, openAIEffort } = await jiti.import("./agent-openai.ts");
const { ask } = await jiti.import("./agent.ts");
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const msgs = [{ role: "system", content: "s" }, { role: "user", content: "q" },
  { role: "assistant", content: null, tool_calls: [{ id: "seed", type: "function", function: { name: "search_assets", arguments: "{}" } }] },
  { role: "tool", tool_call_id: "seed", name: "search_assets", content: "[]" }];

// 1. Groq only (today's production): body unchanged, byte for byte.
const groq = tiers()[0];
ok(tiers().length === 1 && groq.provider === "openai-compatible", "Groq alone is one compat tier");
ok(compatModels().join() === "openai/gpt-oss-120b,openai/gpt-oss-20b", `Groq chain: ${compatModels()}`);
for (const final of [false, true]) {
  const legacy = JSON.stringify({ model: "openai/gpt-oss-120b", messages: msgs, tools: requestBody(groq, "x", [], false).tools,
    tool_choice: final ? "none" : "auto", temperature: 0.2, max_tokens: 800, reasoning_effort: "low" });
  ok(JSON.stringify(requestBody(groq, "openai/gpt-oss-120b", msgs, final)) === legacy, `Groq body changed (final=${final})`);
}
process.env.OPENAI_COMPAT_REASONING_EFFORT = "";
ok(!("reasoning_effort" in requestBody(groq, "openai/gpt-oss-120b", msgs, false)), "compat effort '' sends none");
delete process.env.OPENAI_COMPAT_REASONING_EFFORT;
run([]);
let r = await ask("citrix comparison");
ok(calls.every(c => c.host === "groq" && c.auth === "Bearer gsk_stub_GROQ" && "max_tokens" in c.body && !("store" in c.body)), "Groq-only traffic is unchanged");
ok(r.model === "openai/gpt-oss-120b" && r.trace.some(t => t.step === "model" && t.detail.includes("(openai-compatible)")), "Groq answer recorded as before");

// 2. OpenAI shapes per model family.
env({ OPENAI_API_KEY: "sk-stub-OPEN" });
const oa = tiers()[0];
ok(oa.provider === "openai" && oa.base === "https://api.openai.com/v1" && oa.models.join() === "gpt-6-luna", `OpenAI tier: ${JSON.stringify({ ...oa, key: "" })}`);
const shape = (model) => requestBody(oa, model, msgs, false);
const b = shape("gpt-6-luna");
ok(b.max_completion_tokens === 800 && !("max_tokens" in b), "OpenAI uses max_completion_tokens");
ok(b.reasoning_effort === "none" && b.temperature === 0.2, "gpt-6-luna: effort none (required for tools in Chat Completions), temperature allowed");
ok(b.store === false && b.tools.length === 1 && b.tool_choice === "auto", "store:false, tools kept");
ok(b.messages.every(m => !("name" in m)) && b.messages[3].tool_call_id === "seed", "no name on tool messages");
ok(requestBody(oa, "gpt-6-luna", msgs, true).tool_choice === "none", "forced round is tool_choice none");
for (const [model, effort, temp, max] of [["gpt-5.4-mini", "none", true, 800], ["gpt-5.6-luna", "none", true, 800], ["gpt-6-sol", "none", true, 800],
  ["gpt-5-mini", "minimal", false, 2000], ["gpt-5-nano-2025-08-07", "minimal", false, 2000], ["o4-mini", "low", false, 2000],
  ["gpt-4.1-mini", undefined, true, 800], ["gpt-4o-mini", undefined, true, 800]]) {
  const s = shape(model);
  ok(s.reasoning_effort === effort && ("temperature" in s) === temp && s.max_completion_tokens === max && !("max_tokens" in s),
    `${model}: ${JSON.stringify({ e: s.reasoning_effort, t: s.temperature, m: s.max_completion_tokens })}`);
}
process.env.OPENAI_REASONING_EFFORT = "low";
ok(shape("gpt-6-luna").reasoning_effort === "low" && !("temperature" in shape("gpt-6-luna")), "effort override drops temperature");
process.env.OPENAI_REASONING_EFFORT = "";
ok(openAIEffort("gpt-6-luna") === null && !("reasoning_effort" in shape("gpt-6-luna")), "effort '' sends none");
delete process.env.OPENAI_REASONING_EFFORT;

// 3. Order and keys: OpenAI -> Groq -> retrieval.
ok(compatModels().join() === "gpt-6-luna,openai/gpt-oss-120b,openai/gpt-oss-20b", `chain: ${compatModels()}`);
run([]);
r = await ask("citrix comparison");
ok(calls[0].host === "openai" && calls[0].auth === "Bearer sk-stub-OPEN" && calls[0].body.model === "gpt-6-luna", "OpenAI answers first, with its key");
ok(r.model === "gpt-6-luna" && r.runtime === "openai-compatible" && r.trace.some(t => t.step === "model" && t.detail.startsWith("gpt-6-luna (openai)")), "OpenAI answer recorded");

run([() => ({ status: 429, text: "Rate limit reached for gpt-6-luna" })]);
r = await ask("citrix comparison");
ok(calls.map(c => `${c.host}:${c.body.model}`).slice(0, 2).join() === "openai:gpt-6-luna,groq:openai/gpt-oss-120b", `OpenAI 429 -> Groq: ${calls.map(c => c.body.model)}`);
ok(calls[1].auth === "Bearer gsk_stub_GROQ" && "max_tokens" in calls[1].body && !("store" in calls[1].body), "Groq tier keeps its own key and body");
ok(r.model === "openai/gpt-oss-120b" && r.error?.kind === "provider_error" && /gpt-6-luna.*429/.test(r.error.detail), `recovered failure recorded: ${JSON.stringify(r.error)}`);

run([() => ({ status: 500 }), () => ({ status: 429 }), () => ({ status: 429 })]);
r = await ask("citrix comparison");
ok(calls.map(c => c.body.model).join() === "gpt-6-luna,openai/gpt-oss-120b,openai/gpt-oss-20b", `full chain: ${calls.map(c => c.body.model)}`);
ok(r.runtime === "local" && r.model === null && r.error?.kind === "fallback_retrieval", "everything down -> retrieval");

env({ OPENAI_API_KEY: "sk-stub-OPEN", OPENAI_MODEL: "gpt-6-luna", OPENAI_FALLBACK_MODEL: "gpt-5.4-mini" });
ok(compatModels().join() === "gpt-6-luna,gpt-5.4-mini,openai/gpt-oss-120b,openai/gpt-oss-20b", `with OpenAI fallback: ${compatModels()}`);
run([() => ({ status: 503 })]);
r = await ask("citrix comparison");
ok(calls[1].host === "openai" && calls[1].body.model === "gpt-5.4-mini" && r.model === "gpt-5.4-mini", "OpenAI fallback model before Groq");

// OpenAI alone (Groq vars removed): one tier, no Groq default fallback leaks in.
env({ OPENAI_API_KEY: "sk-stub-OPEN", LLM_PROVIDER: "" });
ok(compatModels().join() === "gpt-6-luna", `OpenAI only: ${compatModels()}`);
// A compat URL pointing at OpenAI is detected by host and gets OpenAI's shape (and no gpt-oss fallback).
env({ OPENAI_COMPAT_BASE_URL: "https://api.openai.com/v1/", OPENAI_COMPAT_MODEL: "gpt-6-luna" });
ok(tiers()[0].provider === "openai" && compatModels().join() === "gpt-6-luna" && "max_completion_tokens" in requestBody(tiers()[0], "gpt-6-luna", msgs, false), "OpenAI detected by base URL");

// 5. The provider endpoint.
env({ OPENAI_API_KEY: "sk-stub-OPEN" });
const { GET } = await jiti.import("../app/api/v1/provider/route.ts");
run([]);
const res = await GET(new Request("https://sam/api/v1/provider", { headers: { Authorization: "Bearer tok_check" } }));
const txt = await res.text(), j = JSON.parse(txt);
ok(j.provider === "openai" && j.model === "gpt-6-luna" && j.order.join() === "gpt-6-luna (openai),openai/gpt-oss-120b (openai-compatible),openai/gpt-oss-20b (openai-compatible),retrieval only", `order: ${j.order}`);
ok(j.tiers[0].available["gpt-6-luna"] === true && j.tiers[0].ping[0].ok && j.tiers[0].key === "...OPEN", "tier checked and pinged");
ok(j.tiers[1].ping.length === 2 && j.tiers[1].available["openai/gpt-oss-20b"] === false, "Groq models checked too");
ok(!txt.includes("sk-stub-OPEN") && !txt.includes("gsk_stub_GROQ"), "no key in the response");
const pingBody = calls.find(c => c.host === "openai").body;
ok(pingBody.max_completion_tokens && pingBody.tools && pingBody.reasoning_effort === "none", "ping uses the real OpenAI body");

console.log(`provider.check: ${n} assertions passed`);
