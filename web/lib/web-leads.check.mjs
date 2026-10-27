// Run: node lib/web-leads.check.mjs (from web/) - stage 3's lead guardrails, offline (PostgREST, DNS and the Power
// Automate webhook are stubbed):
//   1. validation and normalising of the Bookings trigger body (either key casing), the custom answers, the payload shape
//   2. work email: syntax, disposable, internal, free-mail flagged; MX (ok / none / null MX / error / timeout)
//   3. junk names, companies, roles, phones, links in the notes (and real names that must pass)
//   4. the route: secret required and compared in constant time, browser refused, 400s, dedupe within 24 h, daily cap,
//      quarantine never forwards, a webhook failure keeps the lead with forward_error, a failed insert is retried
//   5. Release forwards (once), Forward again after a failure, Discard; no PII, URL or secret in any log line
//   6. the 05 / 06 SQL (RLS, no website grants, settings keys, event allowlist, where true) and the digest's lead line
import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": web } });
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; }; const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const SUPA = "https://stub.supabase.co", HOOK = "https://prod-00.westus.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?api-version=2016-06-01&sig=SIGSECRETSIG";
const SECRET = "lead-secret-0123456789abcdef";
Object.assign(process.env, { SUPABASE_URL: SUPA, SUPABASE_SERVICE_KEY: "service-key-stub", WEB_LEAD_SECRET: SECRET, WEB_LEAD_WEBHOOK_URL: HOOK });

// Every log line of the run (the route's own and console.*), to prove at the end that none carries PII or a secret.
const lines = [], print = console.log;
for (const k of ["log", "warn", "error", "info"]) console[k] = (...a) => lines.push(a.map(String).join(" "));
const L = await jiti.import("./web-leads.ts");

// ---------------------------------------------------------------- stubs: PostgREST (sam_web_leads in memory) + the flow
const db = [];
const hook = { status: 202, throws: null, calls: [] };
const fail = { insert: false };
const match = (row, q) => [...q.entries()].every(([k, v]) => {
  if (["select", "order", "limit"].includes(k)) return true;
  const [op, ...rest] = v.split("."), val = rest.join("."), cur = String(row[k]);
  if (op === "eq" || op === "is") return cur === val;
  if (op === "neq") return cur !== val;
  if (op === "gte") return cur >= val;
  throw new Error(`stub: no operator ${op}`);
});
globalThis.fetch = async (url, init = {}) => {
  const s = String(url);
  if (s.startsWith("https://prod-00.westus.logic.azure.com/")) {
    hook.calls.push(JSON.parse(init.body));
    if (hook.throws) throw hook.throws;
    return new Response(null, { status: hook.status });
  }
  const u = new URL(s), q = u.searchParams, m = init.method ?? "GET";
  assert.equal(u.origin + u.pathname, `${SUPA}/rest/v1/sam_web_leads`, `only sam_web_leads is touched (${u.pathname})`);
  assert.equal(init.headers.Authorization, "Bearer service-key-stub");
  if (m === "GET") {
    let r = db.filter(x => match(x, q));
    if (q.get("order") === "created_at.desc") r = [...r].sort((a, b) => b.created_at.localeCompare(a.created_at));
    return Response.json(q.get("limit") ? r.slice(0, +q.get("limit")) : r);
  }
  if (m === "POST") {
    const row = JSON.parse(init.body);
    // A real check violation quotes the row: the route must not pass that on to a log.
    if (fail.insert) return Response.json({ code: "23514", message: "violates check", details: `Failing row contains (${row.email}, ${row.first_name})` }, { status: 400 });
    db.push(row);
    return new Response(null, { status: 201 });
  }
  if (m === "PATCH") {
    const rows = db.filter(x => match(x, q));
    for (const r of rows) Object.assign(r, JSON.parse(init.body));
    return init.headers.Prefer === "return=representation" ? Response.json(rows) : new Response(null, { status: 204 });
  }
  throw new Error(`stub: ${m}`);
};

const MX = { "acme-corp.com": [{ exchange: "acme-corp-com.mail.protection.outlook.com", priority: 0 }], "gmail.com": [{ exchange: "gmail-smtp-in.l.google.com", priority: 5 }],
  "nullmx.example": [{ exchange: "", priority: 0 }], "empty.example": [] };
