/** ponytail: one runnable check for the snapshot reconcile's diff and guards (diffSnapshot).
 *  node lib/snapshot.check.mjs   (from web/)  ->  throws if a guard stops refusing or the diff drifts.
 *  Runs the REAL sharepoint.ts via jiti; diffSnapshot is pure, so no network is touched. */
import assert from "node:assert";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));
const { diffSnapshot } = await createJiti(import.meta.url, { alias: { "@": web } }).import("./sharepoint.ts");

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

console.log("snapshot.check: ok");
