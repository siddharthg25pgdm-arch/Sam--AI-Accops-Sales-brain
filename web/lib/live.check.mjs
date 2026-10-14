/** ponytail: one runnable check for SAM Live's server logic, every network call stubbed.
 *  node lib/live.check.mjs   (from web/)  ->  throws if any of these break:
 *    1. the qualification never goes backwards, and an unevidenced restatement never replaces a quote
 *    2. Whisper's silence hallucinations and prompt echoes are dropped; short real answers are kept
 *    3. a malformed model reply is repaired (fences, prose, trailing commas, cut off); evidence must be verbatim
 *    4. "ask next" skips answered fields and what the rep has just asked
 *    5. collateral cards: the preferred type, public link first, never the same trigger or card twice
 *    6. the follow-up email never keeps a [placeholder]
 *    7. the Power Automate payload has exactly the spec's fields; its status never carries the flow URL
 *    8. models: OpenAI (LIVE_OPENAI_API_KEY) first, Groq behind it, Groq alone without the key, and a failure falls through
 *    9. mock mode cannot run in production
 *   10. a SAM session JWT as a bearer is the cookie: a rep's desktop token is refused on admin-only routes
 *       and cannot use API-token privileges; API tokens and bad tokens behave as before */
import assert from "node:assert";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@": web } });
for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "LIVE_OPENAI_API_KEY", "LIVE_OPENAI_BASE_URL", "LIVE_MOCK", "VERCEL_ENV", "LIVE_FLOW_URL",
  "LIVE_STT_MODEL", "LIVE_STT_FALLBACK_MODEL", "LIVE_INSIGHT_MODEL", "LIVE_SUMMARY_MODEL", "OPENAI_COMPAT_FALLBACK_MODEL", "OPENAI_REASONING_EFFORT"]) delete process.env[k];
Object.assign(process.env, {
  SUPABASE_URL: "https://stub.supabase.co", SUPABASE_SERVICE_KEY: "stub", SAM_API_TOKENS: "check:tok_check",
  SAM_SESSION_SECRET: "live-check-secret-0123456789-abcdefghij", SAM_USERS: "rep:pw,boss:pw2:admin",
  LLM_PROVIDER: "openai-compatible", OPENAI_COMPAT_BASE_URL: "https://api.groq.com/openai/v1", OPENAI_COMPAT_API_KEY: "gsk_stub_GROQ", OPENAI_COMPAT_MODEL: "openai/gpt-oss-120b",
});

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; }; const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

// ---- stubbed network: Supabase serves CARDS, providers and the flow answer from per-host scripts
const card = (file, title, type, brief, url) => ({ source: file, filename: file.split("/").pop(), title, asset_type: type, industry: "BFSI", client: "", products: ["HyWorks"],
  competitors: ["Citrix"], personas: [], regulations: [], key_problem: "", key_outcomes: [], brief, use_for: "", publish_year: "2025", expired: false, expiry_date: null,
  stale_risk: "", superseded_by: "", visibility: "public", internal_reason: "", public_url: url, confidence: 0.9, needs_human: "", batch: "t", item_id: null });
const CARDS = [
  card("Competition/Accops vs Citrix.pdf", "Accops vs Citrix battlecard", "Battlecard", "Where HyWorks beats Citrix for banks.", "https://downloads.accops.com/vs-citrix.pdf"),
  card("Case studies/Bank moves off Citrix.pdf", "A private bank moves off Citrix", "Case Study", "A bank replaced Citrix with HyWorks in six weeks.", "https://downloads.accops.com/bank-citrix.pdf"),
  card("Events/Gulf roadshow deck.pdf", "Gulf roadshow deck, Fortinet partner session", "Deck", "Event slides from a partner session with Fortinet.", "https://downloads.accops.com/gulf-deck.pdf"),
];
let calls = [], script = {};
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes("stub.supabase.co")) return Response.json(u.includes("sam_asset_cards") ? CARDS : []);
  if (u.endsWith("/models")) return Response.json({ data: [{ id: "gpt-transcribe" }, { id: "gpt-5.4-mini" }, { id: "openai/gpt-oss-20b" }] });
  const host = u.includes("api.openai.com") ? "openai" : u.includes("api.groq.com") ? "groq" : u.includes("flow.example") ? "flow" : "other";
  calls.push({ host, u, init, body: typeof init.body === "string" ? JSON.parse(init.body) : init.body });
  const step = (script[host] ?? []).shift();
  return step ? step(init) : Response.json({ choices: [{ message: { content: "ok" } }], text: "" });
};
const run = s => { script = s; calls = []; };
const reply = content => () => Response.json({ choices: [{ message: { content } }] });
const fail = status => () => new Response(JSON.stringify({ error: { message: "nope" } }), { status });