const resolveMx = async d => {
  if (d === "dnsfail.example") throw Object.assign(new Error("x"), { code: "ESERVFAIL" });
  if (!(d in MX)) throw Object.assign(new Error("x"), { code: d.startsWith("nodata") ? "ENODATA" : "ENOTFOUND" });
  return MX[d];
};

// ---------------------------------------------------------------- 1. normalising the Bookings body
const booking = (o = {}) => ({
  SelfServiceAppointmentId: "ssa-1", ServiceName: "Free IT Health Assessment", StartTime: "2026-10-29T05:30:00.0000000", Duration: 30,
  CustomerName: "Priya Raman", CustomerEmail: "Priya.Raman@Acme-Corp.com", CustomerPhone: "+91 98450 12345", CustomerTimeZone: "India Standard Time",
  CustomerNotes: "We run 600 Citrix seats.", JoinWebURL: "https://teams.microsoft.com/l/meetup-join/secret", CustomerId: "cust-1",
  StaffMembers: [{ DisplayName: "Rep", EmailAddress: "rep@accops.com" }],
  CustomerLocation: { PhysicalAddress: { Street: "1 MG Road", City: "Pune", CountryOrRegion: "India" } },
  CustomQuestionAnswers: [{ Question: "Company name", Answer: "Acme Corp" }, { Question: "Your role", Answer: "Head of IT" },
    { Question: "Number of users", Answer: "600" }, { Question: "Anything else?", Answer: "no" }],
  ...o });
let r = L.normalise(booking());
eq(r.lead, { source: "citrix-lp-booking", first_name: "Priya", last_name: "Raman", email: "priya.raman@acme-corp.com", phone: "+91 98450 12345",
  company: "Acme Corp", role: "Head of IT", seats: "600", country: "India", page: L.LP_PAGE, conversation_id: null, booking_start: "2026-10-29T05:30:00.000Z",
  raw: { appointment_id: "ssa-1", service: "Free IT Health Assessment", time_zone: "India Standard Time", notes: "We run 600 Citrix seats.",
    answers: [{ q: "Company name", a: "Acme Corp" }, { q: "Your role", a: "Head of IT" }, { q: "Number of users", a: "600" }, { q: "Anything else?", a: "no" }],
    utm: undefined, tracking: undefined } }, "the Bookings trigger body -> a lead (offset-less StartTime is UTC, email lowercased)");
ok(!/teams\.microsoft|cust-1|rep@accops|MG Road/.test(JSON.stringify(r.lead)), "never kept: the join link, customer id, staff, street address");
eq(r.clipped, false, "nothing clipped");
r = L.normalise({ customerName: "Ana  Lopez", customerEmailAddress: "ana@acme-corp.com", startTime: "2026-10-29T05:30:00+05:30",
  customQuestionAnswers: [{ question: "Number of users in your company", answer: "1,200" }, { question: "Your role in the organisation", answer: "CISO" }, { question: "Organisation", answer: "Acme" }] });
eq([r.lead.first_name, r.lead.last_name, r.lead.email, r.lead.seats, r.lead.role, r.lead.company, r.lead.booking_start],
  ["Ana", "Lopez", "ana@acme-corp.com", "1,200", "CISO", "Acme", "2026-10-29T00:00:00.000Z"], "camelCase keys work; users before role before company");
eq(L.normalise(booking(), new URLSearchParams("source=citrix-lp-chat")).lead.source, "citrix-lp-chat", "?source=citrix-lp-chat (the chat's calendar)");
eq(L.normalise(booking({ source: "evil" })).lead.source, "citrix-lp-booking", "an unknown source falls back");
eq(L.normalise(booking({ company: "Direct Co", page: "javascript:alert(1)", conversation_id: "c_123" })).lead.company, "Direct Co", "a direct company field wins");
eq([L.normalise(booking({ page: "javascript:alert(1)" })).lead.page, L.normalise(booking({ conversation_id: "c_1 2" })).lead.conversation_id], [L.LP_PAGE, null], "bad page / conversation id dropped");
eq(L.normalise(booking({ TrackingData: "https://lp/?utm_source=linkedin&utm_campaign=citrix-q4" })).lead.raw.utm, { utm_source: "linkedin", utm_campaign: "citrix-q4" }, "utm_* from TrackingData");
eq(L.normalise(booking({ StartTime: "not a date" })).lead.booking_start, null, "an unreadable start is null");
ok(L.normalise(booking({ CustomQuestionAnswers: [{ Question: "Company", Answer: "x".repeat(300) }] })).clipped, "an over-long answer is cut and flagged");
eq(L.normalise(booking({ CustomerEmail: undefined, Customers: [{ Name: "Group Person", Email: "gp@acme-corp.com" }] })).lead.email, "gp@acme-corp.com", "a group booking's first customer");
for (const [b, why] of [[null, "null"], [[], "array"], ["x", "string"], [booking({ CustomerEmail: "" }), "no email"], [booking({ CustomerName: " " }), "no name"], [booking({ CustomerEmail: `${"a".repeat(250)}@x.com` }), "email > 254"]])
  ok("error" in L.normalise(b), `400 shape: ${why}`);
