/** SAM passages: what carded documents say, page by page (docs/supabase-sam-passages.sql, built nightly by
 *  prototype/build_passages.py), for callers that must ground a claim in a document's own words. SAM Live's
 *  grounded assist is the first. Contract: docs/SALES-BRAIN-PLATFORM.md, "Passages".
 *
 *  Policy (Siddharth, 17 Oct 2026):
 *   - Passages of public AND internal carded collateral are indexed (it supersedes "a private file body never
 *     leaves SharePoint" for this text; corpus/README.md).
 *   - Internal passages go only to tokens with the passages:internal scope (lib/apiauth.ts). Everyone else,
 *     a signed-in browser included, gets public passages.
 *   - SAM_PASSAGES_INTERNAL=0 is the kill switch: nothing internal is served, whatever the scope.
 *   - Nothing is offered for external sharing without approval metadata: `sharing.external_approved` needs a
 *     public URL on accops.com or a decided publish request. A public URL elsewhere is not approval.
 *
 *  Retrieval: Postgres full-text recall (sam_passages_search), then SAM's own token and entity scoring and
 *  freshness, all from the same in-memory library SAM's answers use (cards.ts), so a passage carries exactly
 *  the trust note, family and links SAM would show for its document. The audience is re-checked against the
 *  library at serve time: a document unpublished since the nightly build is internal at once. */
import { allAssets, dedupeKey, internalLink, isStale, mentions, namedEntities, namesProduct, pinKey, productsOf, queryTokens,
  successorOf, supersedingFile, trustNote, typeGroup, yearOf, type Asset } from "./cards";
import { cardMeta } from "./cards-cache";
import type { CardRow } from "./sharepoint";
import { ready } from "./registry-cache";
import { resolveCaller, unauthorized, type Caller } from "./apiauth";

export const PASSAGES_VERSION = "1";
const MAX_K = 20, PER_DOC = 3, TTL_MS = 5 * 60_000;

export class BadRequest extends Error {}
/** The table or its functions are not in the database yet (the migration is not applied). */
export class NotInstalled extends Error {}

export const internalOn = () => process.env.SAM_PASSAGES_INTERNAL?.trim() !== "0";
/** The passage audiences a caller may read. */
export function audiencesFor(c: Caller): ("public" | "internal")[] {
  return internalOn() && c.scopes.includes("passages:internal") ? ["public", "internal"] : ["public"];
}

// ---------------------------------------------------------------- request

export type SearchReq = {
  query: string; k: number; audience: "internal" | "external";
  filters: { products: string[]; asset_types: string[]; min_year: number | null; include_expired: boolean; current_editions_only: boolean };
};

/** POST body (or GET params already shaped like one) -> a validated request. */
export function parseSearch(o: Record<string, unknown>): SearchReq {
  const query = typeof o.query === "string" ? o.query.trim() : "";
  if (!query || query.length > 500) throw new BadRequest("query is required (at most 500 characters)");
  const k = o.k == null || o.k === "" ? 8 : Number(o.k);
  if (!Number.isInteger(k) || k < 1 || k > MAX_K) throw new BadRequest(`k must be an integer 1-${MAX_K}`);
  const audience = o.audience == null || o.audience === "" ? "internal" : o.audience;
  if (audience !== "internal" && audience !== "external") throw new BadRequest("audience must be internal or external");
  const f = o.filters ?? {};
  if (typeof f !== "object" || Array.isArray(f)) throw new BadRequest("filters must be an object");
  const g = f as Record<string, unknown>;
  const list = (name: string) => {
    const v = g[name];
    if (v == null) return [];
    if (!Array.isArray(v) || !v.every(x => typeof x === "string")) throw new BadRequest(`filters.${name} must be an array of strings`);
    return v.map(x => x.trim()).filter(Boolean);
  };
  const bool = (name: string, d: boolean) => {
    const v = g[name];
    if (v == null) return d;
    if (typeof v !== "boolean") throw new BadRequest(`filters.${name} must be true or false`);
    return v;
  };
  const min = g.min_year == null ? null : Number(g.min_year);
  if (min !== null && (!Number.isInteger(min) || min < 1990 || min > 2100)) throw new BadRequest("filters.min_year must be a year");
  return { query, k, audience, filters: { products: list("products"), asset_types: list("asset_types"), min_year: min,
    include_expired: bool("include_expired", false), current_editions_only: bool("current_editions_only", true) } };
}