// ---- 1. merge
const { merge, blank, progress, KEYS } = await jiti.import("./live/framework.ts");
const done = { status: "done", value: "1,200 users", evidence: "About 1,200 users." };
const q = merge(blank(), { users: done });
eq(q.users, done, "open -> done takes the reading");
eq(merge(q, { users: { status: "partial", value: "about 1,000", evidence: "maybe a thousand" } }).users, done, "done never goes back to partial");
eq(merge(q, { users: { status: "open", value: "", evidence: "" } }).users, done, "...or to open");
eq(merge(q, { users: { status: "done", value: "1,200", evidence: "" } }).users, done, "same status without evidence keeps the quote");
const refined = { status: "done", value: "1,250 users", evidence: "It is 1,250 users now." };
eq(merge(q, { users: refined }).users, refined, "same status with its own evidence: the newer reading wins");
eq(merge({ budget: { status: "partial", value: "tied to the renewal", evidence: "We have budget for the renewal" } }, { budget: { status: "done", value: "", evidence: "" } }).budget,
  { status: "done", value: "tied to the renewal", evidence: "We have budget for the renewal" }, "an upgrade with no value or quote keeps the earlier ones");
eq(Object.keys(merge(null, { bogus: done })).sort(), [...KEYS].sort(), "all ten fields, unknown keys dropped");
eq(merge(null, { users: { status: "yes", value: 5 } }).users, { status: "open", value: "", evidence: "" }, "junk becomes open");
eq(progress(merge(null, { users: done, budget: { status: "partial", value: "x", evidence: "" } })).pct, 15, "done counts 1, partial half: 1.5 of 10 = 15%");

// ---- 2. hallucination filter
const { clean } = await jiti.import("./live/stt.ts");
for (const junk of ["Thank you.", " Thanks for watching! ", "you", "...", "?", "Thank you for watching.", "Subtitles by the Amara.org community",
  "I'm sorry. I'm sorry. I'm sorry. I'm sorry.", "Accops call about HySecure, HyWorks, HyID, HyLabs, HyDesk, ZTNA.", ""]) eq(clean(junk), "", `dropped: ${JSON.stringify(junk)}`);
for (const real of ["Yes.", "Okay, makes sense.", "Citrix, Omnissa, AVD.", "We have about 1,200 users.", "Thank you, that helps a lot."]) eq(clean(real), real, `kept: ${real}`);

// ---- 3. JSON repair and reading an insight
const { parseJSON, legs, label, firstAnswer, chatJSON } = await jiti.import("./live/llm.ts");
const { readInsight, nextQuestions, triggers, cardsFor } = await jiti.import("./live/insight.ts");
eq(parseJSON('```json\n{"a": 1}\n```'), { a: 1 }, "code fence");
eq(parseJSON('Sure! Here it is: {"a": [1, 2,], } Hope that helps.'), { a: [1, 2] }, "prose around it, trailing commas");
eq(parseJSON('{"ask_next": [{"key": "budget", "question": "Is th'), { ask_next: [{ key: "budget", question: "Is th" }] }, "cut off inside a string");
eq(parseJSON('{"a": 1, "b": '), { a: 1 }, "cut off after a key");
eq(parseJSON('{"a": 1, "b'), { a: 1 }, "cut off inside a key");
eq(parseJSON('{"a": "x, }"}'), { a: "x, }" }, "valid JSON is not 'repaired'");
eq(parseJSON("no json here"), null, "no object: null");
const tail = "Accops: How many users?\nCustomer: About 1,200 users, mostly branch staff. We run Citrix today.";
const r = readInsight('{"qualification":{"users":{"status":"done","value":"1,200","evidence":"About 1,200 users"},"budget":{"status":"partial","value":"big","evidence":"we have lots of money"},'
  + '"nonsense":{"status":"done"}},"ask_next":[{"key":"budget","question":"Is there budget?","why":"open"},{"key":"bogus","question":"?"}],'
  + '"competitors":["Citrix Virtual Apps","Accops"],"objections":[],"customer_questions":[],"alerts":[]', tail); // no closing brace
