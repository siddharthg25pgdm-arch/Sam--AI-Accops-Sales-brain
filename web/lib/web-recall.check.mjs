// Run: node web/lib/web-recall.check.mjs - welcome-back memory (recall.ts, 27 Oct 2026) on REAL data: the bank
// (corpus/web/qa-citrix-lp.json, approved = the committed intent index's pairs; lp-27 is the bank's one unapproved pair),
// the page cards and the committed intent index. PostgREST is stubbed as sam_web_reader sees it, sam_web_recall included.
// Covers: the id format and the EU/EEA/UK/CH session-only rule; the greeting only ever from APPROVED labels (a typed
// question or a retired pair is never echoed) or a public page card's title; the emphasis rules; unknown / malformed id
// and bots -> the normal greeting; the config route's caching (public + Vary by country without an id, private no-store
// with one) and its teaser; /embed's props; page_viewed in the event route; the 07 SQL's shape.
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const json = f => JSON.parse(readFileSync(path.join(web, f), "utf8"));
const stub = path.join(mkdtempSync(path.join(tmpdir(), "web-recall-")), "stub.mjs");
writeFileSync(stub, "export const Barlow = () => ({ variable: 'f' }); export default function Widget() { return null; } export const headers = async () => new Headers(globalThis.__H ?? {});"
  + "export const checkBotId = async () => ({ isBot: false, isVerifiedBot: false });");
const jiti = createJiti(import.meta.url, { alias: { "@": web, "botid/server": stub } });
const pj = createJiti(import.meta.url, { alias: { "next/font/google": stub, "next/headers": stub, "@/components/blocks/blocks.css": stub, "./embed.css": stub,
  "./Widget": stub, "botid/server": stub, "@": web }, jsx: { runtime: "automatic" } });
Object.assign(process.env, { WEB_CHAT_ENABLED: "1", SUPABASE_URL: "https://stub.supabase.co", SAM_WEB_READER_JWT: "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2FtX3dlYl9yZWFkZXIifQ.sig",
  SAM_WEB_SUPABASE_APIKEY: "sb_publishable_stub", WEB_IP_SALT: "salt", WEB_HS_SECRET: "hs-secret-for-the-check" });

const approved = new Set(json("data/web-intent-index.json").intents.map(i => i.qa_id));
const all = json("../corpus/web/qa-citrix-lp.json"), bank = all.filter(q => approved.has(q.id));
const cards = [...json("../corpus/web/pages-citrix-lp.json"), ...json("../corpus/web/pages-accops-com.json")];
const LP = "https://accops-citrix-lp.vercel.app/", group = u => (/^https:\/\/accops-citrix-lp\.vercel\.app([/?#]|$)/i.test(u) ? "citrix-lp" : "general");
const byNudge = (a, b) => b.nudge_weight - a.nudge_weight || (a.id < b.id ? -1 : 1);
const MEM = new Map(), calls = [], events = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url)), fn = u.pathname.replace("/rest/v1/", ""), args = init.body ? JSON.parse(init.body) : null;
  calls.push({ fn, args });
  if (fn === "rpc/sam_web_recall") return Response.json(MEM.get(args.visitor_id) ?? null);
  if (fn === "rpc/sam_web_page_group") return Response.json(group(args.url));
  if (fn === "rpc/sam_web_children") return Response.json(bank.filter(q => q.parent_id === args.qa_id).sort(byNudge).map(q => ({ id: q.id, question: q.question })));
  if (fn === "rpc/sam_web_roots") {
    const r = bank.filter(q => !q.parent_id), own = r.filter(q => q.pages.includes(group(args.page_url)));
    return Response.json((own.length ? own : r.filter(q => q.pages.includes("general"))).sort(byNudge).map(q => ({ id: q.id, question: q.question })));
  }
  if (fn === "rpc/sam_web_settings") return Response.json({ enabled: true, model_enabled: true, cta_url: "https://www.accops.com/schedule-a-free-demo", cta_label: "Talk to an expert" });
  if (fn === "rpc/sam_web_log_event") { events.push(args.e); return new Response(null, { status: 204 }); }
  if (fn === "sam_web_qa_public") return Response.json(bank.map(({ id, question, sources, pages, nudge_weight, visual }) => ({ id, question, sources, pages, nudge_weight, visual: visual?.type ?? null })));
  if (fn === "sam_web_pages_public") {
    const want = u.searchParams.get("url").replace(/^in\.\(|\)$/g, "").split(",").map(s => s.replace(/^"|"$/g, ""));
    return Response.json(cards.filter(c => want.includes(c.url)).map(({ url, title, page_type, products, industries, questions_answered }) => ({ url, title, page_type, products, industries, questions_answered })));
  }
  return new Response("unknown", { status: 404 });
};

