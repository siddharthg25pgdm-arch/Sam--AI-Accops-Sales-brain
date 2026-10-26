// Run: node web/lib/web-guardrails.check.mjs - Stream F's acceptance (plan 2, 8.2, 9 "Stream F").
// The REAL bot/limits/guard/cache run inside B's real answer pipeline (lib/web/answer.ts). Only the network is fake:
// a Supabase stand-in that mirrors A's sam_web_admit / cache RPC semantics, an OpenAI stub that makes ADVERSARIAL picks
// (the first 4 candidates), and a BotID stub. Also runs scripts/web-guard.mjs clean, then on a copy with planted leaks.
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti } from "jiti";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "web-guardrails-"));
const botidStub = path.join(tmp, "botid.mjs");
writeFileSync(botidStub, "export const checkBotId = async () => { const v = globalThis.__BOTID; if (v instanceof Error) throw v; return v; };");
const jiti = createJiti(import.meta.url, { alias: { "@": web, "botid/server": botidStub } });

Object.assign(process.env, { WEB_CHAT_ENABLED: "1", SUPABASE_URL: "https://stub.supabase.co", SAM_WEB_READER_JWT: "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2FtX3dlYl9yZWFkZXIifQ.CHECKSECRETsig0000",
  SAM_WEB_SUPABASE_APIKEY: "sb_publishable_stub", WEB_IP_SALT: "salt", WEB_HS_SECRET: "hs-secret-for-the-check-only", WEB_EVAL_TOKEN: "evaltok",
  OPENAI_API_KEY: "sk-proj-CHECKSECRETopenai0000000000" });
delete process.env.WEB_MODEL_OFF;

// ---- fake Supabase (A's 03 semantics: typed 6/min + 20/day per visitor, 60/day per IP; repeat_n=3 in 10 min; cache model/fallback only)
const QA = { "lp-17": { id: "lp-17", question: "Is Accops ISO 27001 certified?", answer: "Yes. Accops is ISO 27001 certified to the 27001:2022 standard.",
  visual: null, visual_data: null, cta: null, cta_url: null, sources: ["https://accops-citrix-lp.vercel.app/#section-2"] } };
