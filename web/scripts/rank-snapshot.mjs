// Top-3 search results for every persona question (prototype/persona.mjs), on the REAL library.
// Use it to see exactly which rankings a change to lib/cards.ts moves, before it ships:
//
//   node scripts/rank-snapshot.mjs after.json
//   git stash push lib/cards.ts && node scripts/rank-snapshot.mjs before.json; git stash pop
//   node scripts/rank-snapshot.mjs --diff before.json after.json
//
// Reads Supabase through web/.env.local, like the app. Raw words, no filters: this tests the ranking,
// not the model. On 6 Oct a phrase bonus fixed #43 but moved 9 of 50, three for the worse; the job-title
// rule that shipped instead moved 2.
import { readFileSync, writeFileSync } from "node:fs";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args[0] === "--diff") {
  const [b, a] = args.slice(1).map(f => JSON.parse(readFileSync(f, "utf8")));
  let n = 0;
  for (const k of Object.keys(a)) {
    if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
    n++; console.log(`#${k}\n  before: ${b[k].join(" | ")}\n  after:  ${a[k].join(" | ")}`);
  }
  console.log(`changed ${n} of ${Object.keys(a).length}`);
  process.exit(0);
}
const web = fileURLToPath(new URL("..", import.meta.url));
for (const l of readFileSync(`${web}.env.local`, "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const jiti = createJiti(import.meta.url, { alias: { "@": web } });
const { refresh } = await jiti.import("../lib/registry-cache.ts");
const { refreshCards } = await jiti.import("../lib/cards-cache.ts");
await refresh(); await refreshCards();
const { searchAssets } = await jiti.import("../lib/cards.ts");
const src = readFileSync(new URL("../../prototype/persona.mjs", import.meta.url), "utf8");
const qs = [...src.matchAll(/\["(?:core|new)", (\d+), "[A-Z]+", "([^"]*)"/g)].map(m => [Number(m[1]), m[2]]);
const out = {};
for (const [n, q] of qs) out[n] = searchAssets({ query: q, limit: 3 }).results.map(h => h.asset.title.slice(0, 70));
writeFileSync(args[0] ?? "rank-snapshot.json", JSON.stringify(out, null, 1));
console.log(`${qs.length} questions -> ${args[0] ?? "rank-snapshot.json"}`);
