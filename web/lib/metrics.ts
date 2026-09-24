/** Operator metrics. Aggregation happens in Postgres (sam_dashboard, docs/supabase-sam-observability.sql)
 *  so the dashboard reads one small JSON document rather than pulling raw events into Node. Raw rows are
 *  read only for what is inherently row-level: the conversation drill-down and the carding queue.
 *
 *  No runtime imports on purpose: lib/metrics.check.mjs imports this file under bare node.
 *
 *  THE DEFINITIONS. Every number on the dashboard is one of these. They are mirrored in the SQL
 *  function's header comment and shown to the reader in the Definitions panel (DEFINITIONS below).
 *  Change one, change all three. */

export const MIN_N = 10;

export const DEFINITIONS: [string, string][] = [
  ["Test traffic", "Excluded unless the toggle is on. An event is test if it came from a test identity (SAM_TEST_USERS, default dwight-test and dwight-siddharth), from local development, or from a caller that sent x-sam-test: 1."],
  ["Question", "One message someone asked SAM, on any channel. Publish requests and messages from unregistered WhatsApp numbers are not questions."],
  ["People", "Distinct people who asked at least one question or opened an asset from the catalogue in the period. New = their first ever such event falls in the period; returning = everyone else. For the 7-day period, People is weekly active people."],
  ["Daily active", "Average of distinct people per day across every day in the period, quiet days included."],
  ["Answered", "The headline success rate. A question is answered when SAM returned at least one asset, did not log it as a content gap, and did not fail outright (server error, empty answer, or ran out of steps). Necessary, not sufficient: it says SAM found something, not that it was right. Engaged and Rated helpful are the checks on that."],
  ["Engaged", "Answered on web, and the asker then opened one of the returned assets within 30 minutes or rated the answer helpful. Web only, because opens are not observable on WhatsApp, the API or MCP. Shown over web answers."],
  ["Rated helpful", "Helpful ratings over all ratings in the period. Only a minority of answers get rated, so read it with its n."],
  ["Error rate", "Questions with a recorded error over questions logged since error recording shipped (the date is shown beside the figure). Older questions are left out of both sides, because an old row with no error may simply predate the recording."],
  ["Fallback rate", "Questions where a model was tried but retrieval answered instead (timeout or every provider failed), over questions where a model was tried. Local development has no model key, so it never counts here."],
  ["Response time", "Server time from receiving the question to having the answer, p50 and p95. Plain catalogue searches (runtime search) are excluded: they are an in-memory ranking, not a model round trip."],
  ["Change", "Compared with the previous period of the same length, ending the same number of hours ago. Counts show % change; rates show the difference in percentage points. No change is shown without a baseline, and rates need at least 10 in both periods."],
  ["Rates with small n", `Below ${MIN_N}, a rate is shown as a fraction (3 of 4) rather than a percentage, because one more question would move it by more than ten points.`],
  ["Time zone", "Days, hours and the activity heatmap are in India Standard Time."],
];

export type Summary = {
  questions?: number; answered?: number; web_answered?: number; engaged?: number;
  instrumented?: number; errors?: number; model_attempted?: number; fallback?: number;
  latency_n?: number; p50?: number | null; p95?: number | null;
  people: number; new_people: number; rated: number; helpful: number; wrong_asset: number; missing: number;
  opens: number; gap_events: number;
};
export type Dashboard = {
  window: { from: string; to: string; prev_from: string; prev_to: string; days: number; tz: string };
  summary: { cur: Summary; prev: Summary };
  daily: { day: string; questions: number; answered: number; errors: number; people: number }[];
  channel: { key: string; questions: number; people: number; answered: number; instrumented: number; errors: number; p50: number | null; p95: number | null }[];
  intent: { key: string; n: number }[]; asset_type: { key: string; n: number }[]; vertical: { key: string; n: number }[]; product: { key: string; n: number }[];
  runtime: { runtime: string; model: string | null; n: number; p50: number | null }[];
  errors: { key: string; n: number; last_at: string; last_detail: string | null }[];
  heatmap: { dow: number; hour: number; n: number }[];
  latency: { bucket: number; n: number }[];
  assets: { key: string; returned: number; from_answer: number; from_catalogue: number }[];
  people: { key: string; questions: number; answered: number; errors: number; opens: number; channels: string[] | null; last_seen: string; first_seen: string | null; top: string | null }[];
  top_questions: { key: string; n: number; people: number; answered: number }[];
  gaps: { kind: string; query: string | null; filters: Record<string, unknown> | null; user_id: string; created_at: string }[];
  first_event_at: string | null; last_event_at: string | null; instrumented_since: string | null;
};

