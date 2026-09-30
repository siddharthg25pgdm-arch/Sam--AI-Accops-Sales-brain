/** ponytail: one runnable check for document families and answer eligibility.
 *  node lib/family.check.mjs   (from web/)  ->  throws if:
 *    1. real-looking filenames stop grouping (version bumps, date prefixes, Big/Small, PDF/PPTX twins,
 *       Confidential/Sharable, English/Japanese) or different documents start merging;
 *    2. the canonical stops being the newest (card year, then version, then modified), a hand-set
 *       superseded_by stops winning, or an edition sibling takes a slot it should not;
 *    3. the pre-2024 rule breaks: a 2021 deck answers, the ISO certificate or a 2020 regulation stops
 *       answering, a pin stops working, or an excluded battlecard comes back as a substitute.
 *  The SQL mirror (docs/supabase-sam-asset-families.sql) must give the same answers: after changing
 *  either side run `node scripts/family-parity.mjs` (live; every filename and shared asset), and the
 *  SAME / DIFFERENT pairs through `select sam_family_key(x) from unnest(array[...]) x`. */
import assert from "node:assert";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@": web } });
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const { parseName, familyKey, families } = await jiti.import("./family.ts");

// ---- 1. Normalisation, on names shaped like the real library's.
export const SAME = [
  ["Accops - Turbo Architecture-v1.pdf", "Accops - Turbo Architecture-v2.pptx"],                         // version bump + twin
  ["Accops_Forcepoint_Webinar_v03.pptx", "Accops_Forcepoint_Webinar_v04.pptx"],
  ["Accops Customer Deck SEA 1.0.pptx", "Accops Customer Deck SEA Compressed V2.0.pptx"],                 // bare 1.0, compressed
  ["2022-11-30-Accops vs other VDI providers.pptx", "2026-06-11-Accops vs other VDI providers.pptx"],     // date prefixes
  ["2021-01-01-Accops-MS-WVD.docx", "2021-01-01-Accops-MS-WVD.pdf"],
  ["0424-VMWare Alternative stack-Accops and Nutanix.pptx", "VMWare Alternative stack-Accops and Nutanix.pptx"], // MMYY prefix
  ["Accops - HySecure - Product-v2 - Big.pdf", "Accops - HySecure - Product-v2 - Small.pptx"],           // Big / Small
  ["Accops-Corporate Deck-Aug2025.pdf", "Accops Corporate Deck - 25 Aug 2026.pptx"],                     // month + year
  ["Accops Reference Customers Feb_2025_Updated.pptx", "Accops Reference Customers Sept_2022.pptx"],
  ["251029-Confidential-Accops-CustomerWorkshop-Event-Deck-2Hour-HDFC.pptx", "251029-Sharable-Accops-CustomerWorkshop-Event-Deck-2Hour-HDFC.pptx"],
  ["v2026-06-30-Confidential-Accops Partner Bootcamp Event Deck 4Hour 2026- Final Version.pptx", "1009_Accops-JP-PartnerBootcamp-Event-Deck-4Hour-Oct2025_final.pptx"],
  ["Accops Nutanix .Next Tokyo 2026 - English v4.pptx", "Accops Nutanix .Next Tokyo 2026 - Japanese v4 with Videos.pptx"],
  ["Hydesk+6000+V3 (1).pdf", "Hydesk+6000+V3.pdf"],                                                       // Windows duplicate
  ["Accops-Nutanix-DotNext-Event_May 2024 _SUBMITTED FILE.pptx", "Accops-Nutanix-DotNext-Event.pptx"],
  ["Vanquishing VMware - Battlecard - 05082022.pdf", "Vanquishing VMware - Battlecard.pdf"],               // DDMMYYYY
  ["Accops DaaS Calculator v-2.3.xlsx", "Accops DaaS Calculator v-2.4.xlsx"],
  ["Accops Product Editions 2025.V2.October.pdf", "Accops Product Editions 2026.pdf"],
  ["Win 10 EOL Webinar Version 3.1pptx.pptx", "Win 10 EOL Webinar.pptx"],
  ["z__Outdated__Accops NIC PPT 04 Feb.pptx", "Accops NIC PPT.pptx"],
];
export const DIFFERENT = [
  ["Accops Hysecure Datasheet V5 2026.pdf", "Accops HyID Datasheet.V5 2026.pdf"],                       // product
  ["Accops -  Industry Solution - Government.pptx", "Accops Defence Brochure Nov 25 V4.pdf"],
  ["CIO Event Bangalore V1.0.pptx", "CIO Event Chennai V1.0.pptx"],                                       // city
  ["Accops-Event-TechDeck-15min-Sep25.pptx", "Accops-Global-Event-Deck-45min-Sep25.pptx"],               // length
  ["DQ Dec 2022 _Straive.pdf", "DQ Nov 2022 _Ecom Express.pdf"],                                         // customer
  ["for ICICI - Omnissa Horizon VVF Analysis.pptx", "Omnissa Horizon VVF Analysis.docx"],                 // customised copy
  ["GPI_ReviewSnippet_4454492_18082023.png", "GPI_ReviewSnippet_4483976_18082023.png"],                   // ids, not dates
  ["Magic_Quadrant_for_D_785003_ndx.pdf", "Magic_Quadrant_for_D_802050_ndx.pdf"],
  ["Virtual bg (14).jpg", "Virtual bg (24).jpg"],                                                         // numbered, not a duplicate
  ["accops_logo@2x.png", "accops_logo@2x.jpg"],                                                           // format a designer picks
  ["Accops VDI for Graphics Workstation-v3 -Internal-Training.pptx", "Accops VDI for Graphics Workstation-v3.pdf"],
  ["BOTS Slot - 3.pdf", "BOTS Slot - 4.pdf"],
  ["Accops HyID Datasheet.V5 2026.pdf", "HyID_V2.PNG"],                                                   // a logo is not a datasheet
  ["Accops Nutanix .Next Tokyo 2026 - English v4.pptx", "Accops-NutanixDotNext-When VDI Is Not Enough-V6.pptx"],
];
for (const [a, b] of SAME) ok(familyKey(a) === familyKey(b), `same family: ${a} (${familyKey(a)}) vs ${b} (${familyKey(b)})`);
for (const [a, b] of DIFFERENT) ok(familyKey(a) !== familyKey(b), `must not merge: ${a} vs ${b} (${familyKey(a)})`);