ok(r !== null, "a reply missing its closing brace is read");
eq(r.qualification.users.evidence, "About 1,200 users", "a verbatim quote is kept");
eq(r.qualification.budget, { status: "partial", value: "big", evidence: "" }, "a quote not in the transcript is dropped, the reading stays");
ok(!("nonsense" in r.qualification), "unknown field dropped");
eq(r.ask_next.map(a => a.key), ["budget"], "unknown ask_next key dropped");
eq(triggers(r).map(t => `${t.kind}:${t.text}`), ["competitor:Citrix"], "vendor name canonical, Accops never a competitor");
eq(readInsight("I could not do that.", tail), null, "prose only: null, so the next model gets a turn");

// ---- 4. ask next
const q2 = merge(null, { users: done });
eq(nextQuestions([{ key: "timeline", question: "When?", why: "" }], q2, "").map(a => a.key), ["timeline"], "the model's suggestion");
eq(nextQuestions([{ key: "users", question: "How many users?", why: "" }, { key: "budget", question: "Budget?", why: "" }], q2, "So is there a budget for this?").map(a => a.key),
  ["need", "current_solution", "use_case"], "answered and just-asked dropped; nothing left -> the framework's first open fields");
ok(nextQuestions([], q2, "").length === 3, "never more than three");

// ---- 5. collateral cards
const first = await cardsFor(triggers({ competitors: ["Citrix"], customer_questions: [], objections: ["moving off Citrix without downtime"] }), []);
eq(first.map(c => [c.trigger, c.title, c.shareable]), [["Citrix", "Accops vs Citrix battlecard", true], ["moving off Citrix without downtime", "A private bank moves off Citrix", true]],
  "competitor -> battlecard, objection -> case study, public links");
eq(first[0].link, "https://downloads.accops.com/vs-citrix.pdf", "public link when there is one");
eq((await cardsFor(triggers({ competitors: ["Citrix"], customer_questions: [], objections: ["Citrix pricing"] }), first)).length, 0, "nothing already shown comes back");
eq(triggers({ competitors: ["Omnissa Horizon", "VMware Horizon", "Citrix", "citrix"], customer_questions: [], objections: [] }).map(t => t.text), ["Omnissa", "VMware", "Citrix"],
  "a vendor is the one named first (Omnissa Horizon is Omnissa), once");
eq((await cardsFor([{ kind: "competitor", text: "Citrix" }], [{ trigger: "pricing", title: "Accops vs Citrix battlecard", brief: "", link: "x", shareable: true }])).length, 0,
  "a competitor a shown card is already about gets no second card");
eq((await cardsFor([{ kind: "competitor", text: "Fortinet" }, { kind: "question", text: "Fortinet partner session" }, { kind: "objection", text: "Gulf roadshow" }], [])).length, 0,
  "an event deck is never a card, whatever raised it");

// ---- 6. placeholders
const { fillPlaceholders, readSummary } = await jiti.import("./live/summary.ts");
const who = { contact: "Rajesh Kumar", rep: "Siddharth", company: "Bank of Pune" };
eq(fillPlaceholders("Hi [Customer Name],\nThanks for the time with [Company Name] today. The datasheet: [link to datasheet] .\nBest regards,\n[Your Name]", who),
  "Hi Rajesh,\nThanks for the time with Bank of Pune today. The datasheet:.\nBest regards,\nSiddharth", "names filled, other placeholders removed");
eq(fillPlaceholders("Dear [Name],\nThanks.\n[Name]", { ...who, contact: null }), "Dear,\nThanks.\nSiddharth", "an unknown contact leaves a plain greeting");
const s = readSummary(JSON.stringify({ overview: "Bank on Citrix.", follow_up_email: { subject: "Next steps for [Company]", body: "Hi [Customer's First Name],\nThanks.\n[Accops Rep Name]" },
  qualification: { users: { status: "done", value: "1,200", evidence: "About 1,200 users" } }, deal_score: 140 }), merge(null, null), tail, who);
