/** ponytail: one runnable check for the model answer path, with the model stubbed.
 *  node lib/agent.check.mjs   (from web/)  ->  throws if any guarantee below breaks:
 *    1. an answer naming a document no search returned cannot reach the rep
 *    2. the last round forces an answer - "ran out of steps" never shows
 *    3. internal asks are searched internal, whatever the model asks for
 *    4. 429 on the primary model -> fallback model -> retrieval
 *    5. asset_type accepts Deck / Brochure / Battlecard (and datasheet -> Brochure)
 *    6. a cold library is loaded before apiSearch / apiAsk answer
 *    7. missing vs zero: an absent document gets real substitutes (relevance floor, max 2) and is
 *       still logged as a gap; junk substitutes are dropped
 *  Runs the REAL agent.ts / agent-openai.ts / cards.ts / api.ts via jiti. Supabase and Groq are a
 *  stubbed fetch: registry rows are fixtures, and the "model" replies from a per-test script. */
import assert from "node:assert";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@": web } });

Object.assign(process.env, {
  SUPABASE_URL: "https://stub.supabase.co", SUPABASE_SERVICE_KEY: "stub",
  LLM_PROVIDER: "openai-compatible", OPENAI_COMPAT_BASE_URL: "https://groq.stub/openai/v1",
  OPENAI_COMPAT_API_KEY: "stub", OPENAI_COMPAT_MODEL: "openai/gpt-oss-120b",
});
delete process.env.OPENAI_COMPAT_FALLBACK_MODEL;
delete process.env.ANTHROPIC_API_KEY;

const row = (item_id, folder, filename, type) => ({
  item_id, folder, filename, ext: filename.split(".").pop(), web_url: `https://propalmsnetwork.sharepoint.com/${item_id}`,
  created_at: "2026-01-01T00:00:00Z", modified_at: "2026-09-01T00:00:00Z", modified_by: "x",
  asset_type: [type], industry: [], product: [], competitor: [], status: "active", deleted: false,
  list_item_id: 1, last_synced: null, suggest_ingest: true,
});
const REG = [
  row("R1", "Brochures", "Accops HyID Datasheet 2026.pdf", "Datasheet"),
  row("R2", "Competition/VDI and DaaS", "Accops Powered VDI vs Citrix VDI.pdf", "Competitive"),
  row("R3", "Brochures", "Accops HyDesk Brochure V6 2026.pdf", "Brochure"),
  row("R4", "Presentations", "Accops Solutions for Govt V1 2026.pptx", "Presentation"),
  row("R5", "eBooks", "Accops Browser Isolation eBook.pdf", "eBook"),
  row("R6", "Social Media", "Social-Media-Banners Browser Isolation.png", "Brand"),
  row("R7", "Videos/Demo Videos/Revised", "Device posture check and related data on management console.mp4", "Video"),
  row("R8", "Brochures & Datasheets/New", "Accops HyID Datasheet.V5 2026.pdf", "Brochure"),
  // 26 Sep repros
  row("R9", "Competition/VDI and DaaS", "Accops vs Citrix Feature Table 2018.pdf", "Competitive"),
  row("R10", "Pricing", "Accops DaaS Pricing Calculator v2.3 May 2021.xlsx", "Pricing"),
  row("R11", "Solutions/BFSI", "Accops RBI Guidelines Solution Document.pdf", "Solution Document"),
  row("R12", "Nutanix", "Accops HyWorks and Nutanix AHV Integration Guide.pdf", "Solution Document"),
  row("R13", "Brochures", "Accops Digital Workspace on Proxmox V2.pdf", "Brochure"),
  row("R14", "Videos/Demo Videos/Revised", "Geofencing control.mp4", "Video"),
  // 27 Sep repros
  row("R15", "Presentations/Japan", "Accops Nutanix .Next Tokyo 2026 - Japanese v4 with Videos.pptx", "Presentation"),
];
// One card: the 2018 table is superseded by the Citrix battlecard (the newer edition must be shown).
const CARDS = [{ source: "sharepoint/Accops vs Citrix Feature Table 2018.pdf", filename: "Accops vs Citrix Feature Table 2018.pdf",
  title: "Accops vs Citrix Feature Table 2018", asset_type: "Competitive", industry: "", client: "", products: ["HyWorks"], competitors: ["Citrix"],
  personas: [], regulations: [], key_problem: "", key_outcomes: [], brief: "A 2018 feature table comparing Accops with Citrix.", use_for: "",
  publish_year: "2018", expired: false, expiry_date: null, stale_risk: "", superseded_by: "sharepoint/Accops Powered VDI vs Citrix VDI.pdf - the 2024 battlecard",
  visibility: "internal", internal_reason: "", public_url: "", confidence: 0.9, needs_human: "", batch: "t", item_id: "R9" }];

// ---- stubbed network: Supabase fixtures, and a scripted model
let script = [], bodies = [], regDelay = 0, logged = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes("groq.stub")) {
    const body = JSON.parse(init.body);
    bodies.push(body);
    const step = script.shift();
    assert.ok(step, `model called more times than scripted (call ${bodies.length})`);
    const out = step(body);
    if (out.status) return new Response(out.text ?? "err", { status: out.status });
    return Response.json({ choices: [{ message: out }], usage: { total_tokens: 100 } });
  }
  if (u.includes("sam_sharepoint_files")) { if (regDelay) await new Promise(r => setTimeout(r, regDelay)); return Response.json(REG); }
  if (u.includes("sam_events") && init.method === "POST") { logged.push(JSON.parse(init.body)); return Response.json([{ id: logged.length }]); }
  if (u.includes("sam_asset_cards")) return Response.json(CARDS);
  return Response.json([]); // sam_events
};
const call = (args) => () => ({ role: "assistant", content: null, tool_calls: [{ id: `c${Math.random()}`, type: "function", function: { name: "search_assets", arguments: JSON.stringify(args) } }] });
const say = (text) => () => ({ role: "assistant", content: text });
const run = (steps) => { script = [...steps]; bodies = []; };

const { ask, heuristicFilters, assetTypeOf, namedTitles, PRICE_ASK, searchText, SYSTEM } = await jiti.import("./agent.ts");
const { refresh } = await jiti.import("./registry-cache.ts");
const { refreshCards } = await jiti.import("./cards-cache.ts");
const { apiSearch, apiAsk } = await jiti.import("./api.ts");
await refresh(); await refreshCards();
const traceHas = (r, s) => r.trace.some(t => `${t.step} ${t.detail}`.includes(s));
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// 1a. The production repro: model over-filters to Whitepaper, then invents three HyID documents.
run([call({ query: "hyid datasheet", asset_type: "Whitepaper", product: "HyID" }),
     say("Here are the HyID options:\n- **HyID Product Overview Deck** - overview\n- **HyID vs Okta Battlecard** - competitive\n- **HyID Technical Whitepaper** - detail")]);
