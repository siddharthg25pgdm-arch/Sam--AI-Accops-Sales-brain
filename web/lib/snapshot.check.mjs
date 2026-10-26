/** ponytail: one runnable check for the snapshot reconcile's diff and guards (diffSnapshot).
 *  node lib/snapshot.check.mjs   (from web/)  ->  throws if a guard stops refusing or the diff drifts.
 *  Runs the REAL sharepoint.ts via jiti; diffSnapshot is pure, so no network is touched. */
import assert from "node:assert";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));
const { diffSnapshot, isNewer } = await createJiti(import.meta.url, { alias: { "@": web } }).import("./sharepoint.ts");

// 100 live rows with list item ids 1..100, one tombstoned row (id 500), one row the flow never gave an id.
const rows = Array.from({ length: 100 }, (_, i) => ({ item_id: `g${i + 1}`, list_item_id: i + 1, folder: "F", filename: `f${i + 1}.pdf`, deleted: false }));
rows.push({ item_id: "dead", list_item_id: 500, folder: "F", filename: "back.pdf", deleted: true });
rows.push({ item_id: "noid", list_item_id: null, folder: "F", filename: "noid.pdf", deleted: false });
const live = rows.filter(r => !r.deleted).length; // 101
const file = id => ({ id, name: `f${id}.pdf`, path: "Shared Documents/Sales/Sales Collateral/F/", isFolder: false });
const snap = (ids, extra = {}) => {
  const files = [...ids.map(file), { id: 9999, name: "F", path: "", isFolder: true }]; // folders are ignored
  return { complete: true, count: files.length, files, ...extra };
};
const ids = n => Array.from({ length: n }, (_, i) => i + 1);

// Happy path: 3 files gone, the tombstoned one back, one new file unknown to the registry. Ids arrive as strings too.
let d = diffSnapshot(rows, snap([...ids(100).filter(i => ![7, 8, 9].includes(i)).map(String), 500, 777]));
assert.equal(d.refused, null);
assert.deepEqual(d.tombstone.map(r => r.list_item_id), [7, 8, 9]);
assert.deepEqual(d.restore.map(r => r.item_id), ["dead"]);
assert.deepEqual(d.unknown.map(f => f.id), [777]);
assert.equal(d.unverifiable, 1, "row without list_item_id is never tombstoned");
assert.ok(!d.tombstone.some(r => r.item_id === "noid"));

// Idempotent: the same snapshot after applying it changes nothing more.
const applied = rows.map(r => [7, 8, 9].includes(r.list_item_id) ? { ...r, deleted: true } : r.list_item_id === 500 ? { ...r, deleted: false } : r);
d = diffSnapshot(applied, snap([...ids(100).filter(i => ![7, 8, 9].includes(i)), 500]));
assert.equal(d.refused, null); assert.equal(d.tombstone.length, 0); assert.equal(d.restore.length, 0);

// Guards - every one must refuse, and a refusal still reports what it would have done.
const refuses = (s, re, msg) => { const r = diffSnapshot(rows, s); assert.match(r.refused ?? "", re, msg); return r; };
refuses({ complete: true, count: 0, files: [] }, /0 files/, "empty snapshot");
refuses({ complete: true, count: 0 }, /no files array/, "missing files");
refuses(snap(ids(100), { complete: false }), /not marked complete/, "pagination not confirmed");
refuses(snap(ids(100), { complete: undefined }), /not marked complete/, "complete flag absent");
refuses(snap(ids(100), { count: 5000 }), /does not match/, "truncated body");
refuses(snap(ids(100), { count: undefined }), /does not match/, "count absent");
refuses(snap([...ids(99), "abc"]), /no numeric list item id/, "bad id mapping");
refuses(snap(ids(4999)), /pagination cap/, "4999 files + 1 folder = 5000 raw items: possibly cut off");
refuses(snap(ids(90)), /under 90%/, "90 of 101 live is under 90%");
const wrong = refuses(snap(Array.from({ length: 100 }, (_, i) => 1000 + i)), /wrong folder/, "right size, wrong ids");
assert.equal(wrong.tombstone.length, 100, "a refused wrong-library snapshot would have tombstoned everything");
// 91 ids is >= 90% of 101 live by count, and 91 of 100 checkable matched: allowed, 9 tombstoned.
d = diffSnapshot(rows, snap(ids(91)));
assert.equal(d.refused, null); assert.equal(d.tombstone.length, 9);
// The failure mode from 8 September: a failed listing that came back empty-but-marked-complete.
refuses({ complete: true, count: 1, files: [{ id: 1, isFolder: "true" }] }, /0 files/, "only folders = empty");

