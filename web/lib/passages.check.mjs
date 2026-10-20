/** ponytail: one runnable check for the passages API (lib/passages.ts + token scopes in lib/apiauth.ts), no network.
 *  node lib/passages.check.mjs  (from web/)  ->  throws if a token without passages:internal ever gets an internal
 *  passage (also via a stale stored audience, by id, or with the kill switch on), audience=external returns anything
 *  without approval metadata, expired or superseded passages leak past the defaults, a served passage loses a
 *  contract field (text, doc id/version, locator, links, audience, sharing, freshness), bad input is not a 400, or
 *  an index that is not installed stops answering 404 + passages_api:false.
 *  Runs the REAL cards.ts / caches via jiti, with Supabase replaced by a stubbed fetch. */
import assert from "node:assert";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@": web } });
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

Object.assign(process.env, { SUPABASE_URL: "https://stub.supabase.co", SUPABASE_SERVICE_KEY: "stub",
  SAM_API_TOKENS: "dwight:tokA, sam-live:tokB:passages:internal ,web:tokC:passages:public+passages:internal" });
delete process.env.SAM_PASSAGES_INTERNAL; delete process.env.SAM_BUNDLED_CARDS;

// ---- fixtures: registry rows, cards, passages, one decided publish request
const reg = (item_id, folder, filename) => ({ item_id, folder, filename, ext: "pdf", web_url: `https://propalmsnetwork.sharepoint.com/sites/Company/${item_id}`,
  created_at: "2026-01-01T00:00:00Z", modified_at: "2026-09-01T00:00:00Z", modified_by: "x", asset_type: [], industry: [], product: [], competitor: [],
  status: "active", deleted: false, list_item_id: 1, last_synced: null, suggest_ingest: true });
const card = (source, item_id, o) => ({ source, filename: source.split("/").pop(), title: o.title, asset_type: o.type, industry: "", client: "",
  products: o.products ?? [], competitors: [], personas: [], regulations: [], key_problem: "", key_outcomes: [], brief: `${o.title} brief`, use_for: "",
  publish_year: o.year, expired: Boolean(o.expired), expiry_date: o.expired ? "2025-09-20" : null, stale_risk: "", superseded_by: o.superseded_by ?? "",
  visibility: o.url ? "both" : "internal", internal_reason: "", public_url: o.url ?? "", confidence: 0.9, needs_human: "", batch: "b", item_id });
const D26 = "sharepoint/Zeta HySecure Datasheet 2026.pdf", D24 = "sharepoint/Zeta HySecure Datasheet Old.pdf", HW = "public/Zeta HyWorks Brochure 2026.pdf",
  ISO = "sharepoint/Zeta ISO 27001 Certificate.pdf", GG = "public/Zeta Analyst Market Guide.pdf";
const REG = [reg("I1", "Datasheets", "Zeta HySecure Datasheet 2026.pdf"), reg("I2", "Brochures", "Zeta HyWorks Brochure 2026.pdf"),
  reg("I3", "Certificates", "Zeta ISO 27001 Certificate.pdf"), reg("I4", "Datasheets", "Zeta HySecure Datasheet Old.pdf"), reg("I5", "Analyst", "Zeta Analyst Market Guide.pdf")];
const CARDS = [
  card(D26, "I1", { title: "Zeta HySecure Datasheet 2026", type: "Datasheet", products: ["HySecure"], year: "2026" }),
  card(HW, "I2", { title: "Zeta HyWorks Brochure 2026", type: "Brochure", products: ["HyWorks"], year: "2026", url: "https://www.accops.com/zeta-hyworks.pdf" }),
  card(ISO, "I3", { title: "Zeta ISO 27001 Certificate", type: "Certification", year: "2022", expired: true }),
  card(D24, "I4", { title: "Zeta HySecure Datasheet Old", type: "Datasheet", products: ["HySecure"], year: "2024", superseded_by: `${D26} - newer edition` }),
  card(GG, "I5", { title: "Zeta Analyst Market Guide", type: "Analyst Report", year: "2025", url: "https://www.example-analyst.com/doc/123" }),
];
const P = (source, ordinal, audience, text, locator = { page: ordinal + 1 }) => ({ id: `${source}#${ordinal}`, source, item_id: null, doc_version: "v1",
  ordinal, locator, text, audience, extracted_at: "2026-10-17T01:00:00Z" });
const ROWS = [
  P(D26, 0, "internal", "Zeta HySecure checks device posture on Windows and macOS before it grants access to any application."),
  P(D26, 1, "internal", "Zeta posture rules can require disk encryption, antivirus and a domain-joined device."),
  P(D26, 2, "internal", "Zeta posture results are logged for every session and exported to the SIEM."),
  P(D26, 3, "public", "Zeta posture page that was public when it was indexed and is internal now."),
  P(D26, 4, "internal", "Zeta posture fifth passage from the same datasheet, beyond the per-document cap."),
  P(HW, 0, "public", "Zeta HyWorks delivers VDI and DaaS and checks device posture at every login."),
  P(ISO, 0, "internal", "Zeta ISO 27001 certificate covering posture management, valid until 20 September 2025."),
  P(D24, 0, "internal", "Zeta HySecure older edition: device posture on Windows only."),
  P(GG, 0, "public", "Zeta market guide: posture checks are table stakes for ZTNA vendors."),
];
const APPROVALS = [{ asset_title: "Zeta HyWorks Brochure 2026", asset_path: null, status: "published", decided_by: "siddharth", decided_at: "2026-10-01T10:00:00Z",
  public_url: "https://www.accops.com/zeta-hyworks.pdf" }];