export const LATENCY_BUCKETS = ["< 1 s", "1–2 s", "2–4 s", "4–8 s", "8–16 s", "16 s +"];

// ---------------------------------------------------------------- pure helpers (checked)

/** A rate that knows its own n. pct is null below minN, and the UI then shows "num of den". */
export type Ratio = { num: number; den: number; pct: number | null };
export function ratio(num = 0, den = 0, minN = MIN_N): Ratio {
  return { num, den, pct: den >= minN && den > 0 ? Math.round((num / den) * 1000) / 10 : null };
}

/** Period-over-period change. Counts: % change, none without a baseline (0 -> 5 is not "+inf%").
 *  Rates: percentage-point difference, only when both sides cleared minN. `dir` is the raw sign;
 *  whether up is good is the caller's call (errors up is bad, answered up is good). */
export type Delta = { value: number; unit: "%" | "pt"; dir: -1 | 0 | 1 };
export function delta(cur: number | null | undefined, prev: number | null | undefined, unit: "%" | "pt"): Delta | null {
  if (cur == null || prev == null) return null;
  let value: number;
  if (unit === "pt") value = Math.round((cur - prev) * 10) / 10;
  else if (prev === 0) return null;
  else value = Math.round(((cur - prev) / prev) * 100);
  return { value, unit, dir: value > 0 ? 1 : value < 0 ? -1 : 0 };
}

/** Rate change between two Ratios, respecting the small-n rule on both sides. */
export function rateDelta(cur: Ratio, prev: Ratio): Delta | null {
  return cur.pct == null || prev.pct == null ? null : delta(cur.pct, prev.pct, "pt");
}

/** Mean distinct people per day, quiet days included. */
export function dailyActive(days: { people: number }[]): number {
  return days.length ? Math.round((days.reduce((n, d) => n + d.people, 0) / days.length) * 10) / 10 : 0;
}

/** Bin a count into 0..steps for a sequential ramp. 0 stays 0 (its own "none" colour); the rest are
 *  split evenly up to the max, so the darkest step always means "the busiest cell". */
export function heatStep(n: number, max: number, steps = 4): number {
  if (n <= 0 || max <= 0) return 0;
  return Math.min(steps, Math.max(1, Math.ceil((n / max) * steps)));
}

// ---------------------------------------------------------------- reads

function cfg() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}

