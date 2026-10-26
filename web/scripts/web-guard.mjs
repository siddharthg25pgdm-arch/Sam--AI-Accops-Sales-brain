// Prebuild leak test for the website chatbot (plan 2.1). Any finding exits 1, so Vercel fails the deploy.
// usage (from web/): node scripts/web-guard.mjs [webDir]
//   1. Boundary (always, offline): walk the import graph from every website entry (app/embed, app/api/web, lib/web,
//      instrumentation-client.ts, public/embed.js). No reached file may be an internal module, read the service key,
//      name a service-role function, or name any sam_* relation outside sam_web_*. The browser side (app/embed,
//      public/embed.js) may not even say "supabase" or "apikey". The committed intent index may hold only its schema.
//   2. Probes (only when the site is switched on: WEB_CHAT_ENABLED=1 + the reader env): the PostgREST OpenAPI index
//      lists no sam_* path for anon and only the allowlist for sam_web_reader; internal tables answer 401/403/404 to
//      both. An unreachable database is a finding (fail safe). WEB_GUARD_SKIP=1 skips the probes (emergency only).
// ponytail: plan 2.1 steps 4-5 (red-team through the live pipeline + the canary scan with the service key) are not
// here yet; the red-team runs offline in lib/web-guardrails.check.mjs. Add them with web-leak.mjs (live weekly).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOTS = ["app/embed", "app/api/web", "lib/web", "instrumentation-client.ts", "public/embed.js"];
const BROWSER = [/^app\/embed\//, /^public\/embed\.js$/];
const SRC = /\.(ts|tsx|js|mjs|cjs|jsx)$/;
const BAD_MODULE = /^(lib\/(cards|cards-cache|agent[^/]*|events|api|apiauth|passages|sharepoint|registry-cache|brain|brain-route)\.(ts|tsx)$|data\/(?!web-intent-(index|golden)\.json$))/;
const BAD_PACKAGE = /^@supabase\//;
const TOKENS = [
  [/SUPABASE_SERVICE_(KEY|ROLE)/, "the service key"],
  [/\bservice_role\b/, "the service role"],
  [/\bsb_secret_/, "a Supabase secret key"],
  [/NEXT_PUBLIC_SUPABASE/, "a public Supabase env var"],
  [/\bsam_web_(dashboard|purge)\b/, "a service-role-only RPC"],
  // (?!...) also skips the GTM/GA4 dataLayer names of plan 7.1 (sam_chat, sam_event, sam_qa_id, sam_source): analytics keys, not relations
  [/\bsam_(?!web_|(chat|event|qa_id|source)\b)[a-z0-9_]+/, "an internal sam_* relation"],
  [/\badi_[a-z0-9_]+/, "an internal adi_* relation"],
  [/asset_cards\.json/, "the internal card file"],
];
// Contract (docs/plans/web-s1-contract-notes.md): redact.ts names the service key only to scrub it from text (and
// sam_events in a comment). It has no imports and no I/O.
const ALLOW = { "lib/redact.ts": ["the service key", "an internal sam_* relation"] };
const INDEX_KEYS = ["version", "built_at", "knowledge_version", "source", "stop", "synonyms", "entities", "group_entities", "vocab", "w_kw", "unk", "intents", "margin"];
const INTENT_KEYS = ["qa_id", "groups", "must", "allow", "keywords", "phrases", "min_score"];

const rel = (web, f) => path.relative(web, f).split(path.sep).join("/");
const walk = d => readdirSync(d).flatMap(n => { const p = path.join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;

function resolve(web, from, spec) {
  const base = spec.startsWith("@/") ? path.join(web, spec.slice(2)) : path.resolve(path.dirname(from), spec);
  for (const c of ["", ".ts", ".tsx", ".js", ".mjs", ".json", "/index.ts", "/index.tsx", "/index.js"]) {
    if (existsSync(base + c) && statSync(base + c).isFile()) return base + c;
  }
  return null;
}

/** Offline boundary findings for the web/ tree at `web`. */
export function boundary(web) {
  const out = [], seen = new Set(), via = new Map();
  const queue = ROOTS.map(r => path.join(web, r)).filter(existsSync).flatMap(p => (statSync(p).isDirectory() ? walk(p) : [p]));
  for (const f of queue) via.set(f, "entry");
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f)) continue;
    seen.add(f);
    const r = rel(web, f), from = via.get(f);
    if (BAD_MODULE.test(r)) { out.push(`${r}: internal module reached from ${from}`); continue; }
    if (!SRC.test(r)) continue;
    const text = readFileSync(f, "utf8");
    for (const [re, what] of TOKENS) if (re.test(text) && !ALLOW[r]?.includes(what)) out.push(`${r}: ${what} (${text.match(re)[0]})`);
    if (BROWSER.some(b => b.test(r)) && /supabase|apikey/i.test(text)) out.push(`${r}: browser code mentions supabase/apikey`);
    for (const [, spec] of text.matchAll(IMPORT)) {
      if (BAD_PACKAGE.test(spec)) { out.push(`${r}: imports ${spec}`); continue; }
      if (!spec.startsWith(".") && !spec.startsWith("@/")) continue; // other packages (next, zod, botid, ...)
      const to = resolve(web, f, spec);
      if (!to) { out.push(`${r}: cannot resolve ${spec}`); continue; } // fail safe: an unchecked file is a finding
      if (!seen.has(to)) { via.set(to, r); queue.push(to); }
    }
  }
  const ix = path.join(web, "data/web-intent-index.json");
  if (existsSync(ix)) {
    try {
      const j = JSON.parse(readFileSync(ix, "utf8"));
      const extra = [...Object.keys(j).filter(k => !INDEX_KEYS.includes(k)),
        ...(Array.isArray(j.intents) ? j.intents : [null]).flatMap(i => (i && typeof i === "object" ? Object.keys(i).filter(k => !INTENT_KEYS.includes(k)) : ["<intent not an object>"]))];
      if (extra.length) out.push(`data/web-intent-index.json: fields outside the schema: ${[...new Set(extra)].join(", ")}`);
    } catch (e) { out.push(`data/web-intent-index.json: unreadable (${e.message})`); }
  }
  return { findings: out, files: seen.size };
}

