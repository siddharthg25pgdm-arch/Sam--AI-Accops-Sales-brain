import raw from "@/data/asset_cards.json";

export type AssetFile = {
  path: string; ext: string; size_mb: number; pages: number | null; modified?: string; year?: string | null;
  text_excerpt?: string; match_score?: number | null; sha1?: string | null;
};
export type Asset = {
  inventory_id: number | null; title: string; asset_type: string; industry: string; client: string;
  products: string[]; key_problem: string; key_outcomes: string[]; brief: string; use_for: string; section: string;
  file: AssetFile | null; visibility: "private" | "public" | "both"; public_url: string | null; sharepoint_url: string | null;
};

const data = raw as unknown as { counts: Record<string, number>; assets: Asset[] };

export const VERTICALS: Record<string, string[]> = {
  BFSI: ["bfsi", "bank", "banking", "nbfc", "insurance", "financial", "capital", "asset management", "co-operative"],
  "IT / ITeS": ["it/ites", "ites", "it services", "bpo", "system integrator", "software", "case study it"],
  Manufacturing: ["manufacturing", "industry 4.0", "textile", "cable", "food processing", "plant"],
  "E-commerce / Retail": ["e-commerce", "ecommerce", "retail", "logistics", "d2c", "wellness"],
  Government: ["government", "govt", "defence", "defense", "research", "psu", "egovernance", "atomic"],
  "Pharma / Healthcare": ["pharma", "healthcare", "hospital", "pharmacy", "life sciences", "health"],
  Media: ["media", "entertainment", "dth", "broadcast", "news"],
  Education: ["education", "university", "iit", "school", "campus", "student"],
};
export const PRODUCTS = ["HySecure", "HyID", "HyWorks", "HyLabs", "HyDesk", "ZTNA", "MFA", "VDI", "DaaS", "BioAuth", "Browser Isolation", "Nutanix", "Thin Clients"];

/** Same document, two homes. Three files sit in two folders each (a Govt copy of a BFSI bank study, Polycab under
 *  both manufacturing and nutanix, an e-commerce study twice), and two more share a content hash across inventory
 *  entries. With only three slots in an answer, a duplicate wastes one, so collapse them here — once, at the source. */