async function rest<T>(path: string, init?: RequestInit): Promise<{ data: T | null; status: number; headers: Headers | null; body?: string }> {
  const c = cfg();
  if (!c) return { data: null, status: 0, headers: null };
  try {
    const r = await fetch(`${c.url}/rest/v1/${path}`, {
      ...init, cache: "no-store",
      headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    if (!r.ok) { const body = await r.text(); console.error("metrics read failed", path.split("?")[0], r.status); return { data: null, status: r.status, headers: r.headers, body }; }
    return { data: (await r.json()) as T, status: r.status, headers: r.headers };
  } catch (e) { console.error("metrics read error", e); return { data: null, status: 0, headers: null }; }
}

/** The whole dashboard in one RPC. null when Supabase is not configured or the call failed. */
export async function dashboard(days: number, includeTest: boolean, testUsers: string[]): Promise<Dashboard | null> {
  return (await rest<Dashboard>("rpc/sam_dashboard", {
    method: "POST", body: JSON.stringify({ p_days: days, p_include_test: includeTest, p_test_users: testUsers }),
  })).data;
}

export type Conversation = {
  id: number; created_at: string; user_id: string; channel: string; session_id: string | null; query: string | null;
  intent: string | null; result_count: number | null; result_ids: string[] | null; result_titles: string[] | null;
  runtime: string | null; model: string | null; latency_ms: number | null; answer: string | null;
  error_kind: string | null; error_detail: string | null; is_test: boolean; schema_version: number | null;
  reactions: { kind: string; feedback: string | null; asset_path: string | null }[];
};
export type ConvFilter = "all" | "errors" | "gaps" | "fallbacks";

/** Recent questions with what came back and what the asker did next. Two indexed reads. */
export async function conversations(p: { from: string; filter: ConvFilter; channel?: string; user?: string; limit: number; real?: string }): Promise<Conversation[]> {
  const q = [
    "select=id,created_at,user_id,channel,session_id,query,intent,result_count,result_ids,result_titles,runtime,model,latency_ms,answer,error_kind,error_detail,is_test,schema_version",
    "kind=eq.query", `created_at=gte.${encodeURIComponent(p.from)}`, "order=created_at.desc", `limit=${p.limit}`,
    "intent=not.in.(request_publish,unregistered)",
  ];
  if (p.real) q.push(p.real);
  if (p.filter === "errors") q.push("error_kind=not.is.null");
  if (p.filter === "fallbacks") q.push("error_kind=in.(timeout,fallback_retrieval)");
  if (p.filter === "gaps") q.push("or=(intent.eq.gap,result_count.eq.0)");
  if (p.channel) q.push(`channel=eq.${encodeURIComponent(p.channel)}`);
  if (p.user) q.push(`user_id=eq.${encodeURIComponent(p.user)}`);
  const rows = (await rest<Omit<Conversation, "reactions">[]>(`sam_events?${q.join("&")}`)).data ?? [];
  if (!rows.length) return [];
  const refs = (await rest<{ ref_event_id: number; kind: string; feedback: string | null; asset_path: string | null }[]>(
    `sam_events?select=ref_event_id,kind,feedback,asset_path&ref_event_id=in.(${rows.map(r => r.id).join(",")})`)).data ?? [];
  return rows.map(r => ({ ...r, reactions: refs.filter(x => x.ref_event_id === r.id) }));
}

export type CardingRow = { item_id: string; filename: string; folder: string; web_url: string; modified_at: string | null; modified_by: string | null; reason: string; card_updated_at: string | null };

/** Files that need a card written or rewritten. The view is owned by the carding work; until it
 *  exists this returns missing: true and the panel says so, rather than showing an error. */
export async function cardingQueue(limit = 50): Promise<{ rows: CardingRow[]; total: number; missing: boolean }> {
  const r = await rest<CardingRow[]>(`sam_carding_queue?select=*&order=modified_at.desc.nullslast&limit=${limit}`, { headers: { Prefer: "count=exact" } });
  if (!r.data) return { rows: [], total: 0, missing: r.status === 404 || /42P01|PGRST205/.test(r.body ?? "") || r.status === 0 };
  const total = Number(r.headers?.get("content-range")?.split("/")[1] ?? r.data.length) || r.data.length;
  return { rows: r.data, total, missing: false };
}

/** Last model answer and last provider failure: provider status from what actually happened,
 *  rather than a live ping that costs a request on every page view. */
export async function providerEvidence(real: string) {
  const [ok, bad] = await Promise.all([
    rest<{ created_at: string; model: string }[]>(`sam_events?select=created_at,model&kind=eq.query&model=not.is.null&${real}&order=created_at.desc&limit=1`),
    rest<{ created_at: string; error_kind: string; error_detail: string | null }[]>(`sam_events?select=created_at,error_kind,error_detail&error_kind=in.(timeout,fallback_retrieval,provider_error)&${real}&order=created_at.desc&limit=1`),
  ]);
  return { lastAnswer: ok.data?.[0] ?? null, lastFailure: bad.data?.[0] ?? null };
}

// ---------------------------------------------------------------- daily rollup (CSV export)

export type DailyMetric = {
  day: string; channel: string;
  queries: number; users: number; sessions: number; gaps: number;
  zero_results: number; catalogue_opens: number;
  feedback_total: number; feedback_helpful: number;
  latency_p50: number | null; latency_p95: number | null; latency_max: number | null;
};

/** Rollup rows for the last n days, newest first. Real traffic only since 25 Sep 2026. */
export async function daily(days = 30): Promise<DailyMetric[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return (await rest<DailyMetric[]>(`sam_metrics_daily?day=gte.${since}&order=day.desc,channel.asc`)).data ?? [];
}

/** Recompute the rollup's recent window. Idempotent; failure leaves the last good rollup. */
export async function rollup(daysBack = 3): Promise<void> {
  await rest("rpc/sam_rollup_metrics", { method: "POST", body: JSON.stringify({ days_back: daysBack }) });
}

// ---------------------------------------------------------------- worklists (checked)

export type GapRow = {
  key: string; vertical: string; type: string; product: string;
  asks: number; external: number; examples: string[]; users: string[];
  firstSeen: string; lastSeen: string;
};

/** Content gaps as a worklist: what people actually asked for and did not get.
 *
 *  Deliberately NOT coverageGaps(), which enumerates every vertical x type x product permutation -
 *  around 72 of them, most of which nobody will ever ask for. "No Telecom whitepaper about MFA" is
 *  true and commercially meaningless. Demand is the only ranking that earns someone's time.
 *
 *  `external` counts the asks that failed only because the asset has no public URL. Those are not
 *  missing content at all - the asset exists and cannot be sent - so they belong in a publish queue,
 *  not a writing queue. Conflating the two is what produced the false gap on 4 September. */
export function gapWorklist(events: { kind: string; query?: string | null; filters?: Record<string, unknown> | null; user_id: string; created_at?: string }[]): GapRow[] {
  const acc = new Map<string, GapRow>();
  for (const e of events) {
    if (e.kind !== "gap") continue;
    const f = (e.filters ?? {}) as Record<string, string>;
    const vertical = f.vertical || "any", type = f.asset_type || "any", product = f.product || "";
    const key = `${vertical}|${type}|${product}`;
    const at = e.created_at ?? "";
    const row = acc.get(key) ?? {
      key, vertical, type, product, asks: 0, external: 0, examples: [], users: [],
      firstSeen: at, lastSeen: at,
    };
    row.asks++;
    if (f.audience === "external") row.external++;
    if (e.query && !row.examples.includes(e.query) && row.examples.length < 3) row.examples.push(e.query);
    if (!row.users.includes(e.user_id)) row.users.push(e.user_id);
    if (at && at < row.firstSeen) row.firstSeen = at;
    if (at && at > row.lastSeen) row.lastSeen = at;
    acc.set(key, row);
  }
  // Askers before asks: three people wanting the same thing is a stronger signal than one person
  // asking three times, which is usually someone rephrasing.
  return [...acc.values()].sort((a, b) => b.users.length - a.users.length || b.asks - a.asks);
}

export type FreshRow = { owner: string; total: number; stale: number; oldest: string | null };

/** Freshness by owner, so a stale asset has a name attached and the nudge has somewhere to go.
 *
 *  Honest about which date this is. It uses SharePoint's `modified_at`, NOT a publication date -
 *  those are different questions and only the second one is really "how old is this content".
 *  A file touched last week can hold 2022 numbers, and a file untouched since 2021 might still be
 *  accurate. So this over-reports freshness and under-reports staleness, and the UI says so. */
export function freshness(rows: { modified_by: string | null; modified_at: string | null; status: string; deleted: boolean; suggest_ingest?: boolean }[], months = 12): FreshRow[] {
  const cutoff = new Date(Date.now() - months * 30.44 * 86_400_000).toISOString();
  const acc = new Map<string, FreshRow>();
  for (const r of rows) {
    // Only documents a rep could actually send. Logos and archived copies going stale is not news.
    if (r.deleted || r.status !== "active" || r.suggest_ingest === false) continue;
    const owner = r.modified_by || "unknown";
    const f = acc.get(owner) ?? { owner, total: 0, stale: 0, oldest: null };
    f.total++;
    if (r.modified_at && r.modified_at < cutoff) {
      f.stale++;
      if (!f.oldest || r.modified_at < f.oldest) f.oldest = r.modified_at;
    }
    acc.set(owner, f);
  }
  return [...acc.values()].filter(f => f.stale > 0).sort((a, b) => b.stale - a.stale);
}
