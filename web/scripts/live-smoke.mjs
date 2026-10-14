// SAM Live end to end against a running server: login, deals, a meeting, utterances on both channels,
// insight, GET, end + summary + flow status, owner checks, a second call on the same deal; optional
// screenshots; then deletes every row it created (by id, through lib/live/store.ts).
// usage (from web/, against `next dev`, so every row is is_test):
//   node scripts/live-smoke.mjs http://localhost:3311 [--wavs <dir>] [--shots <dir>] [--keep]
//   no --wavs: a 1.2 s tone per utterance, for a server started with LIVE_MOCK=1 (scripted transcript)
//   --wavs:    real speech, files NN-rep.wav / NN-customer.wav played in name order (real providers)
// Signs in with SAM_USERS from .env.local (an admin and a non-admin); passwords are never printed.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { createJiti } from "jiti";

const args = process.argv.slice(2);
const base = args.find(a => a.startsWith("http")) ?? "http://localhost:3311";
const opt = k => { const i = args.indexOf(k); return i < 0 ? null : args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true; };
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const users = (env.SAM_USERS ?? "").split(",").map(s => s.trim().split(":"));
const admin = users.find(u => u[2] === "admin"), rep = users.find(u => u[2] !== "admin");
assert.ok(admin && rep, "SAM_USERS needs an admin and a non-admin");
const log = (...a) => console.log(...a);
const created = { meetings: [], deals: [] };

async function call(method, p, { token, body } = {}) {
  const t0 = performance.now(), raw = body instanceof Uint8Array;
  const r = await fetch(`${base}${p}`, { method, body: raw ? body : body ? JSON.stringify(body) : undefined,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(raw ? { "Content-Type": "audio/wav" } : body ? { "Content-Type": "application/json" } : {}) } });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, text, ms: Math.round(performance.now() - t0) };
}
const expect = (res, status, what) => { assert.equal(res.status, status, `${what}: HTTP ${res.status} ${res.text.slice(0, 300)}`); return res; };

/** 16 kHz mono 16-bit PCM WAV of a quiet tone. */
function tone(seconds = 1.2, hz = 220) {
  const rate = 16000, n = Math.round(seconds * rate), b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 6000), 44 + i * 2);
  return new Uint8Array(b);
}
const wavMs = w => Math.round(((w.length - 44) / 32000) * 1000);
const wavDir = opt("--wavs");
const utterances = wavDir
  ? fs.readdirSync(wavDir).filter(f => /^\d+-(rep|customer)\.wav$/.test(f)).sort().map(f => ({ channel: f.match(/(rep|customer)/)[1], wav: new Uint8Array(fs.readFileSync(path.join(wavDir, f))), name: f }))
  : Array.from({ length: 24 }, (_, i) => ({ channel: i % 2 ? "customer" : "rep", wav: tone(), name: `tone-${i}` })); // the whole mock script

async function post(meetingId, token, list, startMs = 0) {
  let t_ms = startMs;
  const out = [];
  for (const u of list) {
    const r = expect(await call("POST", `/api/live/meetings/${meetingId}/audio?channel=${u.channel}&t_ms=${t_ms}&duration_ms=${wavMs(u.wav)}`, { token, body: u.wav }), 200, `audio ${u.name}`);
    out.push({ ...u, ms: r.ms, seg: r.json.segment, insight: r.json.insight });
    log(`  ${u.channel.padEnd(8)} ${String(r.ms).padStart(5)} ms  ${r.json.segment ? `${r.json.segment.model ?? ""} "${r.json.segment.text.slice(0, 90)}"` : "(nothing kept)"}${r.json.insight ? `  + insight by ${r.json.insight.model}: ${Object.values(r.json.insight.qualification).filter(f => f.status !== "open").length}/10 fields, ask ${r.json.insight.ask_next.map(a => a.key).join(",")}, cards ${r.json.insight.battlecards.map(c => c.title).join(" | ") || "none"}` : ""}`);
    t_ms += wavMs(u.wav) + 700;
  }
  return out;
}