let r = await ask("latest hyid datasheet");
ok(!/Overview Deck|Okta|Technical Whitepaper/.test(r.text), `invented titles reached the rep: ${r.text}`);
ok(traceHas(r, "grounding guard"), "guard trip is visible in the trace");
ok(r.assets[0]?.title === "Accops HyID Datasheet 2026", `the rep asked for a datasheet, so the model's Whitepaper filter is ignored: ${r.assets.map(a => a.title)}`);
ok(traceHas(r, "asset_type Whitepaper ignored"), "the model is told its filter was ignored");
ok(!r.zero && r.runtime === "openai-compatible", "a found asset is not a gap");

// 1a'. A filter the rep did ask for, that finds nothing, is dropped server side instead of costing a round.
run([call({ query: "hyid", asset_type: "Deck", product: "HyID" }), say("- **Accops HyID Datasheet 2026** - the closest")]);
r = await ask("hyid deck");
ok(traceHas(r, "nothing matched asset_type Deck, so that filter was dropped") && r.assets[0]?.title === "Accops HyID Datasheet 2026", `widened: ${JSON.stringify(r.trace)}`);
ok(r.text.includes("HyID Datasheet"), "a grounded answer after widening is kept");

// 1b. Nothing returned at all: a plain gap, whatever the prose claims.
run([call({ query: "telecom case study", asset_type: "Case Study" }),
     say("Yes - the **Telecom Connectivity Case Study** covers it, and internal brochures contain the details.")]);
r = await ask("telecom case study");
ok(/^Nothing in the library matches that/.test(r.text), `zero hits must give the plain gap: ${r.text}`);
ok(r.assets.length === 0 && r.zero === true && r.missing === true && r.intent === "gap", "no cards, logged as a gap");

// 1c. A grounded answer is left alone, and the card it names comes first.
run([call({ query: "citrix comparison" }), say("One internal battlecard fits.\n- **Accops Powered VDI vs Citrix VDI** - direct comparison. Internal only.")]);
r = await ask("citrix comparison");
ok(r.text.startsWith("One battlecard fits.\nAll internal: don't send outside Accops."), `grounded prose kept (visibility is SAM's line, not the verdict's): ${r.text}`);
ok(r.assets[0]?.title === "Accops Powered VDI vs Citrix VDI", "named asset is the first card");

// 1d. Cards are the union of every search, not just the last.
run([call({ query: "hydesk brochure" }), call({ query: "zzqq nothing" }),
     say("- **Accops HyDesk Brochure V6 2026** - current edition")]);
r = await ask("hydesk brochure");
ok(r.assets[0]?.title === "Accops HyDesk Brochure V6 2026" && r.text.includes("HyDesk"), "an earlier search's asset survives a later empty search");

// 1d'. A pricing ask that only finds brochures: a gap, not "the brochures contain the cost details".
run([call({ query: "hydesk pricing" }), say("The **Accops HyDesk Brochure V6 2026** contains the cost details.")]);
r = await ask("pricing for hydesk");
ok(/^Pricing is not in the collateral library/.test(r.text) && r.assets.length === 0 && r.zero, `pricing is a gap: ${r.text}`);
ok(!/^Pricing/.test((run([call({ query: "hydesk" }), say("- **Accops HyDesk Brochure V6 2026** - fits")]), await ask("hydesk brochure for cost savings")).text), "'cost savings' is not a pricing ask");

// 1d''. The model turns everything down and names nothing. Still missing (a gap), but the rep gets
// the closest real results that clear the relevance floor, labelled as substitutes - the model
// over-rejects ("No pharma case study" over four pharma whitepapers).
run([say("No media-industry ZTNA whitepaper is available.")]);
r = await ask("do we have a media industry ZTNA whitepaper?");
ok(r.missing && !r.zero && r.intent === "gap" && r.assets.length >= 1 && r.assets.length <= 2 && /^No media[^\n]*\nAll internal: don't send outside Accops\.\nClosest in the library:\n- \*\*/.test(r.text),
  `a denial naming nothing still shows up to 2 real substitutes: ${r.text} | ${r.assets.map(a => a.title)}`);
// ...unless nothing clears the floor: then a plain gap, no cards contradicting the sentence.
run([say("No Arabic collateral exists.")]);
r = await ask("arabic collateral");
ok(r.zero && r.missing && r.assets.length === 0 && r.text === "No Arabic collateral exists.", `junk-only -> plain gap: ${r.text} | ${r.assets.map(a => a.title)}`);
run([say("No exact match. Closest:\n- **Accops HyDesk Brochure V6 2026** - nearest fit")]);
r = await ask("hydesk brochure for a new branch office");
ok(!r.zero && r.missing && r.assets.some(a => /HyDesk/.test(a.title)), `a denial that names a real substitute keeps its cards, and is still missing: ${r.assets.map(a => a.title)}`);
run([say("No exact match. Closest:\n- **Accops HyDesk Brochure V6 2026** - nearest fit")]);
r = await ask("hydesk brochure for media companies");
ok(!r.zero && r.assets.length > 0, `an unreturned name is replaced by the real results, not turned into a gap: ${r.assets.map(a => a.title)}`);

// 1e. The detector itself: denials and emphasis are not document names; invented titles are.
ok(namedTitles("We have no **SOC 2 report** on file.").length === 0, "a negated title is an honest gap, not an invention");
ok(namedTitles("It is **Internal only**.").length === 0, "emphasis is not a title");
ok(namedTitles("The HyID Technical Whitepaper covers it.").includes("HyID Technical Whitepaper"), "unmarked capitalised title is caught");

