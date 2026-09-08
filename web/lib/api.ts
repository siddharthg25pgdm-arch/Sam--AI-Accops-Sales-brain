/** Shared handlers behind both the REST routes (/api/v1/*) and the MCP tools (/api/mcp).
 *  One implementation, two transports, so the Dwight extension and an MCP client see identical behaviour. */
import { searchAssets, allAssets, slim, facetCounts, coverageGaps, verticalOf, typeGroup, yearOf, isStale, trustNote, assetLink, assetLocation, VERTICALS, type Asset } from "./cards";
import { ask as askAgent, type AskResult } from "./agent";
import { logEvent, recentEvents } from "./events";

export type Channel = "web" | "api" | "mcp" | "whatsapp";

export function card(a: Asset, why?: string) {
  return {
    title: a.title, asset_type: a.asset_type, type: typeGroup(a), industry: a.industry, vertical: verticalOf(a), client: a.client,
    products: a.products, use_for: a.use_for, brief: (a.brief || a.key_problem || "").slice(0, 400), key_outcomes: a.key_outcomes.slice(0, 5),
    year: yearOf(a), stale: isStale(a), trust: trustNote(a), pages: a.file?.pages ?? null, file_path: a.file?.path ?? null,
    visibility: a.public_url ? "public" : "internal", public_url: a.public_url, location: assetLocation(a),
    shareable_externally: Boolean(a.public_url), ...(why ? { why_match: why } : {}),
  };
}

export async function apiSearch(p: { query?: string; asset_type?: string; vertical?: string; product?: string; audience?: "internal" | "external"; limit?: number }, who: string, channel: Channel) {
  const { results, considered } = searchAssets({ ...p, limit: Math.min(Math.max(p.limit ?? 5, 1), 10) });
  await logEvent({ user_id: who, channel, kind: "query", query: p.query ?? "", intent: "find_asset", filters: p, result_count: results.length,
    result_ids: results.map(r => r.asset.file?.path ?? r.asset.title), runtime: "search", latency_ms: 0 });
  if (results.length === 0) await logEvent({ user_id: who, channel, kind: "gap", query: p.query ?? "", filters: p });
  return { results: results.map(r => card(r.asset, r.why)), total_considered: considered, filters: p };
}

export async function apiAsk(question: string, who: string, channel: Channel, history: { role: "user" | "assistant"; content: string }[] = [], sessionId?: string | null) {
  const t0 = Date.now();
  const r: AskResult = await askAgent(question, history);
  const eventId = await logEvent({ user_id: who, channel, session_id: sessionId ?? null, kind: "query", query: question, intent: r.intent, filters: r.filters,
    result_count: r.assets.length, result_ids: r.assets.map(a => a.path ?? a.title), runtime: r.runtime, latency_ms: Date.now() - t0 });
  if (r.zero) await logEvent({ user_id: who, channel, session_id: sessionId ?? null, kind: "gap", query: question, filters: r.filters, ref_event_id: eventId });
  return { answer: r.text, assets: r.assets, gap: r.zero, runtime: r.runtime, trace: r.trace, event_id: eventId };
}

export function apiAssets(p: { vertical?: string; type?: string; product?: string }) {
  let list = allAssets().map(slim);
  if (p.vertical) list = list.filter(a => a.vertical.toLowerCase() === p.vertical!.toLowerCase());
  if (p.type) list = list.filter(a => a.type.toLowerCase() === p.type!.toLowerCase());
  if (p.product) list = list.filter(a => a.products.some(x => x.toLowerCase() === p.product!.toLowerCase()));
  return { assets: list, facets: facetCounts() };
}

export async function apiGaps() {
  const asked = (await recentEvents(1000)).filter(e => e.kind === "gap");
  return coverageGaps().map(g => ({
    ...g,
    asked: asked.filter(e => {
      const f = (e.filters ?? {}) as Record<string, string>;
      return (f.vertical ?? "").toLowerCase() === g.vertical.toLowerCase() && (!g.product || (f.product ?? "").toLowerCase() === g.product.toLowerCase());
    }).length,
  })).sort((a, b) => b.asked - a.asked);
}

export function apiPublicLink(title_or_path: string) {
  const q = title_or_path.toLowerCase();
  const a = allAssets().find(x => (x.file?.path ?? "").toLowerCase() === q || x.title.toLowerCase() === q)
    ?? allAssets().find(x => x.title.toLowerCase().includes(q) || (x.file?.path ?? "").toLowerCase().includes(q));
  if (!a) return { found: false as const };
  return a.public_url
    ? { found: true as const, status: "public" as const, public_url: a.public_url, title: a.title }
    : { found: true as const, status: "private_only" as const, location: assetLocation(a), title: a.title, can_request_publish: true,
        note: "No public version exists. Find it in SharePoint at the location shown; ask marketing to publish before sending anything outside Accops." };
}

export type PublishRequest = {
  id: number; created_at: string; asset_title: string; asset_path: string | null;
  requested_by: string; channel: string; reason: string | null; status: string;
  decided_by: string | null; decided_at: string | null; public_url: string | null;
};

