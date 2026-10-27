// Run: node web/lib/web-suggest.check.mjs - page-aware suggestions (suggest.ts, 27 Oct 2026) on REAL data: the bank
// (corpus/web/qa-citrix-lp.json, approved = the pairs in the committed intent index, which is built from the approved
// bank), the page cards (corpus/web/pages-*.json) and the committed intent index. Only PostgREST is stubbed, as
// sam_web_reader would see it. Covers: the section allowlist, the tier order on the LP's sections, an accops.com product
// page and industry pages, no duplicates, the roots as filler / fallback, the teaser following the section (the config
// route), and the per-(page, section) memo.
import assert from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const json = f => JSON.parse(readFileSync(path.join(web, f), "utf8"));
const jiti = createJiti(import.meta.url, { alias: { "@": web } });
Object.assign(process.env, { WEB_CHAT_ENABLED: "1", SUPABASE_URL: "https://stub.supabase.co", SAM_WEB_READER_JWT: "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2FtX3dlYl9yZWFkZXIifQ.sig",
  SAM_WEB_SUPABASE_APIKEY: "sb_publishable_stub", WEB_IP_SALT: "salt" });

const approved = new Set(json("data/web-intent-index.json").intents.map(i => i.qa_id));
const bank = json("../corpus/web/qa-citrix-lp.json").filter(q => approved.has(q.id));
const cards = [...json("../corpus/web/pages-citrix-lp.json"), ...json("../corpus/web/pages-accops-com.json")];
const LP = "https://accops-citrix-lp.vercel.app/", group = u => (/^https:\/\/accops-citrix-lp\.vercel\.app([/?#]|$)/i.test(u) ? "citrix-lp" : "general");
const byNudge = (a, b) => b.nudge_weight - a.nudge_weight || (a.id < b.id ? -1 : 1);
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url)), fn = u.pathname.replace("/rest/v1/", ""), args = init.body ? JSON.parse(init.body) : null;
  calls.push(fn);
  if (fn === "rpc/sam_web_page_group") return Response.json(group(args.url));
  if (fn === "rpc/sam_web_roots") { // as 02-public.sql: the group's roots, else the general roots
    const r = bank.filter(q => !q.parent_id), own = r.filter(q => q.pages.includes(group(args.page_url)));
    return Response.json((own.length ? own : r.filter(q => q.pages.includes("general"))).sort(byNudge).map(q => ({ id: q.id, question: q.question })));
  }
  if (fn === "rpc/sam_web_settings") return Response.json({ enabled: true, model_enabled: true, cta_url: "https://www.accops.com/schedule-a-free-demo", cta_label: "Talk to an expert" });
  if (fn === "sam_web_qa_public") return Response.json(bank.map(({ id, question, sources, pages, nudge_weight }) => ({ id, question, sources, pages, nudge_weight })));
  if (fn === "sam_web_pages_public") {
    const want = u.searchParams.get("url").replace(/^in\.\(|\)$/g, "").split(",").map(s => s.replace(/^"|"$/g, ""));
    return Response.json(cards.filter(c => want.includes(c.url)).map(({ url, page_type, products, industries, questions_answered }) => ({ url, page_type, products, industries, questions_answered })));
  }
  return new Response("unknown", { status: 404 });
};

const { suggest } = await jiti.import("./web/suggest.ts");
const { cleanSection, SEC } = await jiti.import("../app/embed/bridge.ts");
const config = await jiti.import("../app/api/web/config/route.ts");
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const Q = new Map(bank.map(q => [q.id, q]));
const key = u => { const x = new URL(u); return { p: x.host.replace(/^www\./, "") + x.pathname.replace(/\/+$/, ""), h: x.hash.slice(1) }; };
const cites = (id, page, sec) => Q.get(id).sources.some(s => { const a = key(s), b = key(page); return a.p === b.p && (sec === undefined || a.h === sec); });
const ids = async (page, sec = "") => (await suggest(page, sec)).map(c => c.id);

// 1. the section allowlist: an element id or section-N, nothing that can hold a sentence
for (const s of ["comparison", "migration", "section-2", "faq", "a", "x".repeat(41)]) eq(cleanSection(s), s, `section ${s} kept`);
for (const s of ["", "Comparison", "pricing_table", "how much does it cost", "-x", "x".repeat(42), "évaluation", "a#b", "<script>", null, 7, ["faq"]])
  eq(cleanSection(s), "", `section ${JSON.stringify(s)} dropped`);
ok(SEC.source === "^[a-z0-9][a-z0-9-]{0,40}$", "SEC is the loader's regex");
ok(readFileSync(path.join(web, "scripts/embed.src.js"), "utf8").includes(`SEC = /${SEC.source}/`), "the loader uses the same SEC");