const R = await jiti.import("./web/recall.ts");
const { emProblems } = await jiti.import("./emphasis.ts");
const { pageHuman } = await jiti.import("./web/bot.ts");
const config = await jiti.import("../app/api/web/config/route.ts");
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const Q = new Map(all.map(q => [q.id, q]));
const id = k => `0f8e2d1c-3b4a-4c5d-9e6f-${String(k).padStart(12, "0")}`; // a v4-shaped id per test device
const rpcs = fn => calls.filter(c => c.fn === `rpc/${fn}`);

// 1. the id and where it may live
for (const v of [id(1), crypto.randomUUID()]) ok(R.VID.test(v), `id ${v} accepted`);
for (const v of ["", "v_0123456789abcdef", id(1).toUpperCase(), ` ${id(1)}`, `${id(1)}x`, "0f8e2d1c3b4a4c5d9e6f000000000001", "'); drop table x;--"]) ok(!R.VID.test(v), `id ${JSON.stringify(v)} refused`);
for (const c of ["IN", "US", "AU", "SG", "AE", "SA", "JP"]) ok(R.persist(c), `${c}: kept on the device 90 days`);
for (const c of ["DE", "FR", "IE", "NL", "PL", "SE", "GR", "GB", "CH", "NO", "IS", "LI", null, "", "de", "IND"]) ok(!R.persist(c), `${JSON.stringify(c)}: this visit only`);

// 2. a returning device that asked: the APPROVED label, never the visitor's text, never a retired pair
MEM.set(id(2), { last_qa: [{ id: "lp-27", question: "a retired pair" }, { id: "lp-35", question: "my email is priya@bank.example, call me" }, { id: "lp-01", question: "x" }],
  last_page: null, last_seen: "2026-10-20T10:00:00Z" });
const w2 = await R.welcome(id(2), LP);
eq(w2.line, "Welcome back! Last time you asked “What is the HySecure ZTNA gateway?” Want to pick up there?", "the last approved pair's label, quoted as the visitor's question (lp-27 is not approved: skipped)");
ok(!w2.book, "not a talk-to-sales topic: no calendar offer");
ok(!w2.line.includes("priya") && !w2.line.includes("retired") && emProblems(w2.line).length === 0, "no typed text, no retired pair; emphasis within the contract's limits");
eq(w2.qa_id, "lp-35", "the teaser picks up there: the pair itself");
eq(w2.chips.map(c => c.id), ["lp-40", "lp-41", "lp-42"], `chips: its children (${w2.chips.map(c => c.label).join(" | ")})`);
ok(w2.chips.every(c => approved.has(c.id) && c.label === Q.get(c.id).question.slice(0, 60)), "chips are approved labels");
eq(rpcs("sam_web_recall").at(-1).args, { visitor_id: id(2), not_page: LP }, "the current page goes to the SQL as not_page");
// a leaf pair: its children are none, so the earlier topics and the matcher's related approved pairs
MEM.set(id(3), { last_qa: [{ id: "lp-42", question: "" }, { id: "lp-05", question: "" }], last_page: null, last_seen: "x" });
const w3 = await R.welcome(id(3), LP);
ok(w3.qa_id === "lp-42" && w3.chips[0].id === "lp-05" && w3.chips.length === 3 && w3.chips.every(c => approved.has(c.id) && c.id !== "lp-42"), `leaf: the earlier topic, then related (${w3.chips.map(c => c.id)})`);
// a label over 6 words keeps no emphasis (the contract's limit), the words stay
MEM.set(id(4), { last_qa: [{ id: "lp-05" }], last_page: null, last_seen: "x" });
const w4 = await R.welcome(id(4), LP);
eq(w4.line, "Welcome back! Last time you asked “Can we migrate off Citrix without downtime?” Want to pick up there?", "a long label reads as a quoted question (benchmark, 27 Oct)");
eq(R.askedLine("Pricing"), "Welcome back! Last time you asked “Pricing”. Want to pick up there?", "a label with no end mark gets a full stop after the quote");
// the last topic was talking to the team (lp-32, or any pair whose visual is a CTA): the chat offers the calendar first
MEM.set(id(11), { last_qa: [{ id: "lp-32" }], last_page: null, last_seen: "x" });
const w11 = await R.welcome(id(11), LP);
ok(w11.book === true && w11.line === "Welcome back! Last time you asked “How do I talk to an Accops engineer?” Want to pick up there?", `lp-32: the calendar offer, the quoted line: ${w11.line}`);
MEM.set(id(12), { last_qa: [{ id: "lp-21" }], last_page: null, last_seen: "x" });
ok((await R.welcome(id(12), LP)).book === true, "any pair whose visual is a CTA (lp-21, the renewal review) offers the calendar");
// only retired pairs and no page: the normal greeting
MEM.set(id(5), { last_qa: [{ id: "lp-27", question: "x" }, { id: "lp-999", question: "y" }], last_page: null, last_seen: "x" });
eq(await R.welcome(id(5), LP), null, "only retired / unknown pairs: normal greeting");