function sbCfg() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}

/** File a request to publish an internal-only asset externally.
 *
 *  This is the other half of apiPublicLink()'s can_request_publish:true, which promised a rep they
 *  could ask and then gave them nowhere to ask. Approver is Siddharth.
 *
 *  Repeat asks for the same asset merge onto the existing open row rather than creating a second
 *  one - a unique index on lower(asset_title) where status='open' enforces it. That keeps an agent
 *  that retries, and three reps hitting the same wall, from burying the approver in duplicates. */
export async function apiRequestPublish(p: { asset: string; reason?: string }, who: string, channel: Channel) {
  const c = sbCfg();
  const a = allAssets().find(x => x.title.toLowerCase() === p.asset.toLowerCase())
    ?? allAssets().find(x => x.title.toLowerCase().includes(p.asset.toLowerCase()));
  if (!a) return { ok: false as const, error: `No asset matches "${p.asset}".` };
  if (a.public_url) return { ok: false as const, error: "Already public.", public_url: a.public_url, title: a.title };
  if (!c) return { ok: false as const, error: "Publish requests need SUPABASE_URL and SUPABASE_SERVICE_KEY." };

  const body = {
    asset_title: a.title, asset_path: a.file?.path ?? null,
    requested_by: who, channel, reason: p.reason ?? null,
  };
  const r = await fetch(`${c.url}/rest/v1/sam_publish_requests`, {
    method: "POST", cache: "no-store",
    headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (r.status === 409) {
    // The unique index fired: someone already asked and it is still open. That is a success from the
    // rep's point of view - the request exists - so say so rather than reporting an error.
    return { ok: true as const, status: "already_requested" as const, title: a.title,
             note: "Someone has already asked for this one. It is in the queue." };
  }
  if (!r.ok) return { ok: false as const, error: `Could not file the request (${r.status}).` };
  const [row] = (await r.json()) as PublishRequest[];
  await logEvent({ user_id: who, channel, kind: "query", query: `publish request: ${a.title}`, intent: "request_publish", result_count: 1 });
  return { ok: true as const, status: "requested" as const, id: row?.id, title: a.title,
           note: "Filed. Siddharth approves publish requests; you will get the public link when it goes live." };
}

/** The approver's queue. Open requests, newest first. */
export async function apiPublishQueue(status = "open"): Promise<PublishRequest[]> {
  const c = sbCfg();
  if (!c) return [];
  const r = await fetch(`${c.url}/rest/v1/sam_publish_requests?status=eq.${status}&order=created_at.desc&limit=100`, {
    headers: { apikey: c.key, Authorization: `Bearer ${c.key}` }, cache: "no-store",
  });
  return r.ok ? ((await r.json()) as PublishRequest[]) : [];
}

/** Account brief for the Dwight extension: talking points + shareable assets for a named company/persona. */
export async function apiContextForAccount(p: { company: string; person_title?: string; country?: string; industry?: string; intent?: string }, who: string, channel: Channel) {
  const q = [p.intent ?? "first outreach", "to", p.person_title ?? "a decision maker", "at", p.company, p.industry ? `(${p.industry})` : "", p.country ? `in ${p.country}` : "",
    ". Which proof points and collateral should I lead with, and which are safe to send externally?"].join(" ");
  let r = await apiAsk(q, who, channel);
  if (r.gap || r.assets.length === 0) {
    // Retrieval-only mode cannot reason about a company name. Fall back to the vertical's strongest assets.
    const vertical = p.industry ? Object.keys(VERTICALS).find(v => v.toLowerCase().includes(p.industry!.toLowerCase().split(/[ /]/)[0])) : undefined;
    const { results } = searchAssets({ query: [p.industry, p.person_title].filter(Boolean).join(" "), vertical, limit: 3 });
    const fallback = results.length ? results : searchAssets({ query: "", vertical, limit: 3 }).results;
    r = { ...r, assets: fallback.map(h => ({ title: h.asset.title, asset_type: h.asset.asset_type, industry: h.asset.industry, why: h.why,
      link: assetLink(h.asset), location: assetLocation(h.asset), visibility: h.asset.public_url ? "public" : "internal", year: yearOf(h.asset), stale: isStale(h.asset), trust: trustNote(h.asset), path: h.asset.file?.path ?? null })),
      answer: fallback.length ? `No exact match for ${p.company}. Strongest ${vertical ?? "cross-industry"} assets to lead with:` : r.answer };
  }
  return {
    account: { company: p.company, person_title: p.person_title ?? null, country: p.country ?? null, industry: p.industry ?? null },
    brief: r.answer,
    shareable_assets: r.assets.filter(a => a.visibility === "public").map(a => ({ title: a.title, url: a.link })),
    internal_only: r.assets.filter(a => a.visibility !== "public").map(a => ({ title: a.title, location: a.location, why: a.why })),
    gap: r.gap, runtime: r.runtime,
  };
}