const row0 = { ...L.normalise(booking()).lead, id: "11111111-1111-4111-8111-111111111111", created_at: "2026-10-27T10:00:00.000Z", status: "clean", reasons: [], forwarded: false, forwarded_at: null, forward_error: null };
const P = L.payload(row0);
eq(Object.keys(P), ["source", "first_name", "last_name", "email", "phone", "company", "role", "seats", "country", "page", "conversation_id", "booking_start",
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "submitted_at", "sam_lead_id"], "payload: the agreed flat fields, in order");
ok(Object.values(P).every(v => typeof v === "string"), "payload: every value a string (Power Automate Parse JSON)");
eq([P.conversation_id, P.utm_source, P.sam_lead_id, P.submitted_at], ["", "", row0.id, row0.created_at], "unknown = \"\"; the SAM id and time");

// ---------------------------------------------------------------- 2. email
for (const [e, want] of [["jane@acme-corp.com", []], ["jane@gmail.com", ["free_email"]], ["j@yahoo.co.in", ["free_email"]], ["j@hotmail.co.uk", ["free_email"]],
  ["j@rediffmail.com", ["free_email"]], ["j@mailinator.com", ["disposable_email"]], ["j@x.yopmail.com", ["disposable_email"]], ["j@accops.com", ["internal_email"]],
  ["bad@", ["bad_email"]], ["a..b@acme.com", ["bad_email"]], ["a b@acme.com", ["bad_email"]], [".a@acme.com", ["bad_email"]], ["o'brien@acme.ie", []]])
  eq(L.emailReasons(e), want, `email ${e}`);
eq(await L.mxCheck("acme-corp.com", resolveMx), null, "MX present: ok");
eq(await L.mxCheck("empty.example", resolveMx), "no_mx", "no MX records");
eq(await L.mxCheck("nullmx.example", resolveMx), "no_mx", "RFC 7505 null MX = takes no mail");
eq(await L.mxCheck("nowhere.example", resolveMx), "no_mx", "ENOTFOUND");
eq(await L.mxCheck("nodata.example", resolveMx), "no_mx", "ENODATA");
eq(await L.mxCheck("dnsfail.example", resolveMx), "mx_unchecked", "a DNS error");
let t0 = Date.now();
eq(await L.mxCheck("slow.example", () => new Promise(() => {}), 60), "mx_unchecked", "no answer in time");
ok(Date.now() - t0 < 1000, "the timeout really bounds the lookup");
ok(/resolveMx/.test(readFileSync(path.join(web, "lib/web-leads.ts"), "utf8")) && /from "node:dns"/.test(readFileSync(path.join(web, "lib/web-leads.ts"), "utf8")), "the real lookup is node:dns resolveMx");

// ---------------------------------------------------------------- 3. junk
for (const s of ["Priya Raman", "Siddharth Gupta", "Krzysztof Wójcik", "Ng", "Nguyen Thi", "José Álvarez", "O'Brien", "Anne-Marie", "J. R. Smith", "Zhang Wei", "Hirschfeld", "Doherty"])
  ok(!L.junk(s, "name"), `a real name passes: ${s}`);
for (const s of ["asdfgh", "qwerty", "Xjkqzt", "John123", "aaaa", "12345", "http://spam.ru", "Visit www.cheap.biz", "test", "n/a", "Jhgfdsa", "<b>hi</b>"])
  ok(L.junk(s, "name"), `junk name: ${s}`);
