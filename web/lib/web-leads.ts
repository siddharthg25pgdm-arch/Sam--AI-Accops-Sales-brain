/** Stage-3 leads (docs/plans/web-stage3-leads-task.md 2.5, Siddharth's decisions of 27 Oct): a Microsoft Bookings
 *  appointment arrives server-to-server from a Power Automate flow (POST /api/v1/leads/booking), is checked, stored in
 *  sam_web_leads and, only when every check passes, forwarded to the Website Leads flow (WEB_LEAD_WEBHOOK_URL, a
 *  Power Automate HTTP trigger). Anything that fails a check is QUARANTINED: stored, shown on the Website tab, never
 *  forwarded until an admin releases it. Runbook: docs/plans/web-stage3-leads-runbook.md.
 *
 *  SERVICE KEY: read by the admin tab and that one server-to-server route only. web-guard lists this file as an
 *  internal module, so nothing the website serves (app/embed, app/api/web, lib/web) can import it.
 *  No PII in logs: the log lines carry the lead id, status, reason codes and an HTTP status; never a name, an email,
 *  the webhook URL (its sig= is a secret) or a database message (a Postgres error can quote the whole row). */
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { promises as dns } from "node:dns";

export const SOURCES = ["citrix-lp-booking", "citrix-lp-chat"] as const;
export type LeadSource = (typeof SOURCES)[number];
export type LeadStatus = "clean" | "suspect" | "released" | "discarded";
/** The Citrix LP: both sources are on it (the page's calendar, or the chat's in-panel calendar). */
export const LP_PAGE = "https://accops-citrix-lp.vercel.app/";
/** More leads than this in 24 hours quarantines the rest: a flood of plausible-looking bookings never reaches the pipeline.
 *  ponytail: fixed; move it to sam_web_settings if real traffic ever gets near it. */
export const DAILY_CAP = 25;
export const DEDUPE_HOURS = 24;

export type Lead = {
  source: LeadSource; first_name: string; last_name: string; email: string; phone: string; company: string; role: string;
  seats: string; country: string; page: string; conversation_id: string | null; booking_start: string | null;
  raw: { appointment_id?: string; service?: string; time_zone?: string; notes?: string; answers?: { q: string; a: string }[];
    utm?: Record<string, string>; tracking?: string };
};
export type LeadRow = Omit<Lead, "raw"> & { id: string; created_at: string; status: LeadStatus; reasons: string[]; forwarded: boolean;
  forwarded_at: string | null; forward_error: string | null; raw: Lead["raw"] };

/** What each reason code means, for the Website tab. */
export const REASON_LABEL: Record<string, string> = {
  bad_email: "Not a valid email address", disposable_email: "Disposable email domain", free_email: "Free email (Gmail, Outlook, ...), not a work address",
  internal_email: "An Accops address (a test?)", no_mx: "The email domain receives no mail (no MX record)", mx_unchecked: "The email domain could not be checked in time",
  junk_name: "The name looks like junk", junk_company: "The company looks like junk", junk_role: "The role looks like junk", junk_seats: "Number of users looks like junk",
  bad_phone: "The phone number looks wrong", link_in_notes: "A link in the notes", too_long: "A field was too long and was cut",
  daily_cap: `More than ${DAILY_CAP} leads in 24 hours`,
};

// ---------------------------------------------------------------- the email checks

const EMAIL = /^[a-z0-9](?:[a-z0-9._%+'-]{0,62}[a-z0-9_%+'-])?@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
/** A committed blocklist of throwaway inboxes (a domain or any subdomain of one). ponytail: the common ~120; extend
 *  from github.com/disposable-email-domains if one ever gets through. */
