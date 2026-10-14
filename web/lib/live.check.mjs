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
 *       and cannot use API-token privileges; API tokens and bad tokens behave as before
 *   11. echo: a rep utterance that is the customer's speech heard by the mic is matched (contained, or Jaccard
 *       >= 0.6, within 4 s); short, unrelated or late ones are not; the audio route drops a rep echo and
 *       removes a stored one when the customer's copy arrives
 *   12. assist: "next" reads one line (intent, why <= 15 words) and falls back to the framework when no model
 *       answers; "search" returns SAM cards and adds the web only without a good match, labelled unverified,
 *       citations stripped, <= 3 sources; nothing from the web without the OpenAI key; 409 once ended
 *   13. delete: owner or admin only (404 for anyone else, nothing deleted); the deal goes only when no other call is on it
 *   14. calls with no company: created without a deal (platform checked, auto_started); PATCH is owner/admin, moves
 *       the call to the owner's deal (any case) and deletes an emptied old one; End turns the company the customer
 *       named (never a guess) into the deal before the flow runs; the flow payload copes with no deal */
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
let calls = [], script = {}, rows = () => undefined, dbCalls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes("stub.supabase.co")) {
    if (u.includes("sam_asset_cards")) return Response.json(CARDS);
    const du = decodeURIComponent(u), method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    dbCalls.push({ u: du, method, body });
    return Response.json(rows(du, method, body) ?? []);
  }
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

const FRAMEWORK_Q0 = "What's prompting you to look at this now?";
const SB = "https://stub.supabase.co/rest/v1/";
// ---- 11. echo de-duplication
const { sameWords, isEcho, gapMs } = await jiti.import("./live/echo.ts");
ok(sameWords("we need it before the March renewal", "Honestly, we need it before the March renewal, so January."), "rep text inside the customer's: echo");
ok(sameWords("about twelve hundred users mostly branch staff", "About twelve hundred users, mostly the branch staff."), "not contained but Jaccard 7/8: echo");
ok(sameWords("Yes, that works.", "yes that works"), "exactly three tokens is long enough");
ok(!sameWords("yes okay", "yes okay"), "under three tokens: never judged an echo");
ok(!sameWords("Thanks so much for that", "ok"), "a customer text under three tokens: not an echo either");
ok(!sameWords("How many users do you have?", "About 1,200 users."), "a question and its answer are not the same speech");
ok(!sameWords("what do you use for remote access today", "we use citrix for remote access"), "Jaccard 4/10 = 0.4: kept");
ok(!sameWords("on citrix virtual", "we run non citrix virtualisation"), "containment is by whole tokens");
ok(!sameWords("Right, so about 1,200 users mostly branch staff, got it, thanks for that", "About 1,200 users mostly branch staff"),
  "the rep talking over an echo (the customer's words inside the rep's) is kept: Jaccard 0.5");
const at = (t_ms, duration_ms, text) => ({ t_ms, duration_ms, text });
const said = "We're on Citrix Virtual Apps with NetScaler today";
ok(isEcho(at(1000, 3000, said), at(1200, 3500, said)), "overlapping in time: echo");
eq([gapMs(at(0, 2000, ""), at(6000, 1000, "")), gapMs(at(6000, 1000, ""), at(0, 2000, "")), gapMs(at(0, null, ""), at(0, 500, ""))], [4000, 4000, 0], "gap is symmetric, 0 on overlap");
ok(isEcho(at(0, 2000, said), at(6000, 2000, said)) && !isEcho(at(0, 2000, said), at(6001, 2000, said)), "4 s apart: echo; 4.001 s: not");
ok(!isEcho(at(0, null, said), at(4500, null, said)), "unknown durations count as instants");

const MID = "11111111-1111-4111-8111-111111111111", DID = "22222222-2222-4222-8222-222222222222", BOSS_MID = "33333333-3333-4333-8333-333333333333";
const mrow = (o = {}) => ({ id: MID, deal_id: DID, owner: "rep", title: null, status: "live", started_at: "2026-10-14T10:00:00Z", ended_at: null, qualification: {}, suggestions: [],
  battlecards: [], summary: null, flow_status: null, last_insight_at: null, is_test: true, ...o });