// applySnapshot's writes, against a stubbed Supabase: exact list_item_id filters, soft delete, and the
// sync stamp - last_run only when a write actually applied, last_result always.
const { applySnapshot } = await createJiti(import.meta.url, { alias: { "@": web } }).import("./sharepoint.ts");
process.env.SUPABASE_URL = "https://stub.supabase.co"; process.env.SUPABASE_SERVICE_KEY = "stub";
let calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: decodeURIComponent(String(url)), method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null });
  return init.method === "PATCH" ? new Response(null, { status: 204 }) : new Response(JSON.stringify(rows), { status: 200 });
};
const good = snap([...ids(100).filter(i => ![7, 8, 9].includes(i)), 500]);
let r = await applySnapshot({ ...good, mode: "write" });
let patches = calls.filter(c => c.method === "PATCH");
assert.ok(r.ok && r.applied);
assert.ok(patches[0].url.includes("deleted=is.false&list_item_id=in.(7,8,9)") && patches[0].body.deleted === true && patches[0].body.deleted_at);
assert.ok(patches[1].url.includes("deleted=is.true&list_item_id=in.(500)") && patches[1].body.deleted === false && patches[1].body.deleted_at === null);
assert.ok(patches[2].url.includes("sam_sharepoint_sync?scope=eq.sales") && patches[2].body.last_run && /3 tombstoned/.test(patches[2].body.last_result));
for (const s of [{ ...good, mode: "report" }, { ...good }, { ...snap(ids(10)), mode: "write" }]) {
  calls = [];
  r = await applySnapshot(s);
  patches = calls.filter(c => c.method === "PATCH");
  assert.equal(patches.length, 1, "report / refused: only the sync row is touched");
  assert.ok(!("last_run" in patches[0].body) && patches[0].body.last_result, "no last_run without an applied write");
}
assert.match(r.result, /REFUSED/);

// ---- Several ingestion roots (docs/supabase-sam-ingest-roots.sql): one root's failure stays its own.
const { rootOf, planSnapshot } = await createJiti(import.meta.url, { alias: { "@": web } }).import("./sharepoint.ts");
const ROOTS = [
  { key: "sales-collateral", label: "Sales Collateral", library_path: "Shared Documents/Sales/Sales Collateral", onedrive_folder: "x", trust_file_dates: true, enabled: true },
  { key: "sales-enablement", label: "Other Sales Tools/2025_Sales Enablement", library_path: "Shared Documents/Sales/Other Sales Tools/2025_Sales Enablement", onedrive_folder: "y", trust_file_dates: false, enabled: true },
  { key: "paused", label: "P", library_path: "Shared Documents/Paused", onedrive_folder: null, trust_file_dates: true, enabled: false },
];
assert.deepEqual(rootOf("Shared Documents/Sales/Sales Collateral/Competition/", ROOTS), { root: "sales-collateral", folder: "Competition" }, "flow {Path}, trailing slash");
assert.deepEqual(rootOf("Sales/Sales Collateral", ROOTS), { root: "sales-collateral", folder: "" }, "without the library, at the root");
assert.deepEqual(rootOf("/sites/Company/Shared Documents/Sales/Other Sales Tools/2025_Sales Enablement/Industries/Banking", ROOTS),
  { root: "sales-enablement", folder: "Industries/Banking" }, "server-relative FileDirRef");