const DISPOSABLE = new Set(("mailinator.com mailinator.net mailinator2.com 10minutemail.com 10minutemail.net 10minemail.com 20minutemail.com " +
  "guerrillamail.com guerrillamail.net guerrillamail.org guerrillamail.biz guerrillamail.de guerrillamailblock.com grr.la sharklasers.com " +
  "pokemail.net spam4.me yopmail.com yopmail.net yopmail.fr cool.fr.nf jetable.org temp-mail.org temp-mail.io tempmail.com tempmail.net " +
  "tempmail.dev tempmailo.com tempmail.plus tempr.email tempinbox.com tempail.com temp-mail.ru throwawaymail.com throwam.com trashmail.com " +
  "trashmail.de trashmail.net trash-mail.com trashmail.ws mytrashmail.com dispostable.com discard.email discardmail.com getnada.com nada.email " +
  "maildrop.cc mailnesia.com mailcatch.com mintemail.com mohmal.com emailondeck.com spamgourmet.com spambox.us spamex.com mytemp.email " +
  "burnermail.io 33mail.com inboxkitten.com moakt.com moakt.cc fakeinbox.com fakemail.net fakemailgenerator.com email-fake.com emailfake.com " +
  "fake-mail.net getairmail.com airmail.cc mail.tm mail.gw tmail.ws tmails.net tmpmail.org tmpmail.net tmpeml.com etempmail.com emltmp.com " +
  "byom.de linshiyouxiang.net 1secmail.com 1secmail.org 1secmail.net mailpoof.com mailsac.com harakirimail.com incognitomail.org anonbox.net " +
  "mailforspam.com spamfree24.org wegwerfmail.de wegwerfmail.net einrot.com cuvox.de dayrep.com fleckens.hu gustr.com jourrapide.com " +
  "rhyta.com superrito.com teleworm.us armyspy.com crazymailing.com mvrht.com mvrht.net vomoto.com dropmail.me 10mail.org emailtemporanea.net " +
  "luxusmail.org owlymail.com tempmailaddress.com minuteinbox.com fexbox.org fextemp.com mailto.plus").split(" "));
const FREE = new Set(("gmail.com googlemail.com yahoo.com ymail.com rocketmail.com outlook.com hotmail.com live.com msn.com passport.com " +
  "icloud.com me.com mac.com aol.com aim.com proton.me protonmail.com protonmail.ch pm.me gmx.com gmx.net gmx.de mail.com email.com " +
  "yandex.com yandex.ru ya.ru mail.ru bk.ru inbox.ru list.ru zoho.com zohomail.com zohomail.in rediffmail.com rediff.com sify.com " +
  "indiatimes.com qq.com 163.com 126.com sina.com sohu.com naver.com hanmail.net daum.net web.de t-online.de freenet.de libero.it virgilio.it " +
  "orange.fr free.fr laposte.net sfr.fr wanadoo.fr tutanota.com tutanota.de tuta.io tuta.com fastmail.com fastmail.fm hey.com bigpond.com " +
  "optusnet.com.au comcast.net verizon.net att.net sbcglobal.net cox.net btinternet.com sky.com talktalk.net").split(" "));
/** Webmail in any country (yahoo.co.in, hotmail.co.uk, outlook.in, ...). */
const FREE_CC = /^(yahoo|hotmail|outlook|live|gmx|yandex|aol)\.([a-z]{2,3}|com?\.[a-z]{2})$/;
/** Accops' own addresses: a colleague trying the calendar must not land in the sales pipeline. */
const INTERNAL = /(^|\.)(accops\.com|accops\.in|propalmsnetwork\.onmicrosoft\.com)$/;

const inSet = (set: Set<string>, domain: string) => domain.split(".").some((_, i, p) => set.has(p.slice(i).join(".")));

/** The sync email rules: syntax, then disposable / internal / free-mail (a free address is flagged, not rejected). */
export function emailReasons(email: string): string[] {
  if (!EMAIL.test(email) || email.includes("..")) return ["bad_email"];
  const d = email.split("@")[1];
  if (inSet(DISPOSABLE, d)) return ["disposable_email"];
  if (INTERNAL.test(d)) return ["internal_email"];
  return FREE.has(d) || FREE_CC.test(d) ? ["free_email"] : [];
}