const rpcCalls = []; let notInstalled = false;
globalThis.fetch = async (url, init = {}) => {
  const u = decodeURIComponent(String(url));
  const json = b => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  if (notInstalled && u.includes("sam_passages")) return new Response(JSON.stringify({ code: "PGRST202" }), { status: 404 });
  if (u.includes("rpc/sam_passages_search")) {
    const a = JSON.parse(init.body); rpcCalls.push(a);
    const words = a.p_query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    // The SQL filters on the STORED audience only; the API must re-check the live one.
    return json(ROWS.filter(r => a.p_audiences.includes(r.audience) && words.some(w => r.text.toLowerCase().includes(w))).map((r, i) => ({ ...r, rank: 1 / (i + 2) })));
  }
  if (u.includes("rpc/sam_passages_stats")) return json([{ built_at: "2026-10-17T01:00:00Z", documents: 5, passages: ROWS.length, internal_passages: 6 }]);
  if (u.includes("sam_publish_requests")) return json(APPROVALS);
  if (u.includes("sam_passages?")) {
    const src = u.match(/source=eq\.([^&]+)/)[1], lo = Number(u.match(/ordinal=gte\.(-?\d+)/)[1]), hi = Number(u.match(/ordinal=lte\.(\d+)/)[1]);
    return json(ROWS.filter(r => r.source === src && r.ordinal >= lo && r.ordinal <= hi));
  }
  if (u.includes("sam_asset_cards")) return json(CARDS);
  if (u.includes("sam_sharepoint_files")) return json(REG);
  return json([]);
};
const logs = []; const info = console.info; console.info = s => logs.push(String(s));

const { callerFromToken } = await jiti.import("./apiauth.ts");
const Pa = await jiti.import("./passages.ts");
const { refresh } = await jiti.import("./registry-cache.ts");
const { refreshCards } = await jiti.import("./cards-cache.ts");
await refresh(); await refreshCards();

// ---- token scopes (label:token:scope+scope)
const A = callerFromToken("Bearer tokA"), B = callerFromToken("Bearer tokB"), C = callerFromToken("Bearer tokC");
ok(A.id === "dwight" && A.scopes.length === 0 && B.id === "sam-live" && B.scopes.join() === "passages:internal", `scopes: ${JSON.stringify([A, B])}`);
ok(C.scopes.join() === "passages:public,passages:internal" && callerFromToken("Bearer passages") === null, "scope list; a scope is not a token");
ok(Pa.audiencesFor(A).join() === "public" && Pa.audiencesFor(B).join() === "public,internal", "no scope = public only");

const req = o => Pa.parseSearch({ query: "device posture", ...o });
const srcs = r => r.passages.map(p => p.doc.source);

// ---- public-only caller: never internal, not even a row whose stored audience says public
let r = await Pa.searchPassages(A, req({}), "rep1");
ok(rpcCalls.at(-1).p_audiences.join() === "public", "the database is asked for public rows only");
ok(r.passages.length > 0 && r.passages.every(p => p.audience === "public") && !srcs(r).includes(D26), `public only: ${srcs(r)}`);
const p0 = r.passages[0];
for (const k of ["passage_id", "text", "doc", "locator", "links", "audience", "sharing", "freshness", "score"]) ok(k in p0, `field ${k}`);
ok(p0.doc.doc_version === "v1" && p0.doc.asset_id && p0.doc.title && "item_id" in p0.doc && "family" in p0.doc && p0.locator.page === 1, `doc: ${JSON.stringify(p0.doc)}`);
ok(r.index.passages === ROWS.length && r.index.built_at && r.index.documents === 5, "index block");
ok(logs.some(l => l.includes('"on_behalf_of":"rep1"') && !l.includes("posture")), "on-behalf-of logged, the query text is not");

// ---- internal scope: internal passages with their SharePoint link; expired and superseded out by default
r = await Pa.searchPassages(B, Pa.parseSearch({ query: "hysecure device posture macos", k: 8 }));
ok(rpcCalls.at(-1).p_audiences.join() === "public,internal", "scoped token asks for both");
const top = r.passages[0];
ok(top.passage_id === `${D26}#0` && top.audience === "internal" && top.links.internal === "https://propalmsnetwork.sharepoint.com/sites/Company/I1" && top.links.public === null,
  `ranked + linked: ${JSON.stringify(top)}`);