const READER_PATHS = new Set(["/", "/sam_web_qa_public", "/sam_web_pages_public", "/sam_web_assets_public",
  ...["settings", "page_group", "roots", "children", "search", "admit", "take_model_slot", "cache_get", "cache_put", "log_message", "log_event"]
    .map(f => `/rpc/sam_web_${f}`)]);
const INTERNAL = ["sam_asset_cards", "sam_passages", "sam_v1_assets", "sam_events", "sam_sharepoint_files", "sam_ops_runs", "sam_content_requests",
  "sam_web_qa", "sam_web_pages", "sam_web_settings", "sam_web_conversations", "sam_web_messages", "sam_web_answer_cache", "sam_web_rate", "sam_web_usage_daily"];
const INTERNAL_RPC = ["sam_web_dashboard", "sam_web_purge", "sam_passages_search"];

/** Live probes as anon (publishable key only) and as sam_web_reader. `f` is fetch (injectable for the check). */
export async function probes({ url, apikey, jwt }, f = fetch) {
  const out = [], base = url.replace(/\/$/, "");
  const as = { anon: { apikey }, reader: { apikey, Authorization: `Bearer ${jwt}` } };
  const get = async (who, p, init = {}) => {
    try { return await f(`${base}/rest/v1${p}`, { ...init, headers: { ...as[who], ...init.headers }, signal: AbortSignal.timeout(8000) }); }
    catch (e) { out.push(`${who} ${p}: unreachable (${e?.name ?? "error"})`); return null; }
  };
  for (const who of ["anon", "reader"]) {
    const r = await get(who, "/");
    if (r?.status === 200) {
      const paths = Object.keys((await r.json().catch(() => ({}))).paths ?? {});
      const bad = who === "anon" ? paths.filter(p => /^\/(rpc\/)?(sam_|adi_)/.test(p)) : paths.filter(p => !READER_PATHS.has(p));
      if (bad.length) out.push(`${who} OpenAPI lists ${bad.slice(0, 8).join(", ")}${bad.length > 8 ? ` (+${bad.length - 8})` : ""}`);
    } else if (r && who === "reader" && ![401, 403].includes(r.status)) out.push(`reader OpenAPI returned ${r.status}`);
    // A closed index (401/403: Supabase's new API keys serve OpenAPI to secret keys only, found 27 Oct 2026) hides
    // the table list, which is safer; the per-table probes below still run. The reader must still reach its views:
    if (who === "reader") for (const v of ["sam_web_assets_public", "sam_web_qa_public"]) {
      const x = await get(who, `/${v}?select=*&limit=1`);
      if (x && x.status !== 200) out.push(`reader cannot read its own view ${v} (${x.status})`);
    }
    for (const t of INTERNAL) {
      const x = await get(who, `/${t}?select=*&limit=1`);
      if (x && ![401, 403, 404].includes(x.status)) out.push(`${who} can read ${t} (${x.status})`);
    }
    for (const fn of INTERNAL_RPC) {
      const x = await get(who, `/rpc/${fn}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (x && ![401, 403, 404].includes(x.status)) out.push(`${who} can call ${fn} (${x.status})`);
    }
  }
  return out;
}

async function main() {
  const web = path.resolve(process.argv[2] ?? fileURLToPath(new URL("..", import.meta.url)));
  const { findings, files } = boundary(web);
  console.log(`web-guard: boundary walked ${files} files, ${findings.length} finding(s)`);
  const e = process.env, live = e.WEB_CHAT_ENABLED === "1";
  if (e.WEB_GUARD_SKIP === "1") console.log("\n!!! WEB_GUARD_SKIP=1: the website leak probes were SKIPPED for this build. Emergency use only. !!!\n");
  else if (!live) console.log("web-guard: WEB_CHAT_ENABLED is not 1, the website routes answer 503; probes skipped");
  else if (!e.SUPABASE_URL || !e.SAM_WEB_READER_JWT || !e.SAM_WEB_SUPABASE_APIKEY) findings.push("WEB_CHAT_ENABLED=1 but the reader env is incomplete");
  else {
    const p = await probes({ url: e.SUPABASE_URL.trim(), apikey: e.SAM_WEB_SUPABASE_APIKEY.trim(), jwt: e.SAM_WEB_READER_JWT.trim() });
    console.log(`web-guard: probes ${p.length} finding(s)`);
    findings.push(...p);
  }
  for (const f of findings) console.log(`FINDING ${f}`); // names and statuses only, never a key or a row
  process.exit(findings.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