type MxRecord = { exchange: string; priority: number };
/** The MX lookup (2 s): null = the domain takes mail; `no_mx` = it has none (or only RFC 7505's null MX);
 *  `mx_unchecked` = no answer in time, or a DNS error. Both quarantine. */
export async function mxCheck(domain: string, resolve: (d: string) => Promise<MxRecord[]> = d => dns.resolveMx(d), ms = 2000): Promise<string | null> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    const r = await Promise.race([resolve(domain), new Promise<null>(ok => { t = setTimeout(() => ok(null), ms); })]);
    if (!r) return "mx_unchecked";
    return r.some(x => x.exchange && x.exchange !== ".") ? null : "no_mx";
  } catch (e) {
    const code = (e as { code?: string }).code;
    return code === "ENOTFOUND" || code === "ENODATA" ? "no_mx" : "mx_unchecked";
  } finally { clearTimeout(t); }
}

// ---------------------------------------------------------------- junk text

const LINK = /https?:\/\/|www\.|<\s*\/?[a-z]|[{}]|\b[a-z0-9-]+\.(com|net|org|io|ru|cn|xyz|top|info|biz|online|site|click|link|shop|app|dev)\b/i;
const PLACEHOLDER = /^(test|testing|asdf|qwerty|fake|dummy|sample|null|undefined|none|n\/?a|xxx+)$/i;
const ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const RUNS = ROWS.flatMap(r => [r, [...r].reverse().join("")]).flatMap(r => Array.from({ length: r.length - 4 }, (_, i) => r.slice(i, i + 5)));
const MASH4 = /asdf|qwer|zxcv|hjkl/;

/** A name, company or role that is not one: a link or markup, no letters at all (all digits), a placeholder, the same
 *  character 4+ times, a keyboard run, or a mashed word (6 consonants in a row, or 5+ letters and no vowel, unless it
 *  is an ALL-CAPS acronym like GSPCL). Names may not hold digits. */
export function junk(s: string, kind: "name" | "company" | "role"): boolean {
  const t = s.trim();
  if (!t) return false;
  if (LINK.test(t) || !/\p{L}/u.test(t) || PLACEHOLDER.test(t) || /(.)\1{3,}/u.test(t)) return true;
  if (kind === "name" && /\d/.test(t)) return true;
  const low = t.toLowerCase().replace(/[^a-z]/g, "");
  if (MASH4.test(low) || RUNS.some(r => low.includes(r))) return true;
  return t.split(/[^A-Za-z]+/).some(w => w.length >= 5 && w !== w.toUpperCase()
    && (/[bcdfghjklmnpqrstvwxz]{6}/i.test(w) || !/[aeiouy]/i.test(w)));
}

/** Every rule that needs no network. */
export function fieldReasons(l: Lead): string[] {
  const r = emailReasons(l.email);
  if (junk(`${l.first_name} ${l.last_name}`, "name") || !l.first_name) r.push("junk_name");
  if (junk(l.company, "company")) r.push("junk_company");
  if (junk(l.role, "role")) r.push("junk_role");
  if (LINK.test(l.seats)) r.push("junk_seats"); // "10000" or "500+" are fine; only a link or markup is not
  const digits = l.phone.replace(/\D/g, "");
  if (l.phone && (!/^[+()\d\s./-]+$/.test(l.phone) || digits.length < 6 || digits.length > 15 || /(\d)\1{6,}/.test(digits))) r.push("bad_phone");
  if (l.raw.notes && LINK.test(l.raw.notes)) r.push("link_in_notes");
  return r;
}

// ---------------------------------------------------------------- the Bookings body -> a lead

/** Keys compared without case or punctuation, so the flow can send the Bookings trigger body as it comes
 *  (CustomerName, CustomerEmail, ...) or its own snake_case names. */