ok(!/\[[^\]]*\]/.test(s.follow_up_email.subject + s.follow_up_email.body), `no placeholder survives: ${JSON.stringify(s.follow_up_email)}`);
eq(s.follow_up_email.body, "Hi Rajesh,\nThanks.\nSiddharth", "the email addresses the contact and is signed by the rep");
eq([s.deal_score, s.qualification.users.status], [100, "done"], "score clamped, qualification read");
eq(readSummary(JSON.stringify({ overview: "x", follow_up_email: { body: "" } }), merge(null, null), tail, who), null, "no email body: unusable");

// ---- 7. Power Automate payload
const { flowPayload, sendFlow, repEmail } = await jiti.import("./live/flow.ts");
Object.assign(process.env, { LIVE_REP_EMAILS: "rep:rep@accops.com, boss:boss@accops.com", LIVE_FALLBACK_EMAIL: "sales@accops.com" });
const meeting = { id: "m-1", owner: "rep", started_at: "2026-10-14T10:00:00.000Z", ended_at: "2026-10-14T10:31:40.000Z", qualification: {} };
const deal = { company: "Bank of Pune", contact_name: "Rajesh Kumar", contact_email: "rajesh@bop.example", contact_title: "CIO" };
const summary = { overview: "Bank on Citrix.", pains: [], objections: [], competitors: [], risks: [], next_steps: ["Proof of concept", "Technical session Thursday"],
  follow_up_email: { subject: "Next steps", body: "Hi Rajesh" }, deal_score: 72, qualification: merge(null, { users: done }) };
const p = flowPayload(meeting, deal, summary, "https://sam.example/");
eq(Object.keys(p).sort(), ["company", "contact_email", "contact_name", "contact_title", "dashboard_url", "deal_score", "duration_min", "ended_at", "follow_up_body",
  "follow_up_subject", "meeting_id", "next_steps", "overview", "qualification_text", "rep", "rep_email", "started_at"], "exactly the spec's fields");
eq([p.duration_min, p.rep_email, p.next_steps, p.dashboard_url], [32, "rep@accops.com", "- Proof of concept\n- Technical session Thursday", "https://sam.example/live/m-1"], "derived fields");
ok(p.qualification_text.split("\n").length === 10 && p.qualification_text.includes("Users (done): 1,200 users") && p.qualification_text.includes("Budget (open)"), p.qualification_text);
eq(repEmail("stranger"), "sales@accops.com", "unknown rep -> fallback address");
eq(await sendFlow(p), "not_configured", "no LIVE_FLOW_URL: not_configured, nothing sent");
process.env.LIVE_FLOW_URL = "https://prod.flow.example/workflows/abc/triggers/manual/paths/invoke?sig=SECRETSIG0123456789";
run({ flow: [() => new Response("", { status: 202 })] });
eq(await sendFlow(p), "sent", "202 -> sent");
eq(calls[0].body.meeting_id, "m-1", "the payload is what was posted");
run({ flow: [fail(502)] });
eq(await sendFlow(p), "failed: HTTP 502", "flow error status");
globalThis.__realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new TypeError(`fetch failed for ${process.env.LIVE_FLOW_URL}`); };
const st = await sendFlow(p);
globalThis.fetch = globalThis.__realFetch;
ok(st === "failed: could not reach the flow" && !st.includes("sig="), `network error status never quotes the URL: ${st}`);
delete process.env.LIVE_FLOW_URL;