/** GET ?q=&k=&audience=&product=a,b&type=a,b&min_year=&include_expired=&current_editions_only= -> the POST shape. */
export function searchParams(u: URLSearchParams): Record<string, unknown> {
  const csv = (k: string) => (u.get(k) == null ? undefined : u.get(k)!.split(",").map(s => s.trim()).filter(Boolean));
  const tf = (k: string) => {
    const v = u.get(k);
    if (v == null || v === "") return undefined;
    if (v !== "true" && v !== "false") throw new BadRequest(`${k} must be true or false`);
    return v === "true";
  };
  return { query: u.get("q") ?? u.get("query") ?? "", k: u.get("k") ?? undefined, audience: u.get("audience") ?? undefined,
    filters: { products: csv("product"), asset_types: csv("type"), min_year: u.get("min_year") || undefined,
      include_expired: tf("include_expired"), current_editions_only: tf("current_editions_only") } };
}

// ---------------------------------------------------------------- database

type Row = { id: string; source: string; item_id: string | null; doc_version: string; ordinal: number; locator: Record<string, unknown>;
  text: string; audience: "internal" | "public"; extracted_at: string; rank?: number };
const ROW_COLS = "id,source,item_id,doc_version,ordinal,locator,text,audience,extracted_at";

async function pg<T>(path: string, body?: unknown): Promise<T> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set");
  const r = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${path}`, {
    method: body === undefined ? "GET" : "POST", cache: "no-store", signal: AbortSignal.timeout(8000),
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // PostgREST answers 404 for a function or table it does not know: the migration is not applied yet.
  if (r.status === 404) throw new NotInstalled("the passage index is not installed");
  if (!r.ok) throw new Error(`passages ${path.split("?")[0]} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as T;
}

const g = globalThis as unknown as {
  __samPassStats?: { at: number; v: Index }; __samPassPub?: { at: number; v: Approval[] };
};
type Index = { built_at: string | null; documents: number; passages: number };
async function stats(): Promise<Index> {
  if (g.__samPassStats && Date.now() - g.__samPassStats.at < TTL_MS) return g.__samPassStats.v;
  const [s] = await pg<{ built_at: string | null; documents: number; passages: number }[]>("rpc/sam_passages_stats", {});
  const v = { built_at: s?.built_at ?? null, documents: Number(s?.documents ?? 0), passages: Number(s?.passages ?? 0) };
  g.__samPassStats = { at: Date.now(), v };
  return v;
}

/** Decided publish requests (docs/supabase-sam-publish-requests.sql): the approval behind a public URL. */
type Approval = { asset_title: string; asset_path: string | null; status: string; decided_by: string | null; decided_at: string | null; public_url: string | null };
async function approvals(): Promise<Approval[]> {
  if (g.__samPassPub && Date.now() - g.__samPassPub.at < TTL_MS) return g.__samPassPub.v;
  const v = await pg<Approval[]>("sam_publish_requests?select=asset_title,asset_path,status,decided_by,decided_at,public_url&status=in.(approved,published)&limit=500")
    .catch(() => g.__samPassPub?.v ?? []);
  g.__samPassPub = { at: Date.now(), v };
  return v;
}

// ---------------------------------------------------------------- the library side of a passage

let idx: { all: Asset[]; meta: Map<string, CardRow>; bySource: Map<string, Asset>; byStem: Map<string, Asset> } | null = null;
/** The library asset and card behind a card source. allAssets() rewrites file.path to the registry's folder,
 *  so the card is found as cards.ts finds it (item_id, else filename); a PDF/PPTX twin falls back to its stem. */
function docOf(source: string): { a: Asset; card: CardRow | undefined } | null {
  const all = allAssets(), meta = cardMeta();
  if (!idx || idx.all !== all || idx.meta !== meta) {
    const bySource = new Map<string, Asset>(), byStem = new Map<string, Asset>();
    for (const a of all) {
      const card = (a.item_id ? meta.get(`id:${a.item_id}`) : undefined) ?? meta.get((a.file?.path ?? "").split("/").pop()?.toLowerCase() ?? "");
      if (a.carded && card) bySource.set(card.source, a);
      if (!byStem.has(dedupeKey(a))) byStem.set(dedupeKey(a), a);
    }
    idx = { all, meta, bySource, byStem };
  }
  const file = source.split("/").pop() ?? source;
  const a = idx.bySource.get(source) ?? idx.byStem.get(dedupeKey({ title: file, file: { path: file } } as Asset));
  return a ? { a, card: meta.get(file.toLowerCase()) ?? (a.item_id ? meta.get(`id:${a.item_id}`) : undefined) } : null;
}

