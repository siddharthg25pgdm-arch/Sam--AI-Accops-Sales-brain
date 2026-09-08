import raw from "@/data/asset_cards.json";
import { registryAssets } from "./registry-cache";
import { cardAssets, cardMeta } from "./cards-cache";

export type AssetFile = {
  path: string; ext: string; size_mb: number; pages: number | null; modified?: string; year?: string | null;
  text_excerpt?: string; match_score?: number | null; sha1?: string | null;
};
export type Asset = {
  inventory_id: number | null; title: string; asset_type: string; industry: string; client: string;
  products: string[]; key_problem: string; key_outcomes: string[]; brief: string; use_for: string; section: string;
  file: AssetFile | null; visibility: "private" | "public" | "both"; public_url: string | null; sharepoint_url: string | null;
  /** True when this came from the carded corpus - a human-equivalent read of the real document, so
   *  its year is a fact rather than a filename guess. Set once at projection time and carried
   *  through the merge, because the merge rewrites `file.path` to the registry's real folder and
   *  provenance must not depend on a string we deliberately overwrite. */
  carded?: boolean;
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

/** Richer card wins: more descriptive text, then a card read from the real document, then an
 *  inventory entry, then a shorter path (less likely a stray copy).
 *
 *  The +200 for a carded asset is not a tie-break, it is a statement about provenance. A hand-written
 *  card was written from a filename and a memory of the document; a corpus card was written from the
 *  extracted text, and carries the publication year, the expiry and the visibility that go with
 *  having actually read the thing. Where both describe the same document, the one that read it wins
 *  even if the older card happens to have a longer brief. */
function richness(a: Asset): number {
  return (a.brief?.length ?? 0) + (a.use_for?.length ?? 0) + (a.key_problem?.length ?? 0)
    + a.key_outcomes.join("").length + (a.products?.length ?? 0) * 10
    + (carded(a) ? 200 : 0)
    + (a.inventory_id !== null ? 50 : 0) - (a.file?.path?.length ?? 0) / 100;
}

/** Every corpus SAM has, deduplicated.
 *
 *  THREE now, not two, and they are good at different things.
 *
 *  The 77 hand-written cards are rich - brief, key_problem, key_outcomes - but frozen, undated, and
 *  every one of their 71 SharePoint URLs was constructed against the wrong tenant and 404s.
 *
 *  The registry is the opposite: 874 real files with verified Graph webUrls and dates, but no
 *  document text, so it can say a file exists and not what is in it.
 *
 *  The carded corpus (cards-cache) is new. Claude Enterprise read the actual documents, so these
 *  carry what the other two cannot: a publication year read from the document BODY, an expiry where
 *  one has passed, and a visibility that says whether a rep may forward the thing at all.
 *
 *  richness() decides which wins, and a carded asset should - it answers better. What it must NOT
 *  take with it is a dead link, so whichever card wins, a verified SharePoint URL and a real date
 *  are grafted on from the loser. verified() is true only for registry-sourced URLs, so a
 *  constructed one can never overwrite a real one.
 *
 *  Not memoised: both caches refresh on a TTL, so a frozen result would go stale and never notice. */
export function allAssets(): Asset[] {
  const usable = data.assets.filter(a => a.asset_type !== "Data File" && a.asset_type !== "Content Calendar");
  const best = new Map<string, Asset>();
  for (const a of [...usable, ...registryAssets(), ...cardAssets()]) {
    const k = dedupeKey(a);
    const seen = best.get(k);
    if (!seen) { best.set(k, a); continue; }
    const winner = richness(a) > richness(seen) ? a : seen;
    const other = winner === a ? seen : a;
    // Whichever wins, a verified SharePoint link and a real date beat their absence. verified()
    // is true only for registry-sourced URLs, so a constructed one can never overwrite a real one.
    //
    // The year is the same kind of question - provenance, not precedence. A carded year was read
    // out of the document body; a registry year is inferred from the filename or created date, and
    // is ALWAYS set, so `winner.year ?? other.year` would let a guess beat a fact whenever the
    // registry row won on richness. "2026-06-11-Accops vs other VDI providers.pptx" is dated
    // 29 NOV 2022 on its own title slide: the filename is a SharePoint touch, four years out.
    const dated = carded(winner) ? winner : (carded(other) ? other : null);
    // A card's `section` is its corpus prefix - "sharepoint" or "public" - which is where the FILE
    // sits on disk, not where the document lives in SharePoint. The registry knows the real folder
    // ("Competition/VDI and DaaS"), and that is what a rep needs to be told, so keep the real one.
    const filed = !carded(winner) && winner.section ? winner.section
                : !carded(other) && other.section ? other.section
                : winner.section;
    best.set(k, {
      ...winner,
      carded: winner.carded || other.carded,
      section: filed,
      sharepoint_url: verified(winner) ? winner.sharepoint_url : (verified(other) ? other.sharepoint_url : winner.sharepoint_url),
      // A public URL is a fact wherever it came from, and it is what makes an asset sendable.
      public_url: winner.public_url ?? other.public_url,
      file: winner.file && other.file
        ? {
            ...winner.file,
            // Keep the registry's real folder path too - it is what assetLocation() prints and what
            // searchAssets() matches on, so "Competition" stays a findable word.
            path: carded(winner) && other.file.path ? other.file.path : winner.file.path,
            year: dated?.file?.year ?? winner.file.year ?? other.file.year,
            modified: winner.file.modified ?? other.file.modified,
          }
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

/** True for an asset that came from the carded corpus, where a year means "the document says so"
 *  rather than "the filename suggests so".
 *
 *  Reads an explicit flag rather than sniffing the path prefix. The merge deliberately rewrites
 *  `file.path` to the registry's real folder so a rep is told where the document actually lives,
 *  and a provenance test that depended on that string would quietly stop being true the moment it
 *  was rewritten - costing the card its richness bonus on the next comparison. */
function carded(a: Asset): boolean {
  return a.carded === true;
}

/** Every asset including duplicate copies. Only for diagnostics; answers and the catalogue use allAssets(). */
export function allAssetsRaw(): Asset[] {
  return data.assets;
}
export function assetKey(a: Asset) { return a.file?.path ?? a.title; }
export function typeGroup(a: Asset): "Case Study" | "Whitepaper" | "Battlecard" | "Deck" | "Brochure" | "Other" {
  const t = a.asset_type.toLowerCase();
  if (t.includes("case")) return "Case Study";
  // Battlecard before deck: a competitive comparison IS a deck, and the rep asking for one wants
  // that specific thing. Checked before "white" too, since a competitive analysis can be written up
  // as a whitepaper - the Omnissa VVF teardown is exactly that.
  if (t.includes("battlecard") || t.includes("competit")) return "Battlecard";
  if (t.includes("white") || t.includes("thought") || t.includes("brief") || t.includes("pov")) return "Whitepaper";
  if (t.includes("brochure") || t.includes("datasheet")) return "Brochure";
  if (t.includes("deck") || t.includes("presentation") || t.includes("webinar") || t.includes("event")) return "Deck";
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

/** The one-line reason a rep should hesitate before sending this, or null when there is none.
 *
 *  P1.2 asked for a freshness badge. Age turned out to be the least useful of the three things
 *  carding actually found, so this returns whichever matters most rather than just a year:
 *
 *    1. EXPIRED beats everything. The ISO 27001 certificate expired on 20 September 2024 and is
 *       precisely what a rep reaches for when procurement asks for it. Sending it is a live
 *       commercial problem, not an aesthetic one.
 *    2. A newer edition exists. Five of the nine brochures are superseded by public 2026 versions,
 *       so "the latest HySecure datasheet" has a right answer and a wrong one.
 *    3. Otherwise the age warning, and only where a publication year was actually read from the
 *       document - never from a filename, which is how a 2022 deck came to look like a 2026 one.
 *
 *  Deliberately one string rather than a flags object: it goes into an answer, a WhatsApp message
 *  and a model prompt, and all three want a sentence a human can read. */
/** Asset types that record a moment rather than describe the product, so the generic age note is
 *  meaningless for them. An explicit expiry or a stale_risk on the card still applies. */
const DATED_RECORD = new Set(["Certification", "Certificate", "Award", "Analyst Report"]);

export function trustNote(a: Asset): string | null {
  const m = cardMeta().get((a.file?.path ?? "").split("/").pop()?.toLowerCase() ?? "");
  if (m?.expired) {
    return `EXPIRED${m.expiry_date ? ` on ${m.expiry_date}` : ""} - do not send. ${m.needs_human || ""}`.trim();
  }
  if (m?.superseded_by) {
    const newer = m.superseded_by.split(" - ")[0].split("/").pop();
    return `A newer edition exists${newer ? `: ${newer}` : ""} - prefer that one.`;
  }
  if (m?.stale_risk) return m.stale_risk;
  // The generic age note is about product literature going out of date - a 2022 brochure may
  // describe a release the customer will not get. It does not apply to a certificate, an award or
  // an analyst report, which are dated records of a point in time and are not "stale" for being old.
  // Without this, SAM tells a rep to check whether a 2021 ISO certificate "still reflects the
  // product", which is not a sentence that means anything.
  if (DATED_RECORD.has(a.asset_type)) return null;
  const y = yearOf(a);
  if (y && isStale(a)) return `Published ${y}; over two years old, so check it still reflects the product.`;
  return null;
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
    // Matching EVERY token is a different kind of answer from matching one of them, and the old
    // flat score could not say so. "hysecure datasheet" over 702 assets returned a government
    // reference architecture and a defence brochure alongside the two actual HySecure datasheets,
    // because anything mentioning HySecure anywhere in its blob scored within a point of them - and
    // the model, handed three near-equal results, concluded there was no datasheet at all.
    const complete = tokens.length > 1 && hits.length === tokens.length ? 6 : 0;
    // A token naming an asset type ("datasheet", "battlecard", "brochure") is a filter the rep
    // typed in words rather than selected, so honour it as one - but ONLY once the asset has
    // matched something else too. Rewarding the type token alone made "forcepoint competitive"
    // rank every Competitive-typed asset over the actual Forcepoint deck, because they all earned
    // the bonus on "competitive" while matching nothing about Forcepoint.
    const typeToken = tokens.some(t => typeGroup(a).toLowerCase().includes(t) || a.asset_type.toLowerCase().includes(t));
    const typeHit = typeToken && hits.length > 1 ? 3 : 0;
    const score = hits.length * 2 + titleHits * 1.5 + complete + typeHit + fresh;
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