const k = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
function get(o: unknown, ...names: string[]): unknown {
  if (!o || typeof o !== "object" || Array.isArray(o)) return undefined;
  const want = new Set(names.map(k));
  for (const [key, v] of Object.entries(o)) if (want.has(k(key)) && v != null && v !== "") return v;
  return undefined;
}
const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "").replace(/\s+/g, " ").trim();

/** Bookings custom questions -> company / role / users, by the question's wording (users first: "Number of users in your
 *  company" is about users; role before company: "Your role in the company" is a role). */
const QUESTION: [keyof Pick<Lead, "seats" | "role" | "company">, RegExp][] = [
  ["seats", /\b(users?|seats?|employees|endpoints|headcount|how many)\b/i],
  ["role", /\b(role|title|designation|position|job)\b/i],
  ["company", /\b(company|organi[sz]ation|employer|business|firm)\b/i],
];

/** The flow's JSON (the Bookings trigger body, plus optional source / page / conversation_id / utm_*) -> a lead.
 *  `clipped` = a field was longer than its column allows and was cut (reason too_long). */
export function normalise(body: unknown, query = new URLSearchParams()): { lead: Lead; clipped: boolean } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "a JSON object is required" };
  // A group booking keeps the customer in Customers[0]; this service is 1:1, so that is only a fallback.
  const c0 = (get(body, "Customers") as unknown[] | undefined)?.[0];
  let clipped = false;
  const cut = (v: unknown, n: number) => { const s = str(v); if (s.length > n) clipped = true; return s.slice(0, n); };
  const email = str(get(body, "CustomerEmail", "CustomerEmailAddress", "email") ?? get(c0, "Email", "EmailAddress")).toLowerCase();
  const name = cut(get(body, "CustomerName", "name") ?? get(c0, "Name", "DisplayName"), 200);
  if (!email) return { error: "CustomerEmail is required" };
  if (email.length > 254) return { error: "CustomerEmail is too long" };
  if (!name) return { error: "CustomerName is required" };

  const answersRaw = get(body, "CustomQuestionAnswers", "answers") ?? get(c0, "Answers");
  const answers = (Array.isArray(answersRaw) ? answersRaw : []).slice(0, 10)
    .map(a => ({ q: cut(get(a, "Question"), 200), a: cut(get(a, "Answer"), 200) })).filter(a => a.q && a.a);
  const fromQ: Partial<Record<"seats" | "role" | "company", string>> = {};
  for (const a of answers) {
    const hit = QUESTION.find(([f, re]) => !fromQ[f] && re.test(a.q));
    if (hit) fromQ[hit[0]] = a.a;
  }

  const [first, ...rest] = name.split(" ");
  const qs = (n: string) => query.get(n) ?? get(body, n);
  const src = str(qs("source"));
  const page = str(get(body, "page"));
  const conv = str(get(body, "conversation_id"));
  const tracking = cut(get(body, "TrackingData", "tracking"), 500);
  // TrackingData is Bookings' "campaign tracking data"; if it carries utm_* pairs, keep them.
  const fromTracking = /utm_/.test(tracking) ? new URLSearchParams(tracking.replace(/^[^?]*\?/, "")) : new URLSearchParams();
  const utm: Record<string, string> = {};
  for (const f of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
    const v = cut(qs(f) ?? fromTracking.get(f), 100);
    if (v) utm[f] = v;
  }
  const loc = get(get(body, "CustomerLocation") ?? get(c0, "Location"), "PhysicalAddress");
  const startRaw = str(get(body, "StartTime", "start"));
  const iso = startRaw.replace(/(\.\d{3})\d+/, "$1");
  const t = Date.parse(/([zZ]|[+-]\d\d:?\d\d)$/.test(iso) || !iso ? iso : `${iso}Z`); // Bookings times without an offset are UTC

  const lead: Lead = {
    source: (SOURCES as readonly string[]).includes(src) ? (src as LeadSource) : "citrix-lp-booking",
    first_name: first.slice(0, 100), last_name: rest.join(" ").slice(0, 100), email,
    phone: cut(get(body, "CustomerPhone", "phone") ?? get(c0, "Phone"), 40),
    company: cut(get(body, "company") ?? fromQ.company, 200),
    role: cut(get(body, "role") ?? fromQ.role, 120),
    seats: cut(get(body, "users", "seats") ?? fromQ.seats, 40),
    country: cut(get(body, "country") ?? get(loc, "CountryOrRegion"), 64),
    page: /^https:\/\/\S{1,490}$/.test(page) ? page : LP_PAGE,
    conversation_id: /^[A-Za-z0-9_.:-]{1,80}$/.test(conv) ? conv : null,
    booking_start: Number.isFinite(t) ? new Date(t).toISOString() : null,
    // Only what helps the review. Never the staff, the Teams join link, the customer id or a street address.
    raw: {
      appointment_id: cut(get(body, "SelfServiceAppointmentId", "appointment_id"), 200) || undefined,
      service: cut(get(body, "ServiceName", "service"), 200) || undefined,
      time_zone: cut(get(body, "CustomerTimeZone", "time_zone") ?? get(c0, "TimeZone"), 100) || undefined,
      notes: cut(get(body, "CustomerNotes", "notes") ?? get(c0, "Notes"), 1000) || undefined,
      answers: answers.length ? answers : undefined,
      utm: Object.keys(utm).length ? utm : undefined,
      tracking: tracking || undefined,
    },
  };
  return { lead, clipped };
}