ok(top.sharing.external_approved === false && top.sharing.basis === "none", "internal = not approved for sharing");
ok(top.freshness.expired === false && top.freshness.superseded === false && top.freshness.year === 2026 && top.freshness.indexed_at, `freshness: ${JSON.stringify(top.freshness)}`);
ok(!srcs(r).includes(ISO) && !srcs(r).includes(D24), "expired and superseded excluded by default");
ok(srcs(r).filter(s => s === D26).length <= 3, "at most 3 passages from one document");
ok(!r.passages.some(p => p.passage_id === `${D26}#3` && p.audience === "public"), "audience is the library's, not the stored one");

r = await Pa.searchPassages(B, req({ filters: { include_expired: true, current_editions_only: false } }));
const iso = r.passages.find(p => p.doc.source === ISO), old = r.passages.find(p => p.doc.source === D24);
ok(iso?.freshness.expired === true && /EXPIRED/.test(iso.freshness.trust_note), `expired on request: ${JSON.stringify(iso?.freshness)}`);
ok(old?.freshness.superseded === true && old.doc.family.superseded_by, `superseded on request: ${JSON.stringify(old?.doc.family)}`);

// ---- audience=external: approved only (an accops.com URL or a decided publish request; a third-party URL is not)
r = await Pa.searchPassages(B, req({ audience: "external" }));
ok(srcs(r).length && srcs(r).every(s => s === HW), `external = approved only: ${srcs(r)}`);
ok(r.passages[0].sharing.basis === "publish_request" && r.passages[0].sharing.approved_at === "2026-10-01T10:00:00Z" && r.passages[0].links.public, "approval metadata");
r = await Pa.searchPassages(A, req({}));
const gg = r.passages.find(p => p.doc.source === GG);
ok(gg && gg.audience === "public" && gg.sharing.external_approved === false && gg.sharing.basis === "none", "a public URL elsewhere is not approval");

// ---- filters
r = await Pa.searchPassages(B, req({ filters: { products: ["HyWorks"] } }));
ok(srcs(r).every(s => s === HW), "product filter");
r = await Pa.searchPassages(B, req({ filters: { asset_types: ["Datasheet"] } }));
ok(srcs(r).length && srcs(r).every(s => s === D26), "type filter");

// ---- kill switch: nothing internal, whatever the scope
process.env.SAM_PASSAGES_INTERNAL = "0";
r = await Pa.searchPassages(B, req({}));
ok(rpcCalls.at(-1).p_audiences.join() === "public" && r.passages.every(p => p.audience === "public") && r.policy.internal_passages === false, "kill switch");
ok(await Pa.getPassage(B, `${D26}#1`) === null, "kill switch covers reads by id");
delete process.env.SAM_PASSAGES_INTERNAL;

// ---- by id: invisible = not found; neighbours for context
ok(await Pa.getPassage(A, `${D26}#1`) === null, "an internal id is not found for a public-only caller");
const one = await Pa.getPassage(B, `${D26}#1`);
ok(one.passage.passage_id === `${D26}#1` && one.neighbours.map(x => x.passage_id).join() === `${D26}#0,${D26}#2`, `neighbours: ${JSON.stringify(one.neighbours.map(x => x.passage_id))}`);

// ---- input and the HTTP envelope
for (const [o, re] of [[{ query: "" }, /query/], [{ query: "x", k: 0 }, /k must/], [{ query: "x", k: 21 }, /k must/], [{ query: "x", audience: "customer" }, /audience/],
  [{ query: "x", filters: { products: "HySecure" } }, /products/], [{ query: "x", filters: { min_year: 20 } }, /min_year/], [{ query: "x", filters: { include_expired: "yes" } }, /include_expired/]]) {
  let e; try { Pa.parseSearch(o); } catch (x) { e = x; }
  ok(e instanceof Pa.BadRequest && re.test(e.message), `400: ${JSON.stringify(o)} -> ${e?.message}`);
}
const call = (method, body, path = "") => new Request(`https://sam.test/api/v1/passages${path}`, { method, headers: { authorization: "Bearer tokB", "content-type": "application/json", "x-sam-on-behalf-of": "rep2" }, body });
let res = await Pa.searchRoute(call("POST", JSON.stringify({ query: "device posture", k: 3 })));
ok(res.status === 200 && res.headers.get("x-passages-version") === "1" && (await res.json()).passages.length <= 3, "POST 200");
res = await Pa.searchRoute(call("GET", undefined, "?q=device%20posture&k=2&audience=external"));
ok(res.status === 200 && (await res.json()).passages.every(p => p.sharing.external_approved), "GET ?q= with audience");
ok((await Pa.searchRoute(call("POST", "not json"))).status === 400, "bad body 400");
ok((await Pa.searchRoute(call("GET", undefined, "?q=x&include_expired=maybe"))).status === 400, "bad query param 400");
notInstalled = true;
res = await Pa.searchRoute(call("POST", JSON.stringify({ query: "device posture" })));
const body = await res.json();
ok(res.status === 404 && body.passages_api === false, `not installed: ${res.status} ${JSON.stringify(body)}`);
notInstalled = false;

console.info = info;
console.log(`passages check: ${n} assertions ok`);
