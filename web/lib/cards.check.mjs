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

// 7. Two differently-named documents behind ONE public URL collapse to one, the richer card winning,
//    even when the URLs differ in case, encoding or query string. The pdf/pptx twin collapse still holds.
const pub = (filename, url, brief) => ({ ...card(filename, null), title: filename.replace(/\.\w+$/, ""), visibility: "both", public_url: url, expired: false, brief });
const url = await load([pdf, pptx, other], [
  card("Zeta vs Omega.pdf", "I1"),
  pub("Zeta Bank Study.pdf", "https://downloads.accops.com/Zeta%20Bank.pdf", "short"),
  pub("Zeta Two Banks.pdf", "https://DOWNLOADS.accops.com/zeta bank.pdf?utm=x", "a much longer and richer brief about two zeta banks"),
]);
assert.equal(url.length, 3, "public-url twins collapse; battlecard group and roadmap untouched");
const shared = url.filter(a => a.public_url);
assert.equal(shared.length, 1);
assert.equal(shared[0].title, "Zeta Two Banks", "richer card wins");

// 8. Tokenisation: word-start matching, "SOC 2" as a phrase, stopwords, type words.
const { queryTokens, searchAssets } = await jiti.import("./cards.ts");
assert.deepEqual(queryTokens("do we have a SOC 2 report?"), ["soc 2", "report"]);
assert.deepEqual(queryTokens("Accops vs Forcepoint"), ["forcepoint"]);
assert.deepEqual(queryTokens("2fa for AI"), ["2fa", "ai"]);
await load([
  row("S1", "Brand", "Social-Media-Zeta-Banner.png"), row("S2", "Compliance", "Zeta SOC2 attestation.pdf"),
  row("S3", "Compliance", "Zeta SOC overview.pdf"), row("S4", "Analyst", "Quarterly report.pdf"),
  row("S5", "Competition", "Zeta vs Omega.pdf"), row("S6", "Pharma", "Zeta pharmaceutical brochure.pdf"),
], []);
const titles = q => searchAssets({ query: q, limit: 10 }).results.map(r => r.asset.title);
assert.deepEqual(titles("SOC 2"), ["Zeta SOC2 attestation"], "soc 2 is a phrase; social banners and plain SOC do not match");
assert.ok(titles("soc").includes("Zeta SOC overview") && !titles("soc").includes("Social-Media-Zeta-Banner"), "soc does not match social");
assert.ok(titles("omega report").every(t => /omega/i.test(t)), "a type word alone does not qualify an asset");
assert.ok(titles("Accops vs Omega").every(t => /omega/i.test(t)), "accops and vs are stopwords");
assert.ok(titles("pharma").includes("Zeta pharmaceutical brochure"), "long tokens prefix-match");
assert.ok(titles("zeta brochures").includes("Zeta pharmaceutical brochure"), "plural type word still matches");

// 9. A Deck filter includes battlecards (a battlecard is a deck to a rep).
assert.ok(searchAssets({ query: "omega", asset_type: "Deck", limit: 10 }).results.some(r => r.asset.title === "Zeta vs Omega"), "deck filter keeps battlecards");

console.log("cards.check: ok");
