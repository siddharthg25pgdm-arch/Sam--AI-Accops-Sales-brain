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
export const intentMatch = t => S().intent;
export const related = (t, g) => S().related ?? [];
export const isTestConv = (hs, c) => c.startsWith("t_") && hs === "hs-test"; // the real MAC check: web-widget.check`);
const alias = { "@": web };
for (const m of ["bot", "limits", "guard", "cache", "intent"]) alias[`@/lib/web/${m}`] = stub;
const jiti = createJiti(import.meta.url, { alias });

const SECRETS = { OPENAI_API_KEY: "sk-proj-CHECKSECRETopenai0000000000", OPENAI_COMPAT_API_KEY: "gsk_CHECKSECRETgroq00000000000",
  SAM_WEB_READER_JWT: "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2FtX3dlYl9yZWFkZXIifQ.CHECKSECRETsignature000" };
const ENV = { ...SECRETS, WEB_CHAT_ENABLED: "1", SUPABASE_URL: "https://stub.supabase.co", SAM_WEB_SUPABASE_APIKEY: "sb_publishable_stub",
  WEB_IP_SALT: "salt", OPENAI_COMPAT_BASE_URL: "https://api.groq.com/openai/v1", WEB_EMBED_ORIGINS: "https://accops-citrix-lp.vercel.app,https://sam.test",
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
  { ref: "page:https://accops-citrix-lp.vercel.app/#comparison", kind: "page", types: ["doc_card"], title: "Accops vs Citrix on eight decision criteria",
    text: "A feature table comparing Accops and Citrix on gateway and load balancing.", url: "https://accops-citrix-lp.vercel.app/#comparison" },
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
const { LEAD, accopsFirst } = await jiti.import("./web/fill.ts");
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
const NONE = { type: "none", ref: "none" };
/** The model's strict JSON (27 Oct, text-first): a written answer + cites + optional visual + follow-ups. */
const writes = (verdict, answer, cites, o = {}) => () => reply({ verdict, answer, cites, visual: o.visual ?? NONE, followups: o.followups ?? [] });
const GOOD = "Yes. **HySecure** is ISO 27001:2022 certified."; // every claim is in fact:hysecure-1

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
fresh({ S: { intent: { qa_id: "retired-1", score: 5, margin: 0.4 } } }); N.openai.push(writes("answered", GOOD, ["fact:hysecure-1"]));
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

// 5. tier 3 writes the answer IN the chat (27 Oct): fact-checked text with emphasis + one "Based on" pill
const { emProblems } = await jiti.import("./emphasis.ts");
const { factCheck, docIntent } = await jiti.import("./web/facts.ts");
fresh(); N.openai.push(writes("answered", GOOD, ["fact:hysecure-1", "qa:ghost"], { followups: ["ghost", "lp-steps-1"] }));
r = await run(typed("is hysecure certified"));
ok(r.body.source === "model" && r.body.blocks.map(b => b.type).join() === "text" && !r.body.lead, `a written answer: ${JSON.stringify(r.body.blocks)}`);
ok(r.body.blocks[0].body === GOOD && r.body.blocks[0].ai === true && r.body.blocks[0].source.url === "https://www.accops.com/hysecure", "the text as written, ai, sourced from the first cite");
ok(r.body.chips.map(c => c.id).join() === "lp-steps-1,lp-renewal-1,lp-x", `follow-ups: the model's approved pick first (a retired one dropped), roots top up: ${r.body.chips.map(c => c.id)}`);
ok(N.logs[0].refs.join() === "fact:hysecure-1,qa:ghost" && N.logs[0].error === null && N.logs[0].verdict === "answered", "cites logged as refs");
const sent = N.model[0].body, sch = sent.response_format.json_schema, P = sch.schema.properties;
ok(sch.strict === true && sch.name === "answer" && sch.schema.required.join() === "verdict,answer,cites,visual,followups" && sch.schema.additionalProperties === false, "strict schema, every field required");
ok(JSON.stringify(P.cites.items.enum) === JSON.stringify(CANDS.map(c => c.ref)) && P.cites.maxItems === 4, "cites enum = this request's candidates");
ok(P.visual.properties.ref.enum.join() === "none,qa:lp-renewal-1,qa:lp-steps-1" && P.visual.properties.type.enum[0] === "none", "visual: a qa candidate's own, or none");
ok(P.followups.items.enum.join() === "lp-renewal-1,lp-steps-1" && P.followups.maxItems === 3, "follow-ups: this request's qa ids");
ok(!JSON.stringify(sch.schema).includes("minItems"), "only keywords production already accepted (maxItems, enum)");
ok(sent.model === "gpt-6-luna" && sent.max_completion_tokens === 400 && sent.reasoning_effort === "none" && sent.store === false && !("max_tokens" in sent), "OpenAI body: 400 tokens, effort none");
ok(sent.messages[0].role === "system" && /ONLY the approved Accops records/.test(sent.messages[0].content) && /\*\*double asterisks\*\*/.test(sent.messages[0].content) && /FIRST sentence/.test(sent.messages[0].content), "fixed system prompt");
ok(sent.messages[1].content.split("\n").length === 2 + CANDS.length, "one line per candidate");
fresh({ cands: [...CANDS, ...CANDS.slice(0, 4).map((c, i) => ({ ...c, ref: `${c.ref}-${i}` }))] }); N.openai.push(writes("none", "", []));
await run(typed("anything else"));
ok(N.model[0].body.messages[1].content.split("\n").length === 2 + 8, "at most 8 candidates reach the model");

// fact check: an invented number, customer, certification, a blocked figure, a link -> verified facts (verbatim, From pills)
for (const [why, text] of [["an invented number", "Yes. **HySecure** is ISO 27001:2022 certified and cuts costs by 40%."],
  ["an invented customer", "Yes. **HySecure** is ISO 27001:2022 certified, and HDFC Bank relies on it."],
  ["an invented certification", "Yes. **HySecure** is ISO 27001:2022 and SOC 2 certified."],
  ["the LP's blocked 10X figure", "Yes. **HySecure** is ISO 27001:2022 certified and 10X faster."],
  ["a link", "Yes. **HySecure** is ISO 27001:2022 certified; see accops.com/hysecure."]]) {
  fresh(); N.openai.push(writes("answered", text, ["fact:hysecure-1"]));
  r = await run(typed("is hysecure certified"));
  ok(r.body.source === "model" && r.body.lead === LEAD.facts && /^fact_check: /.test(N.logs[0].error), `${why} -> verified facts (${N.logs[0].error})`);
  const tx = r.body.blocks.filter(b => b.type === "text");
  ok(tx[0].body === CANDS[1].text && tx.every(b => !b.ai && b.source && !b.body.includes("**")), `${why}: the cited quote first, verbatim, no AI text`);
  ok(tx.map(b => b.body).join("|") === [CANDS[1].text, QA["lp-renewal-1"].answer, QA["lp-steps-1"].answer].join("|"), `${why}: cites first, then search rank, at most 3`);
  ok(!JSON.stringify(r.body).includes(text) && r.body.blocks.at(-1).type === "cta" && !r.body.blocks.some(b => b.type === "doc_card"), `${why}: never shown, CTA, no links list`);
  ok(N.puts.length === 1 && N.puts[0].src === "model" && r.body.chips.length > 0, `${why}: cached as the outcome, chips`);
}
const FEV = ["HySecure. HySecure is ISO 27001:2022 certified."];
ok(factCheck("Yes. **HySecure** is ISO 27001:2022 certified.", FEV).length === 0, "fact check passes a supported answer");
for (const [bad, want] of [["HySecure is 99.9% available.", "number 99.9%"], ["HySecure is twice as fast.", "number 2x"], ["Tata Motors runs HySecure.", "name Tata"],
  ["Infosys runs HySecure.", "name Infosys"], ["HySecure is FedRAMP authorised.", "name FedRAMP"], ["HySecure is gdpr ready.", "certification gdpr"],
  ["HySecure replaces Zscaler.", "name Zscaler"], ["HySecure suits banks.", "name BFSI"], ["HySecure is \"certified secure by design\".", "quote \"certified secure by design\""],
  ["HySecure has run since 2009.", "number 2009"]])
  ok(factCheck(bad, FEV).includes(want), `fact check catches ${want}: ${factCheck(bad, FEV)}`);
ok(factCheck("Accops works with Nutanix AHV and 1,000 seats.", ["Nutanix AHV support for 1000 seats"]).length === 0, "tolerant of case, punctuation and thousands commas");

// a qa candidate's own visual; a wrong type is dropped; a page is never a card
fresh(); N.openai.push(writes("answered", "Citrix moved to **subscription bundles**, so many renewals now include components you may not use.", ["qa:lp-renewal-1"],
  { visual: { type: "compare_table", ref: "qa:lp-renewal-1" }, followups: ["lp-steps-1"] }));
r = await run(typed("why is the citrix renewal so expensive"));
ok(r.body.blocks.map(b => b.type).join() === "text,compare_table" && r.body.blocks[0].ai && r.body.blocks[0].source.url === QA["lp-renewal-1"].sources[0], `text + the pair's own table: ${r.body.blocks.map(b => b.type)}`);
ok(r.body.chips.map(c => c.id).join() === "lp-steps-1,lp-x", `chips: the model's pick, roots top up, never the cited pair: ${r.body.chips.map(c => c.id)}`);
fresh(); N.openai.push(writes("answered", "Citrix moved to **subscription bundles**, so many renewals now include components you may not use.", ["qa:lp-renewal-1", "page:https://accops-citrix-lp.vercel.app/#comparison"],
  { visual: { type: "steps", ref: "qa:lp-renewal-1" } }));
r = await run(typed("send me the citrix renewal brochure"));
ok(r.body.blocks.map(b => b.type).join() === "text,doc_card" && r.body.blocks[1].url === "https://www.accops.com/docs/citrix.pdf", `a type the pair lacks is dropped; a document ask gets the asset card, never a page card: ${r.body.blocks.map(b => b.type)}`);
// doc-intent gating: the same answer with an asset cite shows a card only when the visitor asked for a document
for (const [q, card] of [["Do you have a brochure comparing Accops and Citrix?", true], ["How does Accops compare with Citrix?", false], ["Send me the datasheet", true], ["Can I download the case study PDF?", true]]) {
  fresh(); N.openai.push(writes("answered", "The **Accops vs Citrix brochure** is a two-page comparison.", ["asset:7", "page:https://accops-citrix-lp.vercel.app/#comparison"]));
  r = await run(typed(q));
  ok(r.body.blocks[0].ai && r.body.blocks.some(b => b.type === "doc_card") === card && !r.body.blocks.some(b => b.type === "doc_card" && b.kind === "Page") && docIntent(q) === card, `doc intent "${q}" -> card ${card}: ${r.body.blocks.map(b => b.type)}`);
}
// emphasis limits on model text: <= 4 phrases, <= 6 words each, <= 35% of the words; stray / nested markers stripped
fresh({ cands: [{ ...CANDS[0], text: `${QA["lp-renewal-1"].answer} Accops offers perpetual or subscription licensing and a site database with no separate SQL Server licence for every user group you migrate over time.` }] });
N.openai.push(writes("answered", "Citrix moved to **subscription** **bundles**, so **many renewals now include components you may not** use. **Accops** offers **perpetual** **or** subscription **licensing** and a **site database** **with no separate SQL Server licence for every user group you migrate over time*.", ["qa:lp-renewal-1"]));
r = await run(typed("why is the citrix renewal so expensive"));
const em = r.body.blocks[0].body, phrases = [...em.matchAll(/\*\*([^*]+)\*\*/g)].map(x => x[1]);
ok(r.body.blocks[0].ai && emProblems(em).length === 0 && phrases.join("|") === "Accops|perpetual|or|licensing" && !em.replace(/\*\*[^*]+\*\*/g, "").includes("*"), `emphasis cleaned to the limits: ${em}`);
// length: whole sentences up to 70 words; one sentence over 70 -> verified facts
const long = `HySecure is ISO 27001:2022 certified ${"and certified ".repeat(40)}.`;
fresh(); N.openai.push(writes("answered", `Yes. **HySecure** is ISO 27001:2022 certified. ${long}`, ["fact:hysecure-1"]));
r = await run(typed("is hysecure certified"));
ok(r.body.blocks[0].body === GOOD && r.body.blocks[0].ai, "over 70 words: cut at a whole sentence");
fresh(); N.openai.push(writes("answered", long, ["fact:hysecure-1"]));
r = await run(typed("is hysecure certified"));
ok(r.body.lead === LEAD.facts && /empty or over 70 words/.test(N.logs[0].error), "one sentence over 70 words -> verified facts");
// partial: the fixed lead + the written answer + CTA
fresh(); N.openai.push(writes("partial", GOOD, ["fact:hysecure-1"]));
r = await run(typed("is hyworks certified"));
ok(r.body.lead === LEAD.partial && r.body.blocks.map(b => b.type).join() === "text,cta" && r.body.blocks[0].ai, "partial -> lead + text + CTA");
// the 2nd answer in a chat carries the CTA
fresh(); N.openai.push(writes("answered", GOOD, ["fact:hysecure-1"]));
r = await run(typed("is hysecure certified", { recent_ms: [1000, 9000] }));
ok(r.body.blocks.map(b => b.type).join() === "text,cta", "CTA after the 2nd answer");
// follow-ups: the matcher's next-best approved pairs when the model gives fewer than 2; none when nothing is approved
fresh({ S: { related: ["lp-steps-1", "not-approved", "lp-renewal-1"] } }); N.openai.push(writes("answered", GOOD, ["fact:hysecure-1"]));
r = await run(typed("is hysecure certified"));
ok(r.body.chips.map(c => c.id).join() === "lp-steps-1,lp-renewal-1" && !N.rpc.includes("rpc/sam_web_roots"), `matcher's approved next-best, no roots needed: ${r.body.chips.map(c => c.id)}`);
fresh({ cands: [CANDS[1]] }); N.openai.push(writes("answered", GOOD, ["fact:hysecure-1"]));
const savedRoots = ROOTS.splice(0); r = await run(typed("is hysecure certified")); ROOTS.push(...savedRoots);
ok(r.body.source === "model" && r.body.chips.length === 0, "no approved pairs anywhere -> no chips");
fresh(); r = await run(click("lp-steps-1"));
ok(r.body.chips.map(c => c.id).join() === "lp-renewal-1,lp-x", `a bank answer without children still gets follow-ups: ${r.body.chips.map(c => c.id)}`);
fresh({ S: { related: ["lp-renewal-1"] } }); r = await run(click("lp-steps-1"));
ok(r.body.chips.map(c => c.id).join() === "lp-renewal-1,lp-x" && N.rpc.filter(f => f === "sam_web_qa_public").length === 2, "bank follow-ups: matcher next-best (read alongside the children), then roots");

// 6. timeout / 429 / bad JSON -> Groq; both fail -> verified facts
const groqOk = writes("answered", GOOD, ["fact:hysecure-1"]);
const fails = {
  timeout: () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); },
  429: (b, init) => new Response(`rate limited; you sent ${init.headers.Authorization}`, { status: 429 }),
  500: () => new Response("upstream", { status: 503 }),
  "bad JSON": () => reply("Sure! Here is the answer: HySecure is great"),
  "wrong shape": () => reply({ verdict: "maybe", answer: "x", cites: [], visual: NONE, followups: [] }),
  "the old shape": () => reply({ verdict: "answered", blocks: [{ type: "text", ref: "fact:hysecure-1" }] }),
};
for (const [why, f] of Object.entries(fails)) {
  fresh(); N.openai.push(f); N.groq.push(groqOk);
  r = await run(typed("is hysecure certified"));
  ok(r.body.source === "model" && N.model.map(m => m.host).join() === "openai,groq" && N.slots.join() === "openai,groq", `${why} -> Groq`);
  ok(N.logs[0].model === "openai/gpt-oss-20b" && r.body.blocks[0].body === GOOD, `${why}: Groq recorded, its answer shown`);
}
const g = N.model[1].body;
ok(g.max_tokens === 400 && g.reasoning_effort === "low" && g.temperature === 0 && !("max_completion_tokens" in g) && g.response_format.json_schema.strict, "Groq body");
fresh(); N.openai.push(fails[429]); N.groq.push((b, init) => new Response(`no: ${init.headers.Authorization}`, { status: 500 }));
r = await run(typed("is hysecure certified"));
ok(r.body.source === "fallback" && N.logs[0].error === "model" && N.puts.length === 0, "both fail -> not cached");
ok(r.body.lead === LEAD.facts && r.body.blocks.filter(b => b.type === "text").length === 3 && r.body.blocks.every(b => b.type !== "text" || (!b.ai && b.source)) && r.body.blocks.at(-1).type === "cta", "both fail -> verified facts by search rank + CTA");
fresh(); N.openai.push(fails[429]); N.slot.groq = false;
r = await run(typed("is hysecure certified"));
ok(r.body.source === "fallback" && N.model.length === 1 && r.body.lead === LEAD.facts, "Groq cap reached -> no Groq call, verified facts");
fresh({ cands: [CANDS[2], CANDS[4]] }); N.slot.openai = false;
r = await run(typed("is hysecure certified"));
ok(r.body.source === "fallback" && r.body.lead === LEAD.none && r.body.blocks.map(b => b.type).join() === "cta", "no quotable record (only a page and an asset) -> the honest fallback, never a list of links");