const meetingRows = (u, method = "GET") => method !== "GET" ? undefined : u.includes(`live_meetings?id=eq.${MID}`) ? [mrow()] : u.includes(`live_meetings?id=eq.${BOSS_MID}`) ? [mrow({ id: BOSS_MID, owner: "boss" })] : undefined;
const ctx = id => ({ params: Promise.resolve({ id }) });
const { POST: audio } = await jiti.import("../app/api/live/meetings/[id]/audio/route.ts");
const wavBody = () => { const b = new Uint8Array(1000); b.set(new TextEncoder().encode("RIFF"), 0); b.set(new TextEncoder().encode("WAVE"), 8); return b; };
const up = (channel, t_ms, duration_ms) => audio(new Request(`https://sam/api/live/meetings/${MID}/audio?channel=${channel}&t_ms=${t_ms}&duration_ms=${duration_ms}`,
  { method: "POST", body: wavBody(), headers: { Authorization: `Bearer ${repJwt}` } }), ctx(MID));
process.env.LIVE_OPENAI_API_KEY = "sk-live-stub-KEY1";
const custSeg = { id: 7, channel: "customer", t_ms: 1000, duration_ms: 3500, text: said };
rows = (u, method) => meetingRows(u, method) ?? (method === "POST" && u.includes("live_segments") ? [{ id: 8, channel: "rep", t_ms: 1200, duration_ms: 3000, text: said }]
  : u.includes("channel=eq.customer&t_ms=gte") ? [custSeg] : undefined);
run({ openai: [() => Response.json({ text: said })] }); dbCalls = [];
eq(await (await up("rep", 1200, 3000)).json(), { segment: null, dropped: "echo" }, "a rep upload matching a stored customer segment: dropped as an echo");
ok(dbCalls.some(c => c.method === "DELETE" && c.u.includes("live_segments") && c.u.includes("id=in.(8)")), "...and its row is gone");
const repSeg = { id: 5, channel: "rep", t_ms: 900, duration_ms: 3000, text: "Citrix Virtual Apps with NetScaler" };
rows = (u, method) => meetingRows(u, method) ?? (method === "POST" && u.includes("live_segments") ? [{ ...custSeg, id: 9 }]
  : u.includes("channel=eq.rep&t_ms=gte") ? [repSeg, { id: 6, channel: "rep", t_ms: 0, duration_ms: 800, text: "What are you running today?" }] : undefined);
run({ openai: [() => Response.json({ text: said })] }); dbCalls = [];
const aj = await (await up("customer", 1000, 3500)).json();
ok(aj.segment?.id === 9 && aj.segment.text === said, "the customer's copy is stored");
eq(aj.removed_segment_ids, [5], "the rep's echo of it is removed; the rep's own question is not");
ok(dbCalls.some(c => c.method === "DELETE" && c.u.includes("id=in.(5)")), "...deleted in the database");
rows = (u, method) => meetingRows(u, method) ?? (method === "POST" && u.includes("live_segments") ? [{ id: 10, channel: "rep", t_ms: 20000, duration_ms: 2000, text: said }] : undefined);
run({ openai: [() => Response.json({ text: said })] });
const kept = await (await up("rep", 20000, 2000)).json();
ok(kept.segment?.id === 10 && !("dropped" in kept) && !("removed_segment_ids" in kept), "nothing near on the other channel: stored as usual");

// ---- 12. assist
const { readNext, readWeb, needsWeb, fallbackLine } = await jiti.import("./live/assist.ts");
eq(readNext('{"say":{"line":"  So what made the RBI flag it now?  ","intent":"discovery","why":"Need is still partial."},"competitors":["Citrix"]}'),
  { say: { line: "So what made the RBI flag it now?", intent: "discovery", why: "Need is still partial." }, customer_questions: [], competitors: ["Citrix"], objections: [] }, "a reply read");
