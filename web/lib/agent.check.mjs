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
  // These tests use the bundled hand-written cards as their fixed sample library, alongside the stub
  // cards below. Production stopped merging them on 6 Oct 2026 (lib/cards.ts mergedAssets).
  SAM_BUNDLED_CARDS: "1",
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
  // An older copy of R1 (same family, saved a month earlier): answers must never show it.
  { ...row("R8", "Brochures & Datasheets/New", "Accops HyID Datasheet.V5 2026.pdf", "Brochure"), modified_at: "2026-08-01T00:00:00Z" },
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
  visibility: "internal", internal_reason: "", public_url: "", confidence: 0.9, needs_human: "", batch: "t", item_id: "R9" },
  // A public brochure that lists HyID among other products: it kept "one pager on HyID i can email" from
  // ever seeing the internal HyID datasheet (27 Sep #7).
  { source: "public/Accops Corporate Brochure 2026.pdf", filename: "Accops Corporate Brochure 2026.pdf", title: "Accops Corporate Brochure 2026", asset_type: "Brochure", industry: "", client: "",
  products: ["HyWorks", "HySecure", "HyID"], competitors: [], personas: [], regulations: [], key_problem: "", key_outcomes: [], brief: "Company overview: HyWorks, HySecure and HyID in one brochure.", use_for: "",
  publish_year: "2026", expired: false, expiry_date: null, stale_risk: "", superseded_by: "", visibility: "public", internal_reason: "", public_url: "https://downloads.accops.com/corporate-brochure-2026.pdf",
  confidence: 0.9, needs_human: "", batch: "t", item_id: null }];

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
// 28 Sep: "The library has no ..." / "We have no ..." are denials too (they got no request button).
for (const v of ["The library has no media-industry ZTNA whitepaper.", "We have no media-industry ZTNA whitepaper.", "There's no media-industry ZTNA whitepaper."]) {
  run([say(v)]);
  r = await ask("do we have a media industry ZTNA whitepaper?");
  ok(r.missing && r.intent === "gap", `"${v}" counts as a denial (request button): missing=${r.missing}`);
}
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
  ok(verdictProblem("Two public BFSI case studies you can send.", [card, card], "pvt bank moving off citrix", false) === null, "a plain verdict passes");
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
// 9f. A superseded asset is an older version of its successor's family (#4): the newer edition answers
// and the old one never takes a slot (30 Sep: families; it is also a 2018 document, excluded).
run([pickSay("A Citrix comparison fits.", "Accops vs Citrix Feature Table 2018")]);
r = await ask("citrix battlecard for my own prep before the call tmrw");
ok(r.assets[0]?.title === "Accops Powered VDI vs Citrix VDI" && !r.assets.some(a => a.title === "Accops vs Citrix Feature Table 2018"), `newer edition only: ${r.assets.map(a => a.title)}`);
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
  ok(sendLine([bank1, bank2], false) === "Both are public, so they can be sent to a customer." && sendLine([bank1, bank2, pharmacy], false) === "All 3 are public, so they can be sent to a customer."
    && sendLine([bank1, cx1], true, "any malaysia customer reference i can share with a partner?") === "1 of 2 can be sent to a partner; the rest are internal only." && sendLine([bank1, cx1, cx2], true) === "1 of 3 can be sent to a customer; the rest are internal only."
    && sendLine([cx1], false) === "All internal: don't send outside Accops." && /^None of these is published/.test(sendLine([cx1], true)), "sendability is computed from visibility");
  // 27 Sep re-run #2: six real production verdicts the guard threw away (#2, 8, 14, 16, 21, 29), over
  // the cards production showed. They must pass now.
  const cc = (title, o = {}) => { const h = c(title, o); h.asset.use_for = o.use_for ?? ""; h.asset.brief = o.brief ?? title; return h; };
  const deck2021 = cc("Accops BFSI Proposal Deck, Part 1 (2021): Cutting a Bank's Citrix VDI Dependency", { type: "Deck", industry: "BFSI", year: "2021" });
  const pharmaWp = cc("ZTNA for Pharma and Healthcare (Life Sciences)", { type: "Whitepaper", industry: "Pharma / Healthcare" });
  const corp = cc("Accops Corporate Brochure: Anywhere Access, Secure and Simplified", { type: "Brochure", pub: 1 });
  const euc = cc("Migration Strategy from VMware EUC: Three Full-Stack Replacement Options", { type: "Deck" });
  const vvf = cc("Omnissa Horizon with VMware vSphere Foundation for VDI: Analysis of the Bundled Offering", { type: "Whitepaper" });
  const broadcom = cc("Vanquishing VMware: Broadcom Acquisition Battlecard and VDI Attack Scenarios (Jul 2022)", { type: "Battlecard", year: "2022" });
  const ahv = cc("Accops HyWorks and Nutanix AHV: Solution Support Document and Deployment Best-Practice Guide (v2, Nov 2020)", { type: "Solution Document", year: "2020" });
  const proxmox = cc("Accops Digital Workspace on Proxmox V2.0 (Dec 2024): Replacing VMware Horizon + vSphere, with Accops-Supported Proxmox Editions", { type: "Deck", year: "2024" });
  const whyDaas = cc("Why DaaS - Accops DaaS Battlecard (2022): Accops on Azure vs AWS WorkSpaces and Other DaaS", { type: "Battlecard", year: "2022" });
  const field = cc("Accops Powered VDI vs the Field (29 Nov 2022): Tier 1 (Citrix, VMware), Public Cloud (AVD, AWS WorkSpaces)", { type: "Battlecard", year: "2022" });
  const bankQ = "pvt bank in mumbai moving off citrix, need a bfsi case study i can send them";
  const prod = [
    ["The library has two 2026 BFSI case studies, newer than the 2021 deck.", [bank1, bank2], `${bankQ} anything newer?`, [deck2021, bank1, bank2]],
    ["The library has a pharma case study and a pharma‑focused whitepaper as the closest proofs.", [pharmacy, pharmaWp], "pharma customer proof", []],
    ["The library has a SOC‑1/2 auditor letter (not a full SOC 2 report) and a corporate brochure; no actual SOC 2 Type 2 report.", [mirox], "do we have SOC 2 type 2 report", [mirox, corp]],
    ["The library has a suitable migration deck and a battlecard for moving from VMware Horizon after the Broadcom price hike.", [euc, vvf, broadcom], "customer on vmware horizon wants to move after broadcom price hike, omnissa migration pitch?", []],
    ["The library has an integration document for Nutanix AHV and a deck covering Proxmox support.", [ahv, proxmox], "does hyworks support nutanix AHV and proxmox? need integration doc", []],
    ["The library has two battlecards comparing AWS WorkSpaces and HyWorks.", [whyDaas, field], "aws workspaces vs hyworks comparison", []],
    ["The library has two relevant BFSI case studies for a private bank moving off Citrix.", [deck2021, bank1, bank2], bankQ, []],
  ];
  for (const [v, shown, q, seen] of prod) ok(verdictProblem(dropSending(v), shown, q, false, seen) === null, `production verdict rejected: "${v}" -> ${verdictProblem(dropSending(v), shown, q, false, seen)}`);
  // ...and the ones it was right to replace, or that passed and were wrong (#5, #10, #25, #34, #35).
  const seaDeck = cc("Accops Customer Deck for South-East Asia, Compressed V2.0 (Sep 2026)", { type: "Deck", use_for: "For SEA prospects (Indonesia, Malaysia, Thailand); this compressed edition has no SEA customer story." });
  const gccNote = cc("Accops Digital Workspace for Outsourced Service Providers and Consulting Firms (2020)", { type: "Solution Document", use_for: "GCC and BPO prospects" });
  const pqc = cc("Deep Research Note: Post-Quantum Cryptography Gaps in Zscaler and a Multi-Vendor ZTNA Pitch for Banks", { type: "Research Note" });
  const conclave = cc("Sovereign CIO Conclave, Bangalore (Aug-Sep 2026) - ZTNA and Isolation", { type: "Deck" });
  const anyconnect = cc("Accops HySecure vs Cisco AnyConnect and Other VPNs (PDF, 2021)", { type: "Battlecard" }), ztnaDeck = cc("Secure Access with Zero Trust: Accops HySecure ZTNA Gateway Deck - VPN vs ZTNA", { type: "Deck" });
  for (const [v, shown, q] of [
    ["The library has a solution document mapping RBI cyber-security framework and a case study on RBI-mandated MFA for banks.", [bank1], "RBI guidelines, what can i send him"],
    ["The library has two relevant ZTNA pitch decks for GCC contexts.", [gccNote, pqc, conclave], "whats our ZTNA pitch for a GCC"],
    ["The library has a Malaysia customer deck.", [seaDeck], "any malaysia or indonesia customer reference i can share with a partner?"],
    ["The library has no HySecure demo video, but it contains two relevant demo videos.", [v1, v2], "hysecure demo video"],
    ["The library has two battlecards on Cisco AnyConnect replacement.", [anyconnect, ztnaDeck], "cisco anyconnect replacement"],
    ["The library has a deck comparing Citrix and HyWorks.", [bank1], "citrix comparison"],
    ["The library has a case study covering a Citrix migration.", [bank1, deck2021], "bank moving off citrix"],
  ]) ok(verdictProblem(dropSending(v), shown, q, false, shown) !== null, `risky verdict passed: "${v}"`);
  // Rendered: the model's "two can be shared" about internal documents never reaches the rep.
  run([pickSay("The library has internal product videos for HySecure; two can be shared.", "Geofencing control", "Device posture check and related data on management console")]);
  r = await ask("product video hysecure");
  // (Until 30 Sep this expected the model's verdict. No video is named for HySecure, so a general product
  // video is missing: the button shows and the feature demos stand in - 28 Sep #12.)
  ok(/^No exact HySecure product video in the library\.\nAll internal: don't send outside Accops\.\nClosest in the library:\n- \*\*/.test(r.text) && !/shared/.test(r.text) && r.missing
    && r.assets.length === 2 && r.assets.every(a => /Geofencing|Device posture/.test(a.title)), `general product video is missing, demos stand in: ${r.text}`);
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
  // 6 Oct #43: "latest corporate deck" led with the South-East Asia edition - the region was not in REGIONS.
  const seaEd = { ...tokyo, title: "Accops Customer Deck for South-East Asia, Compressed V2.0 (Sep 2026): 13-Slide Corporate Presentation", products: [], brief: "Corporate presentation for SEA", file: { path: "x/SEA Customer Deck.pptx" } };
  ok(!relevant("first meeting with a CIO tomorrow, latest corporate deck please", seaEd), "a South-East Asia deck does not lead a region-less ask");
  ok(relevant("corporate deck for a malaysia prospect", seaEd) && relevant("corporate deck for south east asia", seaEd), "a country in the region (or the region itself) keeps the regional deck");
  // 7. Both editions picked, old one first (#17): the old one is an older version of the newer one's
  // family, so no search returns it and only the newer edition is shown (30 Sep: families).
  run([pickSay("The library has two Citrix comparisons.", "Accops vs Citrix Feature Table 2018", "Accops Powered VDI vs Citrix VDI")]);
  r = await ask("citrix battlecard");
  ok(r.assets[0]?.title === "Accops Powered VDI vs Citrix VDI" && !r.assets.some(a => a.title === "Accops vs Citrix Feature Table 2018"), `newer edition only, even when both were picked: ${r.assets.map(a => a.title)}`);
}

