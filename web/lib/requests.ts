/** Content requests: a rep asks marketing to create something SAM could not find.
 *
 *  Tables and RPCs: docs/supabase-sam-content-requests.sql. One row per thing wanted
 *  (sam_content_requests), one row per rep who asked for it (sam_content_request_votes), so demand is
 *  DISTINCT REPS - one person rephrasing five times is one, fifteen salespeople is fifteen.
 *
 *  Repeat asks merge on requestKey(): the asset type, the product (canonical: ZTNA is HySecure), the
 *  industry, and - only when neither product nor industry is named - the main topic words. Coarse on
 *  purpose: "the same KIND of brochure" is what marketing needs counted, and the example questions
 *  underneath carry the nuance. Marketing merges whatever the key misses.
 *
 *  Pure helpers first (lib/requests.check.mjs runs them), then the Supabase reads and writes. */
import { heuristicFilters, typesNamedIn } from "./agent";
import { queryTokens } from "./cards";
import { logEvent, testTraffic } from "./events";
import { numberForUser, sendText } from "./whatsapp";

export type Status = "open" | "planned" | "in_progress" | "done" | "declined" | "merged";
export const ACTIVE: Status[] = ["open", "planned", "in_progress"];
export const STATUS_LABEL: Record<Status, string> = { open: "Requested", planned: "Planned", in_progress: "In progress", done: "Delivered", declined: "Declined", merged: "Merged" };

// ---------------------------------------------------------------- pure (checked)

