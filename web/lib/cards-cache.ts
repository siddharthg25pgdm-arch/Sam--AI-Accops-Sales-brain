/** The carded corpus - what documents SAY - projected into Assets and held in a warm cache.
 *
 *  Same shape as registry-cache.ts and for the same reason: the read path in cards.ts is
 *  synchronous with 25 call sites across four channels, and Supabase is async. A second cache is
 *  cheaper than converting that chain, and it fails the same way - a bad refresh leaves the previous
 *  contents rather than emptying the catalogue.
 *
 *  What a card adds that a registry row cannot. The registry knows a file called
 *  "Accops vs Citrix.pdf" exists in Competition/VDI and DaaS. The card knows it is a battlecard
 *  covering 24 capabilities, that Citrix needs Netscaler for the zero-trust gateway, that it is
 *  stamped Confidential and must not be forwarded, and that it was published in 2024. That is the
 *  difference between finding a document and answering a question.
 *
 *  Three fields here exist to stop a rep sending the wrong thing, which is the failure this project
 *  treats as worse than missing an asset:
 *    - publish_year, read from the DOCUMENT BODY. The registry's year comes from the filename or
 *      created date, and "2026-06-11-Accops vs other VDI providers.pptx" is dated 29 NOV 2022 on
 *      its own title slide. Believing the filename ages that deck four years wrong.
 *    - expired, where the document states an expiry that has passed. The ISO 27001 certificate
 *      expired on 20 September 2024 and is exactly what a rep reaches for when procurement asks.
 *    - visibility, where 'internal' means never forward. 27 of the 34 cards are internal: licensed
 *      Gartner research, competitive battlecards, a deck listing thirty named customers.
 */
import type { Asset } from "./cards";
import { cardRows, type CardRow } from "./sharepoint";

const TTL_MS = 5 * 60_000;

// One cache per process, not per route bundle - Next gives each route its own module instance.
const g = globalThis as unknown as {
  __samCards?: Asset[]; __samCardsAt?: number; __samCardsBusy?: boolean;
  __samCardMeta?: Map<string, CardRow>;
};

/** Card row -> Asset.
 *
 *  client_actual is deliberately NOT copied onto the Asset. It holds the real customer names, and
 *  Asset is what every channel serialises and what gets built into a model prompt. No ranking
 *  decision needs "Axis Bank" rather than "a large private-sector bank", so the field stays in
 *  Supabase where a human behind the login can query it. */
export function cardToAsset(r: CardRow): Asset {
  return {
    inventory_id: null,
    title: r.title,
    asset_type: r.asset_type || "Other",
    industry: r.industry || "",
    client: r.client || "",
    products: r.products ?? [],
    key_problem: r.key_problem || "",
    key_outcomes: r.key_outcomes ?? [],
    brief: r.brief || "",
    use_for: r.use_for || "",
    section: r.source.includes("/") ? r.source.split("/")[0] : "",
    file: {
      path: r.source,
      ext: (r.filename.split(".").pop() ?? "").toLowerCase(),
      size_mb: 0,
      pages: null,
      // The publication year out of the document text. This is the whole point of P1.1.
      year: r.publish_year || null,
    },
    // 'both' means the document is already published and a rep can send it. Everything else is
    // internal - a battlecard, licensed analyst research, a customer list.
    visibility: r.visibility === "both" ? "both" : "private",
    public_url: r.public_url || null,
    // Cards carry no SharePoint URL. The registry has the verified one and allAssets() grafts it on.
    sharepoint_url: null,
    // Provenance, set once here. allAssets() trusts this over the path, which it rewrites.
    carded: true,
  };
}

/** Cached card assets. Returns [] until the first load completes, and kicks that load off. */
export function cardAssets(): Asset[] {
  // An EMPTY cache is never fresh however recently it was stamped - the defect that silently pinned
  // the registry shut for a whole TTL and had SAM answering from 74 cards instead of 696.
  const loaded = (g.__samCards?.length ?? 0) > 0;
  const fresh = loaded && g.__samCardsAt != null && Date.now() - g.__samCardsAt < TTL_MS;
  if (!fresh) void refreshCards();
  return g.__samCards ?? [];
}

/** Card metadata for the fields an Asset does not carry - expired, stale_risk, superseded_by,
 *  needs_human. Read by trustNote(), not by ranking.
 *
 *  Keyed by FILENAME, lowercased, not by the corpus source path. allAssets() rewrites file.path to
 *  the registry's real folder, so a source-keyed map stops resolving the moment a card is merged
 *  with its registry row - which is every card that has one. The filename is what dedupeKey already
 *  matches the two corpora on, so it is the key that survives. */
export function cardMeta(): Map<string, CardRow> {
  return g.__samCardMeta ?? new Map();
}

/** Reload from Supabase. One in-flight load at a time; a failure keeps the previous contents. */
export async function refreshCards(): Promise<number> {
  if (g.__samCardsBusy) return g.__samCards?.length ?? 0;
  g.__samCardsBusy = true;
  try {
    const rows = await cardRows(2000);
    g.__samCards = rows.map(cardToAsset);
    g.__samCardMeta = new Map(rows.map(r => [r.filename.toLowerCase(), r]));
    g.__samCardsAt = Date.now();
    return g.__samCards.length;
  } catch (e) {
    console.error("card cache refresh failed", e);
    // Same rule as the registry: stale beats empty, and leaving the timestamp alone means the next
    // call retries instead of hammering.
    return g.__samCards?.length ?? 0;
  } finally {
    g.__samCardsBusy = false;
  }
}

/** Warm the cache and wait. Retries while EMPTY, not merely while unstamped. */
export async function cardsReady(): Promise<void> {
  if (!g.__samCards?.length) await refreshCards();
}

export function cardCacheState() {
  return { count: g.__samCards?.length ?? 0, loadedAt: g.__samCardsAt ?? null, ttlMs: TTL_MS };
}
