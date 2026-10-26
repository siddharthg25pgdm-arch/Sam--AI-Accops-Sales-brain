// Website tab parity (plan 9 "Stream E" acceptance): sam_web_dashboard's tiles equal the raw rows for the same window.
// usage (from web/): node scripts/web-dashboard-parity.mjs [days=30] [--env path/to/.env.local]   GETs + the read-only RPC only.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { rawFromRows } from "./web-admin-fixture.mjs";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const a = process.argv.slice(2), days = Number(a.find(x => /^\d+$/.test(x)) ?? 30);
const envFile = a.includes("--env") ? a[a.indexOf("--env") + 1] : path.join(web, ".env.local");
for (const l of readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const i = l.indexOf("=");
  if (i > 0 && !l.startsWith("#") && !process.env[l.slice(0, i)]) process.env[l.slice(0, i)] = l.slice(i + 1).replace(/^"|"$/g, "").trim();
}
const W = await createJiti(import.meta.url, { alias: { "@": web } }).import("../lib/web-dashboard.ts");
const now = Date.now();
const [rpc, rows] = await Promise.all([W.loadDashboard(days, true), W.loadMessages(days, true)]);
if (rows.length >= W.MSG_LIMIT) { console.log(`more than ${W.MSG_LIMIT} messages: parity needs a shorter window`); process.exitCode = 2; }
const mine = rawFromRows(rows, { days, includeTest: true, now });
const tile = r => { const d = W.mapDashboard(r, new Date(now).toISOString()); return { conversations: d.conv, messages: d.messages, tiers: d.totals, withoutModel: [d.withoutModel.num, d.withoutModel.den], tokens: d.tokens }; };
const x = tile(rpc), y = tile(mine), bad = Object.keys(x).filter(k => JSON.stringify(x[k]) !== JSON.stringify(y[k]));
for (const k of bad) console.log(`MISMATCH ${k}: rpc ${JSON.stringify(x[k])} raw ${JSON.stringify(y[k])}`);
console.log(`web-dashboard-parity (${days} days, test included): ${rows.length} messages, ${x.conversations.total} conversations; ${bad.length ? "FAIL" : "tiles = raw counts"}`);
process.exitCode ||= bad.length ? 1 : 0;