// 3. a returning device that only read pages: the public card's own title, re-read (never the recall's text)
MEM.set(id(6), { last_qa: [], last_page: { url: "https://www.accops.com/products/hysecure", title: "<b>forged</b>" }, last_seen: "x" });
const w6 = await R.welcome(id(6), LP);
eq(w6.line, "Welcome back! Since you were reading about **Accops HySecure**, want to pick up there?", "the page card's public title");
const hys = (await (await jiti.import("./web/suggest.ts")).suggest("https://www.accops.com/products/hysecure", "")).slice(0, 3);
eq([w6.qa_id, w6.chips], [hys[0].id, hys], `that page's own suggestions (${hys.map(c => c.label).join(" | ")})`);
MEM.set(id(7), { last_qa: [], last_page: { url: "https://www.accops.com/hyseries", title: "x" }, last_seen: "x" });
eq((await R.welcome(id(7), LP)).line, "Welcome back! Since you were reading about **HySeries Solutions**, want to pick up there?", "a title's \" | Accops\" suffix dropped");
MEM.set(id(8), { last_qa: [], last_page: { url: "https://www.accops.com/not-a-public-page", title: "Internal roadmap" }, last_seen: "x" });
eq(await R.welcome(id(8), LP), null, "a page without a public card: normal greeting");
// asked beats read
MEM.set(id(9), { last_qa: [{ id: "lp-21" }], last_page: { url: "https://www.accops.com/products/hysecure", title: "x" }, last_seen: "x" });
ok((await R.welcome(id(9), LP)).line.includes("How much does Accops cost compared with Citrix?"), "a pair asked comes before a page read");

// 4. unknown and malformed ids; the memo
const before = rpcs("sam_web_recall").length;
eq(await R.welcome(id(10), LP), null, "unknown id: normal greeting");
eq(await R.welcome("v_0123456789abcdef", LP), null, "malformed id: normal greeting");
eq(rpcs("sam_web_recall").length, before + 1, "a malformed id never reaches the database");
const c0 = calls.length;
await R.welcome(id(2), LP);
eq(calls.length, c0, "memo: a repeat (device, page) within 60 s reads nothing");

// 5. who gets recalled: a person's browser only
const H = o => new Headers(o), CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const { embedOrigins } = await jiti.import("../app/embed/bridge.ts"), A = embedOrigins();
ok(pageHuman(H({ "user-agent": CHROME, origin: "https://accops-citrix-lp.vercel.app" }), A), "config from the LP in a browser: human");
ok(pageHuman(H({ "user-agent": CHROME, "sec-fetch-dest": "iframe" }), A), "/embed as an iframe in a browser: human");
for (const [h, why] of [[{ "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)", origin: "https://accops-citrix-lp.vercel.app" }, "a crawler"], [{ origin: "https://accops-citrix-lp.vercel.app" }, "no user agent"],
  [{ "user-agent": CHROME }, "no Origin, not an iframe (a direct fetch)"], [{ "user-agent": CHROME, origin: "https://evil.example" }, "another site's page"], [{ "user-agent": "curl/8.0", "sec-fetch-dest": "iframe" }, "curl"]])
  ok(!pageHuman(H(h), A), `${why}: never recalled`);

