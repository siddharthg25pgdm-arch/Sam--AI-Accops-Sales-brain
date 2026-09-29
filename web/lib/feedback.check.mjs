/** ponytail: one runnable check for the feedback loop.  node lib/feedback.check.mjs  (from web/)
 *  Throws if "wrong asset" learning stops being conservative: one rep does nothing, two reps demote,
 *  a helpful rating blocks it, it decays after DEMOTE_DAYS, a human clear holds until two new reps
 *  agree again, and the penalty really moves a document down in searchAssets (stubbed Supabase). */
import assert from "node:assert";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@": web } });
process.env.SUPABASE_URL = "https://stub.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "stub";

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; }; const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const now = "2026-09-30T06:00:00.000Z";
const ago = d => new Date(Date.parse(now) - d * 86_400_000).toISOString();

let id = 1;
const A = "Competition/Accops vs Citrix.pdf", B = "Competition/Citrix migration guide.pdf";
/** One rep asks `q`, sees `shown`, rates it `fb`, `days` ago. */
function rate(user, q, fb, days = 1, shown = [A, B], extra = {}) {
  const qid = id++;
  return { id: id++, created_at: ago(days), user_id: user, channel: "web", feedback: fb, ref_event_id: qid, is_test: false,
    asked: { id: qid, created_at: ago(days), user_id: user, channel: "web", query: q, answer: "Best matches in the library.\n- Accops vs Citrix", result_ids: shown, result_titles: shown.map(s => s.split("/").pop()), ...extra } };
}

// ---- pure
const { learnDemotions, latestRatings, wrongAssetTally, verdictOf, penalty, DEMOTE_DAYS, DEMOTE_PENALTY } = await jiti.import("./feedback.ts");
const { topicOf } = await jiti.import("./cards.ts");

eq(topicOf("Do we have a Citrix battlecard for banks?"), ["bank", "citrix"], "topic drops type and filler words, singular");
eq(learnDemotions([rate("asha", "citrix battlecard for a bank", "wrong_asset")], now), [], "one rep's rating does nothing");
eq(learnDemotions([rate("asha", "citrix battlecard", "wrong_asset"), rate("asha", "citrix deck for a bank", "wrong_asset")], now), [], "one rep twice is still one rep");

const two = [rate("asha", "citrix battlecard for a bank", "wrong_asset"), rate("ravi", "citrix comparison for banks", "wrong_asset")];
const d2 = learnDemotions(two, now);
eq(d2.map(d => [d.asset, d.topic.join(" "), d.reps.length]), [[A, "bank citrix", 2], [B, "bank citrix", 2]], "two reps demote every document they were shown, on the shared topic");
ok(!learnDemotions([rate("asha", "citrix battlecard", "wrong_asset"), rate("ravi", "nutanix sizing deck", "wrong_asset")], now).length, "no shared topic, no demotion");

ok(!learnDemotions([...two, rate("meera", "citrix battlecard for bank", "helpful", 3, [A])], now).some(d => d.asset === A), "a helpful rating for the topic blocks the demotion");
ok(learnDemotions([...two, rate("meera", "citrix battlecard for bank", "helpful", 3, [A])], now).some(d => d.asset === B), "...only for the document it was shown");
ok(learnDemotions([...two, rate("meera", "hysecure for bank", "helpful", 3, [A])], now).some(d => d.asset === A), "helpful on another topic does not block");

const old = [rate("asha", "citrix battlecard for a bank", "wrong_asset", DEMOTE_DAYS + 1), rate("ravi", "citrix bank", "wrong_asset", 5)];
eq(learnDemotions(old, now), [], `a rating older than ${DEMOTE_DAYS} days no longer counts`);
ok(learnDemotions(two, ago(-DEMOTE_DAYS + 2)).length === 2 && !learnDemotions(two, ago(-DEMOTE_DAYS - 1)).length, "a demotion lapses by itself");

// Latest rating per rep per answer wins: wrong asset, then Yes, is Yes.
const flip = rate("ravi", "citrix bank", "wrong_asset");
const flipBack = { ...flip, id: id++, feedback: "helpful", created_at: ago(0.5) };
eq(latestRatings([flip, flipBack]).map(r => r.feedback), ["helpful"], "latest rating per answer wins");
eq(learnDemotions([two[0], flip, flipBack], now), [], "a rep who changed to Yes does not count as wrong");
ok(!latestRatings([{ ...two[0], user_id: "intruder" }]).length, "rating someone else's question counts for nothing");