const ed = f => parseName(f).edition, ver = f => parseName(f).version.join(".");
ok(ed("251029-Sharable-Accops-CustomerWorkshop-Event-Deck-2Hour-HDFC.pptx") === "sharable" && ed("251029-Confidential-Accops-CustomerWorkshop-Event-Deck-2Hour-HDFC.pptx") === "", "sharable vs confidential (the default)");
ok(ed("Public Version v2026-06-22-MEA-Confidential-Accops Partner Bootcamp Event Deck 4Hour 2026.pptx") === "mea sharable", "a 'Public Version' of a confidential MEA deck is the MEA sharable edition");
ok(ed("Accops Nutanix .Next Tokyo 2026 - Japanese v2.pptx") === "japanese" && ed("Accops Nutanix .Next Tokyo 2026 - English v4.pptx") === "", "Japanese vs English (the default)");
ok(ed("1009-Accops-ForJapan-ENG-PartnerBootcamp-Event-Deck-4Hour-Oct2025.pptx") === "japan", "English deck for Japan is the Japan edition");
ok(ver("Accops Customer Deck SEA Compressed V2.0.pptx") === "2.0" && ver("Accops DaaS Calculator v-2.3.xlsx") === "2.3" && ver("Accops vs VMware Features-Ver02-19072022-CJ.pptx") === "2"
  && ver("Win 10 EOL Webinar Version 3.1pptx.pptx") === "3.1" && ver("Accops DaaS Pricing Calculator v2.3 May 2021.xlsx") === "2.3", "versions parse: V2.0, v-2.3, Ver02, Version 3.1, v2.3 before a month");
ok(parseName("z__Outdated__Accops NIC PPT 04 Feb.pptx").outdated, "an outdated marker is read");

