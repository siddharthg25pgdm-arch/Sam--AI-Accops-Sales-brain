/** ponytail: one runnable check for the model answer path, with the model stubbed.
 *  node lib/agent.check.mjs   (from web/)  ->  throws if any guarantee below breaks:
 *    1. an answer naming a document no search returned cannot reach the rep
 *    2. the last round forces an answer - "ran out of steps" never shows
 *    3. internal asks are searched internal, whatever the model asks for
 *    4. 429 on the primary model -> fallback model -> retrieval
 *    5. asset_type accepts Deck / Brochure / Battlecard (and datasheet -> Brochure)
 *    6. a cold library is loaded before apiSearch / apiAsk answer
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
];

// ---- stubbed network: Supabase fixtures, and a scripted model
let script = [], bodies = [], regDelay = 0;
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
  return Response.json([]); // sam_asset_cards, sam_events
};
const call = (args) => () => ({ role: "assistant", content: null, tool_calls: [{ id: `c${Math.random()}`, type: "function", function: { name: "search_assets", arguments: JSON.stringify(args) } }] });
const say = (text) => () => ({ role: "assistant", content: text });
const run = (steps) => { script = [...steps]; bodies = []; };

const { ask, heuristicFilters, assetTypeOf, namedTitles } = await jiti.import("./agent.ts");
const { refresh } = await jiti.import("./registry-cache.ts");
const { apiSearch } = await jiti.import("./api.ts");
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
ok(r.assets.length === 0 && r.zero === true && r.intent === "gap", "no cards, logged as a gap");

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

// 1e. The detector itself: denials and emphasis are not document names; invented titles are.
ok(namedTitles("We have no **SOC 2 report** on file.").length === 0, "a negated title is an honest gap, not an invention");
ok(namedTitles("It is **Internal only**.").length === 0, "emphasis is not a title");
ok(namedTitles("The HyID Technical Whitepaper covers it.").includes("HyID Technical Whitepaper"), "unmarked capitalised title is caught");

// 2a. A model that never stops searching: round 4 has tools off, and the rep gets a real answer.
run([call({ query: "citrix" }), call({ query: "citrix vdi" }), call({ query: "citrix horizon" }), call({ query: "again" })]);
r = await ask("which deck has the Citrix comparison?");
ok(bodies.length === 4, `expected 3 search rounds + 1 forced round, got ${bodies.length}`);
ok(bodies.slice(0, 3).every(b => b.tool_choice === "auto") && bodies[3].tool_choice === "none", "final round forces an answer");
ok(bodies[3].messages.some(m => m.role === "system" && /budget used/i.test(m.content)), "final round is told why");
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

// 6. Cold start: apiSearch waits for the registry instead of ranking the frozen cards alone.
globalThis.__samReg = undefined; globalThis.__samRegAt = undefined; regDelay = 50;
const s = await apiSearch({ query: "hyid datasheet" }, "check", "api");
ok(s.results.some(x => x.title === "Accops HyID Datasheet 2026"), "cold apiSearch saw the registry");
regDelay = 0;

console.log(`agent.check: ${n} assertions passed`);