// ---- 8. providers: order, fallback, request shapes
const { tiers } = await jiti.import("./agent-openai.ts");
eq(legs("stt").map(label), ["groq:whisper-large-v3-turbo"], "no LIVE_OPENAI_API_KEY: STT on Groq alone");
eq(legs("summary").map(label), ["groq:openai/gpt-oss-120b", "groq:openai/gpt-oss-20b"], "...and the summary on Groq 120b then 20b");
process.env.LIVE_OPENAI_API_KEY = "sk-live-stub-KEY1";
eq(legs("stt").map(label), ["openai:gpt-transcribe", "groq:whisper-large-v3-turbo"], "STT: OpenAI first");
eq(legs("insight").map(label), ["openai:gpt-5.4-mini", "groq:openai/gpt-oss-20b"], "insight: OpenAI first");
eq(legs("summary").map(label), ["openai:gpt-5.5", "groq:openai/gpt-oss-120b", "groq:openai/gpt-oss-20b"], "summary: OpenAI, then Groq 120b, then 20b");
ok(tiers().length === 1 && tiers()[0].provider === "openai-compatible", "SAM chat's tiers are untouched by the Live key");

const msgs = [{ role: "system", content: "Return JSON." }, { role: "user", content: "x" }];
const insightJSON = '{"qualification":{"users":{"status":"done","value":"1,200","evidence":"About 1,200 users"}},"ask_next":[]}';
const readWith = async (l, ms) => readInsight(await chatJSON(l, msgs, { maxTokens: 900, timeoutMs: ms }), tail);
run({ openai: [reply(insightJSON)] });
let out = await firstAnswer("insight", legs("insight"), Date.now() + 11_000, readWith);
const ob = calls[0].body;
eq(out.model, "openai:gpt-5.4-mini", "OpenAI answers first");
ok(calls[0].init.headers.Authorization === "Bearer sk-live-stub-KEY1" && ob.max_completion_tokens === 900 && !("max_tokens" in ob) && ob.reasoning_effort === "none"
  && ob.store === false && ob.response_format.type === "json_object", `OpenAI body: ${JSON.stringify({ ...ob, messages: undefined })}`);
run({ openai: [fail(500)], groq: [reply(insightJSON)] });
out = await firstAnswer("insight", legs("insight"), Date.now() + 11_000, readWith);
const gb = calls[1].body;
ok(out.model === "groq:openai/gpt-oss-20b" && out.value.qualification.users.status === "done", "OpenAI 500 -> Groq answers");
ok(calls[1].init.headers.Authorization === "Bearer gsk_stub_GROQ" && gb.max_tokens > 900 && gb.reasoning_effort === "low" && !("store" in gb), `Groq body: ${JSON.stringify({ ...gb, messages: undefined })}`);
run({ openai: [reply("Sorry, I can't.")], groq: [reply(insightJSON)] });
eq((await firstAnswer("insight", legs("insight"), Date.now() + 11_000, readWith)).model, "groq:openai/gpt-oss-20b", "an unreadable reply also falls through");
run({ openai: [fail(429)], groq: [fail(503)] });
await assert.rejects(firstAnswer("insight", legs("insight"), Date.now() + 11_000, readWith), e => /openai:gpt-5\.4-mini: 429.*groq:openai\/gpt-oss-20b: 503/.test(e.message) && !e.unconfigured, "every failure named");
n++;

const { transcribe } = await jiti.import("./live/stt.ts");
const wav = new Uint8Array(64);
run({ openai: [() => Response.json({ text: "We use Omnissa." })] });
let heard = await transcribe(wav, { meetingId: "m", channel: "customer" });
const f0 = calls[0].body;
ok(heard.model === "openai:gpt-transcribe" && heard.text === "We use Omnissa." && calls[0].u.endsWith("/audio/transcriptions"), "OpenAI transcribes");
ok(f0.get("model") === "gpt-transcribe" && f0.get("language") === "en" && /HySecure/.test(f0.get("prompt")) && f0.get("temperature") === null, "OpenAI form: no temperature");
run({ openai: [fail(503)], groq: [() => Response.json({ text: "We use Omnissa." })] });
heard = await transcribe(wav, { meetingId: "m", channel: "customer" });
ok(heard.model === "groq:whisper-large-v3-turbo" && calls[1].body.get("temperature") === "0", "OpenAI down -> Groq Whisper, temperature 0");
delete process.env.LIVE_OPENAI_API_KEY;
const savedProvider = process.env.LLM_PROVIDER; delete process.env.LLM_PROVIDER;
await assert.rejects(transcribe(wav, { meetingId: "m", channel: "rep" }), e => e.unconfigured === true, "no provider at all: unconfigured (the route says 503)");
n++;
process.env.LLM_PROVIDER = savedProvider;

