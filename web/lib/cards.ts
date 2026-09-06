import raw from "@/data/asset_cards.json";
import { registryAssets } from "./registry-cache";

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

/** Cards plus the live SharePoint registry, deduplicated.
 *
 *  Two corpora meet here. The 77 hand-written cards are rich - brief, key_problem, key_outcomes -
 *  but frozen, undated, and every one of their 71 SharePoint URLs was constructed against the wrong
 *  tenant and 404s. The registry is the opposite: no document text, but real files with dates and a
 *  webUrl verified against Graph.
 *
 *  richness() already prefers the card, which is right - a carded asset answers better. But the
 *  card's dead sharepoint_url would then win too, and a rep forwarding a 404 is the failure this
 *  project has already been bitten by twice. So when a card and a registry row are the same
 *  document, keep the card and graft the registry's verified link and dates onto it.
 *
 *  Not memoised in a module variable any more: the registry cache refreshes on a TTL, so a frozen
 *  result would go stale and never notice. The merge is a few hundred rows of map work per call. */
export function allAssets(): Asset[] {
  const usable = data.assets.filter(a => a.asset_type !== "Data File" && a.asset_type !== "Content Calendar");
  const best = new Map<string, Asset>();
  for (const a of [...usable, ...registryAssets()]) {
    const k = dedupeKey(a);
    const seen = best.get(k);
    if (!seen) { best.set(k, a); continue; }
    const winner = richness(a) > richness(seen) ? a : seen;
    const other = winner === a ? seen : a;
    // Whichever wins, a verified SharePoint link and a real date beat their absence. verified()
    // is true only for registry-sourced URLs, so a constructed one can never overwrite a real one.
    best.set(k, {
      ...winner,
      sharepoint_url: verified(winner) ? winner.sharepoint_url : (verified(other) ? other.sharepoint_url : winner.sharepoint_url),
      file: winner.file && other.file
        ? { ...winner.file, year: winner.file.year ?? other.file.year, modified: winner.file.modified ?? other.file.modified }
        : (winner.file ?? other.file),
    });
  }
  return [...best.values()];
}

/** A SharePoint URL is trustworthy only if it came from Graph. The registry writes the real tenant;
 *  the 71 constructed ones in asset_cards.json point at accops.sharepoint.com, which does not exist. */
function verified(a: Asset): boolean {
  return Boolean(a.sharepoint_url?.includes("propalmsnetwork.sharepoint.com"));
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
    stale: isStale(a), visibility: a.public_url ? "public" : "internal", link: assetLink(a), location: assetLocation(a), ext: a.file?.ext ?? null,
    pages: a.file?.pages ?? null, inventoried: a.inventory_id !== null,
  };
}

/** Links SAM is willing to hand a human, and the honest fallback when it has none.
 *
 *  Every `sharepoint_url` in the current index was *constructed* by prototype/build_cards.py as
 *  `https://accops.sharepoint.com/sites/Sales/Shared Documents/<local path>` — a hostname, a site and a
 *  folder layout all invented from a laptop copy and never checked against SharePoint. The real tenant is
 *  `propalmsnetwork`, the real sites are Company and MarketingTeam, and the real folders are
 *  `Sales Collateral` and `Marketing 2.0`, so all 71 of those links 404. A rep who forwards one to a
 *  customer looks careless, which is the failure that destroys trust in SAM.
 *
 *  Updated 6 September 2026, which is what section 8a of the SharePoint task asked for. A SharePoint
 *  URL is now handed out **only when it came from Graph** - the registry writes the real tenant, so
 *  `propalmsnetwork.sharepoint.com` is the proof of provenance. Constructed URLs stay suppressed
 *  exactly as before. The field can hold a fact or a guess, and this is how the two are told apart.
 *
 *  Order: public link first, because it is the only thing a rep can send a customer. Then the
 *  verified internal link, which needs a login and is marked internal in every channel. Then nothing,
 *  and the caller prints assetLocation() instead. */
export function assetLink(a: Asset): string | null {
  if (a.public_url) return a.public_url;
  return verified(a) ? a.sharepoint_url : null;
}

/** Where to find the document when there is no link: filename, and the folder it sits in.
 *  "Accops - BFSI (Integrated) - Case Study.pdf, in case studys/case study BFSI" beats a link that 404s. */
export function assetLocation(a: Asset): string | null {
  const p = a.file?.path;
  if (!p) return null;
  const parts = p.split("/");
  const name = parts.pop() ?? p;
  return parts.length ? `${name}, in ${parts.join("/")}` : name;
}