// 10. a tier-3 result is cache-put (every outcome, including none)
fresh(); N.openai.push(groqOk);
r = await run(typed("Is HySecure certified?"));
ok(N.puts.length === 1 && N.puts[0].h === qHash("Is HySecure certified?", "citrix-lp") && N.puts[0].g === "citrix-lp" && N.puts[0].src === "model"
  && JSON.stringify(N.puts[0].a.blocks) === JSON.stringify(r.body.blocks), "model answer cache-put under q_hash");
fresh(); N.openai.push(writes("none", "", []));
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
// test chats (SAM's own "Test the bot" page): is_test from the signed "t_" conversation, never from the body alone
fresh(); await run(click("lp-renewal-1"));
ok(N.logs[0].is_test === false, "a visitor's chat: is_test false");
fresh(); await run(click("lp-renewal-1", { conversation_id: "t_1", hs: "hs-test" }));
ok(N.logs[0].is_test === true && N.logs[0].label === "human", "a signed test conversation: is_test, same guardrails");
fresh(); await run(click("lp-renewal-1", { conversation_id: "t_1", hs: "forged" }));
ok(N.logs[0].is_test === false, "a forged t_ id: not a test");

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
ok(N.events.map(e => e.is_test).join() === "false,true", "is_test: LP beacon false, a beacon from SAM's own page true");
fresh();
await post({ ...EV, conversation_id: "c_1" }, "https://sam.test"); // the widget's own events come from SAM's origin
await post({ ...EV, conversation_id: "t_1" }, "https://sam.test");
await post({ ...EV, is_test: true }); // a client flag is rejected outright (strict schema)
ok(N.events.map(e => e.is_test).join() === "false,true", "widget events: test only for a t_ conversation; body flag refused");
process.env.WEB_EMBED_ORIGINS = "https://accops-citrix-lp.vercel.app";
ok((await post(EV, "https://sam.test")).status === 403, "SAM's own origin only when WEB_EMBED_ORIGINS lists it");
process.env.WEB_EMBED_ORIGINS = ENV.WEB_EMBED_ORIGINS;