// A human clear holds until two NEW reps agree after it.
const clear = [{ asset_id: A, topic: "bank citrix", created_at: ago(0.1) }];
ok(!learnDemotions(two, now, clear).some(d => d.asset === A), "cleared demotion stays cleared");
const after = [rate("sam", "citrix for bank", "wrong_asset", 0.05), rate("lee", "bank citrix battlecard", "wrong_asset", 0.01)];
ok(!learnDemotions([...two, after[0]], now, clear).some(d => d.asset === A), "one new rep after a clear is not enough");
ok(learnDemotions([...two, ...after], now, clear).some(d => d.asset === A), "two new reps after a clear demote again");

// Narrowest topic wins: {citrix} from a third rep covers {bank, citrix}.
const three = [...two, rate("meera", "citrix licensing", "wrong_asset", 1, [A])];
eq(learnDemotions(three, now).filter(d => d.asset === A).map(d => d.topic.join(" ")), ["citrix"], "narrowest shared topic kept");

// penalty(): applies when the query's topic contains the demotion's, once.
const m = new Map([[A, [["bank", "citrix"], ["citrix"]]]]);
eq(penalty(m, A, topicOf("citrix battlecard for a bank")), DEMOTE_PENALTY, "applies once, not per demotion");
eq(penalty(m, A, topicOf("hysecure datasheet")), 0, "other topics untouched");
eq(penalty(new Map([[A, [["bank", "citrix"]]]]), A, topicOf("citrix battlecard")), 0, "a narrower query than the demotion is untouched");

const tally = wrongAssetTally([...two, rate("asha", "citrix battlecard for a bank", "wrong_asset", 0.2, [A])]);
eq(tally[0].key, A, "most-rated-wrong document first"); eq(tally[0].reps, 2, "tally counts distinct reps");
eq(verdictOf("No exact match.\n- Doc one\n- Doc two"), "No exact match.", "verdict without document lines");

// ---- searchAssets: the penalty moves a document, on a real (stubbed) pool.
const card = (file, title, brief) => ({ source: file, filename: file.split("/").pop(), title, asset_type: "Battlecard", industry: "BFSI", client: "", products: ["HyWorks"],
  competitors: ["Citrix"], personas: [], regulations: [], key_problem: "", key_outcomes: [], brief, use_for: "", publish_year: "2025", expired: false, expiry_date: null,
  stale_risk: "", superseded_by: "", visibility: "internal", internal_reason: "", public_url: null, confidence: 0.9, needs_human: "", batch: "t", item_id: null });
const CARDS = [card(A, "Accops vs Citrix battlecard", "Citrix comparison for banks."), card(B, "Citrix battlecard for banking", "Citrix migration for banks.")];
let ratings = [], asked = [];
globalThis.fetch = async (url) => {
  const u = decodeURIComponent(String(url));
  if (u.includes("sam_asset_cards")) return Response.json(CARDS);
  if (u.includes("sam_events") && u.includes("kind=eq.feedback")) return Response.json(ratings);
  if (u.includes("sam_events") && u.includes("id=in.")) return Response.json(asked);
  return Response.json([]);
};
const { refreshCards } = await jiti.import("./cards-cache.ts");
const { searchAssets } = await jiti.import("./cards.ts");
const { refreshDemotions } = await jiti.import("./feedback.ts");
await refreshCards();
const hits = () => searchAssets({ query: "citrix battlecard for bank", limit: 2 }).results;
const top = () => hits().map(h => h.asset.file.path);
const before = top();
const loser = before[0], other = before[1];
ok(before.length === 2, `both documents found (${before})`);
// The first search kicked a background refresh; let it land so each refresh below really reloads.
const settle = () => new Promise(r => setTimeout(r, 30));
const load = rs => { ratings = rs.map(({ asked: _a, ...r }) => r); asked = rs.map(r => r.asked); };
load([rate("asha", "citrix battlecard for a bank", "wrong_asset", 1, [loser])]);
await settle(); await refreshDemotions();
eq(top(), before, "one rep: ranking unchanged");
load([rate("asha", "citrix battlecard for a bank", "wrong_asset", 1, [loser]), rate("ravi", "citrix bank comparison", "wrong_asset", 1, [loser])]);
await settle(); await refreshDemotions();
eq(top(), [other, loser], `two reps: demoted (${hits().map(h => h.score)}) below the other document, still returned`);
eq(searchAssets({ query: "nutanix citrix", limit: 5 }).results.length > 0, true, "other queries still search");

console.log(`feedback.check: ${n} assertions passed`);
