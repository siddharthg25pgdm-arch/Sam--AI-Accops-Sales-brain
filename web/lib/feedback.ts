/** What reps told SAM under an answer: "Yes", "Wrong asset", "What I need doesn't exist".
 *
 *  A rating is a sam_events row (kind feedback) pointing at the answered question (ref_event_id).
 *  Three things act on it:
 *    - the admin Quality tab and the morning digest read them (loadRatings, wrongAssetTally);
 *    - "doesn't exist" votes on a content request (app/api/feedback/route.ts -> requests.ts);
 *    - "wrong asset" teaches ranking, conservatively (learnDemotions -> demotion(), used by
 *      cards.ts searchAssets). Nothing is stored for a demotion except a human clearing one
 *      (sam_rank_feedback, docs/supabase-sam-feedback.sql).
 *
 *  Pure helpers first (lib/feedback.check.mjs runs them), then the cache, then the Supabase reads. */
import { topicOf } from "./cards";
import { recentEvents, realOnly } from "./events";

/** Distinct reps who must agree before a document is demoted for a topic. */
export const DEMOTE_MIN_REPS = 2;
/** Ratings older than this stop counting, so a demotion lapses on its own. */
export const DEMOTE_DAYS = 60;
/** Subtracted from a search score. One title-word hit is 1.5, one matched token 2, a complete match 6:
 *  enough to let an equally good document overtake, not enough to bury a clearly better one. */
export const DEMOTE_PENALTY = 3;

export type FeedbackKind = "helpful" | "wrong_asset" | "missing";
export const FEEDBACK_LABEL: Record<FeedbackKind, string> = { helpful: "Helpful", wrong_asset: "Wrong asset", missing: "Doesn't exist" };
export type Asked = { id: number; created_at: string; user_id: string; channel: string; query: string | null; answer: string | null; result_ids: string[] | null; result_titles: string[] | null };
export type Rating = { id: number; created_at: string; user_id: string; channel: string; feedback: FeedbackKind; ref_event_id: number | null; is_test: boolean; asked: Asked | null };
export type Clear = { asset_id: string; topic: string; created_at: string };

// ---------------------------------------------------------------- pure (checked)

/** One rating per rep per answer, the latest (a rep who pressed "Wrong asset" then "Yes" meant yes),
 *  and only ratings of the rep's OWN question: an answer id is guessable, a rep's question is not
 *  someone else's to rate. Newest first. */
