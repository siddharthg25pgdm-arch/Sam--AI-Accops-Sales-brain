/** The Sales Brain API, v1: /api/v1/brain/*. A thin, stable read layer over the v1 views
 *  (docs/supabase-sam-v1-brain.sql). Contract for tool builders: docs/SALES-BRAIN-PLATFORM.md.
 *
 *  Rules this file keeps:
 *   - Every response has the same envelope: { data, page } for lists, { data } for one thing.
 *   - Columns are an explicit list (ASSET_COLS...), so a column added to a view for internal use never
 *     appears in the API by accident, and the OpenAPI spec is generated from the same lists.
 *   - Reads go through PostgREST with the service key, server side only. Tools never hold that key.
 *   - `q` reuses SAM's own ranking (searchAssets in cards.ts), so a tool searching the brain gets the
 *     answers SAM chat would; it ranks over answerable assets (current + eligible) only. */
import { searchAssets, pinKey } from "./cards";
import { ready } from "./registry-cache";

export const BRAIN_VERSION = "1.0.0";
export const MAX_LIMIT = 200, DEFAULT_LIMIT = 50;

type Col = { name: string; type: "string" | "integer" | "number" | "boolean" | "string[]" | "date-time" | "date" | "object"; nullable?: boolean; doc: string };
const s = (name: string, doc: string, nullable = true): Col => ({ name, type: "string", nullable, doc });