eq(readNext('{"say":{"line":"Fair point.","intent":"pitch","why":"one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen"}}').say,
  { line: "Fair point.", intent: "discovery", why: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen" }, "unknown intent -> discovery; why cut to 15 words");
eq([readNext('{"say":{"line":""}}'), readNext("Say hello."), readNext('{"line":"x"}')], [null, null, null], "no line: unusable, so the next model gets a turn");
eq(fallbackLine(merge(null, { need: done })).line, "What are you using today for remote access and virtual desktops?", "no model: the first open field's question");
eq(fallbackLine(Object.fromEntries(KEYS.map(k => [k, done]))).intent, "advance", "everything done: advance");

const { POST: assist } = await jiti.import("../app/api/live/meetings/[id]/assist/route.ts");
const ask2 = (body, tok = repJwt, id = MID) => assist(new Request(`https://sam/api/live/meetings/${id}/assist`, { method: "POST", body: JSON.stringify(body), headers: { Authorization: `Bearer ${tok}` } }), ctx(id));
const tx = [{ id: 1, channel: "rep", t_ms: 0, duration_ms: 2000, text: "What are you running today?" }, { id: 2, channel: "customer", t_ms: 3000, duration_ms: 4000, text: "We're on Citrix and the renewal price doubled." }];
rows = u => meetingRows(u) ?? (u.includes("live_segments") ? [...tx].reverse() : undefined);
run({ openai: [reply('{"say":{"line":"Many banks moved off Citrix for that reason. How many users are on it today?","intent":"objection","why":"Price pain opens the door; users still open."},'
  + '"competitors":["Citrix Virtual Apps"],"objections":["renewal price"],"customer_questions":[]}')] });
let aw = await (await ask2({})).json();
eq(Object.keys(aw).sort(), ["cards", "mode", "model", "say", "web"], "next: exactly mode, say, cards, web, model");
ok(aw.mode === "next" && aw.say.intent === "objection" && aw.model === "openai:gpt-5.4-mini" && aw.web === null, `next answered: ${JSON.stringify(aw.say)}`);
ok(calls[0].body.messages[1].content.includes("Customer: We're on Citrix") && calls[0].body.messages[1].content.includes("need (Need): OPEN"), "the prompt has the transcript tail and the open fields");
ok(aw.cards.length >= 1 && aw.cards.length <= 2 && aw.cards[0].title === "Accops vs Citrix battlecard" && Object.keys(aw.cards[0]).sort().join() === "brief,link,shareable,title,trigger",
  `up to 2 cards, battlecard shape: ${JSON.stringify(aw.cards)}`);
run({ openai: [fail(500)], groq: [fail(503)] });
aw = await (await ask2({})).json();
ok(aw.model === "none" && aw.say.line === FRAMEWORK_Q0, `every model down: the framework's question (${JSON.stringify(aw.say)})`);

const respJSON = (text, cites) => () => Response.json({ output: [{ type: "web_search_call", status: "completed" }, { type: "message", content: [{ type: "output_text", text, annotations: cites }] }] });
const cite = (url, title) => ({ type: "url_citation", url, title, start_index: 0, end_index: 1 });
run({ openai: [respJSON("This year Omnissa named a new CEO and launched Omnissa ONE. ([omnissa.com](https://www.omnissa.com/news/a?utm_source=openai)) More in [the release](https://x.example/r).",
  [cite("https://www.omnissa.com/news/a?utm_source=openai", "Omnissa appoints a new CEO"), cite("https://www.omnissa.com/news/a?utm_source=openai", "dup"), cite("https://b.example/2", "B"), cite("https://c.example/3", ""), cite("https://d.example/4", "D")])] });
aw = await (await ask2({ question: "What did Omnissa announce this year?" })).json();
const wb = calls[0]?.body;
ok(calls[0]?.u.endsWith("/v1/responses") && wb.model === "gpt-5.4-mini" && JSON.stringify(wb.tools) === '[{"type":"web_search"}]' && wb.store === false && wb.reasoning?.effort === "none"
  && wb.input === "What did Omnissa announce this year?", `Responses API request: ${JSON.stringify({ ...wb, instructions: undefined })}`);
eq(aw.web, { answer: "This year Omnissa named a new CEO and launched Omnissa ONE. More in the release.", unverified: true,
  sources: [{ title: "Omnissa appoints a new CEO", url: "https://www.omnissa.com/news/a" }, { title: "B", url: "https://b.example/2" }, { title: "c.example", url: "https://c.example/3" }] },
  "web: citations stripped, utm dropped, distinct sources, at most 3, labelled unverified");
ok(aw.mode === "search" && aw.model === "openai:gpt-5.4-mini" && Array.isArray(aw.cards) && !("say" in aw), "search shape");
run({});
aw = await (await ask2({ question: "How do we compare to Citrix?" })).json();
ok(aw.cards[0]?.title === "Accops vs Citrix battlecard" && aw.web === null && aw.model === "sam" && !calls.length, `a good SAM match: no web call (${JSON.stringify(aw)})`);
ok(needsWeb("Citrix pricing", []) && needsWeb("What did Citrix announce?", [CARDS[0]]) && !needsWeb("Citrix pricing", [CARDS[2], CARDS[0]]), "no card, or fresh facts: the web; any good card among those shown: SAM only");
eq(readWeb({ output: [{ type: "message", content: [{ type: "output_text", text: Array.from({ length: 95 }, (_, i) => `w${i}`).join(" "), annotations: [] }] }] }).answer.split(" ").length, 80, "web answer cut to 80 words");
eq(readWeb({ output: [{ type: "web_search_call" }] }), null, "no message: no web answer");
run({ openai: [fail(500)] });
aw = await (await ask2({ question: "What did Omnissa announce this year?" })).json();
ok(aw.web === null && aw.model === "sam", "the web failing leaves SAM's answer");
delete process.env.LIVE_OPENAI_API_KEY;
run({});
aw = await (await ask2({ question: "What did Omnissa announce this year?" })).json();
ok(aw.web === null && !calls.length, "no OpenAI key: SAM only, nothing sent anywhere");
rows = u => (u.includes(`live_meetings?id=eq.${MID}`) ? [mrow({ status: "ended" })] : undefined);
eq((await ask2({})).status, 409, "assist after the call ended: 409");
rows = meetingRows;
eq((await ask2({}, repJwt, BOSS_MID)).status, 404, "assist on someone else's call: 404");

// ---- 13. delete
const { DELETE: del } = await jiti.import("../app/api/live/meetings/[id]/route.ts");
const rm = (id, tok) => del(new Request(`https://sam/api/live/meetings/${id}`, { method: "DELETE", headers: tok ? { Authorization: `Bearer ${tok}` } : {} }), ctx(id));
const deletes = () => dbCalls.filter(c => c.method === "DELETE").map(c => c.u.split("?")[0].replace(SB, ""));
rows = meetingRows; dbCalls = [];
// No login (401) needs a request scope for cookies(): scripts/live-smoke.mjs checks it against a server.
eq((await rm(BOSS_MID, repJwt)).status, 404, "a rep deleting someone else's call: 404");
eq(deletes(), [], "...and nothing was deleted");
dbCalls = [];
const dr = await rm(MID, repJwt);
eq([dr.status, await dr.json()], [200, { deleted: MID, deal_deleted: true }], "the owner deletes their call");
eq(deletes(), ["live_meetings", "live_deals"], "meeting, then its deal (no other call on it)");
rows = u => meetingRows(u) ?? (u.includes(`deal_id=eq.${DID}`) ? [{ id: "44444444-4444-4444-8444-444444444444" }] : undefined); dbCalls = [];
eq(await (await rm(MID, bossJwt)).json(), { deleted: MID, deal_deleted: false }, "an admin deletes a rep's call; the deal stays while another call is on it");
eq(deletes(), ["live_meetings"], "...only the meeting row");
rows = () => undefined;

// ---- 14. calls with no company: create without a deal, PATCH who it was, End attaches the company the customer named
const { POST: createCall } = await jiti.import("../app/api/live/meetings/route.ts");
const { PATCH: patchCall } = await jiti.import("../app/api/live/meetings/[id]/route.ts");
const { POST: endCall } = await jiti.import("../app/api/live/meetings/[id]/end/route.ts");
const { readDetected } = await jiti.import("./live/summary.ts");
const posted = t => dbCalls.filter(c => c.method === "POST" && c.u.replace(SB, "").startsWith(t));
const echoRow = (body, extra = {}) => [{ id: MID, started_at: "2026-10-14T10:00:00Z", status: "live", ...body, ...extra }];
rows = (u, method, body) => method === "POST" && u.startsWith(`${SB}live_meetings`) ? echoRow(body) : undefined; dbCalls = [];
const cr = await createCall(new Request("https://sam/api/live/meetings", { method: "POST", headers: { Authorization: `Bearer ${repJwt}` },
  body: JSON.stringify({ platform: "phone-link", auto_started: true }) }));
const cj = await cr.json();
ok(cr.status === 200 && cj.meeting.deal_id === null && cj.meeting.platform === "phone-link" && cj.meeting.auto_started === true, `no company: a call without a deal (${JSON.stringify(cj.meeting)})`);
ok(!posted("live_deals").length && posted("live_meetings")[0].body.deal_id === null, "...and no placeholder deal");
dbCalls = [];
const cj2 = await (await createCall(new Request("https://sam/api/live/meetings", { method: "POST", headers: { Authorization: `Bearer ${repJwt}` },
  body: JSON.stringify({ platform: "skype", auto_started: "yes" }) }))).json();
eq([cj2.meeting.platform, cj2.meeting.auto_started], [null, false], "an unknown platform is null; auto_started only when true");

const OLD = DID, NEW = "55555555-5555-4555-8555-555555555555";
const dealRow = (id, company, extra = {}) => ({ id, owner: "rep", company, contact_name: null, contact_email: null, contact_title: null, notes: null, created_at: "", updated_at: "", ...extra });
const patchReq = (body, tok = repJwt, id = MID) => patchCall(new Request(`https://sam/api/live/meetings/${id}`, { method: "PATCH", headers: { Authorization: `Bearer ${tok}` }, body: JSON.stringify(body) }), ctx(id));
let others = [];
rows = (u, method, body) => {
  if (u.includes(`live_meetings?id=eq.${MID}`)) return method === "GET" ? [mrow()] : [mrow(body)];
  if (u.includes(`live_meetings?id=eq.${BOSS_MID}`)) return [mrow({ id: BOSS_MID, owner: "boss" })];
  if (u.includes(`live_deals?id=eq.${OLD}`) && method === "GET") return [dealRow(OLD, "Old Co")];
  if (u.includes("live_deals?owner=eq.rep&company=ilike")) return [];
  if (method === "POST" && u.startsWith(`${SB}live_deals`)) return [dealRow(NEW, body.company, body)];
  if (u.includes(`live_meetings?deal_id=eq.${OLD}`)) return others;
};
dbCalls = [];
eq((await patchReq({ company: "Sunrise" }, repJwt, BOSS_MID)).status, 404, "PATCH someone else's call: 404");
ok(!dbCalls.some(c => c.method !== "GET"), "...and nothing written");
eq((await patchReq({})).status, 400, "PATCH with nothing to change: 400");
let pr14 = await patchReq({ company: " Sunrise Cooperative Bank ", contact_name: "Priya", contact_title: "CIO" });
let pj2 = await pr14.json();
ok(pr14.status === 200 && pj2.meeting.deal_id === NEW && pj2.deal.company === "Sunrise Cooperative Bank" && pj2.deal.contact_name === "Priya", `PATCH moves the call to the new deal: ${JSON.stringify(pj2.deal)}`);
ok(dbCalls.some(c => c.method === "DELETE" && c.u.includes(`live_deals?id=eq.${OLD}`)), "the old deal, now empty, is deleted");
others = [{ id: "66666666-6666-4666-8666-666666666666" }]; dbCalls = [];
await patchReq({ company: "Sunrise Cooperative Bank" }, bossJwt);
ok(!dbCalls.some(c => c.method === "DELETE"), "an admin's PATCH works, and an old deal with another call stays");
ok(dbCalls.some(c => c.u.includes("live_deals?owner=eq.rep&")), "the deal is the meeting owner's, not the admin's");
const base14 = rows;
rows = (u, method, body) => u.includes("live_deals?owner=eq.rep&company=ilike") ? [dealRow("77777777-7777-4777-8777-777777777777", "sunrise cooperative bank")]
  : u.includes("live_deals?id=eq.77777777") && method === "PATCH" ? [dealRow("77777777-7777-4777-8777-777777777777", "sunrise cooperative bank", body)] : base14(u, method, body);
dbCalls = [];
pj2 = await (await patchReq({ company: "SUNRISE Cooperative Bank" })).json();
ok(pj2.meeting.deal_id === "77777777-7777-4777-8777-777777777777" && !posted("live_deals").length, "an existing deal of that name, any case, is reused");
rows = (u, method, body) => u.includes(`live_meetings?id=eq.${MID}`) ? [mrow({ deal_id: null, ...(method === "GET" ? {} : body) })] : undefined;
eq((await patchReq({ contact_name: "Priya" })).status, 400, "a contact without a company on a call with no deal: 400");
eq((await (await patchReq({ title: "Cold call" })).json()).meeting.title, "Cold call", "the title alone can be set");

eq(readDetected({ company: "Sunrise Cooperative Bank", contact_name: "Priya", contact_title: "IT head" }, "Customer: Hi, this is Priya from Sunrise Co-operative Bank."),
  { company: "Sunrise Cooperative Bank", contact_name: "Priya", contact_title: "IT head" }, "detected: kept when said (hyphen and case aside)");
eq(readDetected({ company: "Sunrise Bank Ltd", contact_name: "Priya Sharma", contact_title: "CIO" }, "Customer: Hi, this is Priya from Sunrise."),
  { company: "", contact_name: "", contact_title: "" }, "a company or name not in the transcript is a guess: dropped, and the title with them");
eq(readDetected(null, "x"), { company: "", contact_name: "", contact_title: "" }, "nothing detected: empty strings");

const flowNoDeal = flowPayload(meeting, null, summary, "https://sam.example");
eq([flowNoDeal.company, flowNoDeal.contact_name, flowNoDeal.contact_email, flowNoDeal.contact_title], ["", "", "", ""], "flow payload without a deal: empty strings");

const said14 = [{ id: 1, channel: "customer", t_ms: 0, duration_ms: 4000, text: "Hi, this is Priya from Sunrise Co-operative Bank, we got your number from a colleague." },
  { id: 2, channel: "rep", t_ms: 5000, duration_ms: 3000, text: "Thanks Priya. What are you using for remote access today?" }];
const sumJSON = det => JSON.stringify({ overview: "A cooperative bank called about remote access.", detected: det, follow_up_email: { subject: "Remote access", body: "Hi Priya,\nThanks.\nRep" }, deal_score: 30 });
const endRows = (u, method, body) => {
  if (u.includes(`live_meetings?id=eq.${MID}`)) return [mrow({ deal_id: null, platform: "phone-link", auto_started: true, ...(method === "GET" ? {} : body) })];
  if (u.includes("live_segments")) return said14;
  if (u.includes("live_deals?owner=eq.rep&company=ilike")) return [];
  if (method === "POST" && u.startsWith(`${SB}live_deals`)) return [dealRow(NEW, body.company, body)];
};
process.env.LIVE_OPENAI_API_KEY = "sk-live-stub-KEY1"; process.env.LIVE_FLOW_URL = "https://prod.flow.example/x?sig=S";
rows = endRows; dbCalls = [];
run({ openai: [reply(sumJSON({ company: "Sunrise Cooperative Bank", contact_name: "Priya", contact_title: "" }))], flow: [() => new Response("", { status: 202 })] });
let er14 = await endCall(new Request(`https://sam/api/live/meetings/${MID}/end`, { method: "POST", headers: { Authorization: `Bearer ${repJwt}` } }), ctx(MID));
let ej = await er14.json();
const flowCall = calls.find(c => c.host === "flow");
ok(er14.status === 200 && ej.summary.detected.company === "Sunrise Cooperative Bank" && ej.flow_status === "sent", `End reads who called: ${JSON.stringify(ej.summary.detected)}`);
ok(posted("live_deals")[0]?.body.company === "Sunrise Cooperative Bank" && dbCalls.some(c => c.method === "PATCH" && c.body?.deal_id === NEW), "the detected company becomes the call's deal");
eq([flowCall.body.company, flowCall.body.contact_name], ["Sunrise Cooperative Bank", "Priya"], "...before the flow runs: the email and sheet row carry it");
dbCalls = [];
run({ openai: [reply(sumJSON({ company: "", contact_name: "", contact_title: "" }))], flow: [() => new Response("", { status: 202 })] });
ej = await (await endCall(new Request(`https://sam/api/live/meetings/${MID}/end`, { method: "POST", headers: { Authorization: `Bearer ${repJwt}` } }), ctx(MID))).json();
ok(!posted("live_deals").length && calls.find(c => c.host === "flow").body.company === "", "no company said: no deal, company \"\" in the flow");
delete process.env.LIVE_OPENAI_API_KEY; delete process.env.LIVE_FLOW_URL;
rows = () => undefined;

console.log(`live.check: ${n} assertions passed`);
