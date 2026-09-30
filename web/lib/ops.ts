/** Operations: the scheduled-job run log (sam_ops_runs, docs/supabase-sam-ops.sql) and model token use.
 *
 *  Why a run log. Every daily job used to leave nothing behind when it did nothing, so "nothing changed"
 *  and "did not run" looked the same in the morning digest. Each job now writes one row per run; the
 *  System tab shows the last run of each and the digest raises a line when a daily job has gone quiet.
 *
 *  No runtime imports on purpose: lib/ops.check.mjs imports this file under bare node. */

export type RunStatus = "ok" | "warn" | "failed" | "refused" | "running";
export type OpsRun = { id?: number; job: string; started_at: string; finished_at: string | null; status: RunStatus; summary: string; details?: Record<string, unknown> };

/** Every scheduled job, with the IST time it is expected daily. `writer` says where the row comes from. */
export const JOBS: { job: string; label: string; at: string; writer: string }[] = [
  { job: "snapshot", label: "Deletion snapshot", at: "02:00", writer: "Power Automate \"SAM - daily SharePoint snapshot\" → /api/channels/sharepoint/snapshot" },
  { job: "carding_prep", label: "Nightly carding: prep", at: "07:00", writer: "prototype/carding_prep.py (Windows task SamNightlyCarding)" },
  { job: "carding", label: "Nightly carding: result", at: "07:00", writer: "the /sam-nightly-carding skill, last step" },
  { job: "cron", label: "Registry health cron", at: "08:00", writer: "Vercel cron 02:30 UTC → /api/cron/sharepoint" },
  { job: "rollup", label: "Metrics rollup", at: "08:00", writer: "the cron (and every metrics CSV export)" },
  { job: "digest", label: "Morning digest", at: "08:30", writer: "Power Automate \"SAM - morning digest\" → /api/v1/digest" },
];
/** A daily job with no run for this long has not run, whatever the reason. */
export const STALE_H = 30;

const IST_MS = 5.5 * 3_600_000;
/** The next time `at` (HH:MM, India time) comes round after `now`. */
export function nextRun(at: string, now: string): string {
  const [h, m] = at.split(":").map(Number), t = Date.parse(now);
  const istMidnight = Math.floor((t + IST_MS) / 86_400_000) * 86_400_000 - IST_MS;
  let next = istMidnight + (h * 60 + m) * 60_000;
  if (next <= t) next += 86_400_000;
  return new Date(next).toISOString();
}

export type JobState = (typeof JOBS)[number] & {
  last: OpsRun | null; ageH: number | null; next: string;
  /** No run in STALE_H hours (only once the log itself is older than that, so day one is not an alarm). */
  stale: boolean;
  state: "ok" | "warn" | "bad" | "off";
};
/** Latest run per job -> what the System tab and the digest show. `loggingSince` is the oldest row in the log. */
export function jobStates(runs: OpsRun[], now: string, loggingSince: string | null): JobState[] {
  const t = Date.parse(now), logAgeH = loggingSince ? (t - Date.parse(loggingSince)) / 3_600_000 : 0;
  return JOBS.map(j => {
    const last = runs.filter(r => r.job === j.job).sort((a, b) => b.started_at.localeCompare(a.started_at))[0] ?? null;
    const ageH = last ? (t - Date.parse(last.started_at)) / 3_600_000 : null;
    const stale = (ageH ?? Infinity) > STALE_H && logAgeH > STALE_H;
    const state = !last ? (stale ? "bad" : "off") : stale || last.status === "failed" ? "bad" : last.status === "ok" || last.status === "running" ? "ok" : "warn";
    return { ...j, last, ageH, next: nextRun(j.at, now), stale, state };
  });
}

/** Digest lines: a daily job that has not run, or whose last run failed or was refused. */
export function jobHealth(states: JobState[]): { title: string; detail: string }[] {
  const out: { title: string; detail: string }[] = [];
  for (const s of states) {
    if (s.stale) out.push({ title: `${s.label} has not run ${s.last ? `for ${Math.round(s.ageH!)} hours` : "since run logging began"}`,
      detail: `Expected daily at ${s.at} IST (${s.writer}).${s.last ? ` Last run: ${s.last.status}, ${s.last.summary || "no summary"}.` : ""} "Nothing changed" and "did not run" are different things.` });
    else if (s.last && (s.last.status === "failed" || s.last.status === "refused"))
      out.push({ title: `${s.label}: last run ${s.last.status}`, detail: s.last.summary || "No summary recorded." });
  }
  return out;
}

// ---------------------------------------------------------------- tokens

/** Total tokens the answering model used, from the answer trace's "model" step:
 *  OpenAI-compatible "... · 2140 tokens", Claude "... · 1800 in / 300 out". null when no model answered. */
export function traceTokens(trace: { step: string; detail: string }[] | undefined): number | null {
  let n: number | null = null;
  for (const s of trace ?? []) {
    if (s.step !== "model") continue;
    const oa = s.detail.match(/(\d+) tokens\b/), cl = s.detail.match(/(\d+) in \/ (\d+) out/);
    if (oa) n = (n ?? 0) + Number(oa[1]);
    else if (cl) n = (n ?? 0) + Number(cl[1]) + Number(cl[2]);
  }
  return n;
}