assert.equal(rootOf("shared documents/sales/sales collateralX/a", ROOTS), null, "a sibling folder with the same prefix is not inside");
assert.equal(rootOf("Shared Documents/Sales/Other Sales Tools/Other folder/a.pdf", ROOTS), null, "the rest of Other Sales Tools is outside");
assert.equal(rootOf("Shared Documents/Paused/a", ROOTS), null, "a disabled root takes nothing");
assert.deepEqual(rootOf("Shared Documents/Sales/Sales Collateral/Inner", [...ROOTS, { ...ROOTS[0], key: "inner", library_path: "Shared Documents/Sales/Sales Collateral/Inner" }]),
  { root: "inner", folder: "" }, "the longest root wins");

const SC = "Shared Documents/Sales/Sales Collateral/F/", SE = "Shared Documents/Sales/Other Sales Tools/2025_Sales Enablement/Industries/Banking/";
// Registry: 100 Sales Collateral rows (ids 1..100, no root column = the default root) and 20 Sales Enablement rows (ids 201..220).
const multi = [...rows.filter(r => r.list_item_id !== 500 && r.item_id !== "noid"),
  ...Array.from({ length: 20 }, (_, i) => ({ item_id: `e${i}`, list_item_id: 201 + i, root: "sales-enablement", folder: "Industries/Banking", filename: `e${i}.pdf`, deleted: false }))];
const mfile = (id, path, extra = {}) => ({ id, name: `n${id}.pdf`, path, isFolder: false, ...extra });
const msnap = files => ({ complete: true, count: files.length, files });
const scFiles = ids(100).map(i => mfile(i, SC)), seFiles = Array.from({ length: 20 }, (_, i) => mfile(201 + i, SE));

// Sales Enablement's listing came back empty (a filter typo in the flow): it alone is refused; Sales Collateral still reconciles.
let p = planSnapshot(multi, msnap([...scFiles.filter(f => f.id !== 5), mfile(7777, "Shared Documents/Elsewhere/")]), ROOTS);
const pr = k => p.roots.find(x => x.root === k);
assert.equal(p.refused, null);
assert.deepEqual(pr("sales-collateral").diff.tombstone.map(r => r.list_item_id), [5], "the healthy root tombstones its own deletion");
assert.match(pr("sales-enablement").diff.refused ?? "", /0 files/, "the empty root is refused, not emptied");
assert.equal(p.outside, 1, "a file under no root is counted, never applied");
assert.ok(!p.roots.some(x => x.root === "paused"), "disabled roots are not reconciled");

// A body-level failure refuses every root.
assert.match(planSnapshot(multi, { ...msnap([...scFiles, ...seFiles]), complete: false }, ROOTS).refused, /not marked complete/);

// A file moved from Sales Collateral to Sales Enablement is re-filed, not tombstoned; a new file is added only with a url.
p = planSnapshot(multi, msnap([...scFiles.filter(f => f.id !== 9), ...seFiles, mfile(9, SE + "Moved/"), mfile(300, SE, { url: "https://propalmsnetwork.sharepoint.com/x.pdf" }), mfile(301, SE)]), ROOTS);
assert.deepEqual(pr("sales-collateral").diff.tombstone, [], "a move is not a deletion");
assert.deepEqual(pr("sales-collateral").moved.map(m => [m.list_item_id, m.to.root, m.to.folder]), [[9, "sales-enablement", "Industries/Banking/Moved"]]);
assert.deepEqual(pr("sales-enablement").diff.unknown.map(f => f.id), [300, 301], "a moved file is not unknown in its new root");
assert.equal(pr("sales-enablement").folderOf.get(300), "Industries/Banking");

// Missed edits: the listing says a file changed after the registry last heard (or was renamed in place) -> bring the row forward.
const dated = multi.map(r => ({ ...r, modified_at: "2026-10-01T00:00:00Z" }));
p = planSnapshot(dated, msnap([...scFiles.map(f => f.id === 3 ? { ...f, name: "f3.pdf", modified: "2026-10-09T03:51:12Z" }
  : f.id === 4 ? { ...f, name: "renamed.pdf", modified: "2026-10-01T00:00:30Z" } : { ...f, name: `f${f.id}.pdf`, modified: "2026-10-01T00:00:00Z" }), ...seFiles]), ROOTS);