// 2a. A model that never stops searching: round 4 has tools off, and the rep gets a real answer.
run([call({ query: "citrix" }), call({ query: "citrix vdi" }), call({ query: "citrix horizon" }), call({ query: "again" })]);
r = await ask("which deck has the Citrix comparison?");
// The seed search (the rep's own words) is the first of the 3, so the model gets 2 searching rounds.
ok(bodies.length === 3, `expected seed + 2 model search rounds + 1 forced round = 3 calls, got ${bodies.length}`);
ok(bodies[0].messages.some(m => m.role === "tool" && m.tool_call_id === "seed"), "the model sees the seed search before its first turn");
ok(bodies.slice(0, 2).every(b => b.tool_choice === "auto") && bodies[2].tool_choice === "none", "final round forces an answer");
ok(bodies[2].messages.some(m => m.role === "system" && /budget used/i.test(m.content)), "final round is told why");
ok(!/ran out of steps/i.test(r.text) && r.text.length > 0 && r.assets.length > 0, `no "ran out of steps": ${r.text}`);
ok(r.error?.kind === "step_exhausted", "still logged as step_exhausted for the dashboard");

// 2b. Groq 400s the forced round ("tool choice is none, but model called a tool"): answer from the results.
run([call({ query: "citrix" }), call({ query: "citrix vdi" }), call({ query: "citrix horizon" }), () => ({ status: 400, text: "tool choice is none, but model called a tool" })]);
r = await ask("citrix comparison");
ok(r.runtime === "openai-compatible" && r.assets.length > 0 && !/ran out of steps/i.test(r.text), "a 400 on the forced round still answers");

// 3. Internal asks stay internal even when the model asks for external.
run([call({ query: "citrix comparison", audience: "external" }), say("- **Accops Powered VDI vs Citrix VDI** - comparison")]);
r = await ask("which deck has the Citrix comparison?");
ok(traceHas(r, '"audience":"internal"') && !traceHas(r, '"audience":"external"'), "the model cannot make an internal ask external");
for (const q of ["which deck has the Citrix comparison?", "I need the competitor battlecard against Citrix for a deck", "public sector bank case study",
  "customer is on vmware horizon, what do we have", "internal Citrix battlecard to share with the customer"])
  ok(heuristicFilters(q).audience === "internal", `internal: ${q}`);
for (const q of ["BFSI case study I can send to a customer", "something I can send to a government CIO about VDI",
  "case study I can email a prospect today", "healthcare case study for a customer", "anything public on ZTNA?"])
  ok(heuristicFilters(q).audience === "external", `external: ${q}`);

// 4a. Primary rate-limited -> fallback model answers, recorded as a recovered provider_error with the 429.
const byModel = (fn) => (b) => fn(b);
run([byModel(() => ({ status: 429, text: "Rate limit reached for model openai/gpt-oss-120b tokens per minute (TPM): Limit 8000" })),
     call({ query: "citrix" }), say("- **Accops Powered VDI vs Citrix VDI** - comparison")]);
r = await ask("citrix comparison");
ok(bodies[0].model === "openai/gpt-oss-120b" && bodies[1].model === "openai/gpt-oss-20b", "second call goes to the fallback model");
ok(r.runtime === "openai-compatible" && r.model === "openai/gpt-oss-20b", "fallback model is reported as the answerer");
ok(r.error?.kind === "provider_error" && /429/.test(r.error.detail), `429 recorded: ${JSON.stringify(r.error)}`);

// 4b. Both rate-limited -> retrieval, recorded as fallback_retrieval (not timeout).
run([() => ({ status: 429, text: "rate limit" }), () => ({ status: 429, text: "rate limit" })]);
r = await ask("citrix comparison");
ok(r.runtime === "local" && r.model === null && r.assets.length > 0, "retrieval answers when every model is limited");
ok(r.error?.kind === "fallback_retrieval" && /429/.test(r.error.detail), `fallback recorded: ${JSON.stringify(r.error)}`);
run([() => ({ status: 429 }), () => ({ status: 429 })]);
r = await ask("what does hyworks cost");
ok(r.runtime === "local" && r.zero && r.assets.length === 0, "retrieval treats a pricing ask as a gap too");

// 4c. OPENAI_COMPAT_FALLBACK_MODEL="" disables the second model.
process.env.OPENAI_COMPAT_FALLBACK_MODEL = "";
run([() => ({ status: 429, text: "rate limit" })]);
r = await ask("citrix comparison");
ok(bodies.length === 1 && r.runtime === "local", "empty fallback env means no second model");
delete process.env.OPENAI_COMPAT_FALLBACK_MODEL;

// 5. asset_type: the tool offers the real catalogue types, and free text maps onto them.
run([say("Hello - ask me for a case study, deck or battlecard.")]);
r = await ask("hi");
const desc = bodies[0].tools[0].function.description;
ok(["Case Study", "Whitepaper", "Battlecard", "Deck", "Brochure"].every(t => desc.includes(t)), `tool offers every type: ${desc}`);
ok(r.intent === "other" && !r.zero && r.text.startsWith("Hello"), "a greeting is neither a search nor a gap");
for (const [v, want] of [["Deck", "Deck"], ["Brochure", "Brochure"], ["Battlecard", "Battlecard"], ["datasheet", "Brochure"], ["battle card", "Battlecard"],
  ["competitive comparison", "Battlecard"], ["presentation", "Deck"], ["case studies", "Case Study"], ["white paper", "Whitepaper"], ["certificate", undefined], ["", undefined]])
  ok(assetTypeOf(v) === want, `assetTypeOf(${v}) = ${assetTypeOf(v)}, want ${want}`);
run([call({ query: "govt solutions", asset_type: "Deck" }), say("- **Accops Solutions for Govt V1 2026** - current deck")]);
r = await ask("govt solutions deck");
ok(r.assets[0]?.title === "Accops Solutions for Govt V1 2026" && !traceHas(r, "dropped"), "a Deck filter finds a deck without widening");


// 7a. The exact thing is missing: say so, then real substitutes - floor applied, junk dropped, max 2.
run([say(`No Browser Isolation brochure exists yet.
- **Accops Browser Isolation eBook** - substitute: same product, buyer education
- **Social-Media-Banners Browser Isolation** - substitute: visuals`)]);
r = await ask("remote browser isolation brochure");
ok(r.missing && !r.zero && r.intent === "gap", `substitutes shown, exact thing still missing: ${JSON.stringify({ missing: r.missing, zero: r.zero })}`);
ok(r.assets.length === 1 && r.assets[0].title === "Accops Browser Isolation eBook", `only the real substitute is a card: ${r.assets.map(a => a.title)}`);
ok(!/Banners/.test(r.text) && /^No Browser Isolation brochure/.test(r.text) && /eBook/.test(r.text), `the banner line is dropped from the prose: ${r.text}`);
ok(r.assets.length <= 2, "at most 2 substitutes");
// 7b. Only junk named: the junk is dropped and the closest real results that clear the floor stand in.
run([say(`No Browser Isolation brochure exists yet.
- **Social-Media-Banners Browser Isolation** - substitute: visuals`)]);
r = await ask("remote browser isolation brochure");
ok(!r.zero && r.missing && r.assets.length <= 2 && r.assets.some(a => /Browser Isolation eBook/.test(a.title)) && !r.assets.some(a => /Banners/.test(a.title))
  && !/Banners/.test(r.text) && /^No Browser Isolation brochure exists yet\.\n[^\n]*(send|sent)[^\n]*\nClosest in the library:/.test(r.text), `junk named -> real substitutes instead: ${r.text} ${r.assets.map(a => a.title)}`);
