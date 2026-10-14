/** SAM Live data: live_deals, live_meetings, live_segments (docs/live/supabase-live.sql) through PostgREST
 *  with the service role, server side only - the same env and approach as lib/events.ts. Unlike events,
 *  a failed read or write throws: a call that silently loses its transcript is worse than an error the
 *  desktop app retries. */
import { testTraffic } from "../events";
import type { Qualification } from "./framework";

export type Channel = "rep" | "customer";
export type Deal = { id: string; owner: string; company: string; contact_name: string | null; contact_email: string | null;
  contact_title: string | null; notes: string | null; created_at: string; updated_at: string };
export type Ask = { key: string; question: string; why: string };
export type Card = { trigger: string; title: string; brief: string; link: string | null; shareable: boolean };
/** `model` = which provider:model wrote it ("openai:gpt-5.5", "groq:openai/gpt-oss-120b", "mock", "none"). */
export type Summary = { overview: string; pains: string[]; qualification: Qualification; objections: string[]; competitors: string[];
  next_steps: string[]; follow_up_email: { subject: string; body: string }; deal_score: number; risks: string[]; model?: string };
export type Meeting = { id: string; deal_id: string | null; owner: string; title: string | null; status: "live" | "ended";
  started_at: string; ended_at: string | null; qualification: Qualification; suggestions: Ask[]; battlecards: Card[];
  summary: Summary | null; flow_status: string | null; last_insight_at: string | null; is_test: boolean };
export type Segment = { id: number; channel: Channel; t_ms: number; duration_ms: number | null; text: string; created_at?: string };

function cfg() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}

