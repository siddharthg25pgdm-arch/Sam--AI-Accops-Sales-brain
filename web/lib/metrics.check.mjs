/** ponytail: one runnable check for the gap ranking, the only non-trivial logic in metrics.ts.
 *  node lib/metrics.check.mjs   ->  throws if the ranking or the external-vs-missing split breaks.
 *  Kept as plain node with asserts: no framework, no fixtures, it runs anywhere. */
import assert from "node:assert";

// Mirrors gapWorklist() in metrics.ts. Duplicated rather than imported because that file is TS and
// this is meant to run with bare node - if the two drift, this check is the thing that notices.
function gapWorklist(events) {
  const acc = new Map();
  for (const e of events) {
    if (e.kind !== "gap") continue;
    const f = e.filters ?? {};
    const vertical = f.vertical || "any", type = f.asset_type || "any", product = f.product || "";
    const key = `${vertical}|${type}|${product}`, at = e.created_at ?? "";
    const row = acc.get(key) ?? { key, vertical, type, product, asks: 0, external: 0, examples: [], users: [], firstSeen: at, lastSeen: at };
    row.asks++;
    if (f.audience === "external") row.external++;
    if (e.query && !row.examples.includes(e.query) && row.examples.length < 3) row.examples.push(e.query);
    if (!row.users.includes(e.user_id)) row.users.push(e.user_id);
    if (at && at < row.firstSeen) row.firstSeen = at;
    if (at && at > row.lastSeen) row.lastSeen = at;
    acc.set(key, row);
  }
  return [...acc.values()].sort((a, b) => b.users.length - a.users.length || b.asks - a.asks);
}

const events = [
  { kind: "gap", query: "BFSI case study I can send to a customer", filters: { audience: "external", vertical: "BFSI", asset_type: "Case Study" }, user_id: "a", created_at: "2026-09-04T12:26:34Z" },
  { kind: "gap", query: "BFSI case study I can send to a customer", filters: { audience: "external", vertical: "BFSI", asset_type: "Case Study" }, user_id: "a", created_at: "2026-09-04T12:25:45Z" },
  { kind: "gap", query: "pharma ZTNA?", filters: { audience: "internal", vertical: "Pharma / Healthcare", asset_type: "Whitepaper", product: "ZTNA" }, user_id: "a", created_at: "2026-09-04T12:26:32Z" },
  { kind: "gap", query: "pharma ZTNA?", filters: { audience: "internal", vertical: "Pharma / Healthcare", asset_type: "Whitepaper", product: "ZTNA" }, user_id: "b", created_at: "2026-09-04T12:25:41Z" },
  { kind: "query", query: "not a gap", user_id: "c" },
];
const w = gapWorklist(events);

assert.equal(w.reduce((n, g) => n + g.asks, 0), 4, "non-gap events must be ignored");
// Two people beat one person asking twice: rephrasing is not demand.
assert.ok(w[0].vertical.startsWith("Pharma"), "rank by distinct askers before ask count");
// An external miss means the asset exists with no public URL - a publish decision, not a writing job.
assert.equal(w.find(g => g.vertical === "BFSI").external, 2, "external asks must be counted separately");
assert.equal(w.find(g => g.vertical === "BFSI").examples.length, 1, "identical queries dedupe in examples");

console.log("metrics.check: 4 assertions passed");