export function dedupeKey(a: Asset): string {
  // Filename first: the same document filed under two verticals keeps its name but gets a different hash
  // (re-saved copies differ byte-wise), so hashing alone misses exactly the cases a salesperson notices.
  const file = (a.file?.path ?? "").split("/").pop()?.toLowerCase().replace(/\.(pdf|docx)$/, "").replace(/[^a-z0-9]/g, "") ?? "";
  if (file) return `file:${file}`;
  const sha = a.file?.sha1;
  if (sha) return `sha:${sha}`;
  return `name:${a.title.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

/** Richer card wins: more descriptive text, then an inventory entry, then a shorter path (less likely a stray copy). */
function richness(a: Asset): number {
  return (a.brief?.length ?? 0) + (a.use_for?.length ?? 0) + (a.key_problem?.length ?? 0)
    + a.key_outcomes.join("").length + (a.products?.length ?? 0) * 10
    + (a.inventory_id !== null ? 50 : 0) - (a.file?.path?.length ?? 0) / 100;
}

let cachedAssets: Asset[] | null = null;

export function allAssets(): Asset[] {
  if (cachedAssets) return cachedAssets;
  const usable = data.assets.filter(a => a.asset_type !== "Data File" && a.asset_type !== "Content Calendar");
  const best = new Map<string, Asset>();
  for (const a of usable) {
    const k = dedupeKey(a);
    const seen = best.get(k);
    if (!seen || richness(a) > richness(seen)) best.set(k, a);
  }
  cachedAssets = [...best.values()];
  return cachedAssets;
}

/** Every asset including duplicate copies. Only for diagnostics; answers and the catalogue use allAssets(). */
export function allAssetsRaw(): Asset[] {
  return data.assets;
}
export function assetKey(a: Asset) { return a.file?.path ?? a.title; }
export function typeGroup(a: Asset): "Case Study" | "Whitepaper" | "Other" {
  const t = a.asset_type.toLowerCase();
  if (t.includes("case")) return "Case Study";
  if (t.includes("white") || t.includes("thought") || t.includes("brief") || t.includes("pov")) return "Whitepaper";
  return "Other";
}
export function verticalOf(a: Asset): string {
  const hay = `${a.industry} ${a.section} ${a.file?.path ?? ""}`.toLowerCase();
  for (const [name, words] of Object.entries(VERTICALS)) if (words.some(w => hay.includes(w))) return name;
  return "Cross-industry";
}
export function productsOf(a: Asset): string[] {
  const hay = `${a.title} ${a.products.join(" ")} ${a.brief} ${a.use_for} ${a.file?.path ?? ""}`.toLowerCase();
  return PRODUCTS.filter(p => hay.includes(p.toLowerCase()));
}
/** Year only when the filename or folder says so. The file's modified date is when it was copied to disk, not published. */
export function yearOf(a: Asset): string | null {
  return a.file?.year ?? null;
}
export function isStale(a: Asset): boolean {
  const y = yearOf(a); if (!y) return false;
  return new Date().getFullYear() - Number(y) >= 2;
}
export function blob(a: Asset): string {
  return [a.title, a.asset_type, a.industry, a.client, a.products.join(" "), a.key_problem, a.key_outcomes.join(" "),
    a.brief, a.use_for, a.section, a.file?.path ?? "", a.file?.text_excerpt ?? ""].join(" ").toLowerCase();
}

export type SearchArgs = { query?: string; asset_type?: string; vertical?: string; product?: string; audience?: "internal" | "external"; limit?: number };
export type SearchHit = { asset: Asset; score: number; why: string };

export function searchAssets(args: SearchArgs): { results: SearchHit[]; considered: number } {
  const q = (args.query ?? "").toLowerCase().trim();
  const stop = new Set(["the", "for", "and", "with", "need", "want", "any", "have", "our", "case", "study", "studies", "whitepaper", "please", "pls", "can", "you", "find", "give", "send", "show"]);
  const tokens = (q.match(/[a-z0-9][a-z0-9.+-]*/g) ?? []).filter(t => t.length > 2 && !stop.has(t));
  const out: SearchHit[] = [];
  const pool = allAssets();
  for (const a of pool) {
    if (args.asset_type && typeGroup(a).toLowerCase() !== args.asset_type.toLowerCase() && !a.asset_type.toLowerCase().includes(args.asset_type.toLowerCase())) continue;
    if (args.vertical && verticalOf(a).toLowerCase() !== args.vertical.toLowerCase()) continue;
    if (args.product && !productsOf(a).some(p => p.toLowerCase() === args.product!.toLowerCase())) continue;
    if (args.audience === "external" && !a.public_url) continue;
    const b = blob(a);
    const hits = tokens.filter(t => b.includes(t));
    const titleHits = tokens.filter(t => a.title.toLowerCase().includes(t)).length;
    const fresh = isStale(a) ? 0 : 0.4;
    const score = hits.length * 2 + titleHits * 1.5 + fresh;
    if (tokens.length && hits.length === 0) continue;
    out.push({ asset: a, score, why: hits.length ? `matched ${hits.slice(0, 5).join(", ")}` : "matched your filters" });
  }
  out.sort((x, y) => y.score - x.score || (yearOf(y.asset) ?? "").localeCompare(yearOf(x.asset) ?? ""));
  return { results: out.slice(0, args.limit ?? 5), considered: pool.length };
}

export function facetCounts() {
  const pool = allAssets();
  const count = (f: (a: Asset) => string[]) => {
    const m = new Map<string, number>();
    for (const a of pool) for (const k of f(a)) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m.entries()].sort((x, y) => y[1] - x[1]);
  };
  return {
    types: count(a => [typeGroup(a)]),
    verticals: count(a => [verticalOf(a)]),
    products: count(a => productsOf(a)),
    years: count(a => [yearOf(a) ?? "undated"]).sort((x, y) => (x[0] === "undated" ? 1 : y[0] === "undated" ? -1 : y[0].localeCompare(x[0]))),
  };
}

/** Combinations a salesperson could reasonably ask for that have zero assets. This is the "Not available" view. */
export function coverageGaps(): { vertical: string; type: "Case Study" | "Whitepaper"; product?: string }[] {
  const pool = allAssets();
  const gaps: { vertical: string; type: "Case Study" | "Whitepaper"; product?: string }[] = [];
  for (const v of Object.keys(VERTICALS)) {
    for (const t of ["Case Study", "Whitepaper"] as const) {
      if (!pool.some(a => verticalOf(a) === v && typeGroup(a) === t)) gaps.push({ vertical: v, type: t });
      for (const p of ["ZTNA", "MFA", "VDI"]) {
        if (!pool.some(a => verticalOf(a) === v && typeGroup(a) === t && productsOf(a).includes(p))) gaps.push({ vertical: v, type: t, product: p });
      }
    }
  }
  return gaps;
}

export function latest(n = 12): Asset[] {
  return [...allAssets()].sort((x, y) => (y.file?.modified ?? "").localeCompare(x.file?.modified ?? "")).slice(0, n);
}
export function counts() { return data.counts; }

import type { SlimAsset } from "./types";
export function slim(a: Asset): SlimAsset {
  return {
    key: assetKey(a), title: a.title, type: typeGroup(a), asset_type: a.asset_type, industry: a.industry, vertical: verticalOf(a),
    products: productsOf(a), use_for: a.use_for, brief: a.brief || a.key_problem || "", year: yearOf(a), modified: a.file?.modified ?? null,
    stale: isStale(a), visibility: a.public_url ? "public" : "internal", link: a.public_url ?? a.sharepoint_url, ext: a.file?.ext ?? null,
    pages: a.file?.pages ?? null, inventoried: a.inventory_id !== null,
  };
}
