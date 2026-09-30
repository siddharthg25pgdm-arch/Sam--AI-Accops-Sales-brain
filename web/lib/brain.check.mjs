/** ponytail: one runnable check for the Sales Brain API (lib/brain.ts), no network.
 *  node lib/brain.check.mjs  (from web/)  ->  throws if a query parameter stops mapping to the right
 *  PostgREST filter, bad input stops being a 400, the envelope or the changes cursor changes shape, a
 *  column is served that the contract does not list, the public list grows a sensitive column, the
 *  OpenAPI document has a dangling $ref, or docs/sales-brain-openapi.json is stale
 *  (fix: node scripts/brain-openapi.mjs). */
import assert from "node:assert";
import fs from "node:fs";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@": web } });
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const throws = (f, re, m) => { let e; try { f(); } catch (x) { e = x; } ok(e && re.test(e.message) && e.constructor.name === "BadRequest", `${m}: ${e?.message}`); };

Object.assign(process.env, { SUPABASE_URL: "https://stub.supabase.co", SUPABASE_SERVICE_KEY: "stub" });
const calls = [];
let reply = () => [];
globalThis.fetch = async (url, init = {}) => {
  const u = decodeURIComponent(String(url));
  calls.push({ u, prefer: init.headers?.Prefer });
  return new Response(JSON.stringify(reply(u)), { headers: { "content-type": "application/json", "content-range": "0-1/7" } });
};
const B = await jiti.import("./brain.ts");
const P = (s) => new URLSearchParams(s);

// ---- parameters
ok(JSON.stringify(B.page(P(""))) === JSON.stringify({ limit: 50, offset: 0 }), "default page");
throws(() => B.page(P("limit=0")), /limit/, "limit 0 is refused");
throws(() => B.page(P("limit=201")), /limit/, "limit over 200 is refused");
throws(() => B.page(P("offset=-1")), /offset/, "negative offset is refused");
throws(() => B.since("yesterday"), /ISO 8601/, "since must be a timestamp");
ok(B.since("2026-09-30T12:00:00.123456+00:00") === "2026-09-30T12:00:00.123456+00:00", "since keeps microseconds (a rounded cursor re-sends or skips rows)");
const f = B.assetFilters(P("type=Case Study&industry=bfsi&product=HySecure&family=hysecuredatasheet&visibility=public&current=true&eligible=false&since=2026-09-01T00:00:00Z")).map(decodeURIComponent);
ok(f.includes("asset_type=ilike.Case Study") && f.includes("industry=ilike.bfsi") && f.includes('products=cs.{"HySecure"}') && f.includes("family_key=eq.hysecuredatasheet")
  && f.includes("visibility=eq.public") && f.includes("is_current=is.true") && f.includes("eligible=is.false") && f.includes("updated_at=gte.2026-09-01T00:00:00Z"), `filters: ${f.join(" & ")}`);
throws(() => B.assetFilters(P("visibility=secret")), /visibility/, "visibility is public or internal");
throws(() => B.assetFilters(P("current=yes")), /current must be true or false/, "booleans are true/false");
ok(B.inList(['id:a', 'path:public/x "y".pdf']) === '("id:a","path:public/x \\"y\\".pdf")', "in-lists quote and escape");

// ---- list envelope
reply = () => [{ asset_id: "id:1" }, { asset_id: "id:2" }];
let r = await B.listAssets(P("limit=2&current=true"));
const q1 = calls.at(-1);
ok(q1.u.includes("sam_v1_assets?select=asset_id,item_id,") && q1.u.includes("&is_current=is.true") && q1.u.includes("&order=title,asset_id&limit=2&offset=0") && q1.prefer === "count=exact", `assets query: ${q1.u}`);
ok(r.data.length === 2 && r.page.total === 7 && r.page.next_offset === 2 && r.page.returned === 2, `envelope: ${JSON.stringify(r.page)}`);
r = await B.listAssets(P("since=2026-09-01T00:00:00Z"));
ok(calls.at(-1).u.includes("order=updated_at.asc.nullsfirst,asset_id"), "since orders oldest change first");
reply = () => [];
r = await B.listPublic(P("limit=5&offset=5"));
ok(calls.at(-1).u.startsWith("https://stub.supabase.co/rest/v1/sam_v1_public_assets?select=asset_id,family_key,edition,title,") && r.page.next_offset === null, "public list reads only the public view");
ok(await B.getAsset("id:none") === null, "an unknown asset is null (404)");