/** sam_v1_assets, as the API serves it. Every column is documented here and in the platform doc. */
export const ASSET_COLS: Col[] = [
  s("asset_id", "Stable id: 'id:<SharePoint item id>' for a registry file (survives rename and move), 'path:<card source>' for a card with no live file.", false),
  s("item_id", "SharePoint (Graph driveItem) id, null for a card with no live file."),
  s("card_source", "The card's source path (corpus/...), null when the file is not carded."),
  s("document_key", "Same value for a PDF and a PPTX of the same document (twins)."),
  s("family_key", "Every version, re-save and edition of one document shares it.", false),
  s("edition", "'' default (internal/English/global), or 'sharable', 'japanese', 'japan', 'mea' and combinations.", false),
  s("version", "Version parsed from the filename ('2.3'), null when none."),
  { name: "version_rank", type: "integer", doc: "1 = newest in its edition." },
  { name: "is_current", type: "boolean", doc: "Newest in its edition (the only members answers may show)." },
  { name: "is_family_lead", type: "boolean", doc: "The member that represents the family by default." },
  { name: "superseded", type: "boolean", doc: "A hand-set superseded_by points at a successor that is in the library." },
  { name: "family_size", type: "integer", doc: "Documents in the family, this one included." },
  { name: "family_older_versions", type: "integer", doc: "Documents in the family that are not current in any edition." },
  { name: "eligible", type: "boolean", doc: "May answer: published 2024+, or a certificate / analyst report / regulation / third-party research / brand asset, or pinned; never when excluded by hand or the card says the file is empty." },
  s("excluded_reason", "Why not eligible ('published 2021', 'year unknown, last modified 2022', 'empty file', ...), null when eligible."),
  { name: "pinned", type: "boolean", doc: "An admin kept it in answers despite its age." },
  { name: "answerable", type: "boolean", doc: "is_current AND eligible: what SAM's answers can use." },
  s("visibility", "'public' = published (card visibility both, with a public URL); 'internal' = never send outside Accops.", false),
  s("public_url", "The public link, when published."),
  { name: "public_url_verified", type: "boolean", doc: "public_url is on an accops.com host (third-party papers are public but not ours)." },
  s("sharepoint_url", "Verified SharePoint link (Graph web_url, viewer mode). Needs an Accops login; never forward outside Accops."),
  s("title", "Card title, else the filename without extension.", false),
  s("filename", "Current filename.", false),
  s("folder", "Folder inside Sales Collateral, null for a card with no live file."),
  s("ext", "File extension, lowercase."),
  s("asset_type", "Card type (Case Study, Whitepaper, Deck, Battlecard, Brochure, Datasheet, Certification, ...), else the folder/filename tag.", false),
  s("industry", "Card industry, else the folder/filename tag; '' when none.", false),
  { name: "products", type: "string[]", doc: "Accops products the document covers." },
  { name: "competitors", type: "string[]", doc: "Competitors it names." },
  { name: "regulations", type: "string[]", doc: "Regulations it names (card only)." },
  { name: "personas", type: "string[]", doc: "Who it is for (card only)." },
  { name: "publish_year", type: "integer", nullable: true, doc: "Publication year read from the document body by carding, never from the filename." },
  { name: "eligibility_year", type: "integer", nullable: true, doc: "The year the pre-2024 rule used: publish_year, else the year SharePoint last saw it modified." },
  { name: "expired", type: "boolean", doc: "The document states an expiry that has passed." },
  { name: "expiry_date", type: "date", nullable: true, doc: "That expiry." },
  s("stale_risk", "Why it might mislead even though not expired (carding note)."),
  s("superseded_by", "'sharepoint/<newer file> - why', when carding found a newer edition."),
  { name: "carded", type: "boolean", doc: "SAM has read it (a card exists)." },
  s("client", "Descriptive, anonymised customer ('India's largest private bank'). Real names are never served."),
  s("brief", "What the document is, from the card."),
  s("key_problem", "The problem it addresses (internal)."),
  { name: "key_outcomes", type: "string[]", doc: "Outcomes it states." },
  s("use_for", "When a rep should use it (internal)."),
  { name: "confidence", type: "number", nullable: true, doc: "The card writer's 0-1 estimate that the card is faithful." },
  s("needs_human", "What carding flagged for a person (internal)."),
  s("internal_reason", "Why it is internal (internal)."),
  { name: "size_bytes", type: "integer", nullable: true, doc: "File size." },
  { name: "file_created_at", type: "date-time", nullable: true, doc: "SharePoint created." },
  { name: "modified_at", type: "date-time", nullable: true, doc: "SharePoint last modified." },
  s("modified_by", "Who last modified it in SharePoint."),
  { name: "first_seen", type: "date-time", nullable: true, doc: "When the registry first saw the file." },
  { name: "last_synced", type: "date-time", nullable: true, doc: "When the change flow last wrote the row." },
  { name: "carded_at", type: "date-time", nullable: true, doc: "When the card content last changed." },
  { name: "updated_at", type: "date-time", nullable: true, doc: "Latest of modified_at, last_synced, carded_at: the since= filter." },
];
export const FAMILY_COLS: Col[] = [
  s("family_key", "The family.", false), s("lead_asset_id", "The member that represents it.", false), s("lead_title", "Its title.", false), s("lead_filename", "Its filename.", false),
  { name: "assets", type: "integer", doc: "Asset rows (twins counted separately)." }, { name: "documents", type: "integer", doc: "Documents (twins counted once)." },
  { name: "older_versions", type: "integer", doc: "Documents that are not current." }, { name: "answerable_assets", type: "integer", doc: "Members answers can use." },
  { name: "answerable", type: "boolean", doc: "At least one member is answerable." }, { name: "editions", type: "string[]", doc: "Editions present ('' = default)." },
  { name: "carded_documents", type: "integer", doc: "Documents with a card." }, { name: "has_public_asset", type: "boolean", doc: "A current, eligible, published member on accops.com exists." },
  { name: "updated_at", type: "date-time", nullable: true, doc: "Latest member update." },
];
export const CHANGE_COLS: Col[] = [
  s("change_id", "Stable, sortable id ('log:000000001234', 'event:000000005678'). Tie-break for the cursor.", false),
  { name: "at", type: "date-time", doc: "When it happened." },
  s("entity", "file | card | request | answer", false),
  s("entity_id", "file/card: the asset_id; request: 'request:<id>'; answer: 'event:<question event id>'.", false),
  s("change", "file: added | modified | renamed | moved | status | deleted | restored. card: card_created | card_updated. request: request_created | request_status. answer: feedback.", false),
  { name: "detail", type: "object", doc: "filename/folder/scope; from/to for renames, moves and status; feedback kind; backfilled: true for history reconstructed on 30 Sep 2026." },
];
export const PUBLIC_COLS: Col[] = [
  s("asset_id", "As sam_v1_assets.", false), s("family_key", "As sam_v1_assets.", false), s("edition", "As sam_v1_assets.", false), s("title", "Title.", false),
  s("asset_type", "Type.", false), s("industry", "Industry, '' when none.", false), { name: "products", type: "string[]", doc: "Products." },
  s("client", "Descriptive, anonymised customer."), s("brief", "What it is."), { name: "key_outcomes", type: "string[]", doc: "Outcomes it states." },
  { name: "publish_year", type: "integer", nullable: true, doc: "Year from the document body." }, s("public_url", "The public link (accops.com).", false),
  { name: "updated_at", type: "date-time", nullable: true, doc: "Latest update." },
];
const sel = (cols: Col[]) => cols.map(c => c.name).join(",");

