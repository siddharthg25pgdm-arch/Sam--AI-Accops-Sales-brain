// Run: node web/lib/web-answer.check.mjs - Stream B's acceptance (plan 9), with every network call stubbed:
// Supabase (as sam_web_reader), OpenAI and Groq are a fake fetch; Stream F's and G's functions
// (bot/limits/guard/cache/intent) are aliased to a scripted stub, so this checks B's orchestration alone.
import assert from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stub = path.join(mkdtempSync(path.join(tmpdir(), "web-answer-")), "stub.mjs");
writeFileSync(stub, `const S = () => globalThis.__S;
export const classify = async () => S().label;
export const admit = async (ctx, kind, h) => { S().admits.push([kind, h]); return S().admit; };
export const preGuard = t => S().guard(t);
export const cacheGet = async h => S().cached;
export const cachePut = async (h, g, a, src) => { S().puts.push({ h, g, a, src }); };
export const intentMatch = t => S().intent;`);
const alias = { "@": web };
for (const m of ["bot", "limits", "guard", "cache", "intent"]) alias[`@/lib/web/${m}`] = stub;
const jiti = createJiti(import.meta.url, { alias });

const SECRETS = { OPENAI_API_KEY: "sk-proj-CHECKSECRETopenai0000000000", OPENAI_COMPAT_API_KEY: "gsk_CHECKSECRETgroq00000000000",
  SAM_WEB_READER_JWT: "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2FtX3dlYl9yZWFkZXIifQ.CHECKSECRETsignature000" };
const ENV = { ...SECRETS, WEB_CHAT_ENABLED: "1", SUPABASE_URL: "https://stub.supabase.co", SAM_WEB_SUPABASE_APIKEY: "sb_publishable_stub",
  WEB_IP_SALT: "salt", OPENAI_COMPAT_BASE_URL: "https://api.groq.com/openai/v1", WEB_EMBED_ORIGINS: "https://accops-citrix-lp.vercel.app",
  WEB_EVAL_TOKEN: "evaltok" };
Object.assign(process.env, ENV);

// ---- fixtures (shapes of plan 5 / 7.7)
const QA = {
  "lp-renewal-1": { id: "lp-renewal-1", question: "Why did my Citrix renewal go up?", answer: "Citrix moved to subscription bundles, so many renewals now include components you may not use.",
    visual: "compare_table", visual_data: { title: "Accops vs Citrix", columns: ["", "Accops", "Citrix"], rows: [{ label: "Licensing", cells: ["Perpetual or subscription", "Subscription only"], group: "Licensing" }] },
    cta: null, cta_url: null, sources: ["https://accops-citrix-lp.vercel.app/#compare"] },
  "lp-steps-1": { id: "lp-steps-1", question: "How does migration work?", answer: "Migration runs side by side with Citrix, one user group at a time.",
    visual: "steps", visual_data: { title: "Migration", steps: [{ title: "Assess" }, { title: "Pilot" }, { title: "Cut over" }] },
    cta: "Plan my migration", cta_url: "https://www.accops.com/schedule-a-free-demo", sources: ["https://accops-citrix-lp.vercel.app/#migrate"] },
  "lp-calc-1": { id: "lp-calc-1", question: "What would it cost?", answer: "It depends on seats.", visual: "calculator",
    visual_data: { title: "TCO", input: { label: "Seats", min: 1, max: 10, step: 1, default: 5, unit: "seats" }, columns: ["A", "B"],
      rows: [{ label: "Cost", per_unit: [1, 2], currency: "$" }], disclaimer: "Illustrative placeholder figures only." },
    cta: null, cta_url: null, sources: ["https://accops-citrix-lp.vercel.app/"] },
};
const CANDS = [
  { ref: "qa:lp-renewal-1", kind: "qa", types: ["text", "compare_table"], title: QA["lp-renewal-1"].question, text: QA["lp-renewal-1"].answer, url: null },
  { ref: "fact:hysecure-1", kind: "fact", types: ["text"], title: "HySecure", text: "HySecure is ISO 27001:2022 certified.", url: "https://www.accops.com/hysecure" },
  { ref: "asset:7", kind: "asset", types: ["doc_card"], title: "Accops vs Citrix brochure", text: "A two-page comparison.", url: "https://www.accops.com/docs/citrix.pdf" },
  { ref: "qa:lp-steps-1", kind: "qa", types: ["text", "steps"], title: QA["lp-steps-1"].question, text: QA["lp-steps-1"].answer, url: null },
];
const ROOTS = [{ id: "lp-renewal-1", question: QA["lp-renewal-1"].question }, { id: "lp-steps-1", question: QA["lp-steps-1"].question }, { id: "lp-x", question: "Does it run on Nutanix?" }];