/** One product, one key: reps say "ZTNA" and "HySecure" about the same thing. */
const CANON: Record<string, string> = { ZTNA: "HySecure", MFA: "HyID", VDI: "HyWorks", DaaS: "HyWorks", "Thin Clients": "HyDesk" };
const FILLER = /^(?:(?:hi|hey|hello|please|pls|sam)[,!.\s]+)*(?:(?:do|does) (?:we|accops) have|is there|are there|have we got|i need|i want|we need|need|looking for|i'?m looking for|can (?:you|i) (?:get|find|have)|could you (?:find|get)|find me|get me|show me|send me|give me|any|anything on|something on|something about|do you have)\s+(?:an?\s+|any\s+|the\s+|some\s+)?/i;
/** Words that say who a document is for, or how it is asked for, not what it is about. */
const NOT_TOPIC = new Set(["customer", "client", "prospect", "cio", "ciso", "cto", "buyer", "exist", "exists", "available", "document", "doc", "material",
  "collateral", "one", "pager", "sheet", "new", "good", "best", "external", "internal", "public", "share", "today", "urgently", "asap", "copy", "version", "report"]);

/** The rep's question as a request title: their words, minus "do we have a" and the question mark. */
export function suggestTitle(question: string): string {
  const t = question.trim().replace(/\s+/g, " ").replace(FILLER, "").replace(/[?.!\s]+$/, "").slice(0, 120).trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

export type Facets = { asset_type: string; product: string; vertical: string };
/** Type, product and industry named in free text, through the same rules the answer path uses. */
export function facetsOf(text: string): Facets {
  const f = heuristicFilters(text);
  return { asset_type: typesNamedIn(text)[0] ?? f.asset_type ?? "", product: f.product, vertical: f.vertical };
}

function topicWords(text: string, f: Facets): string[] {
  const own = new Set(queryTokens(`${f.product} ${f.vertical}`));
  const words = queryTokens(text)
    .filter(w => !typesNamedIn(w).length && !NOT_TOPIC.has(w) && !own.has(w) && !/^(deck|datasheet|brochure|battlecard|slides?|ebook|webinar|competitive|study|studies)$/.test(w))
    .map(w => (w.length > 4 && /[^s]s$/.test(w) ? w.slice(0, -1) : w));
  return [...new Set(words)].sort().slice(0, 4);
}

/** The merge key, or null when the text names nothing to key on ("a brochure", "this"). */
export function requestKey(text: string, over: Partial<Facets> = {}): string | null {
  const clean = suggestTitle(text);
  const f = { ...facetsOf(clean), ...Object.fromEntries(Object.entries(over).filter(([, v]) => v)) } as Facets;
  const product = CANON[f.product] ?? f.product;
  const topic = product || f.vertical ? "" : topicWords(clean, f).join(" ");
  if (!product && !f.vertical && !topic) return null;
  return [f.asset_type, product, f.vertical, topic].map(s => (s ?? "").toLowerCase()).join("|");
}

/** What the rep is told after filing. Demand, and whether it is already moving. */
export function confirmation(r: { demand: number; new_vote: boolean; status: string }): string {
  const others = Math.max(0, r.demand - 1);
  const who = others === 0 ? "" : `${others} other${others === 1 ? "" : "s"}`;
  let msg = !r.new_vote
    ? `You have already asked for this${who ? `, and so have ${who}` : ""}. Marketing can see it.`
    : who ? `You and ${who} have asked for this. Marketing can see it.` : "You are the first to ask for this. Marketing can see it now.";
  if (r.status === "planned") msg += " It is planned.";
  if (r.status === "in_progress") msg += " Marketing is already working on it.";
  return msg;
}

const NEXT: Record<Status, Status[]> = {
  open: ["planned", "in_progress", "done", "declined"],
  planned: ["open", "in_progress", "done", "declined"],
  in_progress: ["open", "planned", "done", "declined"],
  done: ["open"],        // reopened: what was delivered did not cover it
  declined: ["open"],
  merged: [],            // only sam_merge_content_requests sets or leaves this
};

export type Update = { status: Status; owner?: string; due_date?: string; delivered_title?: string; delivered_url?: string; decline_reason?: string; notes?: string; title?: string };

/** Validate a status change and build the row patch. Done needs a real link (it is what reps are
 *  sent); declined needs a reason (it is what reps are told). */
export function transition(cur: Status, u: Update): { patch: Record<string, unknown> } | { error: string } {
  const to = u.status;
  if (!(to in NEXT)) return { error: `Unknown status "${to}".` };
  if (to !== cur && !NEXT[cur].includes(to)) return { error: `A ${STATUS_LABEL[cur].toLowerCase()} request cannot be moved to ${STATUS_LABEL[to].toLowerCase()}.` };
  const patch: Record<string, unknown> = { status: to, updated_at: new Date().toISOString() };
  for (const k of ["owner", "notes", "title"] as const) if (u[k] !== undefined) patch[k] = u[k]!.trim() || (k === "title" ? undefined : null);
  if (patch.title === undefined) delete patch.title;
  if (u.due_date !== undefined) {
    if (u.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(u.due_date)) return { error: "Due date must be a date." };
    patch.due_date = u.due_date || null;
  }
  if (to === "done") {
    const url = (u.delivered_url ?? "").trim(), title = (u.delivered_title ?? "").trim();
    if (!/^https?:\/\/\S+$/i.test(url)) return { error: "Marking it delivered needs the link to the new asset (https://...)." };
    if (!title) return { error: "Marking it delivered needs the title of the new asset." };
    Object.assign(patch, { delivered_url: url, delivered_title: title });
  }
  if (to === "declined") {
    const reason = (u.decline_reason ?? "").trim();
    if (!reason) return { error: "Declining needs a reason. The reps who asked will read it." };
    patch.decline_reason = reason;
  }
  const closed = (s: Status) => s === "done" || s === "declined";
  if (closed(to) !== closed(cur)) patch.closed_at = closed(to) ? new Date().toISOString() : null;
  return { patch };
}

export type Vote = { user_id: string; channel: string; question: string | null; note: string | null; created_at: string; notified_at?: string | null };
export type RequestRow = {
  id: number; created_at: string; updated_at: string; topic_key: string; title: string; asset_type: string | null; product: string | null; vertical: string | null;
  description: string | null; status: Status; owner: string | null; due_date: string | null; delivered_title: string | null; delivered_url: string | null;
  decline_reason: string | null; notes: string | null; merged_into: number | null; source: "rep" | "gap"; created_by: string | null; closed_at: string | null;
  is_test: boolean; votes: Vote[];
};
export type RankedRequest = RequestRow & { demand: number; firstAsked: string; lastAsked: string; channels: string[]; examples: string[]; notes_from_reps: string[] };

/** Distinct reps first, then the most recently asked. */
export function rankRequests(rows: RequestRow[]): RankedRequest[] {
  return rows.map(r => {
    const votes = [...(r.votes ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const uniq = <T,>(xs: T[]) => [...new Set(xs)];
    return {
      ...r, votes,
      demand: uniq(votes.map(v => v.user_id)).length,
      firstAsked: votes[0]?.created_at ?? r.created_at,
      lastAsked: votes[votes.length - 1]?.created_at ?? r.created_at,
      channels: uniq(votes.map(v => v.channel)),
      examples: uniq(votes.map(v => v.question?.trim()).filter((q): q is string => Boolean(q))).slice(-3).reverse(),
      notes_from_reps: votes.map(v => v.note?.trim()).filter((n): n is string => Boolean(n)).slice(-3).reverse(),
    };
  }).sort((a, b) => b.demand - a.demand || b.lastAsked.localeCompare(a.lastAsked));
}

export type GapSignal = { key: string; title: string; facets: Facets; users: string[]; asks: number; examples: string[]; lastSeen: string };

/** The weaker, automatic signal: things people asked SAM for and did not get, grouped by the same
 *  key a request would get, minus anything already requested. "Asked 6 times, never requested." */
export function unrequestedGaps(events: { kind: string; query?: string | null; user_id: string; created_at?: string }[], requestKeys: Iterable<string>): GapSignal[] {
  const have = new Set(requestKeys), acc = new Map<string, GapSignal>();
  for (const e of events) {
    if (e.kind !== "gap" || !e.query) continue;
    const key = requestKey(e.query);
    if (!key || have.has(key)) continue;
    const g = acc.get(key) ?? { key, title: suggestTitle(e.query), facets: facetsOf(e.query), users: [], asks: 0, examples: [], lastSeen: "" };
    g.asks++;
    if (!g.users.includes(e.user_id)) g.users.push(e.user_id);
    if (!g.examples.includes(e.query) && g.examples.length < 3) g.examples.push(e.query);
    if ((e.created_at ?? "") > g.lastSeen) g.lastSeen = e.created_at ?? "";
    acc.set(key, g);
  }
  return [...acc.values()].sort((a, b) => b.users.length - a.users.length || b.asks - a.asks || b.lastSeen.localeCompare(a.lastSeen));
}

// ---------------------------------------------------------------- Supabase

function cfg() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
async function db<T>(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: T | null; text?: string }> {
  const c = cfg();
  if (!c) return { ok: false, status: 0, data: null, text: "SUPABASE_URL and SUPABASE_SERVICE_KEY are not set" };
  try {
    const r = await fetch(`${c.url}/rest/v1/${path}`, {
      ...init, cache: "no-store",
      headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers ?? {}) },
    });
    const text = await r.text();
    if (!r.ok) { console.error("content requests", path.split("?")[0], r.status, text.slice(0, 200)); return { ok: false, status: r.status, data: null, text }; }
    return { ok: true, status: r.status, data: text ? (JSON.parse(text) as T) : null };
  } catch (e) { console.error("content requests error", e); return { ok: false, status: 0, data: null, text: String(e) }; }
}

export type Filed = { ok: true; id: number; title: string; status: Status; demand: number; new_request: boolean; new_vote: boolean; message: string } | { ok: false; error: string };

/** File a request, or add this rep to the one that already exists. Every channel comes through here. */
export async function fileRequest(p: { title?: string; question?: string; note?: string; eventId?: number | null; key?: string; source?: "rep" | "gap" } & Partial<Facets>,
  who: string, channel: string): Promise<Filed> {
  const title = (p.title?.trim() || suggestTitle(p.question ?? "")).slice(0, 120);
  if (!title) return { ok: false, error: "Say what you need in a few words." };
  const over = { asset_type: p.asset_type, product: p.product, vertical: p.vertical };
  const key = p.key ?? requestKey(title, over);
  if (!key) return { ok: false, error: "Say what it is about too: the product, the industry or the topic." };
  const f = { ...facetsOf(title), ...Object.fromEntries(Object.entries(over).filter(([, v]) => v)) } as Facets;
  const r = await db<{ id: number; title: string; status: Status; demand: number; new_request: boolean; new_vote: boolean }>("rpc/sam_file_content_request", {
    method: "POST", body: JSON.stringify({
      p_key: key, p_title: title, p_asset_type: f.asset_type || null, p_product: f.product || null, p_vertical: f.vertical || null,
      p_description: p.question?.trim() || null, p_user: who, p_channel: channel, p_question: p.question?.trim() || null,
      p_note: p.note?.trim().slice(0, 500) || null, p_event_id: p.eventId ?? null, p_is_test: await testTraffic(who), p_source: p.source ?? "rep",
    }),
  });
  if (!r.ok || !r.data) return { ok: false, error: `Could not file the request${r.status ? ` (${r.status})` : ""}. Try again in a minute.` };
  const d = r.data;
  if (d.new_vote) await logEvent({ user_id: who, channel, kind: "request", intent: "filed", query: title, ref_event_id: p.eventId ?? null, filters: { request_id: d.id, key, new_request: d.new_request } });
  return { ok: true, ...d, message: confirmation(d) };
}

const VOTES = "votes:sam_content_request_votes(user_id,channel,question,note,created_at,notified_at)";

/** Marketing's queue. Test requests only when asked for. */
export async function listRequests(p: { statuses?: Status[]; includeTest?: boolean } = {}): Promise<RankedRequest[] | null> {
  const q = [`select=*,${VOTES}`, "order=updated_at.desc", "limit=300", `status=in.(${(p.statuses ?? ["open", "planned", "in_progress", "done", "declined"]).join(",")})`];
  if (!p.includeTest) q.push("is_test=is.false");
  const r = await db<RequestRow[]>(`sam_content_requests?${q.join("&")}`);
  return r.ok ? rankRequests(r.data ?? []) : null;
}

export type MyRequest = { id: number; created_at: string; question: string | null; note: string | null; seen_at: string | null;
  request: { id: number; title: string; status: Status; delivered_title: string | null; delivered_url: string | null; decline_reason: string | null; due_date: string | null; updated_at: string; votes: { count: number }[] } };

/** What one rep has asked for, newest first, with how many others asked too. */
export async function myRequests(user: string): Promise<MyRequest[]> {
  const r = await db<MyRequest[]>(`sam_content_request_votes?select=id,created_at,question,note,seen_at,request:sam_content_requests(id,title,status,delivered_title,delivered_url,decline_reason,due_date,updated_at,votes:sam_content_request_votes(count))&user_id=eq.${encodeURIComponent(user)}&order=created_at.desc&limit=100`);
  return r.data ?? [];
}

/** Delivered, not yet seen on the web: the quiet notice on the next visit. */
export async function unseenDeliveries(user: string): Promise<MyRequest[]> {
  return (await myRequests(user)).filter(m => m.request?.status === "done" && !m.seen_at);
}

export async function markSeen(user: string, voteIds: number[]): Promise<void> {
  const ids = voteIds.filter(n => Number.isInteger(n) && n > 0);
  if (!ids.length) return;
  await db(`sam_content_request_votes?id=in.(${ids.join(",")})&user_id=eq.${encodeURIComponent(user)}&seen_at=is.null`, { method: "PATCH", body: JSON.stringify({ seen_at: new Date().toISOString() }) });
}

/** Marketing changes a request. Validates the transition, and on delivery tells every rep who asked. */
export async function updateRequest(id: number, u: Update, by: string): Promise<{ ok: true; notified?: number } | { ok: false; error: string }> {
  const cur = await db<RequestRow[]>(`sam_content_requests?select=*,${VOTES}&id=eq.${id}`);
  const row = cur.data?.[0];
  if (!row) return { ok: false, error: "That request no longer exists." };
  const t = transition(row.status, u);
  if ("error" in t) return { ok: false, error: t.error };
  const r = await db<RequestRow[]>(`sam_content_requests?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(t.patch) });
  if (r.status === 409) return { ok: false, error: "Another active request covers the same thing. Merge this one into it instead of reopening." };
  if (!r.ok) return { ok: false, error: `Could not save (${r.status}).` };
  if (u.status !== row.status) await logEvent({ user_id: by, channel: "web", kind: "request", intent: u.status, query: row.title, filters: { request_id: id, from: row.status } });
  if (u.status === "done" && row.status !== "done") return { ok: true, notified: await notifyDelivered({ ...row, ...(t.patch as Partial<RequestRow>) }) };
  return { ok: true };
}

/** Tell every rep who asked that it exists now. The web shows it on their next visit (seen_at); a
 *  rep with a WhatsApp number also gets a message. Without WHATSAPP_ACCESS_TOKEN sendText is a
 *  logged dry run and notified_at stays empty, so a later real send is not skipped. */
export async function notifyDelivered(row: RequestRow): Promise<number> {
  let sent = 0;
  for (const v of row.votes ?? []) {
    const to = numberForUser(v.user_id);
    if (!to || v.notified_at) continue;
    if (row.is_test) { console.log(`[content request ${row.id} is test] would WhatsApp ${v.user_id}`); continue; }
    const body = `Marketing has made what you asked SAM for.\n\n*${row.delivered_title}*\n${row.delivered_url}\n\nYou asked: "${v.question ?? row.title}"`;
    const s = await sendText(to, body);
    if (s.sent) {
      sent++;
      await db(`sam_content_request_votes?request_id=eq.${row.id}&user_id=eq.${encodeURIComponent(v.user_id)}`, { method: "PATCH", body: JSON.stringify({ notified_at: new Date().toISOString() }) });
    }
  }
  return sent;
}

export async function mergeRequests(from: number, into: number, by: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await db("rpc/sam_merge_content_requests", { method: "POST", body: JSON.stringify({ p_from: from, p_into: into }) });
  if (!r.ok) return { ok: false, error: (r.text && /"message":"([^"]+)"/.exec(r.text)?.[1]) || `Could not merge (${r.status}).` };
  await logEvent({ user_id: by, channel: "web", kind: "request", intent: "merged", filters: { request_id: from, into } });
  return { ok: true };
}

/** Marketing turns an automatic gap into a request. The people who asked SAM for it become its
 *  askers (channel "gap"), so they see it in Your requests and hear when it is delivered. */
export async function promoteGap(g: { key: string; title: string; users: string[]; example?: string }): Promise<Filed> {
  let last: Filed = { ok: false, error: "Nobody asked for this." };
  for (const u of g.users.slice(0, 50)) last = await fileRequest({ title: g.title, question: g.example, key: g.key, source: "gap" }, u, "gap");
  return last;
}