// 14. 27 Sep re-run #2, through finish() on hand-made results (the fixture corpus has none of these).
{
  const { finish } = await jiti.import("./agent.ts");
  const h = (title, o = {}) => ({ asset: { title, asset_type: o.type ?? "Case Study", industry: o.industry ?? "", client: "", products: o.products ?? [], key_problem: "", key_outcomes: [],
    brief: o.brief ?? title, use_for: o.use_for ?? "", section: "", file: { path: `${title}.pdf`, year: o.year ?? null }, public_url: o.pub ? `https://downloads.accops.com/${encodeURIComponent(title)}.pdf` : null }, score: 1, why: "" });
  const fin = (question, text, pool) => finish({ question, text, pool, calls: 1, runtime: "openai-compatible", model: "m", trace: [], filters: {}, error: null });
  // #14: a partial denial whose verdict fails the guard keeps missing (the request button) and its denial.
  const mirox = h("Auditor Letter on SOC 1 / SOC 2 Applicability to Accops Products (Mirox, 2022) - Not a SOC 2 Report", { type: "Certification", year: "2022" });
  r = fin("do we have SOC 2 type 2 report", "The library has a SOC 2 letter from a zzqvendor; no actual SOC 2 Type 2 report.\nPICKS: 1", [mirox]);
  ok(r.missing && /^No actual SOC 2 Type 2 report\.\n/.test(r.text) && traceHas(r, "verdict guard: replaced") && traceHas(r, "partial denial"), `replaced partial denial keeps its clause and the button: ${r.text} | ${r.missing}`);
  // #25: a region named only as the audience (use_for) is not covered: gap + button; "partner" in the line.
  const sea = h("Accops Customer Deck for South-East Asia, Compressed V2.0 (Sep 2026)", { type: "Deck", use_for: "For SEA prospects in Indonesia and Malaysia; this compressed edition has no SEA customer story." });
  const dth = h("Major Indian DTH and OTT Platform: Secure Remote Access for 300+ Vendors", { industry: "Media", pub: 1, use_for: "A customer reference for partner and vendor access asks in Malaysia or Indonesia" });
  r = fin("any malaysia or indonesia customer reference i can share with a partner?", "The library has the closest matches.\nPICKS: 1, 2", [sea, dth]);
  ok(r.missing && /^No exact match for Malaysia or Indonesia: none of the closest documents mentions them\./.test(r.text) && /sent to a partner/.test(r.text), `audience-only region is a gap: ${r.text}`);
  // 6 Oct #3: "1–2 pages" with an en dash is a range; the denial clause must not be cut to "No exact 1."
  const bankCs = h("Two Leading Indian Private Banks: Secure Access, MFA and Biometrics", { type: "Case Study", industry: "BFSI", pub: 1 });
  r = fin("bfsi case study i can send, shorter one? something 1-2 pages", "No exact 1–2 page BFSI case study – closest below.\nPICKS: 1", [bankCs]);
  ok(/^No exact 1–2 page BFSI case study\./.test(r.text) && !/^No exact 1\./.test(r.text), `en-dash range survives the clause cut: ${r.text}`);
  // 6 Oct #50: the partner bootcamp IS the answer, but it is internal and the rep is giving it out.
  // Not "No exact match in the library." - the document exists; what is missing is a sendable copy.
  const camp = h("Accops Partner Sales Bootcamp 2026 - 4-Hour Deck (30 Jun 2026)", { type: "Deck", pub: 0, use_for: "Partner onboarding and sales enablement" });
  r = fin("new SI partner joining next week, what training deck do we give them", "Closest options below.\nPICKS: none", [camp]);
  ok(r.missing && /^The library has matching documents, but only internal ones\./.test(r.text) && /ask marketing first/.test(r.text) && !/No exact match/.test(r.text), `internal-only match is not called missing: ${r.text}`);
  // #10: GCC on no shown title is a gap, and the answer states both readings.
  const gcc = h("Accops Digital Workspace for Outsourced Service Providers (2020)", { type: "Solution Document", products: ["HySecure"], use_for: "GCC and BPO prospects needing ZTNA" });
  const conclave = h("Sovereign CIO Conclave (2026) - ZTNA and Isolation", { type: "Deck", products: ["HySecure"] });
  r = fin("whats our ZTNA pitch for a GCC", "The library has two relevant ZTNA pitch decks for GCC contexts.\nPICKS: 1, 2", [gcc, conclave]);
  ok(r.missing && /^No exact match for GCC \(a Gulf customer or a global capability centre\)/.test(r.text), `GCC pitch is a gap with its readings: ${r.text}`);
  // #23: "No exact datasheet with ..." leads with the product's datasheet, not the model's case study.
  const ecom = h("Leading Indian E-commerce Logistics Company: Software ZTNA for 2,300 Concurrent Users", { products: ["HySecure"] });
  const editions = h("Accops Product Editions 2026: Feature Matrix for Digital Workspace, HySecure, HyID and HyLabs", { type: "Datasheet", products: ["HyWorks", "HySecure", "HyID"] });
  const ds = h("Accops HySecure Gateway: Zero Trust Remote Access Datasheet", { type: "Datasheet", products: ["HySecure", "ZTNA"], pub: 1 });
  r = fin("hysecure datasheet specs - max concurrent users per appliance", "No exact datasheet with max concurrent users per appliance.\nPICKS: 1, 2", [ecom, editions, ds]);
  ok(r.missing && r.assets[0]?.title === ds.asset.title && r.assets.length === 2 && traceHas(r, "named product first"), `the product's datasheet leads the substitutes: ${r.assets.map(a => a.title)}`);
  // An exact-type-and-product substitute already picked is left alone.
  r = fin("hysecure datasheet specs - max concurrent users per appliance", "No exact datasheet with max concurrent users per appliance.\nPICKS: 3, 1", [ecom, editions, ds]);
  ok(r.assets[0]?.title === ds.asset.title && !traceHas(r, "named product first"), `picked datasheet stays first: ${r.assets.map(a => a.title)}`);
}
// 14a. A sending ask whose public results only LIST the product still sees the product's own document (#7).
{
  const { seedSearch } = await jiti.import("./agent.ts");
  const s = seedSearch("one pager on HyID i can email");
  ok(/HyID Datasheet/.test(s.hits[0]?.asset.title ?? ""), `the HyID datasheet leads the seed: ${s.hits.map(h => h.asset.title)}`);
}
// 14b. The fallback model's answer says in the trace why the primary did not answer.
run([() => ({ status: 429, text: "Rate limit reached for model openai/gpt-oss-120b" }), call({ query: "citrix" }), say("- **Accops Powered VDI vs Citrix VDI** - comparison")]);
r = await ask("citrix comparison");
ok(r.trace[0]?.step === "model provider failed, answered by fallback" && /gpt-oss-120b.*429.*answered by openai\/gpt-oss-20b/.test(r.trace[0].detail), `fallback reason in the trace: ${JSON.stringify(r.trace[0])}`);