// ---- 9. mock mode
const { mockOn } = await jiti.import("./live/mock.ts");
process.env.LIVE_MOCK = "1"; process.env.VERCEL_ENV = "production";
ok(!mockOn(), "LIVE_MOCK=1 does nothing in production");
process.env.VERCEL_ENV = "preview"; ok(mockOn(), "...but works elsewhere");
delete process.env.LIVE_MOCK; delete process.env.VERCEL_ENV; ok(!mockOn(), "off by default");

// ---- 10. bearer session tokens
const { issueToken, verifyToken } = await jiti.import("./auth.ts");
const { resolveCaller } = await jiti.import("./apiauth.ts");
const { SignJWT } = await import("jose");
const repJwt = await issueToken({ id: "rep", admin: false }), bossJwt = await issueToken({ id: "boss", admin: true });
const req = (tok, url = "https://sam/x", init = {}) => new Request(url, { ...init, headers: { Authorization: `Bearer ${tok}`, ...(init.headers ?? {}) } });
eq(await resolveCaller(req(repJwt)), { id: "rep", admin: false, via: "cookie" }, "a rep's desktop token is the rep's cookie");
eq(await resolveCaller(req(bossJwt)), { id: "boss", admin: true, via: "cookie" }, "an admin's carries the admin flag");
eq(await resolveCaller(req("tok_check")), { id: "check", admin: false, via: "token" }, "API tokens unchanged");
const sign = (claims, secret, exp) => new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setExpirationTime(exp).sign(new TextEncoder().encode(secret));
ok(await verifyToken(`${repJwt.slice(0, -3)}abc`) === null, "a tampered token is refused");
ok(await verifyToken(await sign({ id: "boss", admin: true }, "some-other-secret-0123456789abcdef", "1h")) === null, "a token signed with another secret is refused");
ok(await verifyToken(await sign({ id: "rep", admin: false }, process.env.SAM_SESSION_SECRET, Math.floor(Date.now() / 1000) - 60)) === null, "an expired token is refused");

const { GET: provider } = await jiti.import("../app/api/v1/provider/route.ts");
eq((await provider(req(repJwt, "https://sam/api/v1/provider"))).status, 403, "a rep's token is refused on the admin-only provider check");
run({});
const pr = await provider(req(bossJwt, "https://sam/api/v1/provider"));
const pj = JSON.parse(await pr.text());
ok(pr.status === 200 && Array.isArray(pj.live.stt) && pj.live.stt[0].model === "groq:whisper-large-v3-turbo" && pj.live.stt[0].available === false, `admin token works; live models reported: ${JSON.stringify(pj.live)}`);
ok(!JSON.stringify(pj).includes("gsk_stub_GROQ"), "no key in the provider report");
eq((await provider(req("tok_check", "https://sam/api/v1/provider"))).status, 200, "an API token still passes, as before");
const { POST: ask } = await jiti.import("../app/api/v1/ask/route.ts");
const pin = await ask(req(repJwt, "https://sam/api/v1/ask", { method: "POST", headers: { "x-sam-test": "1", "Content-Type": "application/json" },
  body: JSON.stringify({ question: "citrix", model: "openai/gpt-oss-120b" }) }));
eq(pin.status, 403, "a desktop token cannot pin the model (an API-token privilege)");

const { POST: login } = await jiti.import("../app/api/live/login/route.ts");
const li = await login(new Request("https://sam/api/live/login", { method: "POST", body: JSON.stringify({ id: " Rep ", password: "pw" }) }));
const lj = await li.json();
ok(li.status === 200 && lj.user.id === "rep" && lj.user.admin === false && (await verifyToken(lj.token))?.id === "rep", "desktop login returns a session token");
eq((await login(new Request("https://sam/api/live/login", { method: "POST", body: JSON.stringify({ id: "rep", password: "nope" }) }))).status, 401, "wrong password: 401");
eq((await login(new Request("https://sam/api/live/login", { method: "POST", body: "{}" }))).status, 400, "nothing sent: 400");

console.log(`live.check: ${n} assertions passed`);