// ---- 2. Canonical choice.
const M = (name, o = {}) => ({ name, publishYear: null, modified: "2026-01-01", carded: false, eligible: true, supersededBy: null, ...o });
const pick = (ms, ov) => { const f = families(ms, x => x, ov); return { f, lead: ms.find(m => f.get(m).canonical), info: m => f.get(m) }; };
{
  const v1 = M("Turbo Architecture-v1.pdf", { modified: "2026-09-01" }), v2 = M("Turbo Architecture-v2.pdf", { modified: "2025-01-01" });
  ok(pick([v1, v2]).lead === v2, "higher version beats a later save");
  const a = M("Deck v3.pptx", { publishYear: 2021 }), b = M("Deck v2.pptx", { publishYear: 2024 });
  ok(pick([a, b]).lead === b, "the card's publication year beats the version number");
  const c = M("BioAuth Deployment Details.pptx", { publishYear: 2024 }), d = M("BioAuth Deployment Details-v2.pptx", { publishYear: 2022 });
  ok(pick([c, d]).lead === c, "a v2 from 2022 is older than an unversioned 2024 file");
  const e = M("Nutanix-DotNext-Event.pptx", { modified: "2024-06-20" }), f = M("Nutanix-DotNext-Event_SUBMITTED FILE-v2.pptx", { modified: "2024-05-19" });
  ok(pick([e, f]).lead === e, "a version on one file only is no evidence: modified decides");
  const old = M("ZTNA for Government.pdf", { publishYear: 2026, supersededBy: "Accops Solutions for Govt. V1 '26" }), cur = M("Accops Solutions for Govt. V1 '26.pdf", { publishYear: 2026 });
  const p = pick([old, cur]);
  ok(p.info(old).key === p.info(cur).key && p.lead === cur && !p.info(old).head && p.info(cur).older === 1, "hand-set superseded_by joins the successor's family and loses, whatever the names say");
  const lone = M("Old brochure.pdf", { supersededBy: "Not in the library V9" });
  ok(pick([lone]).info(lone).head, "a successor that is not in the library hides nothing");
  const conf = M("251029-Confidential-Workshop-HDFC.pptx"), shar = M("251029-Sharable-Workshop-HDFC.pptx"), jp = M("Tokyo Deck - Japanese v4.pptx"), en = M("Tokyo Deck - English v4.pptx");
  const w = pick([conf, shar]);
  ok(w.lead === conf && w.info(shar).head && !w.info(shar).canonical && w.info(conf).older === 0, "editions are siblings: both heads, the default edition leads, none is an older version");
  ok(pick([jp, en]).lead === en, "English leads, Japanese is the sibling");
  const pre = M("Deck 2026.pptx", { eligible: false, publishYear: 2022 }), pinned = M("Deck 2021.pptx", { publishYear: 2021, eligible: true });
  ok(pick([pre, pinned]).lead === pinned, "the canonical prefers an eligible member");
  const x = M("Corporate Deck 2026.pptx"), y = M("Accops Corporate Deck - 25 Aug 2026.pptx", { modified: "2026-09-23" });
  const ov = pick([x, y], new Map([["corporatedeck2026", "corporatekeynote2026"]]));
  ok(ov.info(x).key === "corporatekeynote2026" && ov.info(x).head && ov.info(y).head, "an override splits a false merge");
}

// ---- 3. Through the real cards.ts / agent.ts: eligibility, pins, editions, substitutes.
Object.assign(process.env, {
  SUPABASE_URL: "https://stub.supabase.co", SUPABASE_SERVICE_KEY: "stub",
  LLM_PROVIDER: "openai-compatible", OPENAI_COMPAT_BASE_URL: "https://groq.stub/openai/v1", OPENAI_COMPAT_API_KEY: "stub", OPENAI_COMPAT_MODEL: "m",
});
delete process.env.OPENAI_COMPAT_FALLBACK_MODEL; delete process.env.ANTHROPIC_API_KEY;
const row = (item_id, folder, filename, type, modified = "2026-09-01T00:00:00Z") => ({
  item_id, folder, filename, ext: filename.split(".").pop(), web_url: `https://propalmsnetwork.sharepoint.com/${item_id}`,
  created_at: "2020-01-01T00:00:00Z", modified_at: modified, modified_by: "x", asset_type: [type], industry: [], product: [], competitor: [],
  status: "active", deleted: false, list_item_id: 1, last_synced: null, suggest_ingest: true,
});
const card = (filename, item_id, o) => ({ source: `sharepoint/${filename}`, filename, industry: "", client: "", products: [], competitors: [], personas: [], regulations: [],
  key_problem: "", key_outcomes: [], brief: "", use_for: "", expired: false, expiry_date: null, stale_risk: "", superseded_by: "", visibility: "internal",
  internal_reason: "", public_url: "", confidence: 0.9, needs_human: "", batch: "t", item_id, ...o });