// 15. 28 Sep re-run #3, through finish() on hand-made results.
{
  const { finish, isContext } = await jiti.import("./agent.ts");
  const h = (title, o = {}) => ({ asset: { title, asset_type: o.type ?? "Case Study", industry: o.industry ?? "", client: "", products: o.products ?? [], key_problem: "", key_outcomes: [],
    brief: o.brief ?? title, use_for: o.use_for ?? "", section: "", file: { path: o.path ?? `${title}.pdf`, year: o.year ?? null }, public_url: o.pub ? `https://downloads.accops.com/${encodeURIComponent(title)}.pdf` : null }, score: 1, why: "" });
  const fin = (question, text, pool) => finish({ question, text, pool, calls: 1, runtime: "openai-compatible", model: "m", trace: [], filters: {}, error: null });
  // 1. A competitor given as the rep's situation is context, not a required entity (dry run, #1 on 20b).
  for (const q of ["pvt bank in mumbai moving off citrix, need a bfsi case study i can send them", "bank replacing citrix, need a bfsi case study",
    "customer uses citrix, need a bfsi case study", "customer moving after the citrix price hike, need a bfsi case study", "hospital currently on Citrix, need a case study"])
    ok(isContext(q, "Citrix"), `Citrix is context in "${q}"`);
  for (const q of ["citrix battlecard", "hysecure vs citrix", "citrix comparison", "citrix migration deck", "bank moving off citrix, need the citrix battlecard", "whats our pitch against citrix"])
    ok(!isContext(q, "Citrix"), `Citrix is the object of "${q}"`);
  ok(isContext("Kerala hospital, currently on Citrix, evaluating Azure Virtual Desktop, prep against AVD", "Citrix") && !isContext("Kerala hospital, currently on Citrix, evaluating Azure Virtual Desktop, prep against AVD", "AVD"),
    "AVD named as 'against AVD' stays required even though 'evaluating Azure Virtual Desktop' is context");
  const b1 = h("Two Leading Indian Private Banks: Secure Access, MFA and Biometrics", { industry: "BFSI", year: "2026", pub: 1 });
  const b2 = h("Top-5 Indian Private Bank: 3,000 to 25,000 Remote Users", { industry: "BFSI", year: "2026", pub: 1 });
  const cxDeck = h("Accops BFSI Proposal Deck (2021): Cutting a Bank's Citrix VDI Dependency", { type: "Deck", industry: "BFSI", year: "2021" });
  const bankQ = "pvt bank in mumbai moving off citrix, need a bfsi case study i can send them";
  r = fin(bankQ, "The library has two 2026 BFSI case studies for a private bank.\nPICKS: 1, 2", [b1, b2, cxDeck]);
  ok(!r.missing && !/No exact match for Citrix/.test(r.text) && /^The library has two 2026 BFSI case studies for a private bank\.\nBoth are public/.test(r.text), `Citrix as context is not a gap: ${r.text} | ${r.missing}`);
  const cxCase = h("Private Bank Moves off Citrix: VDI Case Study", { industry: "BFSI", year: "2026", pub: 1 });
  r = fin(bankQ, "The library has three BFSI case studies.\nPICKS: 1, 2, 3", [b1, b2, cxCase]);
  ok(r.assets[0]?.title === cxCase.asset.title && !r.missing, `a case study naming the context competitor goes first: ${r.assets.map(a => a.title)}`);
  r = fin(bankQ, "The library has two 2026 BFSI case studies for a private bank moving off Citrix.\nPICKS: 1, 2", [b1, b2]);
  ok(!r.missing && /^The library has two 2026 BFSI case studies for a private bank moving off Citrix\./.test(r.text), `the rep's situation may be repeated in the verdict: ${r.text}`);
  r = fin(bankQ, "The library has two case studies of banks moving off Citrix.\nPICKS: 1, 2", [b1, b2]);
  ok(/^Best matches in the library\./.test(r.text), `...but not as what a document is about: ${r.text}`);
  r = fin("citrix battlecard", "The library has a BFSI case study.\nPICKS: 1", [b1]);
  ok(r.missing && /No exact match for Citrix/.test(r.text), `Citrix as the object is still required: ${r.text}`);
  // 2. dropSending strips the sending claim, keeps the description, and fixes a/an (#3, dry-run Kerala).
  const { dropSending } = await jiti.import("./agent.ts");
  for (const [v, want] of [
    ["The library has two 2026 BFSI case studies that are short enough for a quick send.", "The library has two 2026 BFSI case studies that are short."],
    ["The library has a 2-page BFSI case study, short enough to email the CIO.", "The library has a 2-page BFSI case study, short."],
    ["The library has a public hospital case study and an internal VDI battlecard.", "The library has a hospital case study and a VDI battlecard."],
    ["An internal MFA deck and a public HyID datasheet.", "An MFA deck and a HyID datasheet."],
    ["A public ISO certificate.", "An ISO certificate."],
    ["The library has two BFSI case studies you can send the customer.", "The library has two BFSI case studies."],
    ["The library has two BFSI case studies that are ready to send.", "The library has two BFSI case studies."],
    ["The library has two decks; both can be shared.", "The library has two decks."],
  ]) ok(dropSending(v) === want, `dropSending("${v}") -> "${dropSending(v)}", want "${want}"`);
  // 3. Fair verdicts the guard threw away (#5 "supporting", dry-run "can be used"); risky ones still caught.
  const { verdictProblem } = await jiti.import("./agent.ts");
  const rbiCase = h("Two Leading Indian Private Banks: Secure Access, MFA and Biometrics", { industry: "BFSI", year: "2026", pub: 1, brief: "RBI-mandated MFA for vendors at two private banks." });
  const keynote = h("Trusted Access for an Untrusted World: Redefining Cyber Resilience in BFSI - IBA CISO Summit", { type: "Deck", year: "2025" });
  const cxA = h("Accops Powered VDI vs Citrix VDI", { type: "Battlecard", year: "2024" }), cxB = h("Accops vs Citrix and VMware Horizon", { type: "Battlecard", year: "2024" });
  for (const [v, shown, q] of [
    ["The library has a relevant case study and a supporting deck.", [rbiCase, keynote], "CISO at a pvt bank asked about the RBI cyber security framework, what can i send the CISO"],
    ["The library has two 2024 Citrix battlecards that can be used for prep.", [cxA, cxB], "citrix battlecard for my own prep before the call tmrw"],
    ["The library has a BFSI case study that supports your RBI conversation.", [rbiCase], "RBI framework, what can i send the CISO"],
  ]) ok(verdictProblem(dropSending(v), shown, q, false, shown) === null, `fair verdict rejected: "${v}" -> ${verdictProblem(dropSending(v), shown, q, false, shown)}`);
  for (const [v, shown, q] of [
    ["The HySecure datasheet can be framed to meet APRA CPS 234.", [cxA], "apra angle for hysecure"],
    ["The library has a case study that can be used to show a Citrix migration.", [b1], "pvt bank moving off citrix, bfsi case study"],
    ["The library has a case study about a bank moving off Citrix.", [b1], "pvt bank moving off citrix, bfsi case study"],
    ["The library has a deck that supports 10,000 concurrent users.", [keynote], "hysecure sizing deck"],
    ["The library has a battlecard that supports SAML federation.", [cxA], "citrix battlecard"],
    ["The deck covers RBI compliance.", [keynote], "RBI framework deck"],
  ]) ok(verdictProblem(dropSending(v), shown, q, false, shown) !== null, `risky verdict passed: "${v}"`);
}
// 15a. Honest gaps get substitutes near the missing topic, from the whole library (#19, #10, #25).
{
  run([say("No exact data residency document.\nPICKS: none")]);
  r = await ask("RFP asks about data residency - is our DaaS hosted in india? need a doc for the RFP response");
  ok(r.missing && r.assets.some(a => a.title === "DPDP Compliance and Access Control") && traceHas(r, "near the missing topic"), `data residency gap offers the DPDP whitepaper: ${r.assets.map(a => a.title)}`);
  run([say("No exact GCC ZTNA pitch.\nPICKS: none")]);
  r = await ask("whats our ZTNA pitch for a GCC");
  ok(r.missing && r.assets.some(a => a.title === "ZTNA to Secure Modern ITeS Operations"), `GCC gap offers the ITeS ZTNA whitepaper: ${r.assets.map(a => a.title)}`);
  const { seedSearch } = await jiti.import("./agent.ts");
  const { queryTokens } = await jiti.import("./cards.ts");
  ok(queryTokens("RFP asks about the RFP response").filter(t => t === "rfp").length === 1 && !queryTokens("RFP asks about the RFP response").includes("asks"), "a repeated word counts once; 'asks' is filler");
  const long = seedSearch("RFP asks about data residency - is our hyworks hosted in india? need a doc for the RFP response");
  ok(long.hits.length === 6 && long.hits.some(h => /hyworks/i.test(`${h.asset.title} ${h.asset.products[0] ?? ""}`)), `a long ask's seed keeps a slot for the product's own document: ${long.hits.map(h => h.asset.title)}`);
}
// 15b. HySecure demo videos (#12, #34): registry-only feature demos, through ask() on the fixture registry.
{
  run([pickSay("The library has no exact HySecure demo video; closest are two demo videos.", "Geofencing control", "Device posture check and related data on management console")]);
  r = await ask("hysecure demo video");
  ok(!r.missing && /^The library has two HySecure demo videos\.\n/.test(r.text) && r.assets.length === 2 && traceHas(r, "demo videos found"), `a feature demo answers a demo ask: ${r.text} | ${r.missing}`);
  run([pickSay("The library has two HySecure demo videos.", "Geofencing control", "Device posture check and related data on management console")]);
  r = await ask("hysecure demo video");
  ok(!r.missing && /^The library has two HySecure demo videos\./.test(r.text), `the model's yes stands: ${r.text}`);
  run([pickSay("The library has no exact HySecure product video; closest are two demo videos.", "Geofencing control", "Device posture check and related data on management console")]);
  r = await ask("product video hysecure");
  ok(r.missing && /^No exact HySecure product video in the library\./.test(r.text) && r.assets.every(a => /Geofencing|Device posture/.test(a.title)), `general product video: missing, demos stand in: ${r.text}`);
  // A HySecure feature demo is not a HyID demo video.
  run([pickSay("The library has two demo videos.", "Geofencing control", "Device posture check and related data on management console")]);
  r = await ask("hyid demo video");
  ok(r.missing && !/^The library has two HyID/.test(r.text), `HySecure demos are not HyID's: ${r.text} | ${r.missing}`);
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