// ---------------------------------------------------------------- the forward (Power Automate HTTP trigger)

/** The flat, all-string JSON the Website Leads flow parses (the schema is in the runbook). "" when unknown. */
export function payload(r: LeadRow): Record<string, string> {
  const u = r.raw?.utm ?? {};
  return {
    source: r.source, first_name: r.first_name ?? "", last_name: r.last_name ?? "", email: r.email, phone: r.phone ?? "",
    company: r.company ?? "", role: r.role ?? "", seats: r.seats ?? "", country: r.country ?? "", page: r.page ?? "",
    conversation_id: r.conversation_id ?? "", booking_start: r.booking_start ?? "",
    utm_source: u.utm_source ?? "", utm_medium: u.utm_medium ?? "", utm_campaign: u.utm_campaign ?? "", utm_term: u.utm_term ?? "",
    utm_content: u.utm_content ?? "", submitted_at: r.created_at, sam_lead_id: r.id,
  };
}

/** POST one lead to WEB_LEAD_WEBHOOK_URL. null = accepted (200 / 202); otherwise a short reason that never contains the
 *  URL (its sig= query parameter is the flow's key) or any lead data. */
export async function forward(r: LeadRow): Promise<string | null> {
  const url = process.env.WEB_LEAD_WEBHOOK_URL?.trim();
  if (!url) return "WEB_LEAD_WEBHOOK_URL is not set";
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload(r)),
      signal: AbortSignal.timeout(8000), redirect: "manual", cache: "no-store" });
    return res.status === 200 || res.status === 202 ? null : `the flow answered ${res.status}`;
  } catch (e) {
    return (e as Error)?.name === "TimeoutError" ? "the flow did not answer in 8 s" : "the flow could not be reached";
  }
}

// ---------------------------------------------------------------- storage (service key)

function cfg() {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/$/, ""), key = process.env.SUPABASE_SERVICE_KEY?.trim();
  return url && key ? { url, key } : null;
}
export const leadsConfigured = () => !!cfg();