// 2. the LP, section by section: tier 0 = pairs citing page#section, in the order of the section card's own questions
const want = {
  comparison: ["lp-03", "lp-19", "lp-20", "lp-15"], // "How does Accops compare with Citrix feature by feature?" first
  migration: ["lp-05", "lp-07", "lp-29", "lp-06"],  // "Can we migrate off Citrix without downtime?" first
  faq: ["lp-05", "lp-09", "lp-01", "lp-08"],
  "section-2": ["lp-28", "lp-17", "lp-68", "lp-53"], // the trust strip: customers, ISO 27001, industries
  talk: ["lp-32", "lp-21", "lp-17"],
};
for (const [sec, first] of Object.entries(want)) {
  const got = await ids(LP, sec);
  eq(got.slice(0, first.length), first, `LP #${sec}: ${got.slice(0, 4).map(id => Q.get(id).question).join(" | ")}`);
  ok(first.every(id => cites(id, LP, sec)), `LP #${sec}: the first ${first.length} all cite #${sec}`);
  ok(got.length === 8 && new Set(got).size === 8 && got.every(id => approved.has(id)), `LP #${sec}: 8 approved, no duplicates (spares for already-asked)`);
  // tiers never go backwards: citing the section, then citing the LP, then the rest
  const tier = id => (cites(id, LP, sec) ? 0 : cites(id, LP) ? 1 : 2);
  ok(got.map(tier).every((t, i, a) => !i || a[i - 1] <= t), `LP #${sec}: tier order ${got.map(tier).join("")}`);
}
// a section no pair cites: the card's confident question match leads (the cost calculator -> the cost question)
eq((await ids(LP, "section-3"))[0], "lp-21", "LP #section-3 (calculator): How much does Accops cost compared with Citrix?");
const top = await ids(LP);
ok(top.every(id => cites(id, LP)) && top[0] === "lp-01", `LP, no section: pairs citing the LP by sources[0] then nudge (${top.slice(0, 3)})`);
eq(await ids(LP, ""), await ids(`${LP}#ignored-hash`, ""), "the page's own #hash is not a section");

// 3. accops.com (stage 2 readiness): a product page suggests that product's pairs, an industry page its industry's
const hys = "https://www.accops.com/products/hysecure", hysIds = await ids(hys);
eq(hysIds.slice(0, 4), ["lp-35", "lp-53", "lp-40", "lp-54"], `HySecure page: ${hysIds.slice(0, 4).map(id => Q.get(id).question).join(" | ")}`);
ok(hysIds.slice(0, 2).every(id => cites(id, hys)) && hysIds.slice(2, 4).every(id => !cites(id, hys) && Q.get(id).pages.includes("product:hysecure")),
  "HySecure: the pairs citing the page (its own question first), then pairs about HySecure");
ok(hysIds.every(id => Q.get(id).pages.includes("general")), "an accops.com page only gets pairs of its group (general)");
eq(await ids(`${hys}/`), hysIds, "trailing slash: same card, same answer");
const health = await ids("https://www.accops.com/industry-solutions/healthcare");
eq(health.slice(0, 2), ["lp-73", "lp-60"], "healthcare page: hospitals, then HIPAA/GDPR (both cite it)");
const bfsi = await ids("https://www.accops.com/industry-solutions/bfsi");
eq(bfsi[0], "lp-26", "BFSI page: Which banks and insurers use Accops? first");
ok(bfsi.slice(0, 4).every(id => cites(id, "https://www.accops.com/industry-solutions/bfsi") || Q.get(id).pages.includes("industry:bfsi")), `BFSI page: its own and BFSI pairs (${bfsi.slice(0, 4)})`);
const gov = await ids("https://www.accops.com/industry-solutions/government-institutions");
ok(gov.slice(0, 2).every(id => Q.get(id).pages.includes("industry:government-institutions") || cites(id, "https://www.accops.com/industry-solutions/government-institutions")), `government page: government pairs first (${gov.slice(0, 3)})`);
const about = await ids("https://www.accops.com/about-us");
ok(about.slice(0, 2).includes("lp-79") && about.slice(0, 3).every(id => cites(id, "https://www.accops.com/about-us")),
  `About Us: "Who leads Accops?" among the first 2, all citing the page (${about.slice(0, 3).map(id => Q.get(id).question).join(" | ")})`);
// an industry card's industry comes before its products ("Pharma / Healthcare" meets lp-73 by its question's "hospitals")
const { analyse } = await jiti.import("./web/intent.ts");
ok(analyse("Do you work with hospitals and healthcare?", false).entities.includes("Pharma / Healthcare"), "card label and pair meet as core.terms entities");

// 4. fallback: no card and nothing citing the page -> the group's roots, in sam_web_roots order
const roots = bank.filter(q => !q.parent_id && q.pages.includes("general")).sort(byNudge).map(q => q.id);
eq(await ids("https://www.accops.com/careers/some-opening"), roots.slice(0, 8), "unknown page: the general roots");
eq(await ids(""), roots.slice(0, 8), "bad page: the general roots");

// 5. the config route: the teaser follows the section; a junk section is the page's teaser; CDN-cached per URL
const conf = async qs => (await config.GET(new Request(`https://sam.test/api/web/config?${qs}`)));
const page = `page=${encodeURIComponent(LP)}`;
const [cm, cc, cj, cn] = await Promise.all([`${page}&section=migration`, `${page}&section=comparison`, `${page}&section=How%20much%3F`, page].map(conf));
const [jm, jc, jj, jn] = await Promise.all([cm, cc, cj, cn].map(r => r.json()));
eq([jm.teaser.label, jc.teaser.label], ["Can we migrate off Citrix without downtime?", "How does Accops compare with Citrix feature by feature?"], "teaser follows the section");
eq(jj, jn, "a junk section: the page's teaser and chips");
ok(jm.chips.length === 7 && !jm.chips.some(c => c.id === jm.teaser.qa_id) && jm.teaser.after_s === 15, "teaser + 7 ranked chips (the loader shows 2, the widget 4 minus asked)");
ok(cm.headers.get("cache-control") === "public, s-maxage=300" && cm.headers.get("access-control-allow-origin") === "*", "config: CDN-cached (key = full URL, section included), CORS *");

// 6. memo: a repeat (page, section) within 60 s reads nothing
const before = calls.length;
await ids(LP, "migration");
eq(calls.length, before, "memo: no DB call for a repeat (page, section)");

console.log(`web-suggest.check: ${n} assertions passed (LP #migration -> ${Q.get(want.migration[0]).question}; HySecure -> ${Q.get(hysIds[0]).question})`);
