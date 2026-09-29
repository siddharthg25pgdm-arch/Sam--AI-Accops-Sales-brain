/** ponytail: one runnable check for the morning digest.  node lib/digest.check.mjs  (from web/)
 *  Stubbed data only: an empty day, a busy day, the worth-creating threshold, the subject line,
 *  file classification, health rules, and that the HTML stays email-safe and escaped.
 *  DIGEST_OUT=dir writes the rendered busy/empty HTML there, for screenshots. */
import assert from "node:assert";
import fs from "node:fs";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@": web } });
const { buildDigest, renderHtml, WORTH_CREATING, day } = await jiti.import("./digest.ts");
const { rankRequests } = await jiti.import("./requests.ts");
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; }; const eq = (a, b, m) => { assert.equal(a, b, m); n++; };

const now = "2026-09-29T03:00:00.000Z";            // 08:30 IST
const h = hrs => new Date(Date.parse(now) - hrs * 3_600_000).toISOString();
const healthy = { lastFlowWrite: h(5), sync: { scope: "sales", last_run: h(10), last_result: "snapshot write: 1 tombstoned, 0 restored, 875 listed, 0 unknown" }, cardCount: 311 };
const zero = { questions: 0, people: 0, answered: 0, gaps: 0, instrumented: 0, errors: 0, model_attempted: 0, fallback: 0, provider_failures: 0, p95: null };
const base = { now, base: "https://sam.example", requests: [], gaps: [], changes: [], queue: [], carded: [], usage: zero, usagePrev: zero, failed: [], ...healthy };

// --- the empty day: one calm line, no sections, no health
const empty = buildDigest(base);
eq(empty.subject, "SAM: nothing new", "empty subject");
ok(/^Nothing new/.test(empty.lead), empty.lead);
ok(!empty.requests && !empty.gaps && !empty.library && !empty.usage && !empty.health.length, "empty day has no sections");
const emptyHtml = renderHtml(empty);
ok(!/Content requests|Needs a look|Usage/.test(emptyHtml), "empty HTML shows no section titles");

// --- a busy day
const vote = (u, at, q) => ({ user_id: u, channel: "web", question: q ?? null, note: null, created_at: at });
const req = (id, title, created, votes, extra = {}) => ({ id, created_at: created, updated_at: created, topic_key: `k${id}`, title, asset_type: null, product: null, vertical: null,
  description: null, status: "open", owner: null, due_date: null, delivered_title: null, delivered_url: null, decline_reason: null, notes: null, merged_into: null,
  source: "rep", created_by: null, closed_at: null, is_test: false, votes, ...extra });
const requests = rankRequests([
  req(1, "GPU workloads brochure", h(200), [vote("a", h(200)), vote("b", h(100)), vote("c", h(3)), vote("c", h(2))], { status: "planned", owner: "Priya", due_date: "2026-10-03" }),
  req(2, "Browser isolation <datasheet>", h(4), [vote("d", h(4), "do we have a browser isolation datasheet?")]),
  req(3, "SEA banking case study", h(20), [vote("e", h(20)), vote("f", h(19))]),
]);
const file = (id, name, o = {}) => ({ item_id: id, filename: name, folder: "Presentations", web_url: `https://sp/${id}`, created_at: h(900), deleted: false, deleted_at: null, last_synced: h(6), ...o });
const busy = buildDigest({ ...base,
  requests,
  gaps: Array.from({ length: 7 }, (_, i) => ({ key: `g${i}`, title: `Gap ${i}`, facets: {}, users: ["x", "y"].slice(0, 1 + (i % 2)), asks: 3, examples: [`gap ${i}`, `something about gap ${i}`], lastSeen: i ? h(30) : h(2) })),
  changes: [file("n", "New deck.pptx", { created_at: h(7) }), file("m", "Edited.pdf"), file("r", "Renamed.pdf"), file("x", "Gone.pdf", { deleted: true, deleted_at: h(8), last_synced: h(300) }), file("old", "Old.pdf", { last_synced: h(40) })],
  queue: [{ item_id: "n", filename: "New deck.pptx", reason: "uncarded" }, { item_id: "r", filename: "Renamed.pdf", reason: "renamed" }, { item_id: "m", filename: "Edited.pdf", reason: "changed_since_card" }],
  carded: [{ title: "HySecure datasheet", filename: "hs.pdf", carded_at: h(4) }],
  usage: { questions: 12, people: 4, answered: 10, gaps: 2, instrumented: 12, errors: 1, model_attempted: 12, fallback: 1, provider_failures: 1, p95: 9200 },
  usagePrev: { questions: 63, people: 6, answered: 50, gaps: 9, instrumented: 63, errors: 2, model_attempted: 60, fallback: 3, provider_failures: 4, p95: 8100 },
});
eq(busy.requests.items[0].title, "GPU workloads brochure", "ranked by distinct reps");
eq(busy.requests.items[0].reps, 3, "a rep asking twice counts once");
ok(busy.requests.items[0].worth && WORTH_CREATING === 3, "3 reps crosses the threshold");
eq(busy.requests.items[0].new_reps, 1, "reps who joined an older request in the last 24 h");
ok(!busy.requests.items[0].is_new && busy.requests.items[1].is_new && busy.requests.items[2].is_new, "new = created in the last 24 h");
ok(busy.requests.items.every((r, i) => i === 0 || !r.worth), "2 reps is not worth creating");
eq(busy.requests.new_count, 2, "two new requests");
eq(busy.requests.items[0].url, "https://sam.example/admin?tab=requests#r1", "links to the request");
eq(busy.gaps.items.length, 5, "top 5 gaps"); eq(busy.gaps.total, 7, "total kept");
ok(busy.gaps.items[0].is_new && !busy.gaps.items[1].is_new, "gap new within 24 h");
eq(busy.gaps.items[0].example, "something about gap 0", "example differs from the title");
const L = busy.library;
eq(L.added.map(f => f.name).join(), "New deck.pptx", "added");
eq(L.modified.map(f => f.name).join(), "Edited.pdf", "modified; a change older than 24 h is left out");
eq(L.renamed.map(f => f.name).join(), "Renamed.pdf", "renamed via the carding queue");
eq(L.deleted.map(f => f.name).join(), "Gone.pdf", "deleted"); eq(L.deleted[0].url, null, "no link to a deleted file");
eq(L.changed, 4, "four files changed");
eq(L.queue.uncarded, 1, "uncarded count"); ok(L.deletion_check?.includes("tombstoned"), "fresh snapshot result shown");
eq(busy.usage.answered.pct, 83.3, "answered rate"); eq(busy.usage.week.questions_per_day, 9, "7-day daily average");
eq(busy.health.length, 0, "healthy system says nothing");
eq(busy.subject, "SAM: 2 new requests, 1 worth creating, 4 files changed, 12 questions", busy.subject);
ok(/^[\x20-\x7e]+$/.test(busy.subject), "subject is ASCII, safe in an HTTP header");
ok(busy.lead.startsWith('"GPU workloads brochure" is worth creating: 3 reps'), busy.lead);