// 6. the config route: caching and the teaser
const conf = (qs, h = {}) => config.GET(new Request(`https://sam.test/api/web/config?page=${encodeURIComponent(LP)}${qs}`, { headers: h }));
const human = { "user-agent": CHROME, origin: "https://accops-citrix-lp.vercel.app", "x-vercel-ip-country": "IN" };
const pub = await conf("", { ...human });
const jp = await pub.json();
eq([pub.headers.get("cache-control"), pub.headers.get("vary"), jp.persist], ["public, s-maxage=300", "X-Vercel-IP-Country", true], "no id: public, CDN-cached per URL and per country; India persists");
eq((await (await conf("", { ...human, "x-vercel-ip-country": "DE" })).json()).persist, false, "Germany: this visit only");
eq((await (await conf("", { "user-agent": CHROME })).json()).persist, false, "no country header: this visit only (fail safe)");
const back = await conf(`&vid=${id(2)}`, human), jb = await back.json();
eq(back.headers.get("cache-control"), "private, no-store", "with an id: private, no-store (never CDN-cached across visitors)");
eq(jb.teaser, { after_s: 15, qa_id: "lp-35", label: "Welcome back! Last time you asked “What is the HySecure ZTNA gateway?” Want to pick up there?" }, "the teaser is the welcome-back line (plain: the loader sets textContent)");
ok(jb.chips.slice(0, 3).map(c => c.id).join() === "lp-40,lp-41,lp-42" && jb.chips.length === 7 && !jb.chips.some(c => c.id === "lp-35") && new Set(jb.chips.map(c => c.id)).size === 7,
  "chips: the welcome's first, then the page's, no repeats, never the teaser's own pair");
const normal = jp.teaser;
for (const [qs, h, why] of [[`&vid=${id(10)}`, human, "unknown id"], [`&vid=${id(2)}`, { ...human, "user-agent": "Googlebot/2.1" }, "a crawler"], [`&vid=${id(2)}`, { "user-agent": CHROME }, "no Origin"],
  ["&vid=v_0123456789abcdef", human, "a malformed id"], [`&vid=${id(2)}&section=migration`, { ...human, origin: "https://evil.example" }, "another site"]]) {
  const r = await conf(qs, h), j = await r.json();
  ok(r.headers.get("cache-control") === "private, no-store" && !j.teaser.label.startsWith("Welcome back"), `${why}: the normal teaser, still never CDN-cached`);
}
eq(normal.qa_id, "lp-01", "the normal teaser is the page's top question");

// 7. /embed: the greeting reaches the widget for a person's browser only
{
  const Page = (await pj.import("../app/embed/page.tsx")).default;
  const props = async (vid, h) => { globalThis.__H = h; return (await Page({ searchParams: Promise.resolve({ page: LP, vid }) })).props.children.props; };
  const frame = { "user-agent": CHROME, "sec-fetch-dest": "iframe", "sec-fetch-site": "cross-site", referer: LP, "x-vercel-ip-country": "IN" };
  const p = await props(id(2), frame);
  eq([p.visitor, p.persist, p.welcome?.line, p.welcome?.chips.map(c => c.id), p.welcome?.book],
    [id(2), true, "Welcome back! Last time you asked “What is the HySecure ZTNA gateway?” Want to pick up there?", ["lp-40", "lp-41", "lp-42"], false], "/embed: id, persist and the greeting with its chips");
  eq((await props(id(11), frame)).welcome?.book, true, "/embed: a talk-to-sales topic tells the widget to offer the calendar first");
  eq((await props(id(2), { ...frame, "x-vercel-ip-country": "GB" })).persist, false, "/embed: UK, this visit only (the privacy line says so)");
  eq((await props(id(2), { ...frame, "user-agent": "python-requests/2.32" })).welcome, null, "/embed: a bot gets the normal greeting");
  const pj2 = await props("not-a-uuid", frame);
  eq([pj2.visitor, pj2.welcome], ["", null], "/embed: a malformed id is dropped (the widget makes its own)");
  eq((await props(id(10), frame)).welcome, null, "/embed: unknown id, normal greeting");
  delete globalThis.__H;
}