assert.deepEqual(pr("sales-collateral").behind.map(b => [b.list_item_id, b.to.modified_at, b.to.filename]),
  [[3, "2026-10-09T03:51:12Z", "f3.pdf"], [4, "2026-10-01T00:00:00Z", "renamed.pdf"]], "an edit and an in-place rename are caught; 30 s of clock noise is not an edit");
assert.equal(pr("sales-enablement").behind.length, 0, "no `modified` in the listing (today's flow): nothing is inferred");

// applySnapshot end to end against the stub: per-root PATCH filters, seeding, and last_run held back while any root is refused.
globalThis.__samRoots = undefined;
const stub = (registryRows) => { calls = []; globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: decodeURIComponent(String(url)), method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null });
  if (init.method && init.method !== "GET") return new Response(null, { status: 204 });
  return new Response(JSON.stringify(String(url).includes("sam_ingest_roots") ? ROOTS : registryRows), { status: 200 });
}; };
stub(multi);
r = await applySnapshot({ ...msnap([...scFiles.filter(f => f.id !== 5), ...seFiles.filter(f => f.id !== 210),
  mfile(300, SE, { url: "https://propalmsnetwork.sharepoint.com/sites/Company/Shared%20Documents/x.pdf", modified: "2026-01-15T09:43:26Z", editor: "A" })]), mode: "write" });
assert.ok(r.ok && r.applied, r.result);
const writes = calls.filter(c => c.method !== "GET");
assert.ok(writes.some(c => c.method === "PATCH" && c.url.includes("root=eq.sales-collateral&deleted=is.false&list_item_id=in.(5)")));
assert.ok(writes.some(c => c.method === "PATCH" && c.url.includes("root=eq.sales-enablement&deleted=is.false&list_item_id=in.(210)")));
const seed = writes.find(c => c.method === "POST").body[0];
assert.deepEqual([seed.item_id, seed.root, seed.folder, seed.list_item_id, seed.last_synced, seed.suggest_ingest], ["li:300", "sales-enablement", "Industries/Banking", 300, "2026-01-15T09:43:26Z", true],
  "a seeded row: li:<id>, its root and folder, the file's own date as last_synced");
assert.match(r.result, /^snapshot write: 2 tombstoned, 0 restored, 119 listed, 1 unknown, 1 added \| sales-collateral: .* \| sales-enablement: /, r.result);
assert.ok(writes.at(-1).url.includes("sam_sharepoint_sync") && writes.at(-1).body.last_run, "every root applied: last_run stamped");

stub(multi);
r = await applySnapshot({ ...msnap(scFiles), mode: "write" });
assert.ok(!r.ok && !r.applied && /sales-enablement REFUSED/.test(r.result), r.result);
const sync = calls.filter(c => c.url.includes("sam_sharepoint_sync")).at(-1);
assert.ok(!("last_run" in sync.body), "a refused root holds last_run back, so the 36-hour banner keeps firing");
assert.match(r.result, /^snapshot write: 0 tombstoned/, "the healthy root's totals are still reported");

// Date-only registry values (bulk-seeded at 00:00 UTC) are not edits when SharePoint has the time of day.
assert.equal(isNewer("2021-07-16T12:38:08Z", "2021-07-16T00:00:00+00:00"), false, "same day, date-only registry");
assert.equal(isNewer("2021-07-16T23:30:00Z", "2021-07-16T00:00:00+00:00"), false, "within 24 h of a date-only value");
assert.equal(isNewer("2021-07-18T09:00:00Z", "2021-07-16T00:00:00+00:00"), true, "a later day is an edit");
assert.equal(isNewer("2026-10-21T09:55:00Z", "2026-10-21T09:53:01+00:00"), true, "precise values: over a minute is an edit");
assert.equal(isNewer("2026-10-21T09:53:30Z", "2026-10-21T09:53:01+00:00"), false, "precise values: under a minute is not");

console.log("snapshot.check: ok");