try {
  // ---- sign-in
  expect(await call("POST", "/api/live/login", { body: { id: rep[0], password: `${rep[1]}-wrong` } }), 401, "wrong password");
  expect(await call("GET", "/api/live/deals"), 401, "no token");
  const L = expect(await call("POST", "/api/live/login", { body: { id: rep[0], password: rep[1] } }), 200, "rep login");
  const repTok = L.json.token, adminTok = expect(await call("POST", "/api/live/login", { body: { id: admin[0], password: admin[1] } }), 200, "admin login").json.token;
  assert.deepEqual(L.json.user, { id: rep[0], admin: false });
  log(`login ok (${L.ms} ms); bad password 401; no token 401`);

  // ---- a meeting
  const company = `SAM Live test bank ${Date.now() % 100000}`;
  const M = expect(await call("POST", "/api/live/meetings", { token: repTok, body: { company, contact_name: "Rajesh Kumar", contact_email: "rajesh.kumar@example.com", contact_title: "CIO", title: "Discovery call" } }), 200, "create meeting");
  const m1 = M.json.meeting;
  created.meetings.push(m1.id); created.deals.push(m1.deal_id);
  assert.equal(M.json.framework.length, 10);
  assert.ok(Object.values(m1.qualification).every(f => f.status === "open"), "a new deal starts open");
  log(`meeting ${m1.id} created (${M.ms} ms), deal ${m1.deal_id}, framework ${M.json.framework.map(f => f.key).join(",")}`);
  const D = expect(await call("GET", `/api/live/deals?q=${encodeURIComponent(company.slice(0, 18))}`, { token: repTok }), 200, "deals");
  assert.ok(D.json.deals.some(d => d.id === m1.deal_id && d.contact_name === "Rajesh Kumar"), "deal found by autocomplete");
  assert.ok(!(await call("GET", `/api/live/deals?q=${encodeURIComponent(company)}`, { token: adminTok })).json.deals.length, "deals are the caller's own");
  log(`deals autocomplete ok (${D.ms} ms)`);

  // `next dev` compiles a route on its first request: warm audio and end (404s) so the timings below are the work.
  const none = "00000000-0000-0000-0000-000000000000";
  expect(await call("POST", `/api/live/meetings/${none}/audio?channel=rep&t_ms=0`, { token: repTok, body: tone(0.1) }), 404, "warm audio");
  expect(await call("POST", `/api/live/meetings/${none}/end`, { token: repTok }), 404, "warm end");

  // ---- the call: first half, wait out the 12 s insight window, second half
  const half = Math.ceil(utterances.length / 2), started = Date.now();
  log("utterances:");
  const a = await post(m1.id, repTok, utterances.slice(0, half));
  const lastAt = a.reduce((t, u) => t + wavMs(u.wav) + 700, 0);
  const wait = 12_500 - (Date.now() - started);
  if (wait > 0) { log(`  (waiting ${(wait / 1000).toFixed(1)} s for the next insight window)`); await new Promise(r => setTimeout(r, wait)); }
  const b = await post(m1.id, repTok, utterances.slice(half), lastAt);
  const all = [...a, ...b], insights = all.filter(u => u.insight);
  assert.ok(insights.length >= 2, `at least two insights ran (${insights.length})`);
  const retry = expect(await call("POST", `/api/live/meetings/${m1.id}/audio?channel=${all[0].channel}&t_ms=0&duration_ms=1`, { token: repTok, body: all[0].wav }), 200, "retried upload");
  assert.equal(retry.json.segment?.id, all[0].seg?.id, "a retried upload returns the stored segment");
  expect(await call("POST", `/api/live/meetings/${m1.id}/audio?channel=both&t_ms=0`, { token: repTok, body: all[0].wav }), 400, "bad channel");
  expect(await call("POST", `/api/live/meetings/${m1.id}/audio?channel=rep&t_ms=5`, { token: repTok, body: new Uint8Array(100) }), 415, "not a WAV");

  // ---- reading it back, and who may
  const G = expect(await call("GET", `/api/live/meetings/${m1.id}`, { token: repTok }), 200, "get meeting");
  log(`GET meeting (${G.ms} ms): ${G.json.segments.length} segments, qualification ${Object.values(G.json.meeting.qualification).filter(f => f.status !== "open").length}/10, ${G.json.meeting.battlecards.length} cards, is_test ${G.json.meeting.is_test}`);
  assert.equal(G.json.meeting.is_test, true, "dev traffic is test traffic");
  assert.equal(G.json.meeting.deal.company, company);
  expect(await call("GET", `/api/live/meetings/${m1.id}`, { token: adminTok }), 200, "admin reads a rep's call");
  const other = expect(await call("POST", "/api/live/meetings", { token: adminTok, body: { company: `${company} (admin)` } }), 200, "admin meeting").json.meeting;
  created.meetings.push(other.id); created.deals.push(other.deal_id);
  expect(await call("GET", `/api/live/meetings/${other.id}`, { token: repTok }), 404, "a rep cannot read another's call");
  expect(await call("POST", `/api/live/meetings/${other.id}/end`, { token: repTok }), 404, "...or end it");
  expect(await call("POST", "/api/live/meetings", { token: repTok, body: { deal_id: other.deal_id } }), 404, "...or join their deal");
  log("owner checks ok: admin 200, other rep 404 on read, end and deal");

  // ---- end
  const E = expect(await call("POST", `/api/live/meetings/${m1.id}/end`, { token: repTok }), 200, "end");
  log(`END (${E.ms} ms): model ${E.json.summary.model}, flow_status ${E.json.flow_status}, deal_score ${E.json.summary.deal_score}`);
  log(`  overview: ${E.json.summary.overview}`);
  log(`  follow-up subject: ${E.json.summary.follow_up_email.subject}`);
  log(`  follow-up body:\n${E.json.summary.follow_up_email.body.split("\n").map(l => `    | ${l}`).join("\n")}`);
  assert.ok(E.json.summary.overview && E.json.summary.follow_up_email.body, "summary has an overview and an email");
  assert.ok(!/\[[^\]]*\]/.test(E.json.summary.follow_up_email.body), "no [placeholder] in the email");
  const E2 = expect(await call("POST", `/api/live/meetings/${m1.id}/end`, { token: repTok }), 200, "end again");
  assert.deepEqual(E2.json.summary, E.json.summary, "ending twice returns the first summary");
  expect(await call("POST", `/api/live/meetings/${m1.id}/audio?channel=rep&t_ms=99999`, { token: repTok, body: all[0].wav }), 409, "audio after end");
  log(`end is idempotent (${E2.ms} ms); audio after end 409`);

  // ---- a second call on the same deal starts from the first one's qualification
  const M2 = expect(await call("POST", "/api/live/meetings", { token: repTok, body: { deal_id: m1.deal_id, title: "Technical session" } }), 200, "second meeting");
  const m2 = M2.json.meeting;
  created.meetings.push(m2.id);
  const carried = Object.keys(m2.qualification).filter(k => m2.qualification[k].status !== "open").length;
  assert.equal(carried, Object.values(E.json.summary.qualification).filter(f => f.status !== "open").length, "qualification carried over");
  log(`second meeting ${m2.id} starts with ${carried}/10 fields carried over`);
  await post(m2.id, repTok, utterances.slice(-2), 0);
  const byName = expect(await call("POST", "/api/live/meetings", { token: repTok, body: { company: company.toUpperCase() } }), 200, "same company, other case");
  created.meetings.push(byName.json.meeting.id);
  assert.equal(byName.json.meeting.deal_id, m1.deal_id, "a company name lands on the existing deal");

  // ---- provider report: admin only
  expect(await call("GET", "/api/v1/provider", { token: repTok }), 403, "rep token on the provider check");
  const P = expect(await call("GET", "/api/v1/provider", { token: adminTok }), 200, "admin token on the provider check");
  log(`provider live report: ${JSON.stringify(P.json.live)}`);

  // ---- screenshots
  const shots = opt("--shots");
  if (shots) {
    const { chromium } = await import("playwright-core");
    fs.mkdirSync(shots, { recursive: true });
    const channel = fs.existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe") ? "chrome" : "msedge";
    const browser = await chromium.launch({ channel, headless: true });
    const session = async (u, width, colorScheme = "light") => {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, deviceScaleFactor: width < 500 ? 2 : 1 });
      const page = await ctx.newPage();
      await page.goto(`${base}/login`);
      await page.fill("input[autocomplete=username]", u[0]);
      await page.fill("input[type=password]", u[1]);
      await page.click("form button");
      await page.waitForURL(`${base}/`);
      return { ctx, page };
    };
    const shot = async (page, url, name, full = true) => { await page.goto(`${base}${url}`); await page.waitForLoadState("networkidle"); await page.screenshot({ path: `${shots}/${name}.png`, fullPage: full }); log(`  shot ${name}`); };
    const tag = opt("--tag") ?? (wavDir ? "real" : "mock");
    {
      const { ctx, page } = await session(admin, 1440);
      await shot(page, "/live", `${tag}-1-list-admin-1440`);
      await shot(page, "/live?test=1", `${tag}-2-list-admin-with-test-1440`);
      await shot(page, `/live/${m1.id}`, `${tag}-3-call-1440`);
      await shot(page, `/live/${m2.id}`, `${tag}-4-call-live-1440`);
      await page.click("text=End & summarise");
      await page.waitForSelector(".lv-score", { timeout: 60_000 });
      await page.screenshot({ path: `${shots}/${tag}-5-call-ended-from-dashboard-1440.png`, fullPage: true });
      log(`  shot ${tag}-5-call-ended-from-dashboard-1440 (End & summarise worked from the browser)`);
      await shot(page, `/live/deals/${m1.deal_id}`, `${tag}-6-deal-1440`);
      await ctx.close();
    }
    {
      const { ctx, page } = await session(admin, 1440, "dark");
      await shot(page, `/live/${m1.id}`, `${tag}-7-call-dark-1440`);
      await ctx.close();
    }
    {
      const { ctx, page } = await session(rep, 390);
      await shot(page, "/live", `${tag}-8-list-rep-390`);
      await shot(page, `/live/${m1.id}`, `${tag}-9-call-rep-390`);
      await page.goto(`${base}/live/${other.id}`);
      assert.ok((await page.textContent("body")).includes("404"), "a rep's browser gets 404 on someone else's call");
      await ctx.close();
    }
    {
      const { ctx, page } = await session(admin, 1280);
      await shot(page, `/live/${m1.id}`, `${tag}-10-call-1280`, false);
      await ctx.close();
    }
    await browser.close();
  }
  log("SMOKE PASSED");
} finally {
  if (!opt("--keep")) {
    for (const [k, v] of Object.entries(env)) if (k.startsWith("SUPABASE_")) process.env[k] = v;
    const jiti = createJiti(import.meta.url, { alias: { "@": path.resolve(".") } });
    const { db } = await jiti.import("../lib/live/store.ts");
    const ids = list => list.filter(Boolean).map(i => `"${i}"`).join(",");
    if (created.meetings.length) await db(`live_meetings?id=in.(${ids(created.meetings)})`, { method: "DELETE" });
    if (created.deals.length) await db(`live_deals?id=in.(${ids([...new Set(created.deals)])})`, { method: "DELETE" });
    const left = await db(`live_meetings?id=in.(${ids(created.meetings) || '"00000000-0000-0000-0000-000000000000"'})&select=id`);
    const segs = await db(`live_segments?meeting_id=in.(${ids(created.meetings) || '"00000000-0000-0000-0000-000000000000"'})&select=id`);
    log(`cleanup: deleted ${created.meetings.length} meetings and ${new Set(created.deals).size} deals; left behind: ${left.length} meetings, ${segs.length} segments`);
  }
}
