/** ponytail: one runnable check for content requests.  node lib/requests.check.mjs  (from web/)
 *  Throws if any of these break: the merge key (same ask -> same key, different ask -> different key),
 *  demand = distinct reps, the status rules, the gap signal, the rep-facing sentence, and the
 *  WhatsApp REQUEST command. Pure functions only; the SQL side is exercised on the dev server. */
import assert from "node:assert";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@": web } });
const { suggestTitle, requestKey, confirmation, transition, rankRequests, unrequestedGaps } = await jiti.import("./requests.ts");
const { requestCommand, numberForUser } = await jiti.import("./whatsapp.ts");
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const same = (a, b) => ok(requestKey(a) && requestKey(a) === requestKey(b), `same key: "${a}" (${requestKey(a)}) vs "${b}" (${requestKey(b)})`);
const differ = (a, b) => ok(requestKey(a) !== requestKey(b), `different keys: "${a}" vs "${b}" (${requestKey(a)})`);

// Titles are the rep's words, minus the asking.
ok(suggestTitle("Do we have a remote browser isolation brochure?") === "Remote browser isolation brochure", suggestTitle("Do we have a remote browser isolation brochure?"));
ok(suggestTitle("  hi sam, i need a ZTNA whitepaper for pharma  ") === "ZTNA whitepaper for pharma", suggestTitle("  hi sam, i need a ZTNA whitepaper for pharma  "));
ok(suggestTitle("?") === "", "nothing left is empty");

// The merge key.
same("remote browser isolation brochure", "Browser Isolation brochure");
same("Do we have a browser isolation datasheet?", "browser isolation brochure");     // datasheet is a Brochure
same("ZTNA brochure", "HySecure brochure");                                          // one product, two names
same("MFA case study for banks", "HyID case study BFSI");
same("whitepaper on GPU workloads", "GPU workload whitepaper");                     // word order, plural
same("SOC 2 report", "do we have a soc 2 report?");
differ("browser isolation brochure", "browser isolation case study");
differ("hysecure case study", "hysecure case study for a bank");
differ("SOC 2 report", "ISO 27001 certificate");
ok(requestKey("a brochure") === null && requestKey("this") === null, "nothing to key on -> null");
ok(requestKey("brochure", { product: "HyWorks" }) === requestKey("HyWorks brochure"), "explicit facets count");

// What the rep is told.
ok(confirmation({ demand: 1, new_vote: true, status: "open" }) === "You are the first to ask for this. Marketing can see it now.", "first");
ok(confirmation({ demand: 4, new_vote: true, status: "open" }) === "You and 3 others have asked for this. Marketing can see it.", "with others");
ok(confirmation({ demand: 2, new_vote: true, status: "in_progress" }).endsWith("You and 1 other have asked for this. Marketing can see it. Marketing is already working on it."), "singular, in progress");
ok(confirmation({ demand: 3, new_vote: false, status: "open" }) === "You have already asked for this, and so have 2 others. Marketing can see it.", "repeat");

// Status rules.
const err = (x) => "error" in x;
ok(err(transition("open", { status: "done" })), "done needs a link");
ok(err(transition("open", { status: "done", delivered_url: "sharepoint somewhere", delivered_title: "X" })), "done needs a real URL");
ok(err(transition("open", { status: "done", delivered_url: "https://x.test/a.pdf" })), "done needs a title");
let t = transition("in_progress", { status: "done", delivered_url: "https://x.test/a.pdf", delivered_title: "RBI brochure" });
ok(!err(t) && t.patch.status === "done" && t.patch.delivered_url === "https://x.test/a.pdf" && t.patch.closed_at, `done patch: ${JSON.stringify(t)}`);
ok(err(transition("open", { status: "declined" })) && !err(transition("open", { status: "declined", decline_reason: "Covered by the eBook" })), "declined needs a reason");
ok(err(transition("done", { status: "planned" })), "done can only be reopened");
t = transition("done", { status: "open" });
ok(!err(t) && t.patch.closed_at === null, "reopen clears closed_at");
ok(err(transition("merged", { status: "open" })) && err(transition("open", { status: "merged" })), "merged is set only by a merge");
ok(err(transition("open", { status: "planned", due_date: "next week" })), "a due date is a date");
t = transition("open", { status: "planned", owner: " Priya ", due_date: "2026-10-01" });
ok(!err(t) && t.patch.owner === "Priya" && t.patch.due_date === "2026-10-01" && !("closed_at" in t.patch), `planned: ${JSON.stringify(t)}`);
ok(!err(transition("open", { status: "open", notes: "x" })), "a same-status save edits fields");

// Demand = distinct reps, then recency.
const v = (user_id, created_at, question = null) => ({ user_id, channel: "web", question, note: null, created_at });
const ranked = rankRequests([
  { id: 1, created_at: "2026-09-01", title: "A", votes: [v("a", "2026-09-01"), v("a", "2026-09-02")] },
  { id: 2, created_at: "2026-09-01", title: "B", votes: [v("a", "2026-09-01", "q1"), v("b", "2026-09-03", "q2")] },
  { id: 3, created_at: "2026-09-01", title: "C", votes: [v("c", "2026-09-05")] },
]);
ok(ranked.map(r => r.id).join() === "2,3,1", `ranked by distinct reps then recency: ${ranked.map(r => `${r.id}:${r.demand}`)}`);
ok(ranked[0].demand === 2 && ranked[2].demand === 1 && ranked[0].examples.join() === "q2,q1" && ranked[0].lastAsked === "2026-09-03", "demand counts people, examples newest first");

// The weaker signal: gaps not yet requested, grouped by the same key.
const gap = (query, user_id, created_at = "2026-09-10") => ({ kind: "gap", query, user_id, created_at });
const gs = unrequestedGaps([
  gap("remote browser isolation brochure", "a"), gap("browser isolation datasheet?", "b"), gap("browser isolation brochure", "a"),
  gap("SOC 2 report", "c"), gap("hysecure brochure", "d"), { kind: "query", query: "x", user_id: "e" }, gap("hi", "f"),
], [requestKey("HySecure brochure")]);
ok(gs.length === 2 && gs[0].users.length === 2 && gs[0].asks === 3, `grouped and ranked: ${JSON.stringify(gs.map(g => [g.key, g.users.length, g.asks]))}`);
ok(!gs.some(g => g.key === requestKey("hysecure brochure")), "already requested is not a gap signal");

// WhatsApp.
ok(requestCommand("REQUEST")?.note === "" && requestCommand("request: for Axis Bank by Friday")?.note === "for Axis Bank by Friday", "REQUEST parses");
ok(requestCommand("what requests are open?") === null && requestCommand("requesting a deck") === null, "not a command");
process.env.SAM_WHATSAPP_USERS = "919876543210:Siddharth, +91 98123 45678:rahul";
ok(numberForUser("siddharth") === "919876543210" && numberForUser("rahul") === "919812345678" && numberForUser("nobody") === null, "number for user");

console.log(`requests.check: ${n} assertions passed`);