async function rest<T>(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<T> {
  const c = cfg();
  if (!c) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set");
  const r = await fetch(`${c.url}/rest/v1/${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"), cache: "no-store", signal: AbortSignal.timeout(8000),
    headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, "Content-Type": "application/json", ...(init.prefer ? { Prefer: init.prefer } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  // The status and Postgres' error code only: the message of a failed insert can quote the row (names, emails).
  if (!r.ok) { const code = (await r.json().catch(() => null) as { code?: string } | null)?.code; throw new Error(`${path.split("?")[0]} returned ${r.status}${code ? ` (${code})` : ""}`); }
  const t = await r.text();
  return (t ? JSON.parse(t) : null) as T;
}
const enc = encodeURIComponent;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COLS = "id,created_at,source,status,reasons,forwarded,forwarded_at,forward_error,first_name,last_name,email,phone,company,role,seats,country,page,conversation_id,booking_start,raw";

/** The admin tab's list, newest first. */
export const loadLeads = (limit = 500) => rest<LeadRow[]>(`sam_web_leads?select=${COLS}&order=created_at.desc&limit=${limit}`);
/** The digest's line: leads received since `since`, and how many of them are still in quarantine. */
export async function leadsSince(since: string): Promise<{ n: number; quarantined: number }> {
  const rows = await rest<{ status: LeadStatus }[]>(`sam_web_leads?select=status&created_at=gte.${enc(since)}`);
  return { n: rows.length, quarantined: rows.filter(r => r.status === "suspect").length };
}

// ---------------------------------------------------------------- the route

/** Bearer <WEB_LEAD_SECRET>, compared in constant time (hashing first evens the lengths, so they leak nothing either). */
export function secretOk(header: string | null, want = process.env.WEB_LEAD_SECRET): boolean {
  const got = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!want || !got) return false;
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(got), h(want));
}

export type Deps = { resolveMx?: (d: string) => Promise<MxRecord[]>; log?: (line: string) => void; now?: () => number };
const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** POST /api/v1/leads/booking. Server-to-server only (a browser request is refused: no browser form exists, so no
 *  honeypot, render timer or per-IP cap is needed). 401 without the secret; 400 when the body is not a booking; 200
 *  with {sam_lead_id, status, reasons, forwarded} once stored (also for a duplicate); 500 if storing failed, so the
 *  flow's retry policy tries again. A failed forward never fails the request: the lead stays, with forward_error. */
export async function handleBooking(req: Request, deps: Deps = {}): Promise<Response> {
  const log = deps.log ?? (s => console.log(s)), now = deps.now ?? Date.now;
  if (!process.env.WEB_LEAD_SECRET || !cfg()) return json(503, { error: "leads are not configured" });
  if (req.headers.get("origin") || req.headers.get("sec-fetch-mode")) return json(403, { error: "server-to-server only" });
  if (!secretOk(req.headers.get("authorization"))) return json(401, { error: "unauthorized" });
  const text = await req.text();
  let body: unknown = null;
  try { body = text.length <= 32_768 ? JSON.parse(text) : null; } catch { /* below */ }
  const n = normalise(body, new URL(req.url).searchParams);
  if ("error" in n) return json(400, { error: n.error });
  const { lead, clipped } = n;

  try {
    // One read for both dedupe (same email in 24 h) and the flood cap.
    const since = new Date(now() - DEDUPE_HOURS * 3600_000).toISOString();
    const recent = await rest<{ id: string; email: string }[]>(`sam_web_leads?select=id,email&created_at=gte.${enc(since)}&order=created_at.desc&limit=200`);
    const dup = recent.find(r => r.email === lead.email);
    if (dup) { log(`lead ${dup.id}: duplicate within ${DEDUPE_HOURS} h, not stored again`); return json(200, { ok: true, duplicate: true, sam_lead_id: dup.id }); }

    const reasons = fieldReasons(lead);
    if (!reasons.some(r => r === "bad_email" || r === "disposable_email")) {
      const mx = await mxCheck(lead.email.split("@")[1], deps.resolveMx);
      if (mx) reasons.push(mx);
    }
    if (clipped) reasons.push("too_long");
    if (recent.length >= DAILY_CAP) reasons.push("daily_cap");
    const row: LeadRow = { ...lead, id: randomUUID(), created_at: new Date(now()).toISOString(), status: reasons.length ? "suspect" : "clean",
      reasons, forwarded: false, forwarded_at: null, forward_error: null };
    await rest("sam_web_leads", { body: row, prefer: "return=minimal" });

    let error: string | null = null;
    if (row.status === "clean") { // only a clean lead is forwarded on its own; a suspect one waits in quarantine
      error = await forward(row);
      const patch = error ? { forward_error: error } : { forwarded: true, forwarded_at: new Date(now()).toISOString() };
      await rest(`sam_web_leads?id=eq.${row.id}`, { method: "PATCH", body: patch, prefer: "return=minimal" })
        .catch(e => log(`lead ${row.id}: forward result not saved (${(e as Error).message})`));
    }
    log(`lead ${row.id}: ${row.source} ${row.status}${reasons.length ? ` [${reasons.join(",")}]` : ""}, ${row.status !== "clean" ? "quarantined" : error ? `not forwarded: ${error}` : "forwarded"}`);
    return json(200, { ok: true, sam_lead_id: row.id, status: row.status, reasons, forwarded: row.status === "clean" && !error });
  } catch (e) {
    log(`lead: not stored (${(e as Error).message})`);
    return json(500, { error: "not stored, try again" });
  }
}

// ---------------------------------------------------------------- the admin decisions

/** Release (a quarantined lead) or Forward again (a clean or released lead whose forward failed): forwards now. The row
 *  is claimed first (forwarded false -> true, only from the state the admin saw), so a double click forwards once. */
export async function releaseLead(id: string): Promise<{ ok: true; forwarded: boolean; error?: string } | { ok: false; error: string }> {
  if (!UUID.test(id)) return { ok: false, error: "No such lead." };
  const cur = (await rest<LeadRow[]>(`sam_web_leads?select=${COLS}&id=eq.${id}`))[0];
  if (!cur) return { ok: false, error: "No such lead." };
  if (cur.status === "discarded") return { ok: false, error: "This lead was discarded." };
  if (cur.forwarded) return { ok: false, error: "Already forwarded." };
  const status = cur.status === "suspect" ? "released" : cur.status;
  const claimed = await rest<LeadRow[]>(`sam_web_leads?id=eq.${id}&forwarded=is.false&status=eq.${cur.status}`,
    { method: "PATCH", body: { status, forwarded: true, forwarded_at: new Date().toISOString(), forward_error: null }, prefer: "return=representation" });
  if (claimed.length !== 1) return { ok: false, error: "Someone changed this lead a moment ago. Reload and try again." };
  const error = await forward({ ...cur, status });
  if (error) await rest(`sam_web_leads?id=eq.${id}`, { method: "PATCH", body: { forwarded: false, forwarded_at: null, forward_error: error }, prefer: "return=minimal" });
  console.log(`lead ${id}: ${cur.status} -> ${status} by an admin, ${error ? `not forwarded: ${error}` : "forwarded"}`);
  return error ? { ok: true, forwarded: false, error } : { ok: true, forwarded: true };
}

/** Discard: kept for the record, never forwarded. Not once it has been forwarded (it is in the pipeline already). */
export async function discardLead(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!UUID.test(id)) return { ok: false, error: "No such lead." };
  const out = await rest<{ id: string }[]>(`sam_web_leads?id=eq.${id}&forwarded=is.false&status=neq.discarded`,
    { method: "PATCH", body: { status: "discarded" }, prefer: "return=representation" });
  if (out.length === 1) console.log(`lead ${id}: discarded by an admin`);
  return out.length === 1 ? { ok: true } : { ok: false, error: "Already forwarded or discarded." };
}
