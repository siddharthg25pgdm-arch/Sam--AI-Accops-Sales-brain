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
];

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
  return Response.json([]); // sam_asset_cards, sam_events
};
const call = (args) => () => ({ role: "assistant", content: null, tool_calls: [{ id: `c${Math.random()}`, type: "function", function: { name: "search_assets", arguments: JSON.stringify(args) } }] });
const say = (text) => () => ({ role: "assistant", content: text });
const run = (steps) => { script = [...steps]; bodies = []; };

const { ask, heuristicFilters, assetTypeOf, namedTitles, PRICE_ASK, searchText, SYSTEM } = await jiti.import("./agent.ts");
const { refresh } = await jiti.import("./registry-cache.ts");
const { apiSearch, apiAsk } = await jiti.import("./api.ts");
await refresh();
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
ok(r.text.startsWith("One internal battlecard fits."), `grounded prose kept: ${r.text}`);
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
ok(r.missing && !r.zero && r.intent === "gap" && r.assets.length >= 1 && r.assets.length <= 2 && /^No media.*\nClosest in the library:$/.test(r.text),
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
  && !/Banners/.test(r.text) && r.text.startsWith("No Browser Isolation brochure exists yet.\nClosest in the library:"), `junk named -> real substitutes instead: ${r.text} ${r.assets.map(a => a.title)}`);
// 7c. The model says an eBook "fits" a brochure ask: not a denial, but the brochure is still missing.
run([say(`One asset fits.
- **Accops Browser Isolation eBook** - covers isolation`)]);
r = await ask("browser isolation brochure");
ok(r.missing && !r.zero && r.assets[0]?.title === "Accops Browser Isolation eBook", `named type absent -> missing, cards kept: ${JSON.stringify({ m: r.missing, z: r.zero })}`);
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
// 8f. "public" only when sending outside.
ok(/"public" or "published" in the verdict only if the rep is sending/.test(SYSTEM), "the prompt keeps visibility talk out of internal verdicts");

// 6. Cold start: apiSearch waits for the registry instead of ranking the frozen cards alone.
globalThis.__samReg = undefined; globalThis.__samRegAt = undefined; regDelay = 50;
const s = await apiSearch({ query: "hyid datasheet" }, "check", "api");
ok(s.results.some(x => x.title === "Accops HyID Datasheet 2026"), "cold apiSearch saw the registry");
regDelay = 0;

console.log(`agent.check: ${n} assertions passed`);
