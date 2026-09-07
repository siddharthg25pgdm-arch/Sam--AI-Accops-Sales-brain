/** Operator metrics, read from the daily rollup rather than recomputed from raw events.
 *
 *  The admin page's original approach - fetch 2000 events and .filter() them in Node - is fine at 26
 *  events and degrades every day it is used. Everything here reads sam_metrics_daily instead, which
 *  is one indexed read per panel and stays constant-time as traffic grows. See
 *  docs/supabase-sam-metrics.sql for the schema and the rollup function.
 *
 *  Raw events are still the right source for the things that are inherently row-level - the last few
 *  questions asked, which assets got opened - so recentEvents() keeps its job. The rollup is for
 *  counts and distributions, which are the panels that would otherwise grow without bound. */

export type DailyMetric = {
  day: string; channel: string;
  queries: number; users: number; sessions: number; gaps: number;
  zero_results: number; catalogue_opens: number;
  feedback_total: number; feedback_helpful: number;
  latency_p50: number | null; latency_p95: number | null; latency_max: number | null;
};

function cfg() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}

async function rest<T>(path: string): Promise<T | null> {
  const c = cfg();
  if (!c) return null;
  try {
    const r = await fetch(`${c.url}/rest/v1/${path}`, {
      headers: { apikey: c.key, Authorization: `Bearer ${c.key}` }, cache: "no-store",
    });
    if (!r.ok) { console.error("metrics read failed", path, r.status); return null; }
    return (await r.json()) as T;
  } catch (e) { console.error("metrics read error", e); return null; }
}

/** Rollup rows for the last n days, newest first. */
export async function daily(days = 30): Promise<DailyMetric[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return (await rest<DailyMetric[]>(`sam_metrics_daily?day=gte.${since}&order=day.desc,channel.asc`)) ?? [];
}

/** Recompute the rollup. Called before rendering so the dashboard is never stale, and cheap because
 *  the function only touches the recent window. Failure is non-fatal: the page then shows whatever
 *  the last successful rollup produced, which is better than an error where a number should be. */
export async function rollup(daysBack = 3): Promise<void> {
  const c = cfg();
  if (!c) return;
  try {
    await fetch(`${c.url}/rest/v1/rpc/sam_rollup_metrics`, {
      method: "POST",
      headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ days_back: daysBack }), cache: "no-store",
    });
  } catch (e) { console.error("rollup failed", e); }
}

export type Totals = {
  queries: number; users: number; sessions: number; gaps: number; zeroResults: number;
  catalogueOpens: number; feedbackTotal: number; feedbackHelpful: number;
  /** Share of questions that found something. The headline "is SAM useful" number. */
  answerRate: number | null;
  /** Worst p95 across channels, not an average of percentiles - averaging percentiles is meaningless,
   *  and the slowest channel is the one a rep will complain about. */
  latencyP95: number | null;
  byChannel: Record<string, { queries: number; users: number; p50: number | null; p95: number | null }>;
};

export function totals(rows: DailyMetric[]): Totals {
  const t: Totals = {
    queries: 0, users: 0, sessions: 0, gaps: 0, zeroResults: 0, catalogueOpens: 0,
    feedbackTotal: 0, feedbackHelpful: 0, answerRate: null, latencyP95: null, byChannel: {},
  };
  for (const r of rows) {
    t.queries += r.queries; t.gaps += r.gaps; t.zeroResults += r.zero_results;
    t.catalogueOpens += r.catalogue_opens; t.sessions += r.sessions;
    t.feedbackTotal += r.feedback_total; t.feedbackHelpful += r.feedback_helpful;
    // Users cannot be summed across days or channels without double-counting the same person, so
    // this is a peak-day figure, not a distinct count. Labelled as such in the UI.
    t.users = Math.max(t.users, r.users);
    if (r.latency_p95 != null) t.latencyP95 = Math.max(t.latencyP95 ?? 0, r.latency_p95);
    const c = (t.byChannel[r.channel] ??= { queries: 0, users: 0, p50: null, p95: null });
    c.queries += r.queries; c.users = Math.max(c.users, r.users);
    if (r.latency_p50 != null) c.p50 = Math.max(c.p50 ?? 0, r.latency_p50);
    if (r.latency_p95 != null) c.p95 = Math.max(c.p95 ?? 0, r.latency_p95);
  }
  t.answerRate = t.queries ? Math.round(((t.queries - t.zeroResults) / t.queries) * 100) : null;
  return t;
}

/** One row per day, channels folded together, oldest first - the shape a bar chart wants.
 *  Days with no activity are included as zeroes so the chart shows silence rather than hiding it. */
export function byDay(rows: DailyMetric[], days = 14) {
  const acc = new Map<string, { queries: number; gaps: number }>();
  for (const r of rows) {
    const d = acc.get(r.day) ?? { queries: 0, gaps: 0 };
    d.queries += r.queries; d.gaps += r.gaps;
    acc.set(r.day, d);
  }
  const out: { day: string; queries: number; gaps: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    const d = acc.get(key) ?? { queries: 0, gaps: 0 };
    out.push({ day: key, ...d });
  }
  return out;
}

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

export type UserRow = { user: string; queries: number; gaps: number; channels: string[]; lastSeen: string; top: string };

/** Per-user activity. The adoption number: whether sales picked SAM up or only marketing did. */
export function userActivity(events: { kind: string; user_id: string; channel?: string; query?: string | null; created_at?: string }[]): UserRow[] {
  const acc = new Map<string, UserRow & { counts: Map<string, number> }>();
  for (const e of events) {
    if (e.kind !== "query" && e.kind !== "gap") continue;
    const r = acc.get(e.user_id) ?? {
      user: e.user_id, queries: 0, gaps: 0, channels: [] as string[], lastSeen: "", top: "",
      counts: new Map<string, number>(),
    };
    if (e.kind === "query") r.queries++; else r.gaps++;
    const ch = e.channel ?? "web";
    if (!r.channels.includes(ch)) r.channels.push(ch);
    const at = e.created_at ?? "";
    if (at > r.lastSeen) r.lastSeen = at;
    if (e.query) r.counts.set(e.query, (r.counts.get(e.query) ?? 0) + 1);
    acc.set(e.user_id, r);
  }
  return [...acc.values()].map(r => {
    const top = [...r.counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return { user: r.user, queries: r.queries, gaps: r.gaps, channels: r.channels, lastSeen: r.lastSeen, top: top?.[0] ?? "" };
  }).sort((a, b) => b.queries - a.queries);
}