export function latestRatings(rs: Rating[]): Rating[] {
  const seen = new Set<string>(), out: Rating[] = [];
  for (const r of [...rs].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)) {
    if (!(r.feedback in FEEDBACK_LABEL) || !r.asked || r.asked.user_id !== r.user_id) continue;
    const k = `${r.user_id}|${r.ref_event_id}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push(r);
  }
  return out;
}

/** The answer's verdict sentence: its text minus the document lines ("- ..."), as the chat shows it. */
export function verdictOf(answer: string | null | undefined): string {
  return (answer ?? "").split("\n").filter(l => l.trim() && !l.startsWith("- ")).join(" ").trim();
}

/** The documents an answer showed, as [key, title]. */
const docs = (a: Asked) => (a.result_ids ?? []).map((k, i) => [k, a.result_titles?.[i] ?? k.split("/").pop() ?? k] as const);

export type DocTally = { key: string; title: string; reps: number; ratings: number; questions: string[]; last: string };
/** Documents most often shown in an answer rated "wrong asset", by distinct reps. A rating is of the
 *  whole answer, so every document it showed is counted: read it with the questions. */
export function wrongAssetTally(rs: Rating[]): DocTally[] {
  const acc = new Map<string, DocTally & { users: Set<string> }>();
  for (const r of latestRatings(rs)) {
    if (r.feedback !== "wrong_asset") continue;
    for (const [key, title] of docs(r.asked!)) {
      const t = acc.get(key) ?? { key, title, reps: 0, ratings: 0, questions: [], last: "", users: new Set<string>() };
      t.ratings++; t.users.add(r.user_id); t.reps = t.users.size;
      const q = r.asked!.query?.trim();
      if (q && !t.questions.includes(q) && t.questions.length < 3) t.questions.push(q);
      if (r.created_at > t.last) t.last = r.created_at;
      acc.set(key, t);
    }
  }
  return [...acc.values()].map(({ users: _u, ...t }) => t).sort((a, b) => b.reps - a.reps || b.ratings - a.ratings || b.last.localeCompare(a.last));
}

export type Demotion = { asset: string; title: string; topic: string[]; reps: string[]; questions: string[]; last: string };
const within = (sub: string[], sup: string[]) => sub.every(t => sup.includes(t));

/** Documents reps agree are the wrong answer for a topic.
 *
 *  A demotion is (document, topic): at least DEMOTE_MIN_REPS distinct reps rated an answer showing the
 *  document "wrong asset" for questions whose topics (topicOf) share those tokens, within DEMOTE_DAYS,
 *  and nobody rated an answer showing it "helpful" for a question on that topic in the same window.
 *  The topic is what the reps' questions have in common, so it is never broader than the agreement.
 *  A human clear counts: only ratings after the latest clear of that (document, topic) count again.
 *  ponytail: pairwise intersections, O(n^2) per document; fine for the tens of ratings a document gets. */
export function learnDemotions(rs: Rating[], now: string, clears: Clear[] = []): Demotion[] {
  const since = new Date(Date.parse(now) - DEMOTE_DAYS * 86_400_000).toISOString();
  type R = { user: string; topic: string[]; q: string; at: string; title: string };
  const wrong = new Map<string, R[]>(), helpful = new Map<string, string[][]>();
  for (const r of latestRatings(rs)) {
    if (r.created_at < since || r.feedback === "missing") continue;
    const topic = topicOf(r.asked!.query ?? "");
    if (!topic.length) continue;
    for (const [key, title] of docs(r.asked!)) {
      if (r.feedback === "helpful") helpful.set(key, [...(helpful.get(key) ?? []), topic]);
      else wrong.set(key, [...(wrong.get(key) ?? []), { user: r.user_id, topic, q: r.asked!.query ?? "", at: r.created_at, title }]);
    }
  }
  const clearedAt = new Map<string, string>();
  for (const c of clears) { const k = `${c.asset_id}\n${c.topic}`; if ((clearedAt.get(k) ?? "") < c.created_at) clearedAt.set(k, c.created_at); }

  const out: Demotion[] = [];
  for (const [asset, ws] of wrong) {
    const topics = new Map<string, string[]>();
    for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) {
      if (ws[i].user === ws[j].user) continue;
      const shared = ws[i].topic.filter(t => ws[j].topic.includes(t));
      if (shared.length) topics.set(shared.join(" "), shared);
    }
    const found: Demotion[] = [];
    for (const [key, topic] of topics) {
      if ((helpful.get(asset) ?? []).some(h => within(topic, h))) continue;
      const after = clearedAt.get(`${asset}\n${key}`) ?? "";
      const support = ws.filter(w => w.at > after && within(topic, w.topic));
      const reps = [...new Set(support.map(w => w.user))];
      if (reps.length < DEMOTE_MIN_REPS) continue;
      found.push({ asset, title: support[0].title, topic, reps, questions: [...new Set(support.map(w => w.q))].slice(0, 3),
        last: support.map(w => w.at).sort().pop()! });
    }
    // A narrower topic already covers every query a wider one would: keep the narrowest.
    out.push(...found.filter(d => !found.some(o => o !== d && o.topic.length < d.topic.length && within(o.topic, d.topic))));
  }
  return out.sort((a, b) => b.reps.length - a.reps.length || b.last.localeCompare(a.last));
}

/** The penalty for one document on one query: DEMOTE_PENALTY when any demotion's topic is inside the
 *  query's topic, else 0. Once, however many demotions match. */
export function penalty(ds: Map<string, string[][]>, key: string, topic: string[]): number {
  return ds.get(key)?.some(t => within(t, topic)) ? DEMOTE_PENALTY : 0;
}

// ---------------------------------------------------------------- cache (search path is synchronous)

const TTL_MS = 10 * 60_000;
const g = globalThis as unknown as { __samRank?: Map<string, string[][]>; __samRankList?: Demotion[]; __samRankAt?: number; __samRankBusy?: boolean };

/** Used by searchAssets for every asset on every query, so it only reads the warm map; a stale map
 *  kicks a background refresh, the same pattern as cards-cache and registry-cache. */
export function demotion(key: string, topic: string[]): number {
  if (!g.__samRankAt || Date.now() - g.__samRankAt > TTL_MS) void refreshDemotions();
  return g.__samRank ? penalty(g.__samRank, key, topic) : 0;
}

/** Real traffic only. A failed read keeps the previous demotions. Empty is a valid answer here (unlike
 *  the card cache), so it is stamped either way. */
export async function refreshDemotions(): Promise<Demotion[]> {
  if (g.__samRankBusy) return g.__samRankList ?? [];
  g.__samRankBusy = true;
  try {
    if (!cfg()) { g.__samRank = new Map(); g.__samRankList = []; return []; }
    const now = new Date().toISOString();
    const [rs, clears] = await Promise.all([loadRatings({ from: new Date(Date.now() - DEMOTE_DAYS * 86_400_000).toISOString(), real: true, limit: 2000 }), loadClears()]);
    if (!rs || !clears) return g.__samRankList ?? [];
    const list = learnDemotions(rs, now, clears);
    const m = new Map<string, string[][]>();
    for (const d of list) m.set(d.asset, [...(m.get(d.asset) ?? []), d.topic]);
    g.__samRank = m; g.__samRankList = list;
    return list;
  } catch (e) { console.error("rank feedback refresh failed", e); return g.__samRankList ?? []; }
  finally { g.__samRankAt = Date.now(); g.__samRankBusy = false; }
}

// ---------------------------------------------------------------- Supabase

function cfg() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
async function rest<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  const c = cfg();
  if (!c) return null;
  try {
    const r = await fetch(`${c.url}/rest/v1/${path}`, { ...init, cache: "no-store",
      headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
    if (!r.ok) { console.error("feedback read failed", path.split("?")[0], r.status); return null; }
    const text = await r.text();
    return (text ? JSON.parse(text) : []) as T;
  } catch (e) { console.error("feedback read error", e); return null; }
}

/** Ratings since `from` (no upper bound: the DB clock can run ahead of this server), newest first, each with the question it rated. null when the read failed. */
export async function loadRatings(p: { from: string; real: boolean; limit: number }): Promise<Rating[] | null> {
  const q = ["select=id,created_at,user_id,channel,feedback,ref_event_id,is_test", "kind=eq.feedback", `created_at=gte.${encodeURIComponent(p.from)}`,
    "order=created_at.desc", `limit=${p.limit}`];
  if (p.real) q.push(realOnly());
  const rows = await rest<Omit<Rating, "asked">[]>(`sam_events?${q.join("&")}`);
  if (!rows) return null;
  const ids = [...new Set(rows.map(r => r.ref_event_id).filter((x): x is number => Number.isInteger(x)))];
  const asked = new Map<number, Asked>();
  for (let i = 0; i < ids.length; i += 200) {
    const part = await rest<Asked[]>(`sam_events?select=id,created_at,user_id,channel,query,answer,result_ids,result_titles&kind=eq.query&id=in.(${ids.slice(i, i + 200).join(",")})`);
    if (!part) return null;
    for (const a of part) asked.set(a.id, a);
  }
  return rows.map(r => ({ ...r, asked: r.ref_event_id != null ? asked.get(r.ref_event_id) ?? null : null }));
}

/** The question one rating is about, when it is the rater's own. */
export async function askedEvent(id: number, user: string): Promise<Asked | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const [e] = await recentEvents(1, `kind=eq.query&id=eq.${id}`);
  return e && e.id === id && e.user_id === user ? (e as unknown as Asked) : null;
}

export async function loadClears(): Promise<Clear[] | null> {
  return rest<Clear[]>("sam_rank_feedback?select=asset_id,topic,created_at&order=created_at.desc&limit=1000");
}

/** A human says a learned demotion is wrong. Takes effect on this instance at once, others within the TTL. */
export async function clearDemotion(asset: string, topic: string, by: string): Promise<boolean> {
  const ok = (await rest("sam_rank_feedback", { method: "POST", body: JSON.stringify({ asset_id: asset, topic, cleared_by: by }) })) !== null;
  if (ok) { g.__samRankAt = 0; await refreshDemotions(); }
  return ok;
}
