// TS families (lib/family.ts via cards.ts) vs SQL families (docs/supabase-sam-asset-families.sql) on the
// live library. Run after changing either side: every filename must parse the same, and every shared
// asset must get the same family, head, canonical and eligibility.
// usage (from web/): node scripts/family-parity.mjs      reads SUPABASE_URL / SUPABASE_SERVICE_KEY from .env.local
import { createJiti } from "jiti";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@": web } });
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter(l => l.includes("=") && !l.startsWith("#")).map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]));
process.env.SUPABASE_URL = env.SUPABASE_URL; process.env.SUPABASE_SERVICE_KEY = env.SUPABASE_SERVICE_KEY;
const get = async p => (await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${p}`, { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } })).json();

const { parseName } = await jiti.import("../lib/family.ts");
const { allAssets } = await jiti.import("../lib/cards.ts");
await (await jiti.import("../lib/registry-cache.ts")).ready();

let bad = 0;
const names = [...await get("sam_sharepoint_files?select=filename,fam_key,fam_edition,fam_version,fam_outdated&limit=1000"),
  ...await get("sam_asset_cards?select=filename,fam_key,fam_edition,fam_version,fam_outdated&limit=1000")];
for (const r of names) {
  const p = parseName(r.filename);
  if (p.key !== r.fam_key || p.edition !== r.fam_edition || p.version.join(".") !== (r.fam_version ?? []).join(".") || p.outdated !== r.fam_outdated) {
    bad++; console.log(`parse differs: ${r.filename}  ts ${p.key} [${p.edition}] ${p.version}  sql ${r.fam_key} [${r.fam_edition}] ${r.fam_version}`);
  }
}
const sql = await get("sam_asset_families?select=*&limit=1000");
const byId = new Map(sql.filter(r => r.item_id).map(r => [r.item_id, r])), bySrc = new Map(sql.filter(r => !r.item_id).map(r => [r.source, r]));
let shared = 0;
for (const a of allAssets()) {
  const r = (a.item_id && byId.get(a.item_id)) || bySrc.get(a.file?.path);
  if (!r) continue;
  shared++;
  const f = a.family, d = [f.key !== r.family_key && `key ${f.key}/${r.family_key}`, f.head !== r.is_head && `head ${f.head}/${r.is_head}`,
    f.canonical !== r.is_canonical && `canonical ${f.canonical}/${r.is_canonical}`, f.eligible !== r.eligible && `eligible ${f.eligible}/${r.eligible}`].filter(Boolean);
  if (d.length) { bad++; console.log(`family differs: ${(a.file?.path ?? a.title).split("/").pop()}: ${d.join("; ")}`); }
}
console.log(`${names.length} filenames, ${shared} shared assets, ${bad} differences`);
process.exit(bad ? 1 : 0);