/** One PostgREST call. `path` is "table?query". Returns the parsed body (rows for return=representation). */
export async function db<T>(path: string, init: RequestInit = {}): Promise<T> {
  const c = cfg();
  if (!c) throw new Error("SAM Live needs SUPABASE_URL and SUPABASE_SERVICE_KEY");
  const r = await fetch(`${c.url}/rest/v1/${path}`, { ...init, cache: "no-store",
    headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers ?? {}) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`live store ${init.method ?? "GET"} ${path.split("?")[0]}: ${r.status} ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : null) as T;
}

const enc = encodeURIComponent;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isId = (s: unknown): s is string => typeof s === "string" && UUID.test(s);
const one = <T>(rows: T[] | null) => rows?.[0] ?? null;

// ---------------------------------------------------------------- deals

export type DealHit = { id: string; company: string; contact_name: string | null; contact_email: string | null; last_meeting_at: string | null };

/** The rep's own deals for the desktop's company autocomplete, most recently touched first. */
export async function myDeals(owner: string, q = ""): Promise<DealHit[]> {
  // Letters, digits and a few name characters only: the term goes inside a PostgREST ilike pattern.
  const term = q.replace(/[^\p{L}\p{N} .&'-]/gu, "").trim().slice(0, 60);
  const rows = await db<(DealHit & { live_meetings: { started_at: string }[] })[]>(
    `live_deals?select=id,company,contact_name,contact_email,live_meetings(started_at)&live_meetings.order=started_at.desc&live_meetings.limit=1`
    + `&owner=eq.${enc(owner)}${term ? `&company=ilike.${enc(`*${term}*`)}` : ""}&order=updated_at.desc&limit=20`);
  return rows.map(({ live_meetings, ...d }) => ({ ...d, last_meeting_at: live_meetings[0]?.started_at ?? null }));
}

export async function getDeal(id: string): Promise<Deal | null> {
  return isId(id) ? one(await db<Deal[]>(`live_deals?id=eq.${id}&select=*`)) : null;
}

type Contact = { contact_name?: string | null; contact_email?: string | null; contact_title?: string | null };

/** The rep's deal for this company (same name, any case), created when there is none, so a second call
 *  with the same customer lands on the same timeline. Contact details given now replace the old ones:
 *  the latest call's contact is who the follow-up is for. */
export async function dealFor(owner: string, company: string, contact: Contact): Promise<Deal> {
  const name = company.trim().slice(0, 160);
  // ilike pattern characters become the one-character wildcard: it may over-match, the exact check below decides.
  const like = name.replace(/[*%\\]/g, "_");
  const found = (await db<Deal[]>(`live_deals?owner=eq.${enc(owner)}&company=ilike.${enc(like)}&select=*&order=updated_at.desc&limit=5`))
    .find(d => d.company.trim().toLowerCase() === name.toLowerCase());
  if (found) return touchDeal(found, contact);
  return one(await db<Deal[]>("live_deals", { method: "POST", body: JSON.stringify({ owner, company: name, ...given(contact) }) }))!;
}

/** Bump updated_at (the autocomplete order) and apply any contact details given. */
export async function touchDeal(d: Deal, contact: Contact = {}): Promise<Deal> {
  return one(await db<Deal[]>(`live_deals?id=eq.${d.id}`, { method: "PATCH",
    body: JSON.stringify({ ...given(contact), updated_at: new Date().toISOString() }) })) ?? d;
}

const given = (c: Contact) => Object.fromEntries(Object.entries(c)
  .map(([k, v]) => [k, typeof v === "string" ? v.trim().slice(0, 200) : ""]).filter(([, v]) => v));

// ---------------------------------------------------------------- meetings

export async function createMeeting(p: { owner: string; deal_id: string; title: string | null; qualification: Qualification }): Promise<Meeting> {
  // Same rule as every SAM event: local dev, a test identity or x-sam-test: 1 makes it test traffic.
  const row = { ...p, is_test: await testTraffic(p.owner) };
  return one(await db<Meeting[]>("live_meetings", { method: "POST", body: JSON.stringify(row) }))!;
}

export async function getMeeting(id: string): Promise<Meeting | null> {
  return isId(id) ? one(await db<Meeting[]>(`live_meetings?id=eq.${id}&select=*`)) : null;
}

/** The newest earlier meeting's qualification on a deal: what a new call starts from. */
export async function lastQualification(dealId: string): Promise<Qualification | null> {
  return one(await db<{ qualification: Qualification }[]>(`live_meetings?deal_id=eq.${dealId}&select=qualification&order=started_at.desc&limit=1`))?.qualification ?? null;
}

/** PATCH one meeting. `when` is an extra PostgREST condition ("status=eq.live"); null = it did not match. */
export async function patchMeeting(id: string, patch: Partial<Meeting>, when = ""): Promise<Meeting | null> {
  return one(await db<Meeting[]>(`live_meetings?id=eq.${id}${when ? `&${when}` : ""}`, { method: "PATCH", body: JSON.stringify(patch) }));
}

/** Claim the insight slot: stamp last_insight_at only if the last insight is older than `everyMs`. One
 *  UPDATE, so of two uploads arriving together (rep and customer) exactly one gets the row back. */
export async function claimInsight(id: string, everyMs: number): Promise<Meeting | null> {
  const now = Date.now();
  const due = enc(`(last_insight_at.is.null,last_insight_at.lt."${new Date(now - everyMs).toISOString()}")`);
  return patchMeeting(id, { last_insight_at: new Date(now).toISOString() }, `status=eq.live&or=${due}`);
}

export type MeetingRow = Pick<Meeting, "id" | "deal_id" | "owner" | "title" | "status" | "started_at" | "ended_at" | "is_test" | "qualification" | "flow_status">
  & { deal_score: number | null; deal: Pick<Deal, "company" | "contact_name" | "contact_title"> | null };
const ROW = "id,deal_id,owner,title,status,started_at,ended_at,is_test,qualification,flow_status,deal_score:summary->deal_score,deal:live_deals(company,contact_name,contact_title)";

/** Newest first; one owner's, or everyone's when owner is null. */
export async function listMeetings(owner: string | null, limit = 100): Promise<MeetingRow[]> {
  return db<MeetingRow[]>(`live_meetings?select=${ROW}${owner ? `&owner=eq.${enc(owner)}` : ""}&order=started_at.desc&limit=${limit}`);
}

/** A deal's meetings, oldest first (the timeline). */
export async function dealMeetings(dealId: string): Promise<MeetingRow[]> {
  return db<MeetingRow[]>(`live_meetings?select=${ROW}&deal_id=eq.${dealId}&order=started_at.asc&limit=200`);
}

export type TeamRow = { started_at: string; status: string; qualification: Qualification; competitors: string[] | null; objections: string[] | null };

/** Everyone's meetings since `since`, real ones only unless `withTest`, with only what the team strip counts. */
export async function teamMeetings(since: string, withTest = false): Promise<TeamRow[]> {
  return db<TeamRow[]>(`live_meetings?select=started_at,status,qualification,competitors:summary->competitors,objections:summary->objections`
    + `${withTest ? "" : "&is_test=is.false"}&started_at=gte.${enc(since)}&order=started_at.desc&limit=1000`);
}

// ---------------------------------------------------------------- segments

/** The segment already stored for this utterance: the desktop retries uploads, and a retry whose first
 *  attempt did land must not be transcribed (and stored) twice. */
export async function findSegment(meetingId: string, channel: Channel, t_ms: number): Promise<Segment | null> {
  return one(await db<Segment[]>(`live_segments?meeting_id=eq.${meetingId}&channel=eq.${channel}&t_ms=eq.${t_ms}&select=id,channel,t_ms,duration_ms,text&limit=1`));
}

export async function addSegment(s: { meeting_id: string; channel: Channel; t_ms: number; duration_ms: number | null; text: string }): Promise<Segment> {
  return one(await db<Segment[]>("live_segments?select=id,channel,t_ms,duration_ms,text", { method: "POST", body: JSON.stringify(s) }))!;
}

/** A meeting's transcript in call order. `tail` = only the last n segments. Pages past PostgREST's
 *  1000-row cap, so a two-hour call is not silently cut short. */
export async function segments(meetingId: string, tail = 0): Promise<Segment[]> {
  const base = `live_segments?meeting_id=eq.${meetingId}&select=id,channel,t_ms,duration_ms,text`;
  if (tail) return (await db<Segment[]>(`${base}&order=t_ms.desc,id.desc&limit=${tail}`)).reverse();
  const out: Segment[] = [];
  for (let off = 0; ; off += 1000) {
    const page = await db<Segment[]>(`${base}&order=t_ms.asc,id.asc&limit=1000&offset=${off}`);
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

/** "Accops: ..." / "Customer: ..." lines. `maxChars` keeps the most recent lines that fit. */
export function transcript(segs: Pick<Segment, "channel" | "text">[], maxChars = 0): string {
  const lines = segs.map(s => `${s.channel === "rep" ? "Accops" : "Customer"}: ${s.text}`);
  if (!maxChars) return lines.join("\n");
  const out: string[] = [];
  let n = 0;
  for (let i = lines.length - 1; i >= 0 && n + lines[i].length + 1 <= maxChars; i--) { out.unshift(lines[i]); n += lines[i].length + 1; }
  return out.join("\n");
}