for (const s of ["Accops Systems Pvt Ltd", "GSPCL", "HDFC Bank", "3M India", "Tata Consultancy Services", "Liberty Mutual", "Property Solutions", "Bharti Airtel", "KPMG"])
  ok(!L.junk(s, "company"), `a real company passes: ${s}`);
for (const s of ["dsfkjhsdf", "Acme <script>", "spam.xyz", "zxcvbnm", "1234567", "Testing", "xxxx"]) ok(L.junk(s, "company"), `junk company: ${s}`);
for (const s of ["CIO", "Head of IT Infrastructure", "VP, Engineering", "Sr. Dev"]) ok(!L.junk(s, "role"), `a real role passes: ${s}`);
ok(L.junk("lkjhgf", "role"), "junk role");
const lead = o => ({ ...L.normalise(booking()).lead, ...o });
eq(L.fieldReasons(lead()), [], "the clean booking has no reason");
for (const [o, want] of [[{ phone: "abc" }, "bad_phone"], [{ phone: "123" }, "bad_phone"], [{ phone: "1111111111" }, "bad_phone"], [{ seats: "see www.x.com" }, "junk_seats"],
  [{ raw: { notes: "cheap pills https://x.ru" } }, "link_in_notes"], [{ first_name: "" }, "junk_name"], [{ company: "asdfasdf" }, "junk_company"], [{ role: "qwerty" }, "junk_role"]])
  ok(L.fieldReasons(lead(o)).includes(want), `${want}: ${JSON.stringify(o)}`);
eq(L.fieldReasons(lead({ phone: "", seats: "10000", role: "" })), [], "empty optional fields and 10000 users are fine");

