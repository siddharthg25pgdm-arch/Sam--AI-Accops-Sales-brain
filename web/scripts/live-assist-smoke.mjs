// SAM Live assist, echo de-duplication, delete, and an auto-started call with no company (PATCH, End attaching
// the company the customer named, dashboard labels), against a running server with REAL providers (not LIVE_MOCK):
// speech is synthesised offline with Windows SAPI, so the same WAV on both channels is a true echo.
//   node scripts/live-assist-smoke.mjs http://localhost:3311 [--keep]
// Signs in with SAM_USERS from .env.local (an admin and a non-admin); passwords are never printed. Deletes every
// row it created and reports what is left (should be 0).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { createJiti } from "jiti";

const args = process.argv.slice(2);
const base = args.find(a => a.startsWith("http")) ?? "http://localhost:3311";
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const users = (env.SAM_USERS ?? "").split(",").map(s => s.trim().split(":"));
const admin = users.find(u => u[2] === "admin"), rep = users.find(u => u[2] !== "admin");
assert.ok(admin && rep, "SAM_USERS needs an admin and a non-admin");
const log = (...a) => console.log(...a);
const created = { meetings: [], deals: [] };
const timings = {};

async function call(method, p, { token, body } = {}) {
  const t0 = performance.now(), raw = body instanceof Uint8Array;
  const r = await fetch(`${base}${p}`, { method, body: raw ? body : body ? JSON.stringify(body) : undefined,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(raw ? { "Content-Type": "audio/wav" } : body ? { "Content-Type": "application/json" } : {}) } });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, text, ms: Math.round(performance.now() - t0) };
}
const expect = (res, status, what) => { assert.equal(res.status, status, `${what}: HTTP ${res.status} ${res.text.slice(0, 300)}`); return res; };

