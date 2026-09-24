/** ponytail: one runnable check for card<->file merging (allAssets) across a SharePoint rename.
 *  node lib/cards.check.mjs   (from web/)  ->  throws if a rename detaches a card, twins stop
 *  collapsing, or binding changes anything when nothing was renamed.
 *  Runs the REAL cards.ts / caches via jiti, with Supabase replaced by a stubbed fetch. */
import assert from "node:assert";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@": web } });

process.env.SUPABASE_URL = "https://stub.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "stub";
let regRows = [], cardRows = [];
globalThis.fetch = async (url) => {
  const body = String(url).includes("sam_asset_cards") ? cardRows : regRows;
  return new Response(JSON.stringify(body), { status: 200 });
};

const { allAssets, trustNote, assetLink } = await jiti.import("./cards.ts");
const { refresh } = await jiti.import("./registry-cache.ts");
const { refreshCards } = await jiti.import("./cards-cache.ts");

const row = (item_id, folder, filename) => ({
  item_id, folder, filename, ext: filename.split(".").pop(), web_url: `https://propalmsnetwork.sharepoint.com/${item_id}`,
  created_at: "2024-01-01T00:00:00Z", modified_at: "2026-09-01T00:00:00Z", modified_by: "x",
  asset_type: ["Competitive"], industry: [], product: [], competitor: [], status: "active", deleted: false,
  list_item_id: 1, last_synced: null, suggest_ingest: true,
});
const card = (filename, item_id) => ({
  source: `sharepoint/${filename}`, filename, title: "Zeta vs Omega battlecard", asset_type: "Competitive",
  industry: "", client: "", products: [], competitors: [], personas: [], regulations: [],
  key_problem: "Omega needs a gateway", key_outcomes: ["24 capabilities compared"], brief: "Battlecard brief",
  use_for: "competitive deals", publish_year: "2024", expired: true, expiry_date: "2025-01-01", stale_risk: "",
  superseded_by: "", visibility: "internal", internal_reason: "", public_url: "", confidence: 0.9,
  needs_human: "", batch: "b", item_id,
});

async function load(reg, cards) {
  regRows = reg; cardRows = cards;
  globalThis.__samRegBusy = globalThis.__samCardsBusy = false;
  await refresh(); await refreshCards();
  // Only the fixture's assets; the frozen hand-written corpus has no "Zeta" in it.
  return allAssets().filter(a => /zeta/i.test(`${a.title} ${a.file?.path}`));
}
const view = xs => xs.map(a => ({ title: a.title, path: a.file?.path, link: assetLink(a), brief: a.brief, note: trustNote(a) }))
  .sort((a, b) => a.path.localeCompare(b.path));

const pdf = row("I1", "Competition", "Zeta vs Omega.pdf");
const pptx = row("I2", "Competition", "Zeta vs Omega.pptx");
const other = row("I3", "Competition", "Zeta roadmap.pdf");
const renamed = { ...pdf, filename: "Zeta vs Omega 2026 edition.pdf" };

// 1. Baseline: card + PDF + PPTX twin collapse to ONE asset, with the card's text and the verified link.
const base = await load([pdf, pptx, other], [card("Zeta vs Omega.pdf", "I1")]);
assert.equal(base.length, 2, "card, pdf and pptx twin collapse; roadmap separate");
const merged = base.find(a => a.brief);
assert.equal(assetLink(merged), "https://propalmsnetwork.sharepoint.com/I1");
assert.match(trustNote(merged), /^EXPIRED/);

// 2. Binding changes nothing when nothing was renamed: bound and unbound cards give identical output.
assert.deepEqual(view(await load([pdf, pptx, other], [card("Zeta vs Omega.pdf", null)])), view(base));

// 3. The bug, reproduced: an UNBOUND card after a rename splits in two - the described one has no link.
const bug = await load([renamed, other], [card("Zeta vs Omega.pdf", null)]);
assert.equal(bug.length, 3, "unbound: card and renamed file no longer merge");
assert.equal(assetLink(bug.find(a => a.brief)), null, "unbound: the described entry has no working link");

// 4. The fix: a BOUND card follows its file through the rename, keeping link, text and the expiry note.
const fixed = await load([renamed, other], [card("Zeta vs Omega.pdf", "I1")]);
assert.equal(fixed.length, 2, "bound: card merges with the renamed file");
const f = fixed.find(a => a.brief);
assert.equal(assetLink(f), "https://propalmsnetwork.sharepoint.com/I1");
assert.equal(f.file.path, "Competition/Zeta vs Omega 2026 edition.pdf", "rep is told the file's current name");
assert.match(trustNote(f), /^EXPIRED/, "expiry warning survives the rename");

// 5. Twins still collapse under a renamed binding when the twin is renamed the same way.
const both = await load([renamed, { ...pptx, filename: "Zeta vs Omega 2026 edition.pptx" }, other], [card("Zeta vs Omega.pdf", "I1")]);
assert.equal(both.length, 2, "renamed pdf+pptx twins still collapse with the card");

// 6. A bound card whose row was deleted falls back to its filename (old behaviour), not to nothing.
const gone = await load([pptx, other], [card("Zeta vs Omega.pdf", "I1")]);
assert.equal(gone.length, 2, "dead binding: card still collapses with the same-named pptx twin");

console.log("cards.check: ok");