// ---------------------------------------------------------------- 4. the route
const URL0 = "https://sam-accops.vercel.app/api/v1/leads/booking";
let now = Date.parse("2026-10-27T10:00:00Z");
const deps = { resolveMx, now: () => now, log: s => lines.push(s) };
const post = (body, h = {}, url = URL0) => L.handleBooking(new Request(url, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}`, ...h } }), deps);
const call = async (...a) => { const res = await post(...a); return { status: res.status, body: await res.json() }; };

delete process.env.WEB_LEAD_SECRET;
eq((await call(booking())).status, 503, "no WEB_LEAD_SECRET: 503, nothing accepted (fail closed)");
process.env.WEB_LEAD_SECRET = SECRET;
eq((await call(booking(), { Authorization: "" })).status, 401, "no secret: 401");
eq((await call(booking(), { Authorization: "Bearer wrong" })).status, 401, "wrong secret: 401");
eq((await call(booking(), { Authorization: `Bearer ${SECRET.slice(0, -1)}` })).status, 401, "a prefix of the secret: 401");
eq((await call(booking(), { Authorization: SECRET })).status, 401, "the secret without Bearer: 401");
ok(L.secretOk(`bearer  ${SECRET} `) && !L.secretOk(`Bearer ${SECRET}`, ""), "Bearer is case-insensitive; an empty expected secret never matches");
const src = readFileSync(path.join(web, "lib/web-leads.ts"), "utf8");
ok(/createHash\("sha256"\)[\s\S]{0,80}timingSafeEqual\(h\(got\), h\(want\)\)/.test(src) && !/got\s*===\s*want|want\s*===\s*got/.test(src), "constant time: sha256 both sides, timingSafeEqual, no ===");
eq((await call(booking(), { Origin: "https://evil.example" })).status, 403, "a browser (Origin) is refused even with the secret");
eq((await call(booking(), { "Sec-Fetch-Mode": "cors" })).status, 403, "a browser (Sec-Fetch) is refused");
eq((await call("{not json")).status, 400, "bad JSON: 400");
eq((await call(booking({ CustomerEmail: "" }))).body, { error: "CustomerEmail is required" }, "no email: 400 with the field");
eq((await call("x".repeat(40_000))).status, 400, "over 32 KB: 400");
eq([db.length, hook.calls.length], [0, 0], "nothing stored or forwarded so far");

let a = await call(booking());
eq([a.status, a.body.status, a.body.forwarded, a.body.reasons], [200, "clean", true, []], "a clean booking: stored and forwarded");
eq(hook.calls.length, 1, "forwarded once");
eq(hook.calls[0].sam_lead_id, a.body.sam_lead_id, "the payload carries the SAM id");
eq([hook.calls[0].email, hook.calls[0].company, hook.calls[0].seats, hook.calls[0].source], ["priya.raman@acme-corp.com", "Acme Corp", "600", "citrix-lp-booking"], "payload fields");
let row = db.find(x => x.id === a.body.sam_lead_id);
eq([row.status, row.forwarded, !!row.forwarded_at, row.forward_error, row.ip_hash], ["clean", true, true, null, undefined], "the row: clean, forwarded, no error, no IP hash");
ok(!("JoinWebURL" in row.raw) && !JSON.stringify(row).includes("teams.microsoft"), "the stored raw has no join link");

const dup = await call(booking({ CustomerEmail: "PRIYA.RAMAN@acme-corp.com", CustomerName: "Someone Else" }));
eq([dup.status, dup.body.duplicate, dup.body.sam_lead_id, db.length, hook.calls.length], [200, true, a.body.sam_lead_id, 1, 1], "same email within 24 h: attached to the first, not stored, not forwarded");
now += 25 * 3600_000;
a = await call(booking());
eq([a.body.status, db.length, hook.calls.length], ["clean", 2, 2], "the same email after 24 h is a new lead");

const quarantined = [];
for (const [o, want] of [[{ CustomerEmail: "ravi@gmail.com" }, "free_email"], [{ CustomerEmail: "x@mailinator.com" }, "disposable_email"],
  [{ CustomerEmail: "me@nowhere-at-all.example" }, "no_mx"], [{ CustomerEmail: "me@dnsfail.example" }, "mx_unchecked"],
  [{ CustomerEmail: "a1@acme-corp.com", CustomerName: "asdf qwer" }, "junk_name"], [{ CustomerEmail: "a2@acme-corp.com", CustomerNotes: "see http://x.ru" }, "link_in_notes"],
  [{ CustomerEmail: "dev@accops.com" }, "internal_email"]]) {
  const before = hook.calls.length;
  const q = await call(booking(o));
  ok(q.status === 200 && q.body.status === "suspect" && q.body.reasons.includes(want) && q.body.forwarded === false, `${want}: quarantined ${JSON.stringify(q.body)}`);
  eq(hook.calls.length, before, `${want}: never forwarded`);
  quarantined.push(q.body.sam_lead_id);
}
ok(quarantined.every(id => db.find(x => x.id === id && x.status === "suspect" && !x.forwarded && x.reasons.length)), "quarantined rows: suspect, reasons, not forwarded");

hook.status = 500;
a = await call(booking({ CustomerEmail: "fail1@acme-corp.com" }));
row = db.find(x => x.id === a.body.sam_lead_id);
eq([a.status, a.body.status, a.body.forwarded, row.status, row.forwarded, row.forward_error], [200, "clean", false, "clean", false, "the flow answered 500"], "the flow fails: the lead stays, with forward_error");
hook.status = 202; hook.throws = new TypeError("fetch failed");
a = await call(booking({ CustomerEmail: "fail2@acme-corp.com" }));
eq(db.find(x => x.id === a.body.sam_lead_id).forward_error, "the flow could not be reached", "the flow unreachable: kept");
hook.throws = null;
delete process.env.WEB_LEAD_WEBHOOK_URL;
a = await call(booking({ CustomerEmail: "nohook@acme-corp.com" }));
eq([a.status, a.body.status, db.find(x => x.id === a.body.sam_lead_id).forward_error], [200, "clean", "WEB_LEAD_WEBHOOK_URL is not set"], "no webhook URL: stored clean, not forwarded, visitor never failed");
process.env.WEB_LEAD_WEBHOOK_URL = HOOK;
hook.status = 200;
a = await call(booking({ CustomerEmail: "ok200@acme-corp.com" }));
eq(a.body.forwarded, true, "200 counts as accepted too");
hook.status = 302;
a = await call(booking({ CustomerEmail: "redirect@acme-corp.com" }));
eq(db.find(x => x.id === a.body.sam_lead_id).forward_error, "the flow answered 302", "a redirect is not acceptance (never followed)");
hook.status = 202;

// the daily cap: 25 leads in 24 h quarantines the 26th
const inDay = db.filter(x => x.created_at >= new Date(now - 24 * 3600_000).toISOString()).length;
for (let i = inDay; i < L.DAILY_CAP; i++) db.push({ ...row0, id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, email: `filler${i}@acme-corp.com`, created_at: new Date(now - 1000).toISOString() });
a = await call(booking({ CustomerEmail: "flood@acme-corp.com" }));
eq([a.body.status, a.body.reasons], ["suspect", ["daily_cap"]], `over ${L.DAILY_CAP} in 24 h: quarantined`);
const capped = a.body.sam_lead_id;
db.splice(0, db.length, ...db.filter(x => !x.email.startsWith("filler")));

fail.insert = true;
a = await call(booking({ CustomerEmail: "insertfail@acme-corp.com", CustomerName: "Zed Insertfail" }));
eq([a.status, a.body.error], [500, "not stored, try again"], "a failed insert: 500, so the flow retries");
fail.insert = false;
ok(lines.some(l => /lead: not stored \(sam_web_leads returned 400 \(23514\)\)/.test(l)), "logged with the status and code only");

// ---------------------------------------------------------------- 5. Release / Forward again / Discard
const sus = quarantined[0];
let calls = hook.calls.length;
eq(await L.releaseLead(sus), { ok: true, forwarded: true }, "Release forwards now");
eq([hook.calls.length, hook.calls.at(-1).sam_lead_id, db.find(x => x.id === sus).status, db.find(x => x.id === sus).forwarded], [calls + 1, sus, "released", true], "released + forwarded");
eq(await L.releaseLead(sus), { ok: false, error: "Already forwarded." }, "a second Release forwards nothing");
eq(hook.calls.length, calls + 1, "still forwarded once");
hook.status = 500;
eq(await L.releaseLead(quarantined[1]), { ok: true, forwarded: false, error: "the flow answered 500" }, "Release while the flow fails: reported");
eq([db.find(x => x.id === quarantined[1]).status, db.find(x => x.id === quarantined[1]).forwarded, db.find(x => x.id === quarantined[1]).forward_error],
  ["released", false, "the flow answered 500"], "the decision is kept, the forward is not claimed");
hook.status = 202;
eq(await L.releaseLead(quarantined[1]), { ok: true, forwarded: true }, "Forward again once the flow works");
eq(db.find(x => x.id === quarantined[1]).forward_error, null, "the error is cleared");
eq(await L.discardLead(quarantined[2]), { ok: true }, "Discard");
eq(db.find(x => x.id === quarantined[2]).status, "discarded", "discarded");
calls = hook.calls.length;
eq(await L.releaseLead(quarantined[2]), { ok: false, error: "This lead was discarded." }, "a discarded lead cannot be released");
eq(await L.discardLead(sus), { ok: false, error: "Already forwarded or discarded." }, "a forwarded lead cannot be discarded");
eq(await L.releaseLead("not-a-uuid"), { ok: false, error: "No such lead." }, "a bad id");
eq(hook.calls.length, calls, "none of those forwarded anything");
ok(db.filter(x => x.status === "suspect").every(x => !x.forwarded) && db.find(x => x.id === capped).forwarded === false, "quarantine never forwards on its own");
eq(new Set(hook.calls.map(c => db.find(x => x.id === c.sam_lead_id)?.status)), new Set(["clean", "released"]), "only clean and released leads ever reached the flow");

// no PII, no URL, no secret in any log line
const PII = ["priya", "raman", "acme corp", "98450", "600 citrix", "ravi@", "gmail.com", "mailinator", "zed", "insertfail", "head of it", "logic.azure", "sigsecretsig", SECRET.toLowerCase(), "service-key-stub"];
const leaked = lines.filter(l => PII.some(p => l.toLowerCase().includes(p)));
eq(leaked, [], "no log line carries a name, an email, a company, a phone, the notes, the webhook URL or a key");
ok(lines.filter(l => /^lead /.test(l)).length >= 15, `the ops lines exist (${lines.length})`);
ok(lines.some(l => /^lead [0-9a-f-]{36}: citrix-lp-booking suspect \[free_email\], quarantined$/.test(l)), "an ops line: id, source, status, reason codes");

// ---------------------------------------------------------------- 6. SQL, boundary, digest
const sql5 = readFileSync(path.join(web, "../docs/supabase-sam-web-05-leads.sql"), "utf8"), sql3 = readFileSync(path.join(web, "../docs/supabase-sam-web-03-log.sql"), "utf8");
const code = sql5.replace(/--.*$/gm, "");
ok(/alter table sam_web_leads enable row level security/.test(code) && /revoke all on sam_web_leads from public, anon, authenticated/.test(code), "05: RLS on, closed to public/anon/authenticated");
ok(!/grant[^;]*sam_web_leads[^;]*sam_web_reader|grant[^;]*sam_web_purge_leads[^;]*sam_web_reader/.test(code) && !/create policy/.test(code), "05: no grant to the website's reader, no policy");
ok(/security definer set search_path = public, pg_catalog/.test(code), "05: definer functions with a fixed search_path");
ok(["enabled", "model_enabled", "cta_url", "cta_label", "booking_url"].every(k => code.includes(`'${k}',`)), "05: sam_web_settings() keeps every key and adds booking_url");
ok(code.includes("('booking_url', 'https://bookings.cloud.microsoft/book/AccopsUnifiedPlatformforSecureRemoteAccess2@propalmsnetwork.onmicrosoft.com/s/UEDDAf42hEiNVqsGcRVJ-w2?ismsaljsauthenabled')"), "05: the booking_url default");
const names = s => s.match(/name\s+text not null check \(name in \(([^)]*)\)\)/)?.[1] ?? s.match(/sam_web_events_name_check check \(name in \(([^)]*)\)\)/)[1];
const old = names(sql3).match(/'[a-z_]+'/g), next = names(code).match(/'[a-z_]+'/g);
eq(next, [...old, "'booking_opened'"], "05: the event allowlist is 03's plus booking_opened");
eq((code.match(/\bupdate\s+\w+\s+set\b[^;]*;/gi) ?? []).filter(u => !/\bwhere\b/i.test(u)), [], "05: no UPDATE without WHERE");
const sql6 = readFileSync(path.join(web, "../docs/supabase-sam-web-06-restamp-where.sql"), "utf8");
ok(/update sam_web_pages set url = url where true;/.test(sql6) && /create or replace function sam_web_restamp_pages\(\) returns trigger/.test(sql6), "06: the restamp has its WHERE");
ok(existsSync(path.join(web, "app/api/v1/leads/booking/route.ts")) && !existsSync(path.join(web, "app/api/web/lead")), "the lead route sits outside the website boundary");
const { boundary } = await import("../scripts/web-guard.mjs");
eq(boundary(web).findings, [], "web-guard: the website reaches no lead code");

const { buildDigest, websiteLine } = await jiti.import("./digest.ts");
const zero = { questions: 0, people: 0, answered: 0, gaps: 0, instrumented: 0, errors: 0, model_attempted: 0, fallback: 0, provider_failures: 0, p95: null };
const base = { now: "2026-10-27T03:00:00.000Z", base: "https://sam.example", requests: [], gaps: [], changes: [], queue: [], carded: [], usage: zero, usagePrev: zero, failed: [],
  lastFlowWrite: "2026-10-27T00:00:00Z", sync: null, cardCount: 300 };
const site = o => ({ conversations: 0, human: 0, suspect: 0, bot: 0, messages: 0, without_model: { num: 0, den: 0 }, model_answers: 0, cta_clicks: 0, missed: 0,
  usage: [], model_ceiling: 300, groq_daily_cap: 40, oldest_conversation_at: null, ...o });
let dg = buildDigest({ ...base, website: site({ leads: { n: 3, quarantined: 1 } }) });
ok(dg.website && websiteLine(dg.website).startsWith("3 new leads (1 quarantined) · "), `digest: the lead line (${dg.website && websiteLine(dg.website)})`);
ok(/3 new leads/.test(dg.subject) && !/website chat/.test(dg.subject), `subject: leads, no "0 website chats" (${dg.subject})`);
eq(buildDigest({ ...base, website: site({ leads: { n: 0, quarantined: 0 } }) }).website, null, "no chats, no leads: no section");
dg = buildDigest({ ...base, website: site({ conversations: 2, human: 2, leads: null }) });
ok(!/lead/.test(websiteLine(dg.website)), "no lead data (05 not applied): no lead line");

print(`web-leads.check: ${n} assertions passed`);