const CANDS = [
  { ref: "qa:lp-17", kind: "qa", types: ["text"], title: QA["lp-17"].question, text: QA["lp-17"].answer, url: null },
  { ref: "fact:hysecure-1", kind: "fact", types: ["text"], title: "HySecure", text: "HySecure is a secure access gateway.", url: "https://www.accops.com/hysecure" },
  { ref: "asset:7", kind: "asset", types: ["doc_card"], title: "Accops vs Citrix brochure", text: "A two-page comparison.", url: "https://www.accops.com/docs/citrix.pdf" },
];
let N;
const fresh = () => { N = { rate: new Map(), cache: new Map(), logs: [], model: 0, slots: 0, rpc: [] }; globalThis.__BOTID = { isHuman: true, isBot: false, isVerifiedBot: false, bypassed: false }; };
const bump = (k, by = 1) => { N.rate.set(k, (N.rate.get(k) ?? 0) + by); return N.rate.get(k); };
const RPC = {
  sam_web_settings: () => ({ enabled: true, model_enabled: true, cta_url: "https://www.accops.com/schedule-a-free-demo", cta_label: "Talk to an expert" }),
  sam_web_page_group: a => (a.url.includes("accops-citrix-lp") ? "citrix-lp" : null),
  sam_web_roots: () => [{ id: "lp-17", question: QA["lp-17"].question }],
  sam_web_children: () => [],
  sam_web_search: () => CANDS,
  sam_web_take_model_slot: () => (N.slots++, true),
  sam_web_log_message: a => (N.logs.push(a.m), null),
  sam_web_admit: ({ visitor, ip_hash, kind, q_hash }) => {
    if (!visitor || !["typed", "click", "event"].includes(kind)) return "rate";
    if (kind !== "typed") return bump(`ce:${visitor}`) > 300 ? "rate" : null;
    const m = bump(`tm:${visitor}`), d = bump(`td:${visitor}`), ip = ip_hash ? bump(`ip:${ip_hash}`) : 0;
    if (m > 6 || d > 20 || ip > 60) return "rate";
    if (q_hash && bump(`q:${visitor}:${q_hash}`) >= 3) return "repeat";
    return null;
  },
  sam_web_cache_get: a => N.cache.get(a.q_hash) ?? null,
  sam_web_cache_put: a => { if (/^[0-9a-f]{64}$/.test(a.q_hash) && ["model", "fallback"].includes(a.source)) N.cache.set(a.q_hash, a.answer); return null; },
};
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.host === "api.openai.com") { // adversarial: every candidate it can see, best first
    N.model++;
    const refs = JSON.parse(init.body).response_format.json_schema.schema.properties.blocks.items.properties.ref.enum;
    const blocks = refs.slice(0, 4).map(ref => ({ ref, type: CANDS.find(c => c.ref === ref).types[0] }));
    return Response.json({ choices: [{ message: { content: JSON.stringify({ verdict: "answered", blocks }) } }], usage: { total_tokens: 900 } });
  }
  assert.equal(u.host, "stub.supabase.co", `unexpected fetch ${u.host}`);
  assert.equal(init.headers?.Authorization, `Bearer ${process.env.SAM_WEB_READER_JWT}`, "only the reader JWT");
  const fn = u.pathname.replace("/rest/v1/", "");
  N.rpc.push(fn);
  if (fn === "sam_web_qa_public") {
    const ids = decodeURIComponent(u.searchParams.get("id")).replace(/^in\.\(|\)$/g, "").split(",").map(s => s.replace(/"/g, ""));
    return Response.json(ids.map(i => QA[i]).filter(Boolean));
  }
  const f = RPC[fn.replace(/^rpc\//, "")];
  assert.ok(f, `unexpected PostgREST call ${fn}`);
  return Response.json(f(init.body ? JSON.parse(init.body) : {}));
};
for (const k of ["warn"]) console[k] = () => {};

const { ask } = await jiti.import("./web/answer.ts");
const { classify, mintHs, verifyHs, cadence } = await jiti.import("./web/bot.ts");
const { preGuard } = await jiti.import("./web/guard.ts");
const { Answer } = await jiti.import("./blocks.ts");

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const HOST = "https://sam.test";
const SAME = { origin: HOST, "sec-fetch-site": "same-origin" };
const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36";
const hsAt = (conv, agoMs) => mintHs(conv, Date.now() - agoMs);
let conv = 0;
/** One ask through the whole pipeline. Every visitor-facing body must render. */
const send = async (text, o = {}) => {
  const conversation_id = o.conv ?? `c_${++conv}`;
  const body = { conversation_id, visitor_id: o.visitor ?? `v_${conversation_id}`, page: o.page ?? "https://accops-citrix-lp.vercel.app/",
    hs: "hs" in o ? o.hs : hsAt(conversation_id, 60_000), parent: o.parent ?? true, ms_since_render: o.msr ?? 30_000,
    recent_ms: o.recent ?? [1_000], turn: o.click ? { kind: "click", qa_id: o.click } : { kind: "typed", text } };
  const r = await ask(new Request(`${HOST}/api/web/ask`, { method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", "user-agent": o.ua ?? BROWSER, "x-forwarded-for": o.ip ?? "203.0.113.9", ...(o.headers ?? SAME) } }));
  if (r.log) await r.log();
  if (r.status === 200 || r.status === 429) ok(Answer.safeParse(r.body).success, `renderable ${JSON.stringify(r.body).slice(0, 200)}`);
  return { status: r.status, source: r.body.source, body: r.body, log: N.logs.at(-1) };
};

// ---- 1. classify: eval -> human; forged / expired / missing hs, bot UA, BotID -> bot; timing -> suspect
fresh();
const req = (h = SAME, ua = BROWSER) => new Request(`${HOST}/api/web/ask`, { method: "POST", headers: { ...h, "user-agent": ua } });
const ctx = (o = {}) => ({ kind: "typed", conversation_id: "c_x", visitor_id: "v_x", page: "", page_group: "general", country: null, ip_hash: "h", ua: BROWSER,
  hs: hsAt("c_x", 60_000), parent: true, ms_since_render: 30_000, recent_ms: [1_000], eval: false, ...o });
let c = await classify(req(), ctx());
ok(c.label === "human" && c.signals.length === 0, `clean browser ask -> human (${c.signals})`);
c = await classify(req({}, "curl/8.7.1"), ctx({ eval: true, hs: null, ua: "curl/8.7.1", parent: false, ms_since_render: 0 }));
ok(c.label === "human", "ctx.eval -> human, whatever else is missing");
for (const [why, o, sig] of [
  ["missing hs", { hs: null }, "hs_missing"],
  ["forged hs", { hs: "c_x.1761400000000.AAAAforgedAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }, "hs_forged"],
  ["hs re-signed by someone else", { hs: hsAt("c_x", 60_000).replace(/.$/, ch => (ch === "A" ? "B" : "A")) }, "hs_forged"],
  ["hs from another conversation", { hs: hsAt("c_other", 60_000) }, "hs_other_conversation"],
  ["expired hs (3 h)", { hs: hsAt("c_x", 3 * 3600_000) }, "hs_expired"],
  ["hs younger than 1 s", { hs: hsAt("c_x", 100) }, "hs_expired"],
  ["curl UA", { ua: "curl/8.7.1" }, "ua"], ["python UA", { ua: "python-requests/2.32" }, "ua"], ["HeadlessChrome UA", { ua: "Mozilla/5.0 HeadlessChrome/141" }, "ua"], ["empty UA", { ua: "" }, "ua"],
]) { c = await classify(req(), ctx(o)); ok(c.label === "bot" && c.signals.includes(sig), `${why} -> bot (${c.signals})`); }
c = await classify(req({}), ctx()); ok(c.label === "bot" && c.signals.includes("origin"), "no Origin -> bot");
globalThis.__BOTID = { isHuman: false, isBot: true, isVerifiedBot: false, bypassed: false };
c = await classify(req(), ctx()); ok(c.label === "bot" && c.signals.includes("botid"), "BotID isBot -> bot");
globalThis.__BOTID = { isHuman: false, isBot: false, isVerifiedBot: true, bypassed: false };
c = await classify(req(), ctx()); ok(c.label === "bot", "BotID verified crawler -> bot");
globalThis.__BOTID = new Error("botid unavailable");
c = await classify(req(), ctx()); ok(c.label === "suspect" && c.signals.includes("botid_error"), "BotID failure -> suspect, never human");
fresh();
for (const [why, o, sig] of [
  ["no origin-checked init (parent=false)", { parent: false }, "no_parent"],
  ["sent 150 ms after render", { ms_since_render: 150 }, "too_fast"],
  ["4 sends under 1.5 s apart", { recent_ms: [0, 900, 1800, 2700] }, "cadence_fast"],
  ["metronome spacing (sd < 100 ms)", { recent_ms: [0, 5000, 10010, 15005, 20000] }, "cadence_regular"],
  ["timestamps out of order", { recent_ms: [5000, 1000] }, "cadence_unordered"],
  ["claims a render before the token was minted", { ms_since_render: 10 * 60_000 }, "render_clock"],
]) { c = await classify(req(), ctx(o)); ok(c.label === "suspect" && c.signals.includes(sig), `${why} -> suspect (${c.signals})`); }
for (const [kind, msr, flagged] of [["typed", 1500, true], ["typed", 2500, false], ["click", 1500, false], ["click", 150, true]]) {
  c = await classify(req(), ctx({ kind, ms_since_render: msr }));
  ok(c.signals.includes("too_fast") === flagged && c.label === (flagged ? "suspect" : "human"), `${kind} send ${msr} ms after render -> ${c.label} (${c.signals})`);
}
ok(cadence([0, 4000, 11000, 15500]) === null && cadence([0, 500]) === null, "human cadence is not flagged");
ok("age" in verifyHs(hsAt("c.with.dots", 5000), "c.with.dots"), "conversation ids with dots verify");
const saved = process.env.WEB_HS_SECRET; delete process.env.WEB_HS_SECRET;
ok(verifyHs("a.1.b", "a").bad === "hs_unconfigured", "no WEB_HS_SECRET -> nothing verifies (fail safe)");
process.env.WEB_HS_SECRET = saved;

// ---- 2. bots and suspects never reach tier 3 (end to end); eval does
for (const [why, o, label] of [["no hs", { hs: null }, "bot"], ["forged hs", { hs: "c_1.1.forged" }, "bot"], ["curl UA", { ua: "curl/8.7.1" }, "bot"],
  ["no parent", { parent: false }, "suspect"], ["fast cadence", { recent: [0, 800, 1600, 2400] }, "suspect"]]) {
  fresh();
  const r = await send("Tell me about HySecure gateways", o);
  ok(r.source === "fallback" && N.model === 0 && N.slots === 0 && r.log.label === label, `${why} -> ${label}, fallback, no model, no slot (${r.source}/${r.log?.label})`);
}
fresh(); globalThis.__BOTID = { isHuman: false, isBot: true, isVerifiedBot: false, bypassed: false };
let r = await send("Tell me about HySecure gateways");
ok(r.source === "fallback" && N.model === 0 && r.log.label === "bot", "BotID bot -> no model");
fresh(); r = await send("Tell me about HySecure gateways", { msr: 1500 });
ok(r.log.signals.includes("too_fast") && r.log.label === "suspect" && N.model === 0, "answer.ts passes kind: a typed send 1.5 s after render is suspect");
fresh(); r = await send(null, { click: "qa_unknown", msr: 1500 });
ok(!r.log.signals.includes("too_fast"), `answer.ts passes kind: a click 1.5 s after render is fine (${r.log.signals})`);
fresh();
r = await send("Tell me about HySecure gateways");
ok(r.source === "model" && N.model === 1 && r.log.label === "human", "control: a clean human reaches tier 3");
fresh();
r = await send("Tell me about HySecure gateways", { headers: { "x-sam-eval": "evaltok" }, ua: "node", hs: null, parent: false, msr: 0 });
ok(r.status === 200 && r.log.label === "human" && r.log.is_test === true && N.slots === 1, "eval token -> human, is_test, still takes a ceiling slot");

// ---- 3. rate: the 7th typed question in a minute is limited (and so is everything after it)
fresh();
const seq = [];
for (let i = 1; i <= 30; i++) seq.push((await send(`Tell me about HyWorks number ${i}`, { conv: "c_rate", visitor: "v_rate", hs: hsAt("c_rate", 60_000) })));
ok(seq.slice(0, 6).every(x => x.source !== "limited") && seq.slice(6).every(x => x.source === "limited" && x.status === 429), `7th+ typed -> limited: ${seq.map(x => x.source).join(",")}`);
ok(N.model === 6, `limited sends never call the model (${N.model})`);
ok(seq[6].body.blocks.some(b => b.type === "cta"), "a limited reply still renders + carries the CTA");
fresh();
const ipSeq = [];
for (let i = 1; i <= 61; i++) ipSeq.push((await send(`Accops question ${i}`, { visitor: `v_ip_${i}`, ip: "198.51.100.7" })).source);
ok(ipSeq.slice(0, 60).every(s => s !== "limited") && ipSeq[60] === "limited", "61st typed from one IP in a day -> limited");

// ---- 4. repeats: same question x4 -> model, cache, repeat, repeat (exactly one model call); cache hit = no model
fresh();
const rep = [];
for (let i = 0; i < 4; i++) rep.push((await send("Does Accops work with Proxmox clusters?", { conv: "c_rep", visitor: "v_rep", hs: hsAt("c_rep", 60_000) })).source);
ok(rep.join() === "model,cache,repeat,repeat" && N.model === 1, `repeat ladder: ${rep} (${N.model} model calls)`);
fresh();
await send("Does Accops support Nutanix AHV?", { visitor: "v_a" });
const m0 = N.model, s0 = N.slots;
r = await send("does accops support nutanix ahv", { visitor: "v_b" }); // another visitor, same normalised question
ok(r.source === "cache" && N.model === m0 && N.slots === s0, "shared cache hit -> no model call, no slot");
fresh(); N.cache.set("x".repeat(64), { blocks: [], chips: [] });
const { cacheGet } = await jiti.import("./web/cache.ts");
ok((await cacheGet("x".repeat(64)))?.blocks.length === 0 && (await cacheGet("y".repeat(64))) === null, "cacheGet: hit parses, miss is null");
N.cache.set("z".repeat(64), { blocks: [{ type: "evil" }] });
ok((await cacheGet("z".repeat(64))) === null, "a cached row that no longer parses is a miss");

// ---- 5. the red-team set: the pre-guard catches every guard case, never reflects the text, and spares real questions
const RT = JSON.parse(readFileSync(path.join(web, "..", "docs", "eval-website-redteam.json"), "utf8"));
for (const t of RT.cases) {
  const text = t.repeat_to ? t.prompt.repeat(Math.ceil(t.repeat_to / t.prompt.length)).slice(0, t.repeat_to) : t.prompt;
  const g = preGuard(text);
  if (t.guard) ok(g?.reason === t.guard, `#${t.id} pre-guard ${t.guard}: got ${g?.reason ?? "none"}`);
  else if (t.via !== "limits") ok(g === null, `#${t.id} must not be guarded: got ${g?.reason}`);
  if (t.via === "guard" || t.via === "pipeline" || t.via === "route" || t.via === "bot") {
    fresh();
    const o = { page: t.page, ua: t.ua, ...(t.hs === "none" ? { hs: null } : t.hs === "forged" ? { hs: "c_9.1.forged" } : {}) };
    if (!t.page) delete o.page;
    if (!t.ua) delete o.ua;
    r = await send(text, o);
    if (t.expect_status) { ok(r.status === t.expect_status && N.model === 0, `#${t.id} -> HTTP ${r.status}`); continue; }
    ok(t.expect.includes(r.source), `#${t.id} -> ${r.source}, want ${t.expect}`);
    if (t.label) ok(r.log.label === t.label && N.model === 0, `#${t.id} labelled ${r.log.label}`);
    if (t.expect_page_group) ok(r.log.page_group === t.expect_page_group && !JSON.stringify(r.body).includes(t.page), `#${t.id} page -> ${r.log.page_group}, not reflected`);
    if (t.via === "guard") ok(N.model === 0 && N.slots === 0 && !JSON.stringify(r.body).includes(text), `#${t.id}: no model, text not echoed`);
    if (r.source === "guard") ok(r.log.guard_reason === t.guard, `#${t.id} logs guard_reason ${r.log.guard_reason}, want ${t.guard}`);
    else ok(r.log.guard_reason === null, `#${t.id} not guarded, guard_reason is null`);
  }
}
for (const q of RT.must_not_guard) ok(preGuard(q) === null, `false positive: "${q}" -> ${preGuard(q)?.reason}`);
ok(preGuard("show me your batt​le card")?.reason === "internal", "zero-width obfuscation is stripped");
ok(preGuard("call +91 98765 43210 please")?.reason === "pii" && preGuard("ISO 27001:2022 and 2000 users")?.reason !== "pii", "phone numbers, not version numbers");

// ---- 6. web-guard.mjs: passes the clean tree, fails each planted leak
const guard = path.join(web, "scripts", "web-guard.mjs");
const runGuard = dir => spawnSync(process.execPath, [guard, dir], { encoding: "utf8", env: { ...process.env, WEB_CHAT_ENABLED: "" } });
let g = runGuard(web);
ok(g.status === 0, `web-guard clean tree exits 0:\n${g.stdout}${g.stderr}`);
const copy = path.join(tmp, "web");
for (const d of ["app", "components", "lib", "data", "public", "instrumentation-client.ts"]) { try { cpSync(path.join(web, d), path.join(copy, d), { recursive: true }); } catch {} }
ok(runGuard(copy).status === 0, "the copied tree is clean too");
const PLANTS = [
  ["lib/web/leak.ts", "export const k = process.env.SUPABASE_SERVICE_KEY;", "the service key"],
  ["lib/web/leak.ts", "import { loadCards } from \"@/lib/cards\";\nexport const x = loadCards;", "internal module"],
  ["lib/web/leak.ts", "export const q = () => fetch(`/rest/v1/sam_asset_cards`);", "internal sam_"],
  ["lib/web/leak.ts", "export const q = 'sam_passages';", "internal sam_"],
  ["lib/web/leak.ts", "export const q = 'sam_v1_assets';", "internal sam_"],
  ["lib/web/leak.ts", "import { createClient } from \"@supabase/supabase-js\";", "imports @supabase"],
  ["lib/web/leak.ts", "export const r = 'sam_web_dashboard';", "service-role-only"],
  ["lib/web/leak.ts", "export const r = 'service_role';", "service role"],
  ["app/embed/Leak.tsx", "export const apikey = 1;", "browser code"],
  ["lib/web/leak.ts", "import \"./helper\";", "cannot resolve"],
];
for (const [file, src, want] of PLANTS) {
  const p = path.join(copy, file);
  mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, src);
  g = runGuard(copy);
  rmSync(p);
  ok(g.status === 1 && g.stdout.includes(want), `planted ${want} -> exit 1 (${g.status}): ${g.stdout.trim().split("\n").at(-1)}`);
}
// an indirect leak: a helper outside lib/web that the website imports
writeFileSync(path.join(copy, "lib/helper-leak.ts"), "export const k = process.env.SUPABASE_SERVICE_KEY;");
writeFileSync(path.join(copy, "lib/web/leak.ts"), "export { k } from \"@/lib/helper-leak\";");
g = runGuard(copy);
ok(g.status === 1 && g.stdout.includes("lib/helper-leak.ts: the service key"), "a transitive import is walked");
rmSync(path.join(copy, "lib/web/leak.ts")); rmSync(path.join(copy, "lib/helper-leak.ts"));
writeFileSync(path.join(copy, "data/web-intent-index.json"), JSON.stringify({ version: 1, intents: [{ qa_id: "x", client_actual: "HDFC" }] }));
g = runGuard(copy);
ok(g.status === 1 && g.stdout.includes("client_actual"), "an intent index with extra fields fails");

// probes, with an over-granted reader (the planted leak) and an unreachable DB
const { probes } = await import(pathToFileURL(guard).href);
const fake = over => async (url, init) => {
  const p = new URL(url).pathname.replace("/rest/v1", ""), reader = !!init.headers.Authorization;
  if (p === "/") return Response.json({ paths: Object.fromEntries((reader ? ["/", "/sam_web_qa_public", "/rpc/sam_web_search", ...(over ? ["/sam_asset_cards"] : [])] : ["/"]).map(k => [k, {}])) });
  if (over && reader && p === "/sam_asset_cards") return Response.json([{ id: 1 }]);
  if (reader && ["/sam_web_assets_public", "/sam_web_qa_public"].includes(p)) return Response.json([]);
  return new Response("{}", { status: reader ? 403 : 401 });
};
const E = { url: "https://stub.supabase.co", apikey: "sb_publishable_stub", jwt: "jwt" };
ok((await probes(E, fake(false))).length === 0, "probes: a correct grant set has no findings");
const pf = await probes(E, fake(true));
ok(pf.some(f => f.includes("reader OpenAPI lists /sam_asset_cards")) && pf.some(f => f.includes("reader can read sam_asset_cards (200)")), `probes: over-granted reader caught: ${pf}`);
// Supabase's new keys close the OpenAPI index to non-secret keys (27 Oct 2026): closed is fine, unreadable own views are not
const closedIdx = async (url, init) => new URL(url).pathname === "/rest/v1/" ? new Response("{}", { status: 401 }) : fake(false)(url, init);
ok((await probes(E, closedIdx)).length === 0, "probes: a closed OpenAPI index (401) is not a finding");
const blind = await probes(E, async (url, init) => /sam_web_(assets|qa)_public/.test(url) ? new Response("{}", { status: 401 }) : fake(false)(url, init));
ok(blind.some(f => f.includes("reader cannot read its own view")), `probes: a reader that can't read its views is caught: ${blind}`);
const down = await probes(E, async () => { throw new TypeError("fetch failed"); });
ok(down.length > 0 && down.every(f => f.includes("unreachable")), "probes: unreachable DB is a finding (fail safe)");

rmSync(tmp, { recursive: true, force: true });
console.log(`web-guardrails: ${n} checks ok`);