/** One 16 kHz mono WAV per phrase, from Windows' offline speech synthesiser. */
function speak(phrases) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sam-live-assist-"));
  const q = s => `'${s.replace(/'/g, "''")}'`;
  const files = phrases.map((_, i) => path.join(dir, `p${i}.wav`));
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
${phrases.map((p, i) => `$s.SetOutputToWaveFile(${q(files[i])}, $f); $s.Speak(${q(p)})`).join("\n")}
$s.SetOutputToNull(); $s.Dispose()`], { windowsHide: true });
  const out = files.map(f => new Uint8Array(fs.readFileSync(f)));
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}
const wavMs = w => Math.round(((w.length - 44) / 32000) * 1000);
const upload = (id, token, channel, t_ms, wav) =>
  call("POST", `/api/live/meetings/${id}/audio?channel=${channel}&t_ms=${t_ms}&duration_ms=${wavMs(wav)}`, { token, body: wav });

try {
  const repTok = expect(await call("POST", "/api/live/login", { body: { id: rep[0], password: rep[1] } }), 200, "rep login").json.token;
  const adminTok = expect(await call("POST", "/api/live/login", { body: { id: admin[0], password: admin[1] } }), 200, "admin login").json.token;
  const company = `SAM Live assist test ${Date.now() % 100000}`;
  const m = expect(await call("POST", "/api/live/meetings", { token: repTok, body: { company, contact_name: "Rajesh Kumar", title: "Assist smoke" } }), 200, "create").json.meeting;
  created.meetings.push(m.id); created.deals.push(m.deal_id);
  log(`meeting ${m.id}`);

  const [c1, r1, c2, e1, e2] = speak([
    "We're on Citrix Virtual Apps today, and the renewal price has almost doubled, so we are looking at alternatives.",
    "How many users would this cover?",
    "About twelve hundred users, mostly branch staff, and around a hundred and fifty vendor engineers.",
    "Our main concern is migration downtime for the branches during business hours.",
    "We also need multi factor authentication for the vendor engineers.",
  ]);
  // Warm the routes `next dev` compiles on first request, so the timings below are the work.
  const none = "00000000-0000-0000-0000-000000000000";
  expect(await call("POST", `/api/live/meetings/${none}/assist`, { token: repTok, body: {} }), 404, "warm assist");
  expect(await call("DELETE", `/api/live/meetings/${none}`, { token: repTok }), 404, "warm delete");

  // ---- a short call
  let t = 0;
  for (const [channel, wav] of [["customer", c1], ["rep", r1], ["customer", c2]]) {
    const r = expect(await upload(m.id, repTok, channel, t, wav), 200, `audio ${channel}`);
    log(`  ${channel.padEnd(8)} ${String(r.ms).padStart(5)} ms  "${r.json.segment?.text ?? "(nothing kept)"}"${r.json.insight ? ` + insight (${r.json.insight.model})` : ""}`);
    t += wavMs(wav) + 600;
  }

  // ---- assist: next
  const N = expect(await call("POST", `/api/live/meetings/${m.id}/assist`, { token: repTok, body: {} }), 200, "assist next");
  timings.next = N.ms;
  log(`ASSIST next (${N.ms} ms, ${N.json.model}): [${N.json.say.intent}] "${N.json.say.line}"  why: ${N.json.say.why}`);
  log(`  cards: ${N.json.cards.map(c => `${c.trigger} -> ${c.title}`).join(" | ") || "none"}`);
  assert.equal(N.json.mode, "next");
  assert.ok(N.json.say.line && ["discovery", "objection", "advance", "clarify", "rapport"].includes(N.json.say.intent), "a line and an intent");
  assert.ok(N.json.say.why.split(" ").length <= 15 && N.json.cards.length <= 2 && N.json.web === null, "why <= 15 words, <= 2 cards, no web");
  assert.ok(N.ms <= 12_000, `next within 12 s (${N.ms} ms)`);

  // ---- assist: search, one SAM answers and one it cannot
  const S1 = expect(await call("POST", `/api/live/meetings/${m.id}/assist`, { token: repTok, body: { question: "How does HyWorks compare to Citrix?" } }), 200, "search SAM");
  timings.search_sam = S1.ms;
  log(`ASSIST search "How does HyWorks compare to Citrix?" (${S1.ms} ms, ${S1.json.model}): cards ${S1.json.cards.map(c => `${c.title}${c.shareable ? " [public]" : ""}`).join(" | ") || "none"}; web ${S1.json.web ? `"${S1.json.web.answer}"` : "none"}`);
  assert.ok(S1.json.mode === "search" && S1.json.cards.length >= 1, "SAM has Citrix material");
  const S2 = expect(await call("POST", `/api/live/meetings/${m.id}/assist`, { token: repTok, body: { question: "What did Omnissa announce this year?" } }), 200, "search web");
  timings.search_web = S2.ms;
  log(`ASSIST search "What did Omnissa announce this year?" (${S2.ms} ms, ${S2.json.model}): cards ${S2.json.cards.map(c => c.title).join(" | ") || "none"}`);
  log(`  web (unverified=${S2.json.web?.unverified}): "${S2.json.web?.answer}"`);
  for (const s of S2.json.web?.sources ?? []) log(`    - ${s.title} <${s.url}>`);
  assert.ok(S2.json.web?.answer && S2.json.web.answer.split(" ").length <= 81 && S2.json.web.sources.length <= 3 && S2.json.web.unverified === true, "a labelled web answer");
  assert.ok(S1.ms <= 25_000 && S2.ms <= 25_000, "search within 25 s");

  // ---- echo: the customer first, then the mic's copy on the rep channel -> dropped
  t += 2000;
  const ec = expect(await upload(m.id, repTok, "customer", t, e1), 200, "echo customer");
  const er = expect(await upload(m.id, repTok, "rep", t + 300, e1), 200, "echo rep");
  timings.echo_drop = er.ms;
  log(`ECHO drop: customer "${ec.json.segment?.text}" then the same on the rep channel -> ${JSON.stringify({ segment: er.json.segment, dropped: er.json.dropped })} (${er.ms} ms)`);
  assert.deepEqual([er.json.segment, er.json.dropped], [null, "echo"], "a rep echo is dropped");
  // ---- echo: the rep channel first (stored), then the customer's copy -> the rep segment is removed
  t += wavMs(e1) + 3000;
  const rr = expect(await upload(m.id, repTok, "rep", t, e2), 200, "echo rep first");
  assert.ok(rr.json.segment?.id, `stored while nothing is near: ${rr.text}`);
  const rc = expect(await upload(m.id, repTok, "customer", t + 200, e2), 200, "echo customer second");
  timings.echo_remove = rc.ms;
  log(`ECHO remove: rep segment ${rr.json.segment.id} "${rr.json.segment.text}", then the customer's copy -> removed_segment_ids ${JSON.stringify(rc.json.removed_segment_ids)} (${rc.ms} ms)`);
  assert.deepEqual(rc.json.removed_segment_ids, [rr.json.segment.id], "the rep echo is removed");
  const G = expect(await call("GET", `/api/live/meetings/${m.id}`, { token: repTok }), 200, "get");
  assert.ok(!G.json.segments.some(s => s.id === rr.json.segment.id) && G.json.segments.filter(s => s.text === rc.json.segment.text).length === 1, "the transcript keeps one copy");
  assert.equal(G.json.segments.filter(s => s.channel === "rep").length, 1, "only the rep's real question is left on the rep channel");
  log(`transcript now: ${G.json.segments.map(s => `${s.channel}:${s.id}`).join(" ")}`);

  // ---- delete: who may
  const other = expect(await call("POST", "/api/live/meetings", { token: adminTok, body: { company: `${company} (admin)` } }), 200, "admin meeting").json.meeting;
  created.meetings.push(other.id); created.deals.push(other.deal_id);
  expect(await call("DELETE", `/api/live/meetings/${m.id}`), 401, "delete without a login");
  expect(await call("DELETE", `/api/live/meetings/${other.id}`, { token: repTok }), 404, "a rep deleting the admin's call");
  expect(await call("GET", `/api/live/meetings/${other.id}`, { token: adminTok }), 200, "...which is still there");
  // a second call on the rep's deal: deleting the first keeps the deal
  const m2 = expect(await call("POST", "/api/live/meetings", { token: repTok, body: { deal_id: m.deal_id } }), 200, "second call").json.meeting;
  created.meetings.push(m2.id);
  const D1 = expect(await call("DELETE", `/api/live/meetings/${m.id}`, { token: repTok }), 200, "owner deletes");
  timings.delete = D1.ms;
  assert.deepEqual(D1.json, { deleted: m.id, deal_deleted: false }, "the deal stays while another call is on it");
  expect(await call("GET", `/api/live/meetings/${m.id}`, { token: repTok }), 404, "deleted call is gone");
  // assist on an ended call: 409
  expect(await call("POST", `/api/live/meetings/${m2.id}/end`, { token: repTok }), 200, "end the second call");
  expect(await call("POST", `/api/live/meetings/${m2.id}/assist`, { token: repTok, body: {} }), 409, "assist after end");
  const D2 = expect(await call("DELETE", `/api/live/meetings/${m2.id}`, { token: adminTok }), 200, "admin deletes the rep's last call");
  assert.deepEqual(D2.json, { deleted: m2.id, deal_deleted: true }, "the last call takes the deal with it");
  const D3 = expect(await call("DELETE", `/api/live/meetings/${other.id}`, { token: adminTok }), 200, "admin deletes own");
  assert.equal(D3.json.deal_deleted, true);
  log(`DELETE ok (${D1.ms} ms): 401 without login, 404 for another rep, deal kept while a call remains, removed with the last; assist after end 409`);

  // ---- an auto-started Phone Link call with no company: the customer names it, End puts the call on that deal
  const A = expect(await call("POST", "/api/live/meetings", { token: repTok, body: { platform: "phone-link", auto_started: true } }), 200, "auto call");
  const auto = A.json.meeting;
  created.meetings.push(auto.id);
  assert.deepEqual([auto.deal_id, auto.platform, auto.auto_started], [null, "phone-link", true], "no company: no deal, platform and auto recorded");
  const cookie = (await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: rep[0], password: rep[1] }) }))
    .headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  const page = async p => (await fetch(`${base}${p}`, { headers: { Cookie: cookie } })).text();
  const html = await page(`/live/${auto.id}`);
  for (const want of ["Unknown caller", "Phone Link", ">Auto<", "Add company &amp; contact", "Delete call"]) assert.ok(html.includes(want), `call page shows ${want}`);
  const list = await page("/live");
  assert.ok(list.includes("Calls by platform") && list.includes("Unknown caller"), "the list shows the platform strip and the unknown caller");
  log(`auto call ${auto.id}: page shows Unknown caller, Phone Link, Auto, the edit control; /live shows Calls by platform`);
  const [p1, p2, p3] = speak([
    "Hi, this is Priya from Sunrise Cooperative Bank. I had a missed call from this number about remote access.",
    "Thanks for calling back, Priya. What are you using for remote access today?",
    "We use Citrix for about four hundred branch users, and the renewal is due in March.",
  ]);
  t = 0;
  for (const [channel, wav] of [["customer", p1], ["rep", p2], ["customer", p3]]) {
    const r = expect(await upload(auto.id, repTok, channel, t, wav), 200, `auto audio ${channel}`);
    log(`  ${channel.padEnd(8)} ${String(r.ms).padStart(5)} ms  "${r.json.segment?.text ?? "(nothing kept)"}"`);
    t += wavMs(wav) + 600;
  }
  const AE = expect(await call("POST", `/api/live/meetings/${auto.id}/end`, { token: repTok }), 200, "end auto call");
  timings.end_auto = AE.ms;
  const AG = expect(await call("GET", `/api/live/meetings/${auto.id}`, { token: repTok }), 200, "get auto call");
  if (AG.json.meeting.deal_id) created.deals.push(AG.json.meeting.deal_id);
  log(`END auto call (${AE.ms} ms, ${AE.json.summary.model}, flow ${AE.json.flow_status}): detected ${JSON.stringify(AE.json.summary.detected)} -> deal ${JSON.stringify(AG.json.meeting.deal && { company: AG.json.meeting.deal.company, contact_name: AG.json.meeting.deal.contact_name, contact_title: AG.json.meeting.deal.contact_title })}`);
  assert.match(AG.json.meeting.deal?.company ?? "", /^sunrise co-?operative bank$/i, "the call is now on the Sunrise Cooperative Bank deal");
  assert.match(AG.json.meeting.deal.contact_name ?? "", /priya/i, "with Priya as the contact");
  // PATCH: name the company of a second auto call, then correct it: the first deal it was put on goes
  const B = expect(await call("POST", "/api/live/meetings", { token: repTok, body: { platform: "teams", auto_started: true } }), 200, "auto call 2").json.meeting;
  created.meetings.push(B.id);
  expect(await call("PATCH", `/api/live/meetings/${B.id}`, { token: adminTok, body: {} }), 400, "PATCH with nothing");
  expect(await call("PATCH", `/api/live/meetings/${B.id}`, { body: { company: "x" } }), 401, "PATCH without a login");
  expect(await call("PATCH", `/api/live/meetings/${other.id}`, { token: repTok, body: { company: "x" } }), 404, "PATCH someone else's call");
  const P1 = expect(await call("PATCH", `/api/live/meetings/${B.id}`, { token: repTok, body: { company: `${company} typo`, contact_name: "Arun" } }), 200, "PATCH company");
  created.deals.push(P1.json.deal.id);
  const P2 = expect(await call("PATCH", `/api/live/meetings/${B.id}`, { token: adminTok, body: { company: `${company} fixed`, contact_title: "CISO", title: "Inbound cold call" } }), 200, "PATCH again");
  created.deals.push(P2.json.deal.id);
  timings.patch = P2.ms;
  assert.ok(P2.json.meeting.deal_id === P2.json.deal.id && P2.json.deal.id !== P1.json.deal.id && P2.json.meeting.title === "Inbound cold call", "moved to the corrected deal");
  const left = expect(await call("GET", `/api/live/deals?q=${encodeURIComponent(`${company} typo`)}`, { token: repTok }), 200, "deals").json.deals;
  assert.equal(left.length, 0, "the mistyped deal, now empty, is gone");
  assert.ok((await page(`/live/${B.id}`)).includes(`${company} fixed`) && (await page(`/live/${B.id}`)).includes("Teams"), "the page shows the company and Teams");
  log(`PATCH ok (${P1.ms} / ${P2.ms} ms): 400 empty, 401 no login, 404 another's call; deal moved, empty old deal deleted, admin's edit lands on the rep's deal`);
  log(`timings ms: ${JSON.stringify(timings)}`);
  log("ASSIST SMOKE PASSED");
} finally {
  if (!args.includes("--keep")) {
    for (const [k, v] of Object.entries(env)) if (k.startsWith("SUPABASE_")) process.env[k] = v;
    const jiti = createJiti(import.meta.url, { alias: { "@": path.resolve(".") } });
    const { db } = await jiti.import("../lib/live/store.ts");
    const ids = list => list.filter(Boolean).map(i => `"${i}"`).join(",") || '"00000000-0000-0000-0000-000000000000"';
    await db(`live_meetings?id=in.(${ids(created.meetings)})`, { method: "DELETE" });
    await db(`live_deals?id=in.(${ids([...new Set(created.deals)])})`, { method: "DELETE" });
    const left = [...await db(`live_meetings?id=in.(${ids(created.meetings)})&select=id`), ...await db(`live_deals?id=in.(${ids(created.deals)})&select=id`),
      ...await db(`live_segments?meeting_id=in.(${ids(created.meetings)})&select=id`)];
    log(`cleanup: ${left.length} rows left behind`);
  }
}