const ACCOPS_URL = /^https:\/\/([a-z0-9-]+\.)*accops\.com\//i;
const norm = (u: string | null | undefined) => (u ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/[?#].*$/, "").replace(/\/+$/, "");

/** A row as the API serves it, or null when this caller may not see it, or when SAM cannot vouch for it (its
 *  document is not in the library). */
function view(r: Row, allowed: string[], approved: Approval[]) {
  const d = docOf(r.source);
  if (!d) return null;
  const { a, card } = d;
  const audience: "internal" | "public" = a.public_url ? "public" : "internal";
  if (!allowed.includes(audience) || !allowed.includes(r.audience)) return null;
  const req = a.public_url ? approved.find(x => (x.public_url && norm(x.public_url) === norm(a.public_url)) || x.asset_path === a.file?.path
    || x.asset_title.toLowerCase() === a.title.toLowerCase()) : undefined;
  const basis: "publish_request" | "public_url" | "none" = !a.public_url ? "none" : req ? "publish_request" : ACCOPS_URL.test(a.public_url) ? "public_url" : "none";
  const successor = successorOf(a);
  const superseded = a.family?.head === false || Boolean(a.family?.superseded) || Boolean(successor);
  const year = Number(card?.publish_year) || Number(yearOf(a)) || null;
  return { a, p: {
    passage_id: r.id, text: r.text,
    doc: { source: r.source, asset_id: pinKey(a), item_id: a.item_id ?? r.item_id ?? null, title: a.title, asset_type: a.asset_type, type: typeGroup(a),
      doc_version: r.doc_version, version: a.family?.version?.length ? a.family.version.join(".") : null, modified_at: a.file?.modified ?? null,
      family: { key: a.family?.key ?? null, is_current: a.family?.head ?? true,
        superseded_by: successor?.title ?? (card?.superseded_by ? supersedingFile(card.superseded_by) ?? card.superseded_by : null) } },
    locator: r.locator ?? {},
    links: { internal: internalLink(a), public: a.public_url },
    audience,
    sharing: { external_approved: basis !== "none", basis, approved_at: req?.decided_at ?? null, approved_by: req?.decided_by ?? null },
    freshness: { year, stale: isStale(a) || a.family?.eligible === false, expired: Boolean(card?.expired), superseded,
      eligible: a.family?.eligible ?? true, excluded: a.family?.excluded ?? null, trust_note: trustNote(a), indexed_at: r.extracted_at },
    score: 0,
  } };
}
export type Passage = NonNullable<ReturnType<typeof view>>["p"];

function wanted(p: Passage, q: SearchReq, a: Asset): boolean {
  const f = q.filters;
  if (q.audience === "external" && !p.sharing.external_approved) return false;
  if (!f.include_expired && p.freshness.expired) return false;
  if (f.current_editions_only && p.freshness.superseded) return false;
  if (f.min_year != null && (p.freshness.year ?? 0) < f.min_year) return false;
  const lc = (xs: string[]) => xs.map(x => x.toLowerCase());
  if (f.products.length && !lc([...a.products, ...productsOf(a)]).some(x => lc(f.products).includes(x))) return false;
  if (f.asset_types.length && !lc(f.asset_types).some(t => t === p.doc.type.toLowerCase() || t === a.asset_type.toLowerCase())) return false;
  return true;
}

/** SAM's re-rank over the recall set: the database's cover density, every question word the passage (or its
 *  document's title) has - product names by their features too (namesProduct) - all of them, the named
 *  vendors, regulations and products it covers and misses, then freshness. */
function score(p: Passage, rank: number, tokens: string[], named: string[]): number {
  const t = `${p.doc.title} ${p.text}`.toLowerCase();
  const hits = tokens.filter(x => namesProduct(t, x)).length;
  const covered = named.filter(e => mentions(t, e)).length;
  return rank * 10 + hits * 2 + (tokens.length > 1 && hits === tokens.length ? 4 : 0) + covered * 3 - (named.length - covered) * 2
    - (p.freshness.stale ? 1 : 0) - (p.freshness.superseded || p.freshness.expired ? 5 : 0);
}

// ---------------------------------------------------------------- the API

export async function searchPassages(c: Caller, q: SearchReq, onBehalfOf: string | null = null) {
  const t0 = Date.now(), allowed = audiencesFor(c);
  await ready();
  const [rows, index, approved] = await Promise.all([
    pg<Row[]>("rpc/sam_passages_search", { p_query: q.query, p_audiences: allowed, p_limit: Math.min(200, q.k * 10) }), stats(), approvals()]);
  const tokens = queryTokens(q.query), named = namedEntities(q.query);
  const ranked = rows.flatMap(r => {
    const v = view(r, allowed, approved);
    if (!v || !wanted(v.p, q, v.a)) return [];
    v.p.score = Math.round(score(v.p, Number(r.rank ?? 0), tokens, named) * 100) / 100;
    return [v.p];
  }).sort((x, y) => y.score - x.score || x.passage_id.localeCompare(y.passage_id));
  const perDoc = new Map<string, number>(), passages: typeof ranked = [];
  for (const p of ranked) {  // at most PER_DOC from one document, so k passages are not one deck's k slides
    const n = perDoc.get(p.doc.source) ?? 0;
    if (n >= PER_DOC) continue;
    perDoc.set(p.doc.source, n + 1);
    passages.push(p);
    if (passages.length === q.k) break;
  }
  const took_ms = Date.now() - t0;
  // Logged, not stored: SAM has no per-user permissions, so on-behalf-of is an audit trail. No query text.
  console.info(JSON.stringify({ passages: "search", caller: c.id, on_behalf_of: onBehalfOf, audiences: allowed, k: q.k, candidates: rows.length, returned: passages.length, took_ms }));
  return { passages, index, took_ms, audience: q.audience, policy: { internal_passages: internalOn(), caller_audiences: allowed } };
}

/** One passage and its neighbours (ordinal ± 1) for context. Null when it does not exist OR this caller may not
 *  see it: the two are indistinguishable, so ids cannot be probed. */
export async function getPassage(c: Caller, id: string) {
  const i = id.lastIndexOf("#"), source = id.slice(0, i), ord = Number(id.slice(i + 1));
  if (i < 1 || !Number.isInteger(ord) || ord < 0) throw new BadRequest("id must be <source>#<ordinal>");
  const allowed = audiencesFor(c);
  await ready();
  const [rows, approved] = await Promise.all([
    pg<Row[]>(`sam_passages?select=${ROW_COLS}&source=eq.${encodeURIComponent(source)}&ordinal=gte.${ord - 1}&ordinal=lte.${ord + 1}&order=ordinal`), approvals()]);
  const views = rows.map(r => ({ r, p: view(r, allowed, approved)?.p }));
  const self = views.find(x => x.r.ordinal === ord)?.p;
  if (!self) return null;
  return { passage: self, neighbours: views.filter(x => x.r.ordinal !== ord && x.p).map(x => ({ passage_id: x.r.id, locator: x.r.locator, text: x.r.text })) };
}

/** Every /api/v1/passages route: auth, 400 for bad input, 404 for nothing (or an index not installed yet, with
 *  passages_api:false so a client can tell), 500 without internals. */
export async function passagesRoute(req: Request, fn: (c: Caller) => Promise<unknown | null>): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "X-Passages-Version": PASSAGES_VERSION };
  const c = await resolveCaller(req);
  if (!c) return unauthorized();
  try {
    const out = await fn(c);
    return out == null ? Response.json({ error: "not found" }, { status: 404, headers }) : Response.json(out, { headers });
  } catch (e) {
    if (e instanceof BadRequest) return Response.json({ error: e.message }, { status: 400, headers });
    if (e instanceof NotInstalled) return Response.json({ error: e.message, passages_api: false }, { status: 404, headers });
    console.error("passages api", e);
    return Response.json({ error: "the passage read failed; the server log has the detail" }, { status: 500, headers });
  }
}

/** GET ?q= and POST {query,...}: the same search. */
export async function searchRoute(req: Request): Promise<Response> {
  const onBehalf = req.headers.get("x-sam-on-behalf-of")?.slice(0, 80) ?? null;
  return passagesRoute(req, async c => {
    const raw = req.method === "GET" ? searchParams(new URL(req.url).searchParams) : await req.json().catch(() => { throw new BadRequest("the body must be JSON"); });
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadRequest("the body must be a JSON object");
    return searchPassages(c, parseSearch(raw as Record<string, unknown>), onBehalf);
  });
}