const html = renderHtml(busy);
ok(html.includes("Browser isolation &lt;datasheet&gt;") && !html.includes("<datasheet>"), "titles are escaped");
ok(!/display:\s*(flex|grid)|var\(--|<style|<script|<img|<link/i.test(html), "no Outlook-hostile CSS, scripts or external resources");
ok(html.includes("Worth creating") && html.includes("can&rsquo;t describe yet") && html.includes("Carded overnight"), "sections render");
ok(html.indexOf("Content requests") < html.indexOf("Asked for, never requested") && html.indexOf("Asked for, never requested") < html.indexOf("Library") && html.indexOf("Library") < html.indexOf(">Usage<"), "sections in order");

// --- health rules
const sick = buildDigest({ ...base, lastFlowWrite: h(60), sync: { scope: "sales", last_run: null, last_result: "snapshot report: 1 would tombstone" }, cardCount: 0,
  usage: { ...zero, questions: 10, model_attempted: 10, provider_failures: 4 }, failed: ["usage"] });
eq(sick.health.length, 5, sick.health.map(x => x.title).join(" | "));
ok(sick.health.some(x => /change has reached SAM for 3 days/.test(x.title)), "flow silent > 48 h");
ok(sick.health.some(x => /never been checked/.test(x.title) && /report mode \(1 would tombstone\).*"write"/.test(x.detail)), "deletions never applied: report mode named, with the fix");
ok(busy.lead.endsWith("2 new content requests since yesterday."), busy.lead);
eq(sick.lead, "No new content requests. 5 things need a look, at the bottom.", "questions but no requests");
eq(buildDigest({ ...base, lastFlowWrite: h(60) }).lead, "A quiet day. One thing needs a look, at the bottom.", "health only");
ok(sick.subject.endsWith("5 things to check"), sick.subject);
const fine = buildDigest({ ...base, lastFlowWrite: h(47), usage: { ...zero, questions: 20, model_attempted: 20, provider_failures: 3 } });
eq(fine.health.length, 0, "47 h and 15% provider failures are not alarms");
eq(buildDigest({ ...base, lastFlowWrite: null }).health[0].title, "The SharePoint change flow has never written", "never wrote");

// --- IST dates
eq(day("2026-09-28T20:00:00Z"), "29 Sep", "IST shifts the day"); eq(day("2026-10-03"), "3 Oct", "bare dates are not shifted");
eq(busy.period.label, "Last 24 hours, to 08:30 IST", "period label");

if (process.env.DIGEST_OUT) {
  fs.mkdirSync(process.env.DIGEST_OUT, { recursive: true });
  fs.writeFileSync(`${process.env.DIGEST_OUT}/busy.html`, html);
  fs.writeFileSync(`${process.env.DIGEST_OUT}/sick.html`, renderHtml(sick));
  fs.writeFileSync(`${process.env.DIGEST_OUT}/empty.html`, emptyHtml);
}
console.log(`digest.check: ${n} assertions passed`);