const REG = [
  row("Q1", "Presentations", "Zeta Portfolio Deck 2021.pptx", "Deck"),
  row("Q2", "Company Certifications", "ISO Certificate- Zeta Systems.pdf", "Certification"),
  row("Q3", "Regulation", "RBI-2020-Zeta Cyber Framework.pdf", "Regulation"),
  row("Q4", "Competition", "Zeta vs Omega Battlecard.pptx", "Competitive"),
  row("Q5", "Competition", "Zeta vs Sigma Battlecard.pptx", "Competitive"),
  row("Q6", "Brochures", "Zeta Gateway Datasheet V4.pdf", "Brochure"),
  row("Q7", "Brochures", "Zeta Gateway Datasheet V5 2026.pdf", "Brochure", "2026-09-10T00:00:00Z"),
  row("Q8", "Events", "v2026-06-30-Confidential-Zeta Partner Bootcamp Deck.pptx", "Deck"),
  row("Q9", "Events", "v2026-06-30-Public-Shareable-Zeta Partner Bootcamp Deck.pptx", "Deck"),
  row("Q10", "Events", "v2026-09-04 - Zeta Partner Bootcamp Deck Japanese.pptx", "Deck"),
  row("Q11", "Logos", "zeta_logo@2x.png", "Brand", "2021-05-01T00:00:00Z"),
  row("Q12", "Videos", "Zeta Case studies - CISO testimonial.mp4", "Video", "2022-03-01T00:00:00Z"),
  row("Q13", "Events", "Zeta Tokyo Deck 2026 - English v4.pptx", "Deck"),
  row("Q14", "Events", "Zeta Tokyo Deck 2026 - Japanese v4.pptx", "Deck"),
  row("Q15", "Presentations", "Zeta Blank Template 2026.pptx", "Deck"),
];
const CARDS = [
  card("Zeta Portfolio Deck 2021.pptx", "Q1", { title: "Zeta Portfolio Deck (2021)", asset_type: "Deck", publish_year: "2021", brief: "The 2021 zeta portfolio deck." }),
  card("ISO Certificate- Zeta Systems.pdf", "Q2", { title: "Zeta ISO 27001 Certificate (2021)", asset_type: "Certification", publish_year: "2021", brief: "ISO 27001 certificate for zeta." }),
  card("RBI-2020-Zeta Cyber Framework.pdf", "Q3", { title: "RBI Cyber Security Framework for Zeta Banks (2020)", asset_type: "Regulation", publish_year: "2020", brief: "The RBI zeta cyber framework circular." }),
  card("Zeta vs Omega Battlecard.pptx", "Q4", { title: "Zeta vs Omega Battlecard (2022)", asset_type: "Battlecard", publish_year: "2022", competitors: ["Omega"], brief: "Zeta against Omega, feature by feature." }),
  card("Zeta vs Sigma Battlecard.pptx", "Q5", { title: "Zeta vs Sigma Battlecard (2022)", asset_type: "Battlecard", publish_year: "2022", competitors: ["Sigma"], brief: "Zeta against Sigma, feature by feature." }),
  card("Zeta Blank Template 2026.pptx", "Q15", { title: "Zeta Blank Template", asset_type: "Deck", publish_year: "2026", confidence: 0.3, needs_human: "The file is empty: one blank slide.", brief: "An empty zeta deck." }),
];
let pins = [];
const OVERRIDES = [{ stem: "zetatokyodeck2026englishv4", family_key: "zetatokyodeck", exclude: true, reason: "empty file" }];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes("groq.stub")) return Response.json({ choices: [{ message: { role: "assistant", content: "No Zeta battlecard for Omega exists.\nPICKS: none" } }], usage: { total_tokens: 10 } });
  if (u.includes("sam_asset_pins")) return Response.json(pins);
  if (u.includes("sam_asset_family_overrides")) return Response.json(OVERRIDES);
  if (u.includes("sam_sharepoint_files")) return Response.json(REG);
  if (u.includes("sam_asset_cards")) return Response.json(CARDS);
  return Response.json([]);
};
const { allAssets, answerable, searchAssets } = await jiti.import("./cards.ts");
const { refresh } = await jiti.import("./registry-cache.ts");
const { refreshCards } = await jiti.import("./cards-cache.ts");
const { ask } = await jiti.import("./agent.ts");
const load = async () => { globalThis.__samRegBusy = globalThis.__samCardsBusy = false; await refresh(); await refreshCards(); };
await load();
const zeta = () => allAssets().filter(a => /zeta/i.test(`${a.title} ${a.file?.path}`));
const byFile = f => zeta().find(a => (a.file?.path ?? "").endsWith(f));
const inAnswers = f => answerable().some(a => (a.file?.path ?? "").endsWith(f));