// 8. page_viewed: allowlisted, no text, crawlers dropped
{
  const ev = await jiti.import("../app/api/web/event/route.ts");
  const post = (body, ua = CHROME) => ev.POST(new Request("https://sam.test/api/web/event", { method: "POST", body: JSON.stringify(body),
    headers: { origin: "https://accops-citrix-lp.vercel.app", "user-agent": ua, "content-type": "text/plain" } }));
  const pv = { visitor_id: id(2), page: LP, name: "page_viewed" };
  eq((await post(pv)).status, 204, "page_viewed accepted");
  eq(events.map(e => [e.name, e.visitor_id, e.page]), [["page_viewed", id(2), LP]], "logged: name, id, page");
  eq([(await post(pv, "Mozilla/5.0 (compatible; Googlebot/2.1)")).status, events.length], [204, 1], "a crawler's page_viewed is not logged");
  eq((await post({ ...pv, title: "HySecure pricing for Priya" })).status, 400, "no extra field (no text) is accepted");
}

// 9. the 07 SQL: shape, grants, and the event list in step with the route
{
  const sql = readFileSync(path.join(web, "../docs/supabase-sam-web-07-recall.sql"), "utf8").replace(/^\s*--.*$/gm, "");
  const fn = sql.match(/create or replace function sam_web_recall[\s\S]*?\$\$;/)[0];
  ok(/returns jsonb language sql stable security definer set search_path = public, pg_catalog/.test(fn), "recall: security definer, fixed search_path");
  ok(/join sam_web_qa_public q on q\.id = a\.qa_id/.test(fn) && /join sam_web_pages_public p/.test(fn), "recall: pairs through sam_web_qa_public, pages through sam_web_pages_public");
  ok(!/\b(m\.question|sam_web_messages\.question|answer|refs)\b/.test(fn), "recall: never reads the typed question, an answer or refs");
  ok((fn.match(/interval '90 days'/g) || []).length === 1 && /c\.label <> 'bot'/.test(fn) && /limit 3/.test(fn), "recall: 90 days, no bot conversations, at most 3 pairs");
  ok(fn.includes("'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'") && R.VID.source === "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", "recall: the same id rule as recall.ts");
  ok(/else|end\s*\$\$/.test(fn) && /case when exists \(select 1 from qa\) or exists \(select 1 from pg\) then/.test(fn), "recall: null when there is nothing to recall (unknown and empty ids look alike)");
  ok(/revoke execute on function sam_web_recall\(text, text\) from public, anon, authenticated, service_role;/.test(sql)
    && /grant execute on function sam_web_recall\(text, text\) to sam_web_reader;/.test(sql) && (sql.match(/grant [^;]*sam_web_recall/g) || []).length === 1, "recall: granted to sam_web_reader only");
  const names = s => s.match(/\(name in \(([^)]*)\)/)[1].match(/'([a-z_]+)'/g).map(x => x.slice(1, -1)).sort();
  const route = readFileSync(path.join(web, "app/api/web/event/route.ts"), "utf8").match(/const NAMES = \[([^\]]*)\]/)[1].match(/"([a-z_]+)"/g).map(x => x.slice(1, -1)).sort();
  const later = ["qualify_answered", "routing_book", "routing_partner", "routing_support"]; // 08's (web-answer.check proves 08 = the route)
  eq(names(sql), route.filter(x => !later.includes(x)), "the table's event names = the event route's, before 08 (page_viewed added)");
  ok(readFileSync(path.join(web, "scripts/web-guard.mjs"), "utf8").includes('"log_event", "recall"'), "web-guard: the reader may see /rpc/sam_web_recall");
}

console.log(`examples: ${w2.line} | ${w6.line} | ${w4.line}`);
console.log(`web-recall.check: ${n} assertions passed`);