// 7c. The model says an eBook "fits" a brochure ask: not a denial, but the brochure is still missing.
run([say(`One asset fits.
- **Accops Browser Isolation eBook** - covers isolation`)]);
r = await ask("browser isolation brochure");
ok(r.missing && !r.zero && r.assets[0]?.title === "Accops Browser Isolation eBook", `named type absent -> missing, cards kept: ${JSON.stringify({ m: r.missing, z: r.zero })} ${r.text}`);
run([say("- **Accops HyDesk Brochure V6 2026** - current")]);
r = await ask("hydesk brochure");
ok(!r.missing && !r.zero, "a brochure answering a brochure ask is not missing");
// 7d. Retrieval-only: same rule without a model.
run([() => ({ status: 429 }), () => ({ status: 429 })]);
r = await ask("remote browser isolation brochure");
ok(r.runtime === "local" && r.missing && !r.zero && r.assets.length >= 1 && r.assets.length <= 2, `local substitutes: ${r.text} ${r.assets.map(a => a.title)}`);
ok(!r.assets.some(a => /Banners/.test(a.title)) && /^There is no .*brochure in the library\. Closest substitutes/.test(r.text), `local: floor + wording: ${r.text}`);
ok(r.assets[0]?.title === "Accops Browser Isolation eBook", `local: the product's own document leads the substitutes, not another product's datasheet that mentions it: ${r.assets.map(a => a.title)}`);
run([() => ({ status: 429 }), () => ({ status: 429 })]);
r = await ask("hydesk brochure");
ok(r.runtime === "local" && !r.missing && r.assets[0]?.title === "Accops HyDesk Brochure V6 2026", `local: a real HyDesk brochure is an exact fit: ${r.text}`);
// 7e. apiAsk logs a gap when the thing is missing even though substitutes were shown.
logged = [];
run([say(`No Browser Isolation brochure exists yet.
- **Accops Browser Isolation eBook** - substitute: same product`)]);
const a7 = await apiAsk("remote browser isolation brochure", "check", "api");
ok(a7.missing === true && a7.gap === false && a7.assets.length === 1, `apiAsk exposes missing distinct from gap: ${JSON.stringify({ m: a7.missing, g: a7.gap })}`);
ok(logged.some(e => e.kind === "gap" && e.query === "remote browser isolation brochure"), "a gap event is logged for a missing-with-substitutes answer");

// 8. Repros from the 25 Sep production salesperson test.
const seedSaw = (t) => bodies[0].messages.some(m => m.role === "tool" && m.tool_call_id === "seed" && m.content.includes(t));
// 8a. A mis-tagged asset: City Pharmacy is filed under retail, so the Pharma-filtered seed missed it.
run([say("- **Accops City Pharmacy Case Study** - a pharmacy chain, public")]);
r = await ask("pharma case study I can send a customer");
ok(seedSaw("City Pharmacy"), "the seed also searches the words without the industry filter");
ok(r.assets[0]?.title === "Accops City Pharmacy Case Study" && !r.missing, `mis-tagged asset found and grounded: ${r.assets.map(a => a.title)}`);
// 8b. Over-rejection: the model says no, the real results still show as substitutes.
run([say("No pharma case study matches.")]);
r = await ask("pharma customer proof");
ok(r.missing && !r.zero && r.assets.length > 0 && r.assets.length <= 2 && r.assets.every(a => /pharma/i.test(`${a.title} ${a.industry}`)), `over-rejection still shows pharma substitutes: ${r.assets.map(a => a.title)}`);
run([say("No HyID one-pager exists.")]);
r = await ask("one pager on HyID i can email");
ok(r.assets.some(a => /HyID Datasheet/.test(a.title)), `a one-pager ask surfaces the HyID datasheet: ${r.assets.map(a => a.title)}`);
// 8c. Videos carry no product tag; a named type Video still finds them.
run([say("- **Device posture check and related data on management console** - HySecure device posture demo")]);
r = await ask("hysecure demo video");
ok(seedSaw("Device posture check") && r.assets[0]?.title.startsWith("Device posture check") && !r.missing, `video found: ${r.assets.map(a => a.title)}`);
// 8d. Pricing means Accops pricing, not "price" anywhere in the deal story.
for (const q of ["pricing for hydesk", "what does hyworks cost", "HyWorks price list", "quote for 500 users", "how much does hysecure cost per user", "licence cost for HyID", "hyid pricing"])
  ok(PRICE_ASK.test(q), `pricing ask: ${q}`);
for (const q of ["customer on vmware horizon wants to move after broadcom price hike, omnissa migration pitch?", "hydesk brochure for cost savings", "vdi cost savings case study", "citrix price increase battlecard", "cost of downtime whitepaper"])
  ok(!PRICE_ASK.test(q), `not a pricing ask: ${q}`);