// 8. no key in any logged error
fresh({ logFails: true }); N.openai.push(fails[429]); N.groq.push(() => { throw new Error(`socket closed, auth ${SECRETS.OPENAI_COMPAT_API_KEY}`); });
r = await run(typed("is hysecure certified"));
const everything = JSON.stringify([printed, bodies, N.logs]);
ok(printed.some(p => /web model openai/.test(p)) && printed.some(p => /web log/.test(p)), "errors were logged");
for (const v of Object.values(SECRETS)) ok(!everything.includes(v), "a key appeared in a log line, a response or a stored message");
ok(!everything.includes("CHECKSECRET"), "no key fragment anywhere");

// Highlights only on Accops (27 Oct live test bolded a Citrix strength)
const live = "Accops offers **gateway built in**, while Citrix needs NetScaler. Accops supports **perpetual or subscription licensing**; Citrix has withdrawn perpetual licensing. Citrix remains more mature for **extreme-latency cases**.";
const af = accopsFirst(live);
ok(af.includes("**gateway built in**") && af.includes("**perpetual or subscription licensing**"), "Accops highlights kept");
ok(!af.includes("**extreme-latency cases**") && af.includes("extreme-latency cases"), "a competitor-only clause loses its highlight, keeps its words");

console.log(`web-answer.check: ${n} assertions passed`);
