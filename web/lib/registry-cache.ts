/** The SharePoint registry, projected into Assets and held in a warm cache.
 *
 *  Why a cache rather than making the read path async. `allAssets()`, `searchAssets()`,
 *  `facetCounts()` and `coverageGaps()` in cards.ts are synchronous, and 25 call sites across
 *  page.tsx, agent.ts, agent-openai.ts and api.ts depend on that. Supabase reads are async, so
 *  joining the registry either means a cache or converting the whole chain and touching every
 *  caller in all four channels for the same result.
 *
 *  The honest cost: the first request after a cold start sees cards only, and the registry lands a
 *  moment later. For a search tool that is fine - nobody notices one query returning 66 instead of
 *  940 - and it is a much smaller blast radius than an async rewrite.
 *
 *  What a registry row is and is not. It carries filename, folder, tags, dates and a VERIFIED
 *  web_url, but no document text: SAM never downloads file content. So a registry-only asset can
 *  answer "this exists, here is the link, here is where it lives", which is most of what a rep
 *  needs, but it cannot answer "what outcome did that bank get". Carding fills that in later. */
import type { Asset } from "./cards";
import { registry, type RegistryRow } from "./sharepoint";

const TTL_MS = 5 * 60_000;

// One cache per process, not per route bundle. Next.js gives each route its own module instance,
// so a plain module-level array would leave /api/ask and the catalogue with separate copies -
// the same trap events.ts already documents.
const g = globalThis as unknown as { __samReg?: Asset[]; __samRegAt?: number; __samRegBusy?: boolean };

/** Office web links arrive as ...Doc.aspx?sourcedoc={GUID}&action=edit. A rep who forwards that
 *  sends the customer to an EDITING surface. Downgrade to a viewer; leave every other URL alone. */
export function safeLink(url: string): string {
  if (!url) return url;
  return url.includes("action=edit") ? url.replace(/([?&])action=edit\b/, "$1action=default") : url;
}

/** Registry row -> Asset. Deliberately conservative: every field SAM has not actually read stays
 *  empty rather than being invented, so a registry-only asset never looks better sourced than it is. */
export function rowToAsset(r: RegistryRow): Asset {
  const year = (r.created_at ?? r.modified_at ?? "").slice(0, 4) || null;
  return {
    inventory_id: null,
    title: r.filename.replace(/\.[^.]+$/, ""),
    asset_type: r.asset_type?.[0] ?? "Other",
    industry: r.industry?.[0] ?? "",
    client: "",
    products: r.product ?? [],
    key_problem: "",
    key_outcomes: [],
    brief: "",
    // Read by a human as provenance, and by searchAssets() as part of the match blob, so the
    // folder name ("Competition/ZTNA and VPN") makes the asset findable before it is carded.
    use_for: r.folder ? `Filed under ${r.folder}` : "",
    section: r.folder ?? "",
    file: {
      path: r.folder ? `${r.folder}/${r.filename}` : r.filename,
      ext: r.ext ?? "", size_mb: 0, pages: null,
      modified: r.modified_at ?? undefined, year,
    },
    // Registry rows are SharePoint documents: private until someone publishes them.
    visibility: "private",
    public_url: null,
    // The whole point of the registry. Verified against Graph, never constructed - unlike the 71
    // URLs in asset_cards.json, which were invented against the wrong tenant and all 404.
    sharepoint_url: safeLink(r.web_url),
  };
}

/** Cached registry assets. Returns [] until the first load completes, and kicks that load off. */
export function registryAssets(): Asset[] {
  const fresh = g.__samRegAt != null && Date.now() - g.__samRegAt < TTL_MS;
  if (!fresh) void refresh();
  return g.__samReg ?? [];
}

/** Reload from Supabase. Safe to call often: one in-flight load at a time, and a failure leaves the
 *  previous contents in place rather than emptying the catalogue. */
export async function refresh(): Promise<number> {
  if (g.__samRegBusy) return g.__samReg?.length ?? 0;
  g.__samRegBusy = true;
  try {
    const rows = await registry("sales", 5000);
    // Only things a rep could actually use. Images, .lnk shortcuts and archive folders are tracked
    // in the registry for completeness but must never surface as an answer.
    const usable = rows.filter(r => r.status !== "archived" && !r.deleted);
    g.__samReg = usable.map(rowToAsset);
    g.__samRegAt = Date.now();
    return g.__samReg.length;
  } catch (e) {
    console.error("registry cache refresh failed", e);
    // Deliberately do NOT clear the cache or the timestamp on failure: stale data beats an empty
    // catalogue, and leaving the timestamp alone means the next call retries rather than hammering.
    return g.__samReg?.length ?? 0;
  } finally {
    g.__samRegBusy = false;
  }
}

/** Warm the cache and wait for it. For entry points that can afford one await - the chat route -
 *  so the first real question does not see an empty registry. */
export async function ready(): Promise<void> {
  if (g.__samRegAt == null) await refresh();
}

export function cacheState() {
  return { count: g.__samReg?.length ?? 0, loadedAt: g.__samRegAt ?? null, ttlMs: TTL_MS };
}