run([say("- **Accops Powered VDI vs Citrix VDI** - migration angle")]);
r = await ask("customer on vmware horizon wants to move after broadcom price hike, omnissa migration pitch?");
ok(!/^Pricing is not/.test(r.text), `deal context is not a pricing ask: ${r.text}`);
// 8e. Short follow-ups are searched with the previous question.
const hist = [{ role: "user", content: "hydesk brochure" }, { role: "assistant", content: "- **Accops HyDesk Brochure V6 2026** - current" }];
ok(searchText("anything newer?", hist) === "hydesk brochure anything newer?" && searchText("shorter one? something 1-2 pages", hist).startsWith("hydesk brochure"), "follow-ups carry the topic");
ok(searchText("citrix battlecard", hist) === "citrix battlecard" && searchText("anything newer?") === "anything newer?", "a new ask, or no history, is searched as typed");
run([say("- **Accops HyDesk Brochure V6 2026** - the current edition")]);
r = await ask("anything newer?", hist);
ok(!r.zero && r.assets[0]?.title === "Accops HyDesk Brochure V6 2026" && seedSaw("HyDesk"), `follow-up answered: ${r.text} | ${r.assets.map(a => a.title)}`);
// 8e'. A second follow-up in a row walks back to the last question with a topic (26 Sep #3).
{
  const bank = "pvt bank in mumbai moving off citrix, need a bfsi case study i can send them";
  const h3 = [{ role: "user", content: bank }, { role: "assistant", content: "..." }, { role: "user", content: "anything newer?" }, { role: "assistant", content: "..." }];
  ok(searchText("shorter one? something 1-2 pages", h3) === `${bank} shorter one? something 1-2 pages`, `2nd follow-up keeps the bank topic: ${searchText("shorter one? something 1-2 pages", h3)}`);
  const { pagesWanted } = await jiti.import("./agent.ts");
  ok(pagesWanted("shorter one? something 1-2 pages") === 2 && pagesWanted("one pager on HyID") === 1 && pagesWanted("citrix battlecard") === null, "page limits read from the ask");
}
// 8f. The model never talks about sending: SAM writes that line from the cards (27 Sep: 25 of 35 verdicts lost).
ok(/SAM says which ones can be sent: never say whether anything can be sent/.test(SYSTEM) && !/can they be sent/.test(SYSTEM), "the prompt leaves sendability to SAM");

// 9. The answer contract (26 Sep): the model picks result numbers and writes one verdict; SAM writes
// every document line from the card. Invented coverage cannot reach the rep.
// The n the model was shown for a title this turn.
const nOf = (body, title) => { for (const m of body.messages) if (m.role === "tool") for (const x of JSON.parse(m.content).results ?? []) if (x.title === title) return x.n; };
const pickSay = (verdict, ...titles) => (body) => ({ role: "assistant", content: `${verdict}\nPICKS: ${titles.map(t => nOf(body, t)).join(", ")}` });
{
  run([pickSay("One internal Citrix battlecard fits.", "Accops Powered VDI vs Citrix VDI")]);
  r = await ask("citrix comparison");
  ok(r.text.startsWith("One Citrix battlecard fits.\nAll internal: don't send outside Accops.\n- **Accops Powered VDI vs Citrix VDI** (") && r.assets[0]?.title === "Accops Powered VDI vs Citrix VDI" && !r.missing,
    `a picked result is rendered by SAM: ${r.text}`);
  ok(JSON.parse(bodies[0].messages.find(m => m.tool_call_id === "seed").content).results.every(x => Number.isInteger(x.n)), "every result the model sees carries its number");
  // Prose about a document never reaches the rep, even for a real, grounded title.
  run([say("Here it is.\n- **Accops HyDesk Brochure V6 2026** - includes list pricing for 500 users and a Citrix migration")]);
  r = await ask("hydesk brochure");
  ok(r.assets[0]?.title === "Accops HyDesk Brochure V6 2026" && !/pricing for 500|Citrix migration/.test(r.text), `model prose about a document is not shown: ${r.text}`);
  // A verdict that says what a document covers, or attributes the rep's competitor to it, is replaced.
  run([pickSay("The HyDesk brochure shows how a bank replaced Citrix.", "Accops HyDesk Brochure V6 2026")]);
  r = await ask("hydesk brochure");
  ok(/^Best matches in the library\./.test(r.text) && !/Citrix/.test(r.text) && traceHas(r, "verdict guard: replaced"), `coverage claim in the verdict is replaced: ${r.text}`);
  const { verdictProblem } = await jiti.import("./agent.ts");
  const card = { asset: { title: "Two Leading Indian Private Banks", asset_type: "Case Study", industry: "BFSI", client: "", products: [], key_problem: "", key_outcomes: ["MFA for 60,000 users"],
    brief: "Two private banks secured remote access with MFA.", use_for: "", section: "", file: { path: "x.pdf", year: "2026" }, public_url: "u" }, score: 1, why: "" };
  ok(verdictProblem("Two public BFSI case studies you can send.", [card], "pvt bank moving off citrix", false) === null, "a plain verdict passes");
  ok(/Citrix/.test(verdictProblem("Two public case studies of banks leaving Citrix.", [card], "pvt bank moving off citrix", false)), "the rep's competitor attributed to a card is caught");
  ok(/includ/.test(verdictProblem("The datasheet includes max concurrent users.", [card], "q", false)), "coverage verbs are caught");
  ok(/2,000/.test(verdictProblem("Good for a 2,000-user quote.", [card], "pricing for 2,000 users", false)), "a number no card has is caught");
  ok(/leaving/.test(verdictProblem("Two case studies of banks leaving legacy desktops.", [card], "bank leaving legacy desktops", false)), "a paraphrased claim in words no card has is caught");
  ok(verdictProblem("No exact Proxmox integration document", [], "does hyworks support proxmox? need integration doc", true) === null, "a denial may name what is missing in the rep's words");
  // An uncarded asset says so instead of being described from its title.
  run([pickSay("A HySecure demo video fits.", "Geofencing control")]);
  r = await ask("hysecure demo video");
  ok(r.assets.some(a => a.title === "Geofencing control") && /Geofencing control\*\* \([^)]*\) - Filed under Videos\/Demo Videos\/Revised; SAM has not read this one/.test(r.text), `uncarded: filed under, not described: ${r.text}`);
}
// 9b. A named entity no shown card mentions -> missing, honestly worded, with the request button (#26).
run([pickSay("The HySecure datasheet can be framed to meet APRA CPS 234.", "Accops HyID Datasheet 2026")]);
r = await ask("australian gov / APRA CPS 234 angle for hysecure - anything?");
ok(r.missing && !r.zero && r.intent === "gap" && /^No exact match for APRA or Australia: none of the closest documents mentions them\.\n[^\n]*\nClosest in the library:/.test(r.text) && !/framed/.test(r.text)
  && !r.assets.some(a => /HyID/.test(a.title)), // a HyID datasheet is off-product for a HySecure ask (relevance floor)
  `APRA on no card -> missing: ${r.text} | ${r.missing}`);