ok(!inAnswers("Zeta Portfolio Deck 2021.pptx") && byFile("Zeta Portfolio Deck 2021.pptx").family.excluded === "published 2021", "a 2021 deck is excluded, and says why");
ok(inAnswers("ISO Certificate- Zeta Systems.pdf"), "the 2021 ISO certificate stays (owner's decision)");
ok(inAnswers("RBI-2020-Zeta Cyber Framework.pdf"), "a 2020 regulation stays");
ok(inAnswers("zeta_logo@2x.png"), "a 2021 logo stays: brand assets are exempt (owner, 30 Sep)");
ok(!inAnswers("Zeta Case studies - CISO testimonial.mp4") && byFile("Zeta Case studies - CISO testimonial.mp4").family.excluded === "year unknown, last modified 2022", "a 2022 testimonial video is excluded: an uncarded file with no document year falls back to modified");
ok(!inAnswers("Zeta Tokyo Deck 2026 - English v4.pptx") && byFile("Zeta Tokyo Deck 2026 - English v4.pptx").family.excluded === "empty file"
  && byFile("Zeta Tokyo Deck 2026 - Japanese v4.pptx").family.canonical && inAnswers("Zeta Tokyo Deck 2026 - Japanese v4.pptx"), "a hand-excluded empty English deck is out and the Japanese edition leads");
ok(!inAnswers("Zeta Blank Template 2026.pptx") && byFile("Zeta Blank Template 2026.pptx").family.excluded === "the card says the file is empty", "a card saying the file is empty (low confidence) takes it out");
ok(!inAnswers("Zeta Gateway Datasheet V4.pdf") && inAnswers("Zeta Gateway Datasheet V5 2026.pdf") && byFile("Zeta Gateway Datasheet V5 2026.pdf").family.older === 1, "the older version never answers; the newer counts it");
ok(!inAnswers("Zeta vs Omega Battlecard.pptx") && !inAnswers("Zeta vs Sigma Battlecard.pptx"), "unpinned 2022 battlecards are excluded");
ok(!searchAssets({ query: "zeta omega battlecard" }).results.some(h => /Omega/.test(h.asset.title)), "search never returns an excluded battlecard");
let r = await ask("zeta vs omega battlecard");
ok(r.missing && !r.assets.some(a => /Battlecard \(2022\)/.test(a.title)), `an excluded battlecard is not a substitute either; the topic is an honest gap: ${r.text} | ${r.assets.map(a => a.title)}`);

pins = [{ asset_key: "id:Q4", pinned_by: "admin", reason: "still accurate", created_at: "2026-09-30" }];
await load();
ok(inAnswers("Zeta vs Omega Battlecard.pptx") && byFile("Zeta vs Omega Battlecard.pptx").family.pinned && !inAnswers("Zeta vs Sigma Battlecard.pptx"), "a pinned 2022 battlecard answers; its unpinned neighbour does not");
ok(searchAssets({ query: "zeta omega battlecard" }).results[0]?.asset.title === "Zeta vs Omega Battlecard (2022)", "and search finds it");

const top = (q, o = {}) => searchAssets({ query: q, ...o }).results.filter(h => /bootcamp/i.test(h.asset.title));
ok(top("zeta partner bootcamp deck").length === 1 && /Confidential/.test(top("zeta partner bootcamp deck")[0].asset.file.path), "one slot per family: the default edition leads");
ok(/Shareable/.test(top("zeta partner bootcamp deck to send the customer")[0]?.asset.file.path), "a sending ask gets the sharable edition");
ok(/Shareable/.test(top("zeta partner bootcamp deck", { sending: true })[0]?.asset.file.path), "so does an internal retry of a sending ask");
ok(/Japanese/.test(top("zeta partner bootcamp deck for a japan partner")[0]?.asset.file.path), "a Japan ask gets the Japanese edition");

console.log(`family.check: ${n} assertions passed`);