// ---------------------------------------------------------------- parameters (pure, checked)

export class BadRequest extends Error {}
const BOOL = (v: string | null, name: string) => {
  if (v == null || v === "") return undefined;
  if (v === "true" || v === "false") return v === "true";
  throw new BadRequest(`${name} must be true or false`);
};
export function page(u: URLSearchParams) {
  const limit = u.get("limit") == null ? DEFAULT_LIMIT : Number(u.get("limit"));
  const offset = u.get("offset") == null ? 0 : Number(u.get("offset"));
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new BadRequest(`limit must be an integer 1-${MAX_LIMIT}`);
  if (!Number.isInteger(offset) || offset < 0) throw new BadRequest("offset must be a non-negative integer");
  return { limit, offset };
}
/** Validated, but passed through as given: Postgres keeps microseconds, a JS Date does not, and a cursor
 *  rounded to milliseconds would re-send or skip rows. */
export function since(v: string | null): string | undefined {
  if (v == null || v.trim() === "") return undefined;
  if (Number.isNaN(Date.parse(v)) || !/^\d{4}-\d{2}-\d{2}/.test(v.trim())) throw new BadRequest("since must be an ISO 8601 timestamp, e.g. 2026-09-30T00:00:00Z");
  return v.trim();
}
const enc = encodeURIComponent;
/** PostgREST in-list of quoted values ("a","b"). */
export const inList = (xs: string[]) => `(${xs.map(x => `"${x.replace(/["\\]/g, "\\$&")}"`).join(",")})`;

/** Query params -> PostgREST filters for sam_v1_assets. Pure, so the check can pin the mapping. */
export function assetFilters(u: URLSearchParams): string[] {
  const f: string[] = [];
  const type = u.get("type"), industry = u.get("industry"), product = u.get("product"), family = u.get("family"), vis = u.get("visibility");
  if (type) f.push(`asset_type=ilike.${enc(type)}`);
  if (industry) f.push(`industry=ilike.${enc(industry)}`);
  if (product) f.push(`products=cs.${enc(`{"${product.replace(/"/g, "")}"}`)}`);
  if (family) f.push(`family_key=eq.${enc(family)}`);
  if (vis) { if (vis !== "public" && vis !== "internal") throw new BadRequest("visibility must be public or internal"); f.push(`visibility=eq.${vis}`); }
  for (const [param, col] of [["current", "is_current"], ["eligible", "eligible"], ["answerable", "answerable"], ["carded", "carded"]] as const) {
    const b = BOOL(u.get(param), param);
    if (b !== undefined) f.push(`${col}=is.${b}`);
  }
  const t = since(u.get("since"));
  if (t) f.push(`updated_at=gte.${enc(t)}`);
  return f;
}

// ---------------------------------------------------------------- reads

