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