// 9c. Two entities: the model picks only the Nutanix guide, SAM adds the Proxmox brochure (#21).
run([pickSay("HyWorks has integration material for both.", "Accops HyWorks and Nutanix AHV Integration Guide")]);
r = await ask("does hyworks support nutanix AHV and proxmox? need integration doc");
ok(r.assets.some(a => /Proxmox/.test(a.title)) && r.assets.some(a => /Nutanix/.test(a.title)) && !r.missing, `each named platform covered: ${r.assets.map(a => a.title)} | ${r.text}`);
// 9d. The sending guard reads the verdict (#5): "Send the ... (internal)" is replaced, not appended to.
run([pickSay("Send the RBI-focused solution document to the CISO.", "Accops RBI Guidelines Solution Document")]);
r = await ask("CISO at the bank asked how we help with RBI guidelines, what can i send him");
// "send him" is sending (27 Sep #5), so the public bank case study is added and SAM's line says which can go.
ok(/^1 of 2 can be sent to a customer; the rest are internal only\./.test(r.text) && !/Send the/.test(r.text) && /RBI Guidelines Solution Document\*\* \([^)]*do not send outside Accops/.test(r.text)
  && traceHas(r, "sending language"), `verdict sending guard: ${r.text}`);
// 9e. Pricing: a pricing calculator is never a quote (#6). NO_PRICING, the calculator as a labelled reference.
run([pickSay("The pricing calculator can be adapted for a 2,000-user quote.", "Accops DaaS Pricing Calculator v2.3 May 2021")]);
r = await ask("whats the pricing for 2000 users hyworks, customer comparing with citrix quote");
ok(/^Pricing is not in the collateral library/.test(r.text) && /not a quote/.test(r.text) && r.missing && !/adapted/.test(r.text) && r.assets.every(a => /Pricing Calculator/.test(a.title)),
  `calculator is a reference, not a quote: ${r.text} | ${r.assets.map(a => a.title)}`);
// 9f. A superseded asset brings its newer edition, newer first (#4).
run([pickSay("A Citrix comparison fits.", "Accops vs Citrix Feature Table 2018")]);
r = await ask("citrix battlecard for my own prep before the call tmrw");
ok(r.assets[0]?.title === "Accops Powered VDI vs Citrix VDI" && r.assets[1]?.title === "Accops vs Citrix Feature Table 2018" && traceHas(r, "newer edition shown"), `newer edition first: ${r.assets.map(a => a.title)}`);
// 9g. False gaps from 26 Sep: Hinglish and misspellings (#30), long paragraphs (#31), a 2nd follow-up (#3).
ok(heuristicFilters("bhai urgent hyworks brocher bhejo customer ko abhi").audience === "external", "bhejo ... customer ko is sending outside");
{
  const { typesNamedIn } = await jiti.import("./agent.ts");
  ok(["brocher", "brouchure", "broucher", "brochure"].every(w => typesNamedIn(`hyworks ${w}`).includes("Brochure")), "misspelt brochure is a brochure ask");
}
run([say("No public hospital case study.")]);
r = await ask("Hospital chain in Kerala, 800 users, currently on Citrix, evaluating Azure Virtual Desktop. Need something I can send the CIO today plus something for my own prep against AVD");
ok(seedSaw("Zulekha Hospital"), "the long hospital paragraph still finds the public Zulekha case study");
{
  const bank = "pvt bank in mumbai moving off citrix, need a bfsi case study i can send them";
  run([say("No exact 1-2 page case study.")]);
  r = await ask("shorter one? something 1-2 pages", [{ role: "user", content: bank }, { role: "assistant", content: "..." }, { role: "user", content: "anything newer?" }, { role: "assistant", content: "..." }]);
  ok(seedSaw("Private Bank MFAZTNA"), "the 2nd follow-up finds the 2-page Private Bank MFA-ZTNA case study");
}