// ---- changes cursor
reply = () => [{ change_id: "log:000000000001", at: "2026-09-30T10:00:00.000001+00:00" }, { change_id: "log:000000000002", at: "2026-09-30T10:00:00.000002+00:00" }];
r = await B.listChanges(P("since=2026-09-30T09:00:00Z&after=log:000000000000&limit=2&entity=file"));
const c = calls.at(-1).u;
ok(c.includes('or=(at.gt."2026-09-30T09:00:00Z",and(at.eq."2026-09-30T09:00:00Z",change_id.gt."log:000000000000"))') && c.includes("entity=eq.file") && c.includes("order=at.asc,change_id.asc&limit=2"), `changes query: ${c}`);
ok(r.next.since === "2026-09-30T10:00:00.000002+00:00" && r.next.after === "log:000000000002" && r.page.more === true, "next cursor = the last row, verbatim");
const rejects = async (p, re, m) => { let e; try { await p; } catch (x) { e = x; } ok(e && re.test(e.message) && e.constructor.name === "BadRequest", `${m}: ${e?.message}`); };
await rejects(B.listChanges(P("after=log:1")), /after needs since/, "after without since is refused");
await rejects(B.listChanges(P("entity=user")), /entity/, "entity is file, card, request or answer");
reply = () => [];
r = await B.listChanges(P("since=2026-09-30T09:00:00Z"));
ok(r.data.length === 0 && r.next.since === "2026-09-30T09:00:00Z" && r.page.more === false, "an empty poll hands the same cursor back");

// ---- the contract: columns, public surface, OpenAPI
const names = cols => cols.map(c => c.name);
ok(!names(B.ASSET_COLS).includes("client_actual"), "real customer names are never served");
for (const bad of ["client_actual", "needs_human", "internal_reason", "sharepoint_url", "key_problem", "use_for", "stale_risk", "folder", "modified_by"])
  ok(!names(B.PUBLIC_COLS).includes(bad), `the public list has no ${bad}`);
ok(B.ASSET_COLS.every(c => c.doc && c.doc.length > 5) && B.FAMILY_COLS.every(c => c.doc) && B.CHANGE_COLS.every(c => c.doc), "every served column is documented");
const doc = B.openapi(), refs = JSON.stringify(doc).match(/"#\/components\/(schemas|responses)\/[A-Za-z]+"/g) ?? [];
ok(doc.openapi === "3.1.0" && refs.length > 5 && refs.every(x => { const [, kind, name] = x.slice(1, -1).match(/components\/(\w+)\/(\w+)/); return doc.components[kind][name]; }), "OpenAPI 3.1 with no dangling $ref");
ok(Object.keys(doc.components.schemas.Asset.properties).join() === names(B.ASSET_COLS).join(), "the Asset schema is the served column list");
ok(["/assets", "/assets/{id}", "/families/{key}", "/changes", "/public-assets", "/openapi.json"].every(p => doc.paths[p]), "every route is in the spec");
const saved = fs.readFileSync(new URL("../../docs/sales-brain-openapi.json", import.meta.url), "utf8").replace(/\r\n/g, "\n");   // git may check it out CRLF
ok(saved === JSON.stringify(doc, null, 2) + "\n", "docs/sales-brain-openapi.json is current (run node scripts/brain-openapi.mjs)");

console.log(`brain.check: ${n} assertions passed`);