function cfg() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set");
  return { url: url.replace(/\/$/, ""), key };
}
async function get<T>(path: string, count = false): Promise<{ rows: T[]; total: number | null }> {
  const c = cfg();
  const r = await fetch(`${c.url}/rest/v1/${path}`, { cache: "no-store",
    headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, ...(count ? { Prefer: "count=exact" } : {}) } });
  if (!r.ok) throw new Error(`brain read ${path.split("?")[0]} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const total = count ? Number(r.headers.get("content-range")?.split("/")[1]) : NaN;
  return { rows: (await r.json()) as T[], total: Number.isFinite(total) ? total : null };
}
export type Page = { limit: number; offset: number; returned: number; total: number | null; next_offset: number | null };
const pageOf = (p: { limit: number; offset: number }, returned: number, total: number | null): Page =>
  // returned > 0 always: an empty page never hands back its own offset (a client would loop forever).
  ({ ...p, returned, total, next_offset: returned > 0 && (total != null ? p.offset + returned < total : returned === p.limit) ? p.offset + returned : null });

export type AssetRow = Record<string, unknown> & { asset_id: string };

/** GET /brain/assets. With q: SAM's ranking over answerable assets, then the other filters, in rank order. */
export async function listAssets(u: URLSearchParams) {
  const p = page(u), filters = assetFilters(u), q = (u.get("q") ?? "").trim();
  if (!q) {
    const order = u.get("since") ? "updated_at.asc.nullsfirst,asset_id" : "title,asset_id";
    const r = await get<AssetRow>(`sam_v1_assets?select=${sel(ASSET_COLS)}${filters.map(x => `&${x}`).join("")}&order=${order}&limit=${p.limit}&offset=${p.offset}`, true);
    return { data: r.rows, page: pageOf(p, r.rows.length, r.total) };
  }
  await ready();
  const hits = searchAssets({ query: q, limit: MAX_LIMIT }).results;
  const ids = [...new Set(hits.map(h => pinKey(h.asset)))];
  if (!ids.length) return { data: [], page: pageOf(p, 0, 0), query: { q, ranked_by: "SAM search over answerable assets" } };
  const r = await get<AssetRow>(`sam_v1_assets?select=${sel(ASSET_COLS)}&asset_id=in.${enc(inList(ids))}${filters.map(x => `&${x}`).join("")}`);
  const rank = new Map(ids.map((id, i) => [id, i]));
  const ordered = r.rows.sort((a, b) => rank.get(a.asset_id)! - rank.get(b.asset_id)!);
  const slice = ordered.slice(p.offset, p.offset + p.limit);
  return { data: slice, page: pageOf(p, slice.length, ordered.length), query: { q, ranked_by: "SAM search over answerable assets" } };
}

const MEMBER_COLS = "asset_id,title,filename,folder,edition,version,version_rank,is_current,is_family_lead,superseded,eligible,excluded_reason,answerable,visibility,publish_year,modified_at";

export async function getAsset(id: string) {
  const r = await get<AssetRow>(`sam_v1_assets?select=${sel(ASSET_COLS)}&asset_id=eq.${enc(id)}&limit=1`);
  const a = r.rows[0];
  if (!a) return null;
  const fam = await get<AssetRow>(`sam_v1_assets?select=${MEMBER_COLS}&family_key=eq.${enc(String(a.family_key))}&asset_id=neq.${enc(id)}&order=is_current.desc,version_rank,asset_id`);
  return { data: { ...a, family_members: fam.rows } };
}

export async function getFamily(key: string) {
  const [f, m] = await Promise.all([
    get<Record<string, unknown>>(`sam_v1_families?select=${sel(FAMILY_COLS)}&family_key=eq.${enc(key)}&limit=1`),
    get<AssetRow>(`sam_v1_assets?select=${MEMBER_COLS}&family_key=eq.${enc(key)}&order=is_family_lead.desc,is_current.desc,edition,version_rank,asset_id`),
  ]);
  return f.rows[0] ? { data: { ...f.rows[0], members: m.rows } } : null;
}

/** GET /brain/changes?since=&after=&entity=&limit= - keyset paging on (at, change_id). */
export async function listChanges(u: URLSearchParams) {
  const { limit } = page(u);
  const t = since(u.get("since")), after = u.get("after"), entity = u.get("entity");
  if (after && !t) throw new BadRequest("after needs since (the cursor is since + after)");
  if (entity && !["file", "card", "request", "answer"].includes(entity)) throw new BadRequest("entity must be file, card, request or answer");
  const f: string[] = [];
  if (t) f.push(after ? `or=${enc(`(at.gt."${t}",and(at.eq."${t}",change_id.gt."${after.replace(/"/g, "")}"))`)}` : `at=gt.${enc(t)}`);
  if (entity) f.push(`entity=eq.${entity}`);
  const r = await get<{ change_id: string; at: string }>(`sam_v1_changes?select=${sel(CHANGE_COLS)}${f.map(x => `&${x}`).join("")}&order=at.asc,change_id.asc&limit=${limit}`);
  const last = r.rows.at(-1);
  // A full page may have more behind it; a short page is the end for now (poll again later with next).
  return { data: r.rows, page: { limit, returned: r.rows.length, more: r.rows.length === limit },
    next: last ? { since: last.at, after: last.change_id } : t ? { since: t, after: after ?? null } : null };
}

export async function listPublic(u: URLSearchParams) {
  const p = page(u), t = since(u.get("since"));
  const r = await get<AssetRow>(`sam_v1_public_assets?select=${sel(PUBLIC_COLS)}${t ? `&updated_at=gte.${enc(t)}` : ""}&order=title,asset_id&limit=${p.limit}&offset=${p.offset}`, true);
  return { data: r.rows, page: pageOf(p, r.rows.length, r.total) };
}

// ---------------------------------------------------------------- OpenAPI 3.1

const schemaOf = (cols: Col[]) => ({
  type: "object", required: cols.filter(c => c.nullable === false).map(c => c.name),
  properties: Object.fromEntries(cols.map(c => {
    const base = c.type === "string[]" ? { type: "array", items: { type: "string" } } : c.type === "date-time" || c.type === "date" ? { type: "string", format: c.type }
      : { type: c.type };
    const t = (base as { type: string }).type;
    return [c.name, { ...base, ...(c.nullable === false || ["boolean", "array"].includes(t) ? {} : { type: [t, "null"] }), description: c.doc }];
  })),
});
const qp = (name: string, description: string, schema: object = { type: "string" }) => ({ name, in: "query", required: false, description, schema });
const pageParams = [qp("limit", `1-${MAX_LIMIT}, default ${DEFAULT_LIMIT}`, { type: "integer", minimum: 1, maximum: MAX_LIMIT }), qp("offset", "Rows to skip, default 0", { type: "integer", minimum: 0 })];
const list = (item: string, extra: object = {}) => ({ type: "object", required: ["data", "page"], properties: { data: { type: "array", items: { $ref: `#/components/schemas/${item}` } }, page: { $ref: "#/components/schemas/Page" }, ...extra } });
const ok = (schema: object, description = "OK") => ({ description, content: { "application/json": { schema } } });
const errors = { "400": { $ref: "#/components/responses/BadRequest" }, "401": { $ref: "#/components/responses/Unauthorized" } };

export function openapi() {
  return {
    openapi: "3.1.0",
    info: { title: "Accops Sales Brain API", version: BRAIN_VERSION,
      description: "Read-only v1 over the Sales Brain: SharePoint Sales Collateral (via Power Automate) -> Supabase registry -> nightly carding -> families and eligibility. Contract: docs/SALES-BRAIN-PLATFORM.md. Additive changes only within v1; a breaking change ships as /api/v2." },
    servers: [{ url: "https://sam-accops.vercel.app/api/v1/brain" }, { url: "http://localhost:3700/api/v1/brain" }],
    security: [{ bearer: [] }],
    paths: {
      "/assets": { get: { operationId: "listAssets", summary: "Assets, filtered and paged",
        parameters: [qp("q", "Free text: SAM's own ranking over answerable assets (current + eligible), best first"), qp("type", "asset_type, case-insensitive exact"),
          qp("industry", "industry, case-insensitive exact"), qp("product", "products contains, exact (HySecure, HyID, HyWorks, ZTNA, MFA, VDI, DaaS, ...)"),
          qp("family", "family_key"), qp("visibility", "public | internal", { type: "string", enum: ["public", "internal"] }),
          qp("current", "is_current", { type: "boolean" }), qp("eligible", "eligible", { type: "boolean" }), qp("answerable", "answerable", { type: "boolean" }),
          qp("carded", "carded", { type: "boolean" }), qp("since", "updated_at >= since (ISO 8601); orders by updated_at", { type: "string", format: "date-time" }), ...pageParams],
        responses: { "200": ok(list("Asset", { query: { type: "object" } })), ...errors } } },
      "/assets/{id}": { get: { operationId: "getAsset", summary: "One asset, with the other members of its family",
        parameters: [{ name: "id", in: "path", required: true, description: "asset_id, URL-encoded (id:... or path:...)", schema: { type: "string" } }],
        responses: { "200": ok({ type: "object", properties: { data: { allOf: [{ $ref: "#/components/schemas/Asset" }, { type: "object", properties: { family_members: { type: "array", items: { $ref: "#/components/schemas/Member" } } } }] } } }),
          "404": { $ref: "#/components/responses/NotFound" }, ...errors } } },
      "/families/{key}": { get: { operationId: "getFamily", summary: "One family and all its members",
        parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": ok({ type: "object", properties: { data: { allOf: [{ $ref: "#/components/schemas/Family" }, { type: "object", properties: { members: { type: "array", items: { $ref: "#/components/schemas/Member" } } } }] } } }),
          "404": { $ref: "#/components/responses/NotFound" }, ...errors } } },
      "/changes": { get: { operationId: "listChanges", summary: "What changed since a point in time, oldest first",
        description: "Poll with the `next` cursor from the previous response (since + after). Without since: from the beginning of the log.",
        parameters: [qp("since", "Exclusive lower bound on at (ISO 8601)", { type: "string", format: "date-time" }), qp("after", "change_id tie-break for since (from next.after)"),
          qp("entity", "file | card | request | answer", { type: "string", enum: ["file", "card", "request", "answer"] }), pageParams[0]],
        responses: { "200": ok({ type: "object", required: ["data", "page", "next"], properties: { data: { type: "array", items: { $ref: "#/components/schemas/Change" } },
          page: { type: "object", properties: { limit: { type: "integer" }, returned: { type: "integer" }, more: { type: "boolean" } } },
          next: { type: ["object", "null"], properties: { since: { type: "string", format: "date-time" }, after: { type: ["string", "null"] } } } } }), ...errors } } },
      "/public-assets": { get: { operationId: "listPublicAssets", summary: "Only what a customer may see (the website bot's world)",
        parameters: [qp("since", "updated_at >= since", { type: "string", format: "date-time" }), ...pageParams],
        responses: { "200": ok(list("PublicAsset")), ...errors } } },
      "/openapi.json": { get: { operationId: "openapi", summary: "This document", security: [], responses: { "200": ok({ type: "object" }) } } },
    },
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "A SAM API token (SAM_API_TOKENS on the server, label:token). A signed-in browser session also works." } },
      schemas: {
        Asset: schemaOf(ASSET_COLS), Family: schemaOf(FAMILY_COLS), Change: schemaOf(CHANGE_COLS), PublicAsset: schemaOf(PUBLIC_COLS),
        Member: { type: "object", description: "An asset's family view: a subset of Asset.", properties: Object.fromEntries(MEMBER_COLS.split(",").map(n => [n, schemaOf(ASSET_COLS).properties[n]])) },
        Page: { type: "object", required: ["limit", "offset", "returned", "next_offset"], properties: { limit: { type: "integer" }, offset: { type: "integer" }, returned: { type: "integer" },
          total: { type: ["integer", "null"] }, next_offset: { type: ["integer", "null"], description: "Pass as offset for the next page; null at the end." } } },
        Error: { type: "object", required: ["error"], properties: { error: { type: "string" } } },
      },
      responses: {
        BadRequest: { description: "A parameter is wrong; error says which.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        Unauthorized: { description: "No or unknown bearer token.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        NotFound: { description: "No such id or key.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  };
}
