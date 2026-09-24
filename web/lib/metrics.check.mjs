/** ponytail: one runnable check for the non-trivial metric logic.
 *  node lib/metrics.check.mjs   ->  throws if any rule below breaks.
 *  Imports the real TypeScript (Node 22.18+ strips types natively), so there is no mirrored copy to
 *  drift. metrics.ts and events.ts keep zero runtime imports so this keeps working under bare node.
 *  The SQL definitions (sam_dashboard) are checked against hand-written queries instead - see
 *  docs/supabase-sam-observability.sql. */
import assert from "node:assert";
import { gapWorklist, freshness, ratio, delta, rateDelta, dailyActive, heatStep, MIN_N } from "./metrics.ts";
import { providerFailure } from "./events.ts";

let n = 0;
const ok = (...a) => { assert.ok(...a); n++; };
const eq = (...a) => { assert.equal(...a); n++; };

// --- gapWorklist
const events = [
  { kind: "gap", query: "BFSI case study I can send to a customer", filters: { audience: "external", vertical: "BFSI", asset_type: "Case Study" }, user_id: "a", created_at: "2026-09-04T12:26:34Z" },
  { kind: "gap", query: "BFSI case study I can send to a customer", filters: { audience: "external", vertical: "BFSI", asset_type: "Case Study" }, user_id: "a", created_at: "2026-09-04T12:25:45Z" },
  { kind: "gap", query: "pharma ZTNA?", filters: { audience: "internal", vertical: "Pharma / Healthcare", asset_type: "Whitepaper", product: "ZTNA" }, user_id: "a", created_at: "2026-09-04T12:26:32Z" },
  { kind: "gap", query: "pharma ZTNA?", filters: { audience: "internal", vertical: "Pharma / Healthcare", asset_type: "Whitepaper", product: "ZTNA" }, user_id: "b", created_at: "2026-09-04T12:25:41Z" },
  { kind: "query", query: "not a gap", user_id: "c" },
];
const w = gapWorklist(events);
eq(w.reduce((s, g) => s + g.asks, 0), 4, "non-gap events must be ignored");
ok(w[0].vertical.startsWith("Pharma"), "rank by distinct askers before ask count"); // rephrasing is not demand
eq(w.find(g => g.vertical === "BFSI").external, 2, "external asks counted separately"); // a publish decision, not a writing job
eq(w.find(g => g.vertical === "BFSI").examples.length, 1, "identical queries dedupe in examples");

// --- freshness
const assets = [
  { modified_by: "A", modified_at: "2021-01-01T00:00:00Z", status: "active", deleted: false, suggest_ingest: true },
  { modified_by: "A", modified_at: new Date().toISOString(), status: "active", deleted: false, suggest_ingest: true },
  { modified_by: "B", modified_at: "2022-06-01T00:00:00Z", status: "active", deleted: false, suggest_ingest: true },
  { modified_by: "B", modified_at: "2020-01-01T00:00:00Z", status: "active", deleted: false, suggest_ingest: true },
  { modified_by: "C", modified_at: "2019-01-01T00:00:00Z", status: "archived", deleted: false, suggest_ingest: true },
  { modified_by: "D", modified_at: "2019-01-01T00:00:00Z", status: "active", deleted: false, suggest_ingest: false },
];
const fr = freshness(assets);
eq(fr[0].owner, "B", "most stale owner ranks first");
eq(fr.find(f => f.owner === "A").stale, 1, "a recent file is not stale");
ok(!fr.find(f => f.owner === "C"), "archived assets excluded");
ok(!fr.find(f => f.owner === "D"), "non-documents excluded");
eq(fr.find(f => f.owner === "B").oldest, "2020-01-01T00:00:00Z", "oldest tracked");

// --- ratio: no percentage below MIN_N, and never divide by zero
eq(ratio(7, 8).pct, null, "8 questions is too few for a percentage");
eq(ratio(9, 10).pct, 90, "at MIN_N the rate appears");
eq(ratio(0, 0).pct, null, "0 of 0 is not 0%");
eq(ratio(1, 3, 1).pct, 33.3, "one decimal");
eq(MIN_N, 10);

// --- delta: counts are % change and need a baseline; rates are points and need n on both sides
eq(delta(5, 0, "%"), null, "0 -> 5 is not +inf%");
eq(delta(15, 10, "%").value, 50);
eq(delta(8, 10, "%").dir, -1);
eq(delta(82.5, 80, "pt").value, 2.5, "rates compare in points");
eq(rateDelta(ratio(9, 10), ratio(7, 8)), null, "no rate delta when the baseline is under MIN_N");
eq(rateDelta(ratio(18, 20), ratio(8, 10)).value, 10);

// --- daily active includes quiet days
eq(dailyActive([{ people: 2 }, { people: 0 }, { people: 1 }, { people: 0 }]), 0.8);

// --- heat bins: 0 is its own colour, the busiest cell is always the darkest step
eq(heatStep(0, 46), 0); eq(heatStep(1, 46), 1); eq(heatStep(46, 46), 4); eq(heatStep(24, 46), 3);

// --- error taxonomy
eq(providerFailure([], false), null, "no failures, no error");
eq(providerFailure([{ model: "m", message: "503", timeout: false }], false).kind, "fallback_retrieval");
eq(providerFailure([{ model: "m", message: "aborted", timeout: true }], false).kind, "timeout", "a timeout is named as one");
eq(providerFailure([{ model: "m", message: "503", timeout: false }], true).kind, "provider_error", "another model answered");
ok(providerFailure([{ model: "m", message: "x".repeat(900), timeout: false }], false).detail.length <= 500, "detail is truncated");

console.log(`metrics.check: ${n} assertions passed`);
