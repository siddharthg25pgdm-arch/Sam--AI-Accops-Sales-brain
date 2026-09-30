// Hit every /api/v1/brain route with a real token and print status, time and shape.
// usage (from web/): node scripts/brain-smoke.mjs [base]    base default http://localhost:3700
// The token is the first entry of SAM_API_TOKENS in .env.local; it is never printed.
import fs from "node:fs";

const base = (process.argv[2] ?? "http://localhost:3700").replace(/\/$/, "");
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter(l => l.includes("=") && !l.startsWith("#")).map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]));
const entry = (process.env.SAM_API_TOKENS ?? env.SAM_API_TOKENS ?? "").split(",")[0] ?? "";
const token = entry.slice(entry.indexOf(":") + 1);
if (!token) { console.error("no SAM_API_TOKENS entry"); process.exit(1); }
const H = { Authorization: `Bearer ${token}`, "x-sam-test": "1" };

let bad = 0;
async function hit(path, expect = 200, auth = true) {
  const t0 = performance.now();
  const r = await fetch(`${base}/api/v1/brain${path}`, { headers: auth ? H : {} });
  const ms = Math.round(performance.now() - t0), j = await r.json().catch(() => null);
  const shape = j?.data ? (Array.isArray(j.data) ? `${j.data.length} rows${j.page?.total != null ? ` of ${j.page.total}` : ""}` : "1 object") : j?.error ? `error: ${j.error}` : j?.openapi ? `openapi ${j.openapi}` : "?";
  if (r.status !== expect) bad++;
  console.log(`${r.status === expect ? "ok " : "BAD"} ${String(r.status).padEnd(4)} ${String(ms).padStart(5)} ms  ${r.headers.get("server-timing") ?? ""}  GET /brain${path}  -> ${shape}`);
  return j;
}

await hit("/assets?limit=1", 200); // warm-up (dev compiles the route on first hit)
const a = await hit("/assets?limit=5");
await hit("/assets?answerable=true&visibility=public&limit=50");
await hit("/assets?q=hysecure%20datasheet&limit=5");
await hit("/assets?type=case%20study&current=true&limit=20");
await hit("/assets?product=HySecure&since=2026-09-01T00:00:00Z&limit=20");
const one = a?.data?.[0];
if (one) {
  await hit(`/assets/${encodeURIComponent(one.asset_id)}`);
  await hit(`/families/${encodeURIComponent(one.family_key)}`);
}
await hit("/families/nutanixnexttokyo");
const ch = await hit("/changes?limit=100");
if (ch?.next) await hit(`/changes?since=${encodeURIComponent(ch.next.since)}&after=${encodeURIComponent(ch.next.after)}&limit=100`);
await hit(`/changes?since=${encodeURIComponent(new Date(Date.now() - 7 * 86_400_000).toISOString())}&entity=card`);
await hit("/public-assets");
await hit("/openapi.json", 200, false);
await hit("/assets/id%3Adoes-not-exist", 404);
await hit("/assets?limit=0", 400);
await hit("/changes?since=yesterday", 400);
await hit("/assets", 401, false);
process.exit(bad ? 1 : 0);