// ---- stubbed network
let N; // per-scenario counters + scripts
const fresh = (o = {}) => {
  N = { model: [], slots: [], logs: [], events: [], rpc: [], openai: [], groq: [], slot: { openai: true, groq: true },
    settings: { enabled: true, model_enabled: true, cta_url: "https://www.accops.com/schedule-a-free-demo", cta_label: "Talk to an expert" }, dbDown: null, logFails: false, cands: CANDS, ...o };
  globalThis.__S = { label: { label: "human", signals: [] }, admit: null, admits: [], guard: () => null, cached: null, puts: [], intent: null, ...(o.S ?? {}) };
  N.puts = globalThis.__S.puts;
};
const reply = (content, tokens = 900) => Response.json({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }], usage: { total_tokens: tokens } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.host === "stub.supabase.co") {
    if (init.headers?.Authorization !== `Bearer ${SECRETS.SAM_WEB_READER_JWT}` || init.headers?.apikey !== "sb_publishable_stub") throw new Error("not the reader");
    const fn = u.pathname.replace("/rest/v1/", ""), args = init.body ? JSON.parse(init.body) : null;
    N.rpc.push(fn);
    if (N.dbDown && N.dbDown.test(fn)) return new Response(JSON.stringify({ code: "PGRST202", message: `Could not find the function public.${fn}` }), { status: 404 });
    switch (fn) {
      case "rpc/sam_web_settings": return Response.json(N.settings);
      case "rpc/sam_web_page_group": return Response.json(args.url.includes("citrix") ? "citrix-lp" : null);
      case "rpc/sam_web_roots": return Response.json(ROOTS);
      case "rpc/sam_web_children": return Response.json(args.qa_id === "lp-renewal-1" ? [ROOTS[1], ROOTS[2]] : []);
      case "rpc/sam_web_search": return Response.json(N.cands);
      case "rpc/sam_web_take_model_slot": N.slots.push(args.provider); return Response.json(N.slot[args.provider]);
      case "rpc/sam_web_log_message":
        if (N.logFails) return new Response(`denied for Bearer ${SECRETS.SAM_WEB_READER_JWT}`, { status: 401 });
        N.logs.push(args.m); return new Response(null, { status: 204 });
      case "rpc/sam_web_log_event": N.events.push(args.e); return new Response(null, { status: 204 });
      case "sam_web_qa_public": {
        const ids = decodeURIComponent(u.searchParams.get("id")).replace(/^in\.\(|\)$/g, "").split(",").map(s => s.replace(/"/g, ""));
        return Response.json(ids.map(i => QA[i]).filter(Boolean));
      }
    }
    return new Response("unknown", { status: 404 });
  }
  const host = u.host === "api.openai.com" ? "openai" : u.host === "api.groq.com" ? "groq" : null;
  assert.ok(host, `unexpected fetch ${u}`);
  const body = JSON.parse(init.body);
  N.model.push({ host, body });
  const step = N[host].shift();
  assert.ok(step, `unscripted ${host} call`);
  return step(body, init);
};

// capture console output for the key check
const printed = [];
for (const k of ["log", "warn", "error"]) { const o = console[k]; console[k] = (...a) => { printed.push(a.join(" ")); if (k !== "warn") o(...a); }; }

const { ask } = await jiti.import("./web/answer.ts");
const { Answer } = await jiti.import("./blocks.ts");
const { qHash } = await jiti.import("./web/normalise.ts");
const { LEAD } = await jiti.import("./web/fill.ts");
const config = await jiti.import("../app/api/web/config/route.ts");
const event = await jiti.import("../app/api/web/event/route.ts");

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const bodies = [];
const BASE = { conversation_id: "c_1", visitor_id: "v_1", page: "https://accops-citrix-lp.vercel.app/", hs: "hs", parent: true, ms_since_render: 5000, recent_ms: [1000] };
const SAME = { origin: "https://sam.test", "sec-fetch-site": "same-origin" };
const req = (body, headers = SAME) => new Request("https://sam.test/api/web/ask", { method: "POST",
  headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0", "x-forwarded-for": "203.0.113.9", "x-vercel-ip-country": "IN", ...headers }, body: JSON.stringify(body) });
const run = async (body, headers) => {
  const r = await ask(req(body, headers));
  if (r.log) await r.log();
  if (r.status === 200 || r.status === 429) {
    bodies.push(r.body);
    ok(Answer.safeParse({ lead: r.body.lead, blocks: r.body.blocks, chips: r.body.chips }).success, `renderable: ${JSON.stringify(r.body)}`);
    ok(typeof r.body.message_id === "string" && typeof r.body.source === "string", "message_id + source");
  }
  return r;
};
const typed = (text, x = {}) => ({ ...BASE, turn: { kind: "typed", text }, ...x });
const click = (qa_id, x = {}) => ({ ...BASE, turn: { kind: "click", qa_id }, ...x });
const picks = (verdict, blocks) => () => reply({ verdict, blocks });

// 1. a click and an intent hit never call a model
fresh();
let r = await run(click("lp-renewal-1"));
ok(r.body.source === "bank" && N.model.length === 0 && N.slots.length === 0, "click -> bank, no model, no slot");
ok(r.body.blocks.map(b => b.type).join() === "text,compare_table" && r.body.blocks[0].body === QA["lp-renewal-1"].answer, "bank = verbatim answer + its visual");
ok(r.body.blocks[0].source.label === "accops-citrix-lp.vercel.app" && r.body.chips.map(c => c.id).join() === "lp-steps-1,lp-x", "source pill + children chips");
ok(N.logs[0].source === "bank" && N.logs[0].label === "human" && N.logs[0].country === "IN" && N.logs[0].qa_id === "lp-renewal-1", "logged");
fresh({ S: { intent: { qa_id: "lp-steps-1", score: 5, margin: 0.4 } } });
r = await run(typed("how does the migration work"));
ok(r.body.source === "intent" && N.model.length === 0 && N.slots.length === 0 && !N.rpc.includes("rpc/sam_web_search"), "intent hit -> no model, no search");
ok(r.body.blocks.at(-1).type === "cta" && r.body.blocks.at(-1).label === "Plan my migration", "a pair's own CTA");
fresh({ S: { intent: { qa_id: "retired-1", score: 5, margin: 0.4 } } }); N.openai.push(picks("answered", [{ type: "text", ref: "fact:hysecure-1" }]));
r = await run(typed("is hysecure certified"));
ok(r.body.source === "model", "an intent hit on a retired pair falls through");
fresh(); r = await run(click("lp-calc-1"));
ok(r.body.blocks.every(b => b.type !== "calculator"), "a calculator without figures_approved is never shown");
fresh(); r = await run(click("does-not-exist"));
ok(r.body.source === "fallback" && r.body.lead === LEAD.none && N.model.length === 0, "unknown click -> fallback");

// 2. a cache hit never calls a model
fresh({ S: { cached: { lead: LEAD.partial, blocks: [{ type: "text", body: "cached" }], chips: [] } } });
r = await run(typed("anything at all"));
ok(r.body.source === "cache" && r.body.blocks[0].body === "cached" && N.model.length === 0 && N.slots.length === 0, "cache hit -> no model");

// 3. a bot or suspect never reaches tier 3
for (const label of ["bot", "suspect"]) {
  fresh({ S: { label: { label, signals: ["ua"] } } });
  r = await run(typed("tell me about hysecure"));
  ok(r.body.source === "fallback" && N.model.length === 0 && N.slots.length === 0 && N.logs[0].label === label, `${label} -> fallback, no model, no slot`);
}

// 4. WEB_MODEL_OFF / model_enabled=false / ceiling reached -> no model call
fresh(); process.env.WEB_MODEL_OFF = "1";
r = await run(typed("tell me about hysecure"));
ok(r.body.source === "fallback" && N.model.length === 0 && N.slots.length === 0, "WEB_MODEL_OFF");
delete process.env.WEB_MODEL_OFF;
fresh(); N.settings.model_enabled = false;
r = await run(typed("tell me about hysecure"));
ok(r.body.source === "fallback" && N.model.length === 0 && N.slots.length === 0, "model_enabled=false");
fresh(); N.slot.openai = false;
r = await run(typed("tell me about hysecure"));
ok(r.body.source === "fallback" && N.model.length === 0 && N.slots.join() === "openai" && N.puts.length === 0, "ceiling reached: no call, no Groq spill-over, nothing cached");
fresh({ cands: [] });
r = await run(typed("tell me about hysecure"));
ok(r.body.source === "fallback" && N.model.length === 0 && N.slots.length === 0, "no candidates -> no slot, no model");

// 5. a ref outside the candidates or with a wrong type is dropped (and the request is locked to this request's refs)
fresh(); N.openai.push(picks("answered", [{ type: "steps", ref: "qa:lp-renewal-1" }, { type: "text", ref: "qa:ghost" },
  { type: "compare_table", ref: "qa:lp-renewal-1" }, { type: "doc_card", ref: "fact:hysecure-1" }]));
r = await run(typed("why is the citrix renewal so expensive"));
ok(r.body.source === "model" && r.body.blocks.map(b => b.type).join() === "compare_table" && !r.body.lead, `only the valid pick survives: ${r.body.blocks.map(b => b.type)}`);
const sent = N.model[0].body, sch = sent.response_format.json_schema;
ok(sch.strict === true && sch.name === "answer" && JSON.stringify(sch.schema.properties.blocks.items.properties.ref.enum) === JSON.stringify(CANDS.map(c => c.ref)), "ref enum = this request's candidates");
ok(sent.model === "gpt-6-luna" && sent.max_completion_tokens === 300 && sent.reasoning_effort === "none" && sent.store === false && !("max_tokens" in sent), "OpenAI body");
ok(sent.messages[0].role === "system" && /never write text/.test(sent.messages[0].content), "fixed system prompt");
fresh({ cands: [{ ...CANDS[0], types: ["text"] }] }); // the record has a table, but this candidate only offers text
N.openai.push(picks("answered", [{ type: "compare_table", ref: "qa:lp-renewal-1" }, { type: "text", ref: "qa:lp-renewal-1" }]));
const r5 = await run(typed("why is the citrix renewal so expensive"));
ok(r5.body.blocks.map(b => b.type).join() === "text", "a type the candidate does not offer is dropped");
fresh(); N.openai.push(picks("partial", [{ type: "compare_table", ref: "qa:lp-renewal-1" }, { type: "compare_table", ref: "qa:lp-renewal-1" },
  { type: "text", ref: "fact:hysecure-1" }, { type: "doc_card", ref: "asset:7" }]));
r = await run(typed("compare accops and citrix"));
ok(r.body.blocks.map(b => b.type).join() === "compare_table,text,doc_card,cta" && r.body.lead === LEAD.partial, `dedupe + partial lead + CTA: ${r.body.blocks.map(b => b.type)}`);
ok(r.body.blocks[1].body === CANDS[1].text && r.body.blocks[1].source.url === "https://www.accops.com/hysecure", "fact = verbatim quote + its page");
ok(r.body.blocks[2].url === "https://www.accops.com/docs/citrix.pdf" && r.body.blocks[2].action === "download", "asset doc card");
ok(r.body.chips.map(c => c.id).join() === "lp-steps-1,lp-x", "chips from the top pair's children");
ok(N.logs[0].verdict === "partial" && N.logs[0].model === "gpt-6-luna" && N.logs[0].tokens === 900 && N.logs[0].candidates === 4, "tier-3 log fields");

// 6. timeout / 429 / bad JSON -> Groq; both fail -> fallback
const groqOk = picks("answered", [{ type: "text", ref: "fact:hysecure-1" }]);
const fails = {
  timeout: () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); },
  429: (b, init) => new Response(`rate limited; you sent ${init.headers.Authorization}`, { status: 429 }),
  500: () => new Response("upstream", { status: 503 }),
  "bad JSON": () => reply("Sure! Here is the answer: HySecure is great"),
  "wrong shape": () => reply({ verdict: "maybe", blocks: [] }),
};
for (const [why, f] of Object.entries(fails)) {
  fresh(); N.openai.push(f); N.groq.push(groqOk);
  r = await run(typed("is hysecure certified"));
  ok(r.body.source === "model" && N.model.map(m => m.host).join() === "openai,groq" && N.slots.join() === "openai,groq", `${why} -> Groq`);
  ok(N.logs[0].model === "openai/gpt-oss-20b", `${why}: Groq recorded`);
}
const g = N.model[1].body;
ok(g.max_tokens === 400 && g.reasoning_effort === "low" && g.temperature === 0 && !("max_completion_tokens" in g) && g.response_format.json_schema.strict, "Groq body");
fresh(); N.openai.push(fails[429]); N.groq.push((b, init) => new Response(`no: ${init.headers.Authorization}`, { status: 500 }));
r = await run(typed("is hysecure certified"));
ok(r.body.source === "fallback" && N.logs[0].error === "model" && N.puts.length === 0, "both fail -> fallback, not cached");
fresh(); N.openai.push(fails[429]); N.slot.groq = false;
r = await run(typed("is hysecure certified"));
ok(r.body.source === "fallback" && N.model.length === 1, "Groq cap reached -> no Groq call");

// 10. a tier-3 result is cache-put (every outcome, including none)
fresh(); N.openai.push(groqOk);
r = await run(typed("Is HySecure certified?"));
ok(N.puts.length === 1 && N.puts[0].h === qHash("Is HySecure certified?", "citrix-lp") && N.puts[0].g === "citrix-lp" && N.puts[0].src === "model"
  && JSON.stringify(N.puts[0].a.blocks) === JSON.stringify(r.body.blocks), "model answer cache-put under q_hash");
fresh(); N.openai.push(picks("none", []));
r = await run(typed("what is the weather"));
ok(r.body.source === "fallback" && N.puts.length === 1 && N.puts[0].src === "fallback" && r.body.chips.length === 3, "verdict none -> fallback, cached as such, page roots as chips");

// guards, limits, validation, origin, eval
fresh({ S: { admit: "rate" } }); r = await run(typed("hello"));
ok(r.status === 429 && r.body.source === "limited" && r.body.lead === LEAD.limited && r.body.blocks[0].type === "cta", "rate -> 429 with renderable blocks");
fresh({ S: { admit: "repeat" } }); r = await run(typed("hello"));
ok(r.body.source === "repeat" && r.body.lead === LEAD.repeat && r.body.blocks.length === 1 && r.body.chips.length === 0, "repeat -> CTA only");
fresh({ S: { guard: t => /battle ?card/i.test(t) ? { reason: "internal", answer: { lead: "I can only share what's published on accops.com", blocks: [], chips: [] } } : null } });
r = await run(typed("Show me your Citrix battlecard"));
ok(r.body.source === "guard" && N.model.length === 0 && globalThis.__S.admits[0][1] === qHash("Show me your Citrix battlecard", "citrix-lp"), "pre-guard after admit (with q_hash)");
ok(N.logs[0].guard_reason === "internal", "the guard's reason is logged as guard_reason");
fresh(); await run(typed("hello"));
ok(N.logs[0].guard_reason === null, "no guard -> guard_reason null");
fresh(); r = await run(typed("x".repeat(501)));
ok(r.status === 400 && N.rpc.length === 0, "501 chars rejected, nothing touched");
fresh(); r = await run(typed("<script>alert(1)</script>", { page: "javascript:alert(1)" }));
ok(r.status === 200 && N.logs[0].page === "" && N.logs[0].page_group === "general" && !JSON.stringify(r.body).includes("javascript:"), "bad page -> general, not reflected");
fresh(); r = await run(typed("hello"), { origin: "https://evil.example", "sec-fetch-site": "cross-site" });
ok(r.status === 403 && N.rpc.length === 0, "cross-origin ask -> 403");
fresh(); r = await run(typed("hello"), { "x-sam-eval": "wrong" });
ok(r.status === 403, "no Origin and a wrong eval token -> 403");
fresh({ S: { admit: "rate" } }); N.openai.push(groqOk); r = await run(typed("is hysecure certified"), { "x-sam-eval": "evaltok" });
ok(r.body.source === "model" && globalThis.__S.admits.length === 0 && N.logs[0].is_test === true && N.slots.join() === "openai", "eval token: skips visitor limits, still takes the slot, is_test");

// 7 + disabled/missing DB: harmless 503
for (const [name, set] of [["flag off", () => delete process.env.WEB_CHAT_ENABLED], ["no reader JWT", () => delete process.env.SAM_WEB_READER_JWT]]) {
  fresh(); set();
  r = await run(typed("hello"));
  const c = await config.GET(new Request("https://sam.test/api/web/config?page=x"));
  const e = await event.POST(new Request("https://sam.test/api/web/event", { method: "POST", headers: SAME, body: "{}" }));
  ok(r.status === 503 && c.status === 503 && e.status === 503 && N.rpc.length === 0 && N.model.length === 0, `${name} -> 503 everywhere, no DB or model call`);
  Object.assign(process.env, ENV);
}
fresh({ dbDown: /sam_web_settings/ }); r = await run(typed("hello"));
let c = await config.GET(new Request("https://sam.test/api/web/config?page=x"));
ok(r.status === 503 && c.status === 503 && c.headers.get("cache-control") === "no-store" && N.model.length === 0, "migrations not applied -> 503, not cached");
fresh(); N.settings.enabled = false; r = await run(typed("hello"));
c = await config.GET(new Request("https://sam.test/api/web/config?page=x"));
ok(r.status === 503 && (await c.json()).enabled === false, "settings enabled=false: config says off, ask 503");
fresh(); c = await config.GET(new Request("https://sam.test/api/web/config?page=https%3A%2F%2Faccops-citrix-lp.vercel.app%2F"));
const cj = await c.json();
ok(c.headers.get("cache-control") === "public, s-maxage=300" && c.headers.get("access-control-allow-origin") === "*"
  && cj.teaser.qa_id === "lp-renewal-1" && cj.chips.map(x => x.id).join() === "lp-steps-1,lp-x", "config: teaser + 2 chips, CDN-cached, CORS *");
ok(bodies.length >= 25, `checked ${bodies.length} answers`);

// 9. the event route rejects unknown names and free text
const post = (body, origin = "https://accops-citrix-lp.vercel.app", type = "text/plain") => event.POST(new Request("https://sam.test/api/web/event",
  { method: "POST", headers: { origin, "content-type": type }, body: typeof body === "string" ? body : JSON.stringify(body) }));
const EV = { visitor_id: "v_1", page: "https://accops-citrix-lp.vercel.app/", name: "popup_shown" };
fresh();
ok((await post(EV)).status === 204 && N.events.length === 1 && N.events[0].name === "popup_shown", "allowlisted beacon from the LP -> 204, logged");
ok((await post({ ...EV, name: "doc_opened", qa_id: "lp-renewal-1", ref: "https://www.accops.com/docs/citrix.pdf" }, "https://sam.test", "application/json")).status === 204, "same-origin JSON");
ok((await post({ ...EV, name: "lead_submitted" })).status === 400, "unknown name rejected");
ok((await post({ ...EV, text: "my email is a@b.com" })).status === 400, "extra free-text field rejected");
ok((await post({ ...EV, ref: "call me on 98765 43210" })).status === 400, "free text in ref rejected");
ok((await post({ ...EV, qa_id: "hello there" })).status === 400, "free text in qa_id rejected");
ok((await post("not json")).status === 400 && (await post(JSON.stringify(EV).padEnd(2100))).status === 400, "bad / oversized body rejected");
ok((await post(EV, "https://evil.example")).status === 403, "foreign origin -> 403");
ok(N.events.length === 2, "only valid events logged");

// 8. no key in any logged error
fresh({ logFails: true }); N.openai.push(fails[429]); N.groq.push(() => { throw new Error(`socket closed, auth ${SECRETS.OPENAI_COMPAT_API_KEY}`); });
r = await run(typed("is hysecure certified"));
const everything = JSON.stringify([printed, bodies, N.logs]);
ok(printed.some(p => /web model openai/.test(p)) && printed.some(p => /web log/.test(p)), "errors were logged");
for (const v of Object.values(SECRETS)) ok(!everything.includes(v), "a key appeared in a log line, a response or a stored message");
ok(!everything.includes("CHECKSECRET"), "no key fragment anywhere");

console.log(`web-answer.check: ${n} assertions passed`);