// 10. The verdict contract (27 Sep: the guard replaced 18 of 35 verdicts, most of them fine). Typical
// good verdicts - "have we got it / what's closest", about the LIBRARY - must reach the rep.
{
  const { verdictProblem, dropSending, sendLine } = await jiti.import("./agent.ts");
  const c = (title, o = {}) => ({ asset: { title, asset_type: o.type ?? "Case Study", industry: o.industry ?? "", client: "", products: o.products ?? [], key_problem: "", key_outcomes: [],
    brief: o.brief ?? "", use_for: "", section: "", file: { path: `${title}${o.ext ?? ".pdf"}`, year: o.year ?? null }, public_url: o.pub ? "https://downloads.accops.com/x.pdf" : null }, score: 1, why: "" });
  const cx1 = c("Accops Powered VDI vs Citrix VDI", { type: "Battlecard", year: "2024" }), cx2 = c("Accops Powered VDI vs Citrix VDI (short)", { type: "Battlecard", year: "2024" });
  const bank1 = c("Two Leading Indian Private Banks", { industry: "BFSI", year: "2026", pub: 1 }), bank2 = c("Top-5 Indian Private Bank", { industry: "BFSI", year: "2026", pub: 1 });
  const pharmacy = c("Accops City Pharmacy Case Study", { industry: "Pharma", pub: 1 });
  const textile = c("A Leading Textile Manufacturer Case Study", { industry: "Manufacturing", brief: "VDI and secure access at a textile plant.", pub: 1 });
  const hyid = c("Accops HyID Datasheet", { type: "Datasheet", year: "2026" });
  const mirox = c("Auditor Letter on SOC 1 / SOC 2 Applicability (Mirox, 2022)", { type: "Certification", year: "2022" });
  const z1 = c("HySecure ZTNA Gateway Deck", { type: "Deck" }), z2 = c("ZTNA for IT Services", { type: "Deck" });
  const forti = c("Secure Access with Zero Trust vs Fortinet", { type: "Deck", year: "2022" });
  const v1 = c("Geofencing control", { type: "Video", ext: ".mp4" }), v2 = c("Device posture check", { type: "Video", ext: ".mp4" });
  const good = [
    ["The library has two internal 2024 Citrix battlecards.", [cx1, cx2], "citrix battlecard for my own prep", false],
    ["No telecom case study; closest are two BFSI ones.", [bank1, bank2], "telecom case study", true],
    ["The library includes a public pharmacy case study.", [pharmacy], "pharma case study", false],
    ["Yes, one close match for manufacturing VDI.", [textile], "manufacturing plant VDI case study", false],
    ["The library has the 2026 HyID datasheet.", [hyid], "one pager on HyID", false],
    ["The library has a related auditor letter, but no SOC 2 Type 2 report.", [mirox], "SOC 2 type 2 report", false],
    ["Assuming GCC means a global capability centre, the library has two ZTNA decks.", [z1, z2], "ZTNA pitch for a GCC", false],
    ["The library contains a 2022 Fortinet comparison deck.", [forti], "fortinet vpn replacement pitch", false],
    ["The library has two HySecure demo videos.", [v1, v2], "hysecure demo video", false],
    ["These are the newest BFSI case studies in the library.", [bank1, bank2], "anything newer?", false],
    ["Two close matches, both BFSI case studies from 2026.", [bank1, bank2], "bfsi case study", false],
    ["No exact Browser Isolation brochure; the closest are two ZTNA decks.", [z1, z2], "remote browser isolation brochure", true],
  ];
  const passed = good.filter(([v, shown, q, d]) => verdictProblem(dropSending(v), shown, q, d) === null);
  console.log(`agent.check: ${passed.length} of ${good.length} typical good verdicts pass the verdict guard`);
  for (const [v, shown, q, d] of good) ok(verdictProblem(dropSending(v), shown, q, d) === null, `good verdict rejected: "${v}" -> ${verdictProblem(dropSending(v), shown, q, d)}`);
  // ...while the risky kinds are still caught.
  for (const [v, shown, q] of [["The deck covers a Citrix migration.", [bank1], "q"], ["The HyID datasheet includes max concurrent users.", [hyid], "q"],
    ["The library has a case study of a bank that replaced Citrix.", [bank1], "bank moving off citrix"], ["Assuming it means Okta, the library has two decks.", [z1], "zscaler pitch"]])
    ok(verdictProblem(v, shown, q, false) !== null, `risky verdict passed: "${v}"`);
  // Visibility words are SAM's too: stripped from the verdict, since sendLine says which is which.
  ok(dropSending("The library has two public Citrix battlecards.") === "The library has two Citrix battlecards." && dropSending("Two decks; both are internal.") === "Two decks."
    && dropSending("A public sector bank case study fits.") === "A public sector bank case study fits.", "visibility adjectives and predicates dropped, 'public sector' kept");
  // 11. Sending talk is SAM's, not the model's: every word form is dropped from the verdict (27 Sep #12 "shared").
  ok(dropSending("The library has internal product videos for HySecure; two can be shared.") === "The library has internal product videos for HySecure.", "'shared' clause dropped");
  ok(dropSending("The library includes relevant manufacturing VDI case studies and they can be sent.") === "The library includes relevant manufacturing VDI case studies.", "'sent' clause dropped");
  ok(dropSending("Send the RBI-focused solution document to the CISO.") === "" && dropSending("The library has two decks.") === "The library has two decks.", "all-sending -> empty; no sending -> unchanged");
  ok(dropSending("Two can be emailed: the library has two HyID datasheets.") === "The library has two HyID datasheets.", "a leading sending clause goes with its separator");
  ok(sendLine([bank1, bank2], false) === "All 2 are public, so they can be sent to a customer." && sendLine([bank1, cx1, cx2], true) === "1 of 3 can be sent to a customer; the rest are internal only."
    && sendLine([cx1], false) === "All internal: don't send outside Accops." && /^None of these is published/.test(sendLine([cx1], true)), "sendability is computed from visibility");
  // Rendered: the model's "two can be shared" about internal documents never reaches the rep.
  run([pickSay("The library has internal product videos for HySecure; two can be shared.", "Geofencing control", "Device posture check and related data on management console")]);
  r = await ask("product video hysecure");
  ok(/^The library has internal product videos for HySecure\.\nAll internal: don't send outside Accops\.\n- \*\*/.test(r.text) && !/shared/.test(r.text), `verdict kept, sending line is SAM's: ${r.text}`);
}

// 12. A named Accops product with no document of the asked type about it (27 Sep #15, #7).
{
  run([pickSay("The library has a brochure.", "Accops HyDesk Brochure V6 2026")]);
  r = await ask("remote browser isolation brochure");
  ok(r.missing && /^No exact Browser Isolation brochure in the library\./.test(r.text) && r.assets.some(a => /Browser Isolation|Virtual Browser/.test(a.title)) && !r.assets.some(a => /HyDesk/.test(a.title)),
    `a brochure about another product is not a browser isolation brochure; the product's own documents stand in: ${r.text}`);
  run([pickSay("The library has the 2026 HyID datasheet.", "Accops HyID Datasheet 2026")]);
  r = await ask("one pager on HyID i can email");
  ok(r.missing && r.assets[0]?.title === "Accops HyID Datasheet 2026" && /^The library has the 2026 HyID datasheet\.\nNone of these is published/.test(r.text) && traceHas(r, "nothing sendable"),
    `a sending ask with nothing public is missing (request button): ${r.text} | ${r.missing}`);
  run([pickSay("The library has the HyDesk brochure.", "Accops HyDesk Brochure V6 2026")]);
  r = await ask("hydesk brochure");
  ok(!r.missing && /^The library has the HyDesk brochure\./.test(r.text), `the product's own brochure is exact: ${r.text}`);
}

// 13. 27 Sep fixes 4-7.
{
  // 4. A mixed ask (send + my own prep) gets the public hospital case study added, prep picks kept (#31).
  run([pickSay("The library has a healthcare whitepaper.", "ZTNA for Pharma and Healthcare (Life Sciences)")]);
  r = await ask("Hospital chain in Kerala, 800 users, currently on Citrix, evaluating Azure Virtual Desktop. Need something I can send the CIO today plus something for my own prep against AVD");
  ok(r.assets[0]?.title === "Accops Zulekha Hospital Case Study" && r.assets.some(a => a.title === "ZTNA for Pharma and Healthcare (Life Sciences)") && /can be sent to a customer/.test(r.text) && !/None of these is published/.test(r.text),
    `mixed ask: public hospital case study first, prep pick kept: ${r.assets.map(a => a.title)} | ${r.text}`);
  ok(heuristicFilters("CISO asked about RBI, what can i send him").audience === "external" && heuristicFilters("one pager on HyID i can email").audience === "external", "send him / i can email are sending asks");
  // 5. Follow-ups check the rep's own turn, not the carried question's competitor (#2), and a
  //    1-2 page ask promotes a known 2-page document (#3).
  const bank = "pvt bank in mumbai moving off citrix, need a bfsi case study i can send them";
  const h2 = [{ role: "user", content: bank }, { role: "assistant", content: "..." }];
  run([pickSay("These are the newest BFSI case studies in the library.", "Accops BFSI Integrated Case Study")]);
  r = await ask("anything newer?", h2);
  ok(!r.missing && !/Citrix/.test(r.text) && /^These are the newest BFSI case studies in the library\./.test(r.text), `a follow-up is not re-checked for Citrix: ${r.text} | ${r.missing}`);
  run([pickSay("The library has two BFSI case studies.", "Accops BFSI Integrated Case Study", "Accops Leading Pvt Sector Bank Case Study")]);
  r = await ask("shorter one? something 1-2 pages", [...h2, { role: "user", content: "anything newer?" }, { role: "assistant", content: "..." }]);
  ok(!/No exact match for Citrix/.test(r.text) && /Private Bank MFAZTNA|South India Bank/.test(r.assets[0]?.title ?? "") && traceHas(r, "short match added"), `the 2-page case study goes first: ${r.assets.map(a => a.title)} | ${r.text}`);
  // 6. The relevance floor: an off-topic pick is dropped, not shown in slot 2 (#8), and a Japanese
  //    deck needs Japan in the ask (#22).
  run([call({ query: "deutsche bank case study" }), pickSay("The library has a pharma case study.", "Accops City Pharmacy Case Study", "Accops Deutsche Bank Case Study")]);
  r = await ask("pharma customer proof");
  ok(r.assets.length === 1 && r.assets[0].title === "Accops City Pharmacy Case Study" && traceHas(r, "relevance: picks dropped"), `a bank case study is dropped from a pharma answer: ${r.assets.map(a => a.title)}`);
  const { relevant } = await jiti.import("./agent.ts");
  const tokyo = { title: "Accops Nutanix .Next Tokyo 2026 - Japanese v4 with Videos", asset_type: "Presentation", industry: "", client: "", products: ["HyWorks"], key_problem: "", key_outcomes: [],
    brief: "HyWorks VDI sizing on Nutanix AHV", use_for: "", section: "", file: { path: "Presentations/Japan/Accops Nutanix .Next Tokyo 2026 - Japanese v4 with Videos.pptx" }, public_url: null };
  ok(!relevant("hyworks sizing for 500 concurrent users", tokyo) && relevant("hyworks deck for a japanese customer", tokyo), "a Japanese-language deck only when Japan is asked about");
  const mea = { ...tokyo, title: "Partner Bootcamp 2026 - MEA Edition for the Dubai Partner Summit: Middle East Sovereignty", products: ["HySecure"], brief: "Middle East partner programme", file: { path: "x/MEA Bootcamp.pptx" } };
  ok(relevant("middle east event deck, gitex", mea) && !relevant("hysecure event deck for a kerala partner meet", mea), "a regional event deck only for its own region");
  // 7. Both editions picked, old one first: the newer edition moves ahead (#17).
  run([pickSay("The library has two Citrix comparisons.", "Accops vs Citrix Feature Table 2018", "Accops Powered VDI vs Citrix VDI")]);
  r = await ask("citrix battlecard");
  ok(r.assets[0]?.title === "Accops Powered VDI vs Citrix VDI" && r.assets[1]?.title === "Accops vs Citrix Feature Table 2018" && traceHas(r, "newer edition first"), `newer edition first when both were picked: ${r.assets.map(a => a.title)}`);
}

// 6. Cold start: apiSearch waits for the registry instead of ranking the frozen cards alone.
globalThis.__samReg = undefined; globalThis.__samRegAt = undefined; regDelay = 50;
const s = await apiSearch({ query: "hyid datasheet" }, "check", "api");
ok(s.results.some(x => x.title === "Accops HyID Datasheet 2026"), "cold apiSearch saw the registry");
regDelay = 0;

// Sending guard: an internal document recommended in sending language gets an explicit warning.
{
  const { guardSending } = await jiti.import("./agent.ts");
  const hit = (title, public_url = null) => ({ asset: { title, asset_type: "Brochure", industry: "", public_url, file: { path: `${title}.pdf` } }, score: 1, why: "" });
  const internal = hit("Accops HyID: Identity and Access Management Datasheet (V5, 2026)");
  const pub = hit("Accops HySecure Gateway: Zero Trust Remote Access Datasheet", "https://downloads.accops.com/x.pdf");
  const prod = "- **Accops HyID: Identity and Access Management Datasheet (V5, 2026)** – internal one-pager covering MFA, SSO and IAM features; suitable for emailing prospects.";
  let g = guardSending(prod, [internal]);
  ok(g.fixed === 1 && /Internal only: do not send outside Accops\.$/.test(g.text), `internal + 'emailing prospects' is warned: ${g.text}`);
  g = guardSending("- **Accops HySecure Gateway: Zero Trust Remote Access Datasheet** – public; fine to email a prospect.", [pub]);
  ok(g.fixed === 0, "a public asset in sending language is left alone");
  g = guardSending("- **Accops HyID: Identity and Access Management Datasheet (V5, 2026)** – internal; do not send it to customers.", [internal]);
  ok(g.fixed === 0, "a line that already says not to send is left alone");
  g = guardSending("- **Accops HyID: Identity and Access Management Datasheet (V5, 2026)** – covers MFA and SSO features.", [internal]);
  ok(g.fixed === 0, "an internal asset described without sending language is left alone");
}

// Sending ask: when the picks are all internal but a relevant public document was found, it goes first.
{
  const { ensurePublished } = await jiti.import("./agent.ts");
  const a = (title, public_url = null, industry = "Pharma / Healthcare") => ({ asset: { title, asset_type: "Case Study", industry, client: "", products: [],
    key_problem: "", key_outcomes: [], brief: `${title} hospital healthcare case study`, use_for: "", section: "", file: { path: `${title}.pdf` }, public_url }, score: 1, why: "" });
  const internal1 = a("UAE Multi-Hospital Group Remote Access"), internal2 = a("Accops for Healthcare Whitepaper");
  const zulekha = a("Accops Zulekha Hospital Case Study", "https://www.accops.com/case-studies/zulekha-hospital");
  const tr = [];
  let out = ensurePublished([internal1, internal2], [internal1, internal2, zulekha], "healthcare case study for a customer", tr);
  ok(out[0] === zulekha && out.length === 2 && tr.some(t => /published match added/.test(t.step)), `sending ask puts the public case study first: ${out.map(h => h.asset.title)}`);
  out = ensurePublished([internal1, internal2], [internal1, internal2, zulekha], "healthcare case study for my own prep", []);
  ok(out[0] === internal1, "an internal ask keeps the model's picks");
  const unrelated = a("Accops Corporate Brochure", "https://downloads.accops.com/b.pdf", "Cross-industry");
  unrelated.asset.asset_type = "Brochure"; unrelated.asset.brief = "company overview";
  out = ensurePublished([internal1], [internal1, unrelated], "telecom case study to send a customer", []);
  ok(out[0] === internal1, "an unrelated public document does not jump in");
}

console.log(`agent.check: ${n} assertions passed`);