/** What each model costs or is allowed. Groq's free tier has a tokens-per-day cap per organisation and
 *  model (console.groq.com/settings/limits); OpenAI bills per token with no daily cap. Prices are USD per
 *  million tokens, list price as of September 2026 to our knowledge: verify on the provider's pricing page
 *  before quoting a number. ponytail: a fixed table; a model not in it shows tokens with no quota or price. */
export const MODEL_INFO: Record<string, { provider: string; dailyQuota?: number; usdIn?: number; usdOut?: number }> = {
  "openai/gpt-oss-120b": { provider: "Groq", dailyQuota: 200_000 },
  "openai/gpt-oss-20b": { provider: "Groq", dailyQuota: 200_000 },
  "gpt-5": { provider: "OpenAI", usdIn: 1.25, usdOut: 10 },
  "gpt-5-mini": { provider: "OpenAI", usdIn: 0.25, usdOut: 2 },
  "gpt-5-nano": { provider: "OpenAI", usdIn: 0.05, usdOut: 0.4 },
  "gpt-4.1": { provider: "OpenAI", usdIn: 2, usdOut: 8 },
  "gpt-4.1-mini": { provider: "OpenAI", usdIn: 0.4, usdOut: 1.6 },
  "gpt-4o-mini": { provider: "OpenAI", usdIn: 0.15, usdOut: 0.6 },
};
/** Only totals are recorded; a SAM answer is mostly prompt (the cards), so estimates assume this share is input. */
export const INPUT_SHARE = 0.9;

export type TokenDay = { day: string; model: string; provider: string; answers: number; tokens: number; quota: number | null; pctOfQuota: number | null; usd: number | null };
/** Per IST day and model: tokens, share of the daily quota, and an estimated spend. */
export function tokenUsage(rows: { created_at: string; model: string | null; tokens: number | null }[]): TokenDay[] {
  const acc = new Map<string, TokenDay>();
  for (const r of rows) {
    if (!r.model || r.tokens == null) continue;
    const day = new Date(Date.parse(r.created_at) + IST_MS).toISOString().slice(0, 10), k = `${day}|${r.model}`;
    const info = MODEL_INFO[r.model];
    const d = acc.get(k) ?? { day, model: r.model, provider: info?.provider ?? (r.model.startsWith("gpt-") ? "OpenAI" : "unknown"), answers: 0, tokens: 0, quota: info?.dailyQuota ?? null, pctOfQuota: null, usd: null };
    d.answers++; d.tokens += r.tokens;
    acc.set(k, d);
  }
  return [...acc.values()].map(d => {
    const info = MODEL_INFO[d.model];
    return { ...d, pctOfQuota: d.quota ? Math.round((d.tokens / d.quota) * 1000) / 10 : null,
      usd: info?.usdIn != null && info.usdOut != null ? Math.round(d.tokens * (INPUT_SHARE * info.usdIn + (1 - INPUT_SHARE) * info.usdOut) / 1e4) / 100 : null };
  }).sort((a, b) => b.day.localeCompare(a.day) || b.tokens - a.tokens);
}

// ---------------------------------------------------------------- reads and writes

function cfg() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}

/** Record one run. Never throws: a job must not fail because its log did. */
export async function logRun(r: { job: string; status: RunStatus; summary?: string; details?: Record<string, unknown>; started_at?: string }): Promise<void> {
  const c = cfg();
  if (!c) return;
  try {
    const res = await fetch(`${c.url}/rest/v1/sam_ops_runs`, {
      method: "POST", cache: "no-store",
      headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ job: r.job, status: r.status, summary: (r.summary ?? "").slice(0, 500), details: r.details ?? {},
        started_at: r.started_at ?? new Date().toISOString(), finished_at: new Date().toISOString() }),
    });
    if (!res.ok) console.error("sam_ops_runs insert failed", res.status);
  } catch (e) { console.error("sam_ops_runs insert error", e); }
}

async function get<T>(path: string): Promise<T | null> {
  const c = cfg();
  if (!c) return null;
  try {
    const r = await fetch(`${c.url}/rest/v1/${path}`, { headers: { apikey: c.key, Authorization: `Bearer ${c.key}` }, cache: "no-store" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch { return null; }
}

/** The last 60 days of runs (small: a handful a day) and when logging began. null = table unreadable. */
export async function recentRuns(): Promise<{ runs: OpsRun[]; since: string | null } | null> {
  const from = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const [runs, first] = await Promise.all([
    get<OpsRun[]>(`sam_ops_runs?select=job,started_at,finished_at,status,summary&started_at=gte.${encodeURIComponent(from)}&order=started_at.desc&limit=1000`),
    get<{ started_at: string }[]>(`sam_ops_runs?select=started_at&order=started_at.asc&limit=1`),
  ]);
  return runs ? { runs, since: first?.[0]?.started_at ?? null } : null;
}

/** Answers with a recorded token count since `from`, every identity (test traffic spends quota too). */
export async function tokenRows(from: string) {
  return (await get<{ created_at: string; model: string | null; tokens: number | null }[]>(
    `sam_events?select=created_at,model,tokens&kind=eq.query&tokens=not.is.null&created_at=gte.${encodeURIComponent(from)}&order=created_at.desc&limit=5000`)) ?? [];
}
