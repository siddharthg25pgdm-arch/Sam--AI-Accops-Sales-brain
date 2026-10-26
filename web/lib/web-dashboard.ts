/** The admin Website tab's data (plan 9 "Stream E"): the website chatbot's analytics, the Q&A approval queue and
 *  the settings, read and written with the SERVICE KEY. Admin only: nothing under web/lib/web, app/api/web or
 *  app/embed may import this file (scripts/web-guard.mjs walks those entries and would flag the service key here).
 *
 *  Aggregates come from Stream A's sam_web_dashboard(days, include_test) (docs/supabase-sam-web-03-log.sql); the
 *  lists (conversations, missed questions ranked by distinct visitors, guard reasons, top questions per page) are
 *  read from sam_web_messages + sam_web_conversations, which service_role may SELECT. No new SQL.
 *
 *  The pure functions (mapDashboard, the list derivations, decisionPatch, draftRow, settingsPatch, websiteDigest's
 *  shaping) are what lib/web-admin.check.mjs runs on fixtures; the fetchers are thin. */
import type { Answer, Block } from "@/lib/blocks";

// ---------------------------------------------------------------- vocabulary

export const SOURCES = ["bank", "intent", "cache", "model", "fallback", "guard", "limited", "repeat"] as const;
export type WebSource = (typeof SOURCES)[number];
export const LABELS = ["human", "suspect", "bot"] as const;
export type WebLabel = (typeof LABELS)[number];
/** Answered without a model call: the plan's "share answered without the model" numerator. */
export const NO_MODEL: WebSource[] = ["bank", "intent", "cache"];
export const SOURCE_LABEL: Record<WebSource, string> = {
  bank: "Bank (clicked)", intent: "Intent match", cache: "Shared cache", model: "Model",
  fallback: "Fallback", guard: "Guard", limited: "Rate limited", repeat: "Repeat",
};
export const SOURCE_HELP: Record<WebSource, string> = {
  bank: "A clicked question or chip: the approved answer, no model.",
  intent: "A typed question the tier-1 matcher placed on an approved pair, no model.",
  cache: "The same question was answered for someone in the last 24 hours, no model.",
  model: "gpt-6-luna (or the Groq fallback) picked approved records; it writes no text.",
  fallback: "Nothing fitted: the fixed honest line, Talk to sales and the page's questions.",
  guard: "The pre-guard stopped it (internal material, injection, pricing, contact details, ...).",
  limited: "Over a per-visitor or per-IP limit.",
  repeat: "The same question a 3rd time within 10 minutes: Talk to sales only.",
};
export const LABEL_HELP: Record<WebLabel, string> = {
  human: "No bot signal. Only humans can reach the model.",
  suspect: "Timing, cadence, a direct /embed open or a limit hit. Bank, intent and cache only.",
  bot: "BotID, a bot user agent or a missing / forged handshake. Bank, intent and cache only.",
};
export const GUARD_LABEL: Record<string, string> = {
  internal: "Asked for internal material", injection: "Prompt injection", identity: "Asked who a customer is",
  pricing: "Pricing or discount", roadmap: "Roadmap or release dates", contact: "Asked for a person's contact details",
  pii: "Shared their own contact details", markup: "HTML or script in the question", careers: "Careers",
};
/** sam_web_dashboard's default blended price (about 2.5k in at $0.10/M + 50 out at $0.50/M per answer). */
export const USD_PER_MTOK = 0.11;
/** Plan 2.2: the digest warns at this share of a daily ceiling. */
export const WARN_SHARE = 0.7;
/** PRD section 10: conversations are kept 180 days, then reduced to aggregates (sam_web_purge, stage 2). */
export const RETENTION_DAYS = 180;

const IST_MS = 330 * 60_000;
/** "2026-10-27": the India-time calendar day of an instant. */
export const istDay = (iso: string | number | Date) => new Date(new Date(iso).getTime() + IST_MS).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ---------------------------------------------------------------- the dashboard RPC, mapped

export type RawDashboard = {
  days: number;
  conversations: Partial<Record<string, number>> | null;
  messages: number;
  tier_mix: { day: string; source: string; label: string; n: number }[] | null;
  without_model_share: number | null;
  tokens: number; est_usd: number; cost_per_human_conversation: number | null;
  missed: { at: string; question: string | null; source: string; verdict: string | null; refs: string[]; conversation_id: string }[] | null;
  events: Partial<Record<string, number>> | null;
  cta_clicks: number;
  countries: Partial<Record<string, number>> | null;
  ceiling: { day: string; model_answers: number; groq_answers: number; tokens: number }[] | null;
  model_ceiling: number | null; groq_daily_cap: number | null;
};

export type Mix = Record<WebSource, number>;
const zeroMix = (): Mix => Object.fromEntries(SOURCES.map(s => [s, 0])) as Mix;
export type UsageDay = { day: string; model: number; groq: number; tokens: number; modelPct: number | null; groqPct: number | null };
export type WebDash = {
  days: number; from: string; to: string;
  conv: Record<WebLabel, number> & { total: number };
  messages: number; perConv: number | null;
  /** Every IST day of the window, oldest first, for the selected label (or all). */
  mix: { day: string; total: number; by: Mix }[];
  totals: Mix;
  /** Human conversations only (plan 2.3: bots and suspects stay out of the rate). */
  withoutModel: { num: number; den: number; pct: number | null; share: number | null };
  tokens: number; usd: number; usdPerHumanConv: number | null;
  events: Record<string, number>; cta: number;
  countries: { key: string; n: number }[];
  usage: UsageDay[]; today: UsageDay; ceiling: number | null; groqCap: number | null;
  missedCount: number;
};

const pctOf = (n: number, cap: number | null) => (cap && cap > 0 ? Math.round((n / cap) * 1000) / 10 : null);
const sorted = (o: Partial<Record<string, number>> | null) => Object.entries(o ?? {}).map(([key, n]) => ({ key, n: n ?? 0 })).sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));

/** sam_web_dashboard's jsonb -> what the tab draws. Null-safe: on an empty database every aggregate is null. */
export function mapDashboard(raw: RawDashboard | null, now: string, label: WebLabel | "all" = "all", daysIn?: number): WebDash {
  const days = raw?.days ?? daysIn ?? 30, to = istDay(now), from = addDays(to, -(days - 1));
  const c = raw?.conversations ?? {};
  const conv = { human: c.human ?? 0, suspect: c.suspect ?? 0, bot: c.bot ?? 0, total: 0 };
  conv.total = conv.human + conv.suspect + conv.bot;
  const byDay = new Map<string, Mix>();
  for (let d = from; d <= to; d = addDays(d, 1)) byDay.set(d, zeroMix());
  const totals = zeroMix(), human = zeroMix();
  for (const r of raw?.tier_mix ?? []) {
    const s = r.source as WebSource;
    if (!SOURCES.includes(s)) continue;
    if (r.label === "human") human[s] += r.n;
    if (label !== "all" && r.label !== label) continue;
    totals[s] += r.n;
    const m = byDay.get(r.day) ?? (r.day >= from && r.day <= to ? zeroMix() : null); // messages after the window's last day are kept in totals only
    if (m) { m[s] += r.n; byDay.set(r.day, m); }
  }
  const num = NO_MODEL.reduce((n, s) => n + human[s], 0), den = num + human.model;
  const usage = (raw?.ceiling ?? []).map(u => ({ day: u.day, model: u.model_answers, groq: u.groq_answers, tokens: Number(u.tokens) || 0,
    modelPct: pctOf(u.model_answers, raw?.model_ceiling ?? null), groqPct: pctOf(u.groq_answers, raw?.groq_daily_cap ?? null) }));
  const today = usage.find(u => u.day === to) ?? { day: to, model: 0, groq: 0, tokens: 0, modelPct: pctOf(0, raw?.model_ceiling ?? null), groqPct: pctOf(0, raw?.groq_daily_cap ?? null) };
  const messages = raw?.messages ?? 0;
  return {
    days, from, to, conv, messages, perConv: conv.total ? Math.round((messages / conv.total) * 10) / 10 : null,
    mix: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, by]) => ({ day, by, total: SOURCES.reduce((n, s) => n + by[s], 0) })),
    totals,
    withoutModel: { num, den, pct: den ? Math.round((num / den) * 100) : null, share: raw?.without_model_share ?? null },
    tokens: Number(raw?.tokens) || 0, usd: Number(raw?.est_usd) || 0, usdPerHumanConv: raw?.cost_per_human_conversation ?? null,
    events: Object.fromEntries(sorted(raw?.events ?? null).map(e => [e.key, e.n])), cta: raw?.cta_clicks ?? 0,
    countries: sorted(raw?.countries ?? null),
    usage, today, ceiling: raw?.model_ceiling ?? null, groqCap: raw?.groq_daily_cap ?? null,
    missedCount: (raw?.missed ?? []).length,
  };
}

// ---------------------------------------------------------------- raw messages -> the lists

export type ConvInfo = { visitor_id: string; page: string | null; page_group: string; country: string | null; label: WebLabel; signals: string[]; is_test: boolean; started_at: string };
export type MsgRow = { id: string; conversation_id: string; turn_kind: "click" | "typed"; qa_id: string | null; question: string | null; source: WebSource;
  verdict: "answered" | "partial" | "none" | null; refs: string[]; model: string | null; tokens: number; latency_ms: number | null; error: string | null;
  guard_reason: string | null; created_at: string; conv: ConvInfo };
export type Conversation = ConvInfo & { id: string; turns: MsgRow[]; last_at: string };

/** Grouped by conversation, newest first; turns oldest first. */
export function conversationsFrom(rows: MsgRow[], label: WebLabel | "all" = "all"): Conversation[] {
  const m = new Map<string, Conversation>();
  for (const r of rows) {
    if (label !== "all" && r.conv.label !== label) continue;
    const c = m.get(r.conversation_id) ?? { ...r.conv, id: r.conversation_id, turns: [], last_at: r.created_at };
    c.turns.push(r);
    if (r.created_at > c.last_at) c.last_at = r.created_at;
    m.set(r.conversation_id, c);
  }
  for (const c of m.values()) c.turns.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return [...m.values()].sort((a, b) => b.last_at.localeCompare(a.last_at));
}

/** One key per question for grouping: lower case, punctuation out, spaces collapsed (a display-side cousin of normalise.ts). */
export const qKey = (q: string) => q.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();

export type Missed = { key: string; question: string; visitors: number; asks: number; last: string; model: number; fallback: number; partial: number; refs: string[]; page_group: string };
/** Plan 9 "Stream E": tier 3 + fallback + partial, typed by humans, ranked by DISTINCT visitors (one person rephrasing is
 *  not demand), then asks, then recency. The same rule as sam_web_dashboard's `missed`, which is newest-first instead. */
export function missedRanked(rows: MsgRow[]): Missed[] {
  const m = new Map<string, Missed & { v: Set<string>; r: Set<string> }>();
  for (const r of rows) {
    if (r.conv.label !== "human" || r.turn_kind !== "typed" || !r.question) continue;
    if (!(r.source === "model" || r.source === "fallback" || r.verdict === "partial")) continue;
    const key = qKey(r.question);
    if (!key) continue;
    const x = m.get(key) ?? { key, question: r.question, visitors: 0, asks: 0, last: r.created_at, model: 0, fallback: 0, partial: 0, refs: [], page_group: r.conv.page_group, v: new Set<string>(), r: new Set<string>() };
    x.v.add(r.conv.visitor_id); x.asks++;
    if (r.created_at >= x.last) { x.last = r.created_at; x.question = r.question; }
    if (r.source === "model") x.model++;
    if (r.source === "fallback") x.fallback++;
    if (r.verdict === "partial") x.partial++;
    for (const ref of r.refs) x.r.add(ref);
    m.set(key, x);
  }
  return [...m.values()].map(({ v, r, ...x }) => ({ ...x, visitors: v.size, refs: [...r].slice(0, 6) }))
    .sort((a, b) => b.visitors - a.visitors || b.asks - a.asks || b.last.localeCompare(a.last));
}

/** Why the pipeline stopped before answering: the pre-guard's rule names, plus limits and repeats. All labels. */
export function stopReasons(rows: MsgRow[]): { key: string; label: string; n: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = r.source === "guard" ? `guard:${r.guard_reason ?? "unknown"}` : r.source === "limited" || r.source === "repeat" ? r.source : null;
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  const name = (k: string) => k === "limited" ? SOURCE_LABEL.limited : k === "repeat" ? "Asked the same thing a 3rd time" : GUARD_LABEL[k.slice(6)] ?? k.slice(6).replace(/_/g, " ");
  return [...m.entries()].map(([key, n]) => ({ key, label: name(key), n })).sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
}

/** Signals that labelled conversations suspect or bot, counted once per conversation. */
export function signalCounts(rows: MsgRow[]): { key: string; n: number }[] {
  const seen = new Map<string, Set<string>>();
  for (const r of rows) for (const s of r.conv.signals) if (s !== "eval") (seen.get(s) ?? seen.set(s, new Set()).get(s)!).add(r.conversation_id);
  return [...seen.entries()].map(([key, v]) => ({ key, n: v.size })).sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
}

/** Top typed questions per page group (human), with how each was answered. */
export function topByPage(rows: MsgRow[], per = 5): { page_group: string; total: number; questions: { question: string; n: number; sources: string }[] }[] {
  const g = new Map<string, Map<string, { question: string; n: number; s: Map<string, number> }>>();
  for (const r of rows) {
    if (r.conv.label !== "human" || r.turn_kind !== "typed" || !r.question) continue;
    const pg = g.get(r.conv.page_group) ?? g.set(r.conv.page_group, new Map()).get(r.conv.page_group)!;
    const k = qKey(r.question), x = pg.get(k) ?? { question: r.question, n: 0, s: new Map() };
    x.n++; x.s.set(r.source, (x.s.get(r.source) ?? 0) + 1); pg.set(k, x);
  }
  return [...g.entries()].map(([page_group, qs]) => ({
    page_group, total: [...qs.values()].reduce((n, q) => n + q.n, 0),
    questions: [...qs.values()].sort((a, b) => b.n - a.n || a.question.localeCompare(b.question)).slice(0, per)
      .map(q => ({ question: q.question, n: q.n, sources: [...q.s.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${SOURCE_LABEL[s as WebSource] ?? s} ${n}`).join(" · ") })),
  })).sort((a, b) => b.total - a.total);
}

const quantile = (xs: number[], q: number) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]; };
/** p50 / p95 server latency per source. Plan 8.1 gates: bank + intent p50 < 300 ms, model p95 < 5 s. */
export function latencyBySource(rows: MsgRow[]): { source: WebSource; n: number; p50: number | null; p95: number | null }[] {
  return SOURCES.map(source => {
    const xs = rows.filter(r => r.source === source && r.latency_ms != null).map(r => r.latency_ms!);
    return { source, n: xs.length, p50: quantile(xs, 0.5), p95: quantile(xs, 0.95) };
  }).filter(x => x.n > 0);
}

// ---------------------------------------------------------------- the Q&A bank and approval

export type QaRow = { id: string; question: string; aliases: string[]; answer: string; visual: string | null; visual_data: Record<string, unknown> | null;
  pages: string[]; parent_id: string | null; nudge_weight: number; cta: string | null; cta_url: string | null; sources: string[];
  status: "draft" | "approved" | "retired"; origin: string; approved_by: string | null; approved_at: string | null; review_by: string | null; updated_at: string };
export type ReviewMeta = { reasons?: string[]; notes?: string | null; evidence?: { url: string; quote: string }[] };
export type Blocked = { pattern: string; reason: string; except_case_studies: boolean };

/** Months until an approved pair must be reviewed again (plan 9: review_by = +12 months); past it, the pair leaves the
 *  public view on its own (sam_web_qa_rows). */
export const REVIEW_MONTHS = 12;
export function reviewBy(now: Date): string {
  const [y, m, d] = istDay(now).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + REVIEW_MONTHS, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}

export const MAX_WORDS = 80, MAX_CHARS = 600;
export const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
/** The table's own check (01: <= 600 chars and <= 80 words), said in a sentence before PostgREST says it in SQL. */
export function answerProblem(text: string): string | null {
  const t = text.trim();
  if (!t) return "The answer is empty.";
  if (t.length > MAX_CHARS) return `The answer is ${t.length} characters; the most is ${MAX_CHARS}.`;
  if (words(t) > MAX_WORDS) return `The answer is ${words(t)} words; the most is ${MAX_WORDS}.`;
  return null;
}

export type Decision = "approve" | "edit" | "retire";
/** The one write shape for a decision, used by the tab and mirrored by prototype/import_qa_review.py. Approval needs a
 *  source and stamps approved_by (the admin login), approved_at and review_by; an edit replaces the answer and approves;
 *  retire keeps who approved it, for the record. */
export function decisionPatch(d: Decision, row: Pick<QaRow, "status" | "sources">, by: string, now: Date, edit?: string):
  { patch: Record<string, unknown> } | { error: string } {
  if (!by.trim()) return { error: "No admin login to record as the approver." };
  if (d === "retire") return row.status === "retired" ? { error: "Already retired." } : { patch: { status: "retired" } };
  if (!row.sources?.length) return { error: "This pair has no source page. A pair must cite a public page before it can go public." };
  const stamp = { status: "approved", approved_by: by.trim().toLowerCase(), approved_at: now.toISOString(), review_by: reviewBy(now) };
  if (d === "approve") return row.status === "approved" ? { error: "Already approved." } : { patch: stamp };
  const p = answerProblem(edit ?? "");
  return p ? { error: p } : { patch: { answer: edit!.trim().replace(/\s+/g, " "), ...stamp } };
}

/** First matching blocked pattern for a pair's text, the way sam_web_qa_rows applies them (POSIX ARE \m \M -> \b;
 *  case-insensitive). Display only: the database view is the authority on what is public. */
export function blockedBy(row: Pick<QaRow, "question" | "answer" | "visual_data">, patterns: Blocked[]): Blocked | null {
  const text = `${row.question} ${row.answer} ${row.visual_data ? JSON.stringify(row.visual_data) : ""}`;
  for (const p of patterns) {
    try { if (new RegExp(p.pattern.replace(/\\[mM]/g, "\\b"), "i").test(text)) return p; } catch { /* a pattern JS cannot read */ }
  }
  return null;
}

const SOURCE_HOSTS = /^https:\/\/(www\.accops\.com|accops-citrix-lp\.vercel\.app)([/?#]|$)/i;
export const slug = (s: string) => s.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
/** A new draft pair from a missed question ("Draft a pair"). Text only (no visual); it joins the approval queue as a draft
 *  with origin 'missed'. The source must be a public page the views allow, so the provenance pill can show it. */
export function draftRow(i: { question: string; answer: string; source: string; page_group: string; parent_id?: string | null }, rand: string):
  { row: Record<string, unknown> } | { error: string } {
  const q = i.question.trim().replace(/\s+/g, " ");
  if (q.length < 3 || q.length > 200) return { error: "The question must be 3 to 200 characters." };
  const p = answerProblem(i.answer);
  if (p) return { error: p };
  const src = i.source.trim();
  if (!SOURCE_HOSTS.test(src) || !URL.canParse(src)) return { error: "The source must be a page on www.accops.com or the Citrix LP (https://...)." };
  const id = `${slug(q) || "pair"}-${rand.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6)}`.replace(/^-/, "");
  return { row: { id, question: q, answer: i.answer.trim().replace(/\s+/g, " "), sources: [src], pages: [i.page_group || "general"], aliases: [],
    parent_id: i.parent_id || null, status: "draft", origin: "missed", visual: null, visual_data: null } };
}

/** A missed question as one more alias of an existing pair; null when it is already there. The intent matcher only
 *  learns it on the next index build (prototype/build_intent_index.py). */
export function withAlias(aliases: string[], question: string): string[] | null {
  const a = qKey(question).slice(0, 200);
  if (!a || aliases.some(x => qKey(x) === a)) return null;
  return [...aliases, a];
}

// ---------------------------------------------------------------- settings

export type SettingSpec = { key: string; label: string; kind: "bool" | "int" | "url" | "text"; min?: number; max?: number; help: string };
export const SETTINGS: SettingSpec[] = [
  { key: "enabled", label: "Show the chatbot on the website", kind: "bool", help: "Off hides the launcher within 5 minutes (the config is cached 300 s)." },
  { key: "model_enabled", label: "Let the model answer", kind: "bool", help: "Off = bank, intent match and cache only, at once. The instant kill switch." },
  { key: "model_ceiling", label: "Model answers a day (OpenAI)", kind: "int", min: 0, max: 2000, help: "Counted in Postgres before each call, India time. About $0.10 a day at 300." },
  { key: "groq_daily_cap", label: "Groq fallback answers a day", kind: "int", min: 0, max: 200, help: "Groq's free tier is shared with the reps' SAM (200k tokens a day); 40 is about half." },
  { key: "repeat_n", label: "Repeat stops at the Nth ask", kind: "int", min: 2, max: 10, help: "The same question this many times from one visitor gets Talk to sales only." },
  { key: "repeat_window_min", label: "Repeat window, minutes", kind: "int", min: 1, max: 120, help: "" },
  { key: "cta_label", label: "Talk-to-sales button", kind: "text", max: 28, help: "At most 28 characters. Changing it clears the answer cache." },
  { key: "cta_url", label: "Talk-to-sales link", kind: "url", max: 300, help: "https://... or #talk once the LP form works. Changing it clears the answer cache." },
];
/** Form values -> the rows to change, validated; nothing is written when any value is bad. A checkbox posts "on" or nothing. */
export function settingsPatch(form: Record<string, string | undefined>, current: Record<string, string>): { changes: { key: string; value: string }[] } | { error: string } {
  const changes: { key: string; value: string }[] = [];
  for (const s of SETTINGS) {
    let v: string;
    if (s.kind === "bool") v = form[s.key] === "on" || form[s.key] === "true" ? "true" : "false";
    else {
      const raw = (form[s.key] ?? "").trim();
      if (s.kind === "int") {
        if (!/^\d+$/.test(raw) || +raw < (s.min ?? 0) || +raw > (s.max ?? Infinity)) return { error: `${s.label}: a whole number from ${s.min} to ${s.max}.` };
        v = String(+raw);
      } else if (s.kind === "url") {
        if (!/^(https:\/\/\S+|#[\w-]+)$/.test(raw) || raw.length > (s.max ?? 300) || (raw.startsWith("https://") && !URL.canParse(raw))) return { error: `${s.label}: an https:// link or a #anchor.` };
        v = raw;
      } else {
        if (!raw || raw.length > (s.max ?? 80)) return { error: `${s.label}: 1 to ${s.max} characters.` };
        v = raw;
      }
    }
    if (current[s.key] !== v) changes.push({ key: s.key, value: v });
  }
  return { changes };
}

// ---------------------------------------------------------------- the morning digest's Website line

export type WebsiteDigest = {
  conversations: number; human: number; suspect: number; bot: number; messages: number;
  without_model: { num: number; den: number }; model_answers: number; cta_clicks: number; missed: number;
  /** sam_web_usage_daily rows for the IST days the last 24 hours touch. */
  usage: { day: string; model_answers: number; groq_answers: number }[];
  model_ceiling: number | null; groq_daily_cap: number | null;
  oldest_conversation_at: string | null;
};
export function toWebsiteDigest(raw: RawDashboard | null, usage: { day: string; model_answers: number; groq_answers: number }[], oldest: string | null, now: string): WebsiteDigest {
  const d = mapDashboard(raw, now, "all", 1);
  return { conversations: d.conv.total, human: d.conv.human, suspect: d.conv.suspect, bot: d.conv.bot, messages: d.messages,
    without_model: { num: d.withoutModel.num, den: d.withoutModel.den }, model_answers: d.totals.model, cta_clicks: d.cta, missed: d.missedCount,
    usage, model_ceiling: raw?.model_ceiling ?? null, groq_daily_cap: raw?.groq_daily_cap ?? null, oldest_conversation_at: oldest };
}

// ---------------------------------------------------------------- preview (C's blocks, B's filling)

/** The answer a visitor would see for a pair, built the way B's tier 0 builds it (qaBlocks + the pair's CTA), so the
 *  approval view previews exactly what goes public. `qaBlocks`/`cta` are passed in to keep this file import-free. */
export function previewAnswer(qa: QaRow, kids: { id: string; question: string }[], build: {
  qaBlocks: (qa: QaRow) => Block[]; cta: (qa: QaRow) => Block; parse: (a: unknown) => { success: true; data: Answer } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }):
  { answer: Answer } | { error: string } {
  const blocks = build.qaBlocks(qa);
  if (qa.cta_url && !blocks.some(b => b.type === "cta")) blocks.push(build.cta(qa));
  const chips = kids.slice(0, 3).map(k => ({ id: k.id, label: k.question.length <= 60 ? k.question : `${k.question.slice(0, 59).trimEnd()}…` }));
  const r = build.parse({ blocks, chips });
  if (r.success) return { answer: r.data };
  const i = r.error.issues[0];
  return { error: `The visual does not fit the block contract (${i?.path.map(String).join(".") || "answer"}: ${i?.message ?? "invalid"}).` };
}

// ---------------------------------------------------------------- I/O (service key)

function cfg() {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/$/, ""), key = process.env.SUPABASE_SERVICE_KEY?.trim();
  return url && key ? { url, key } : null;
}
export const webAdminConfigured = () => !!cfg();

async function rest<T>(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<T> {
  const c = cfg();
  if (!c) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set");
  const r = await fetch(`${c.url}/rest/v1/${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"), cache: "no-store", signal: AbortSignal.timeout(8000),
    headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, "Content-Type": "application/json", ...(init.prefer ? { Prefer: init.prefer } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  // Status and the start of PostgREST's message only: never the URL's query, never a header.
  if (!r.ok) throw new Error(`${path.split("?")[0]} returned ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const t = await r.text();
  return (t ? JSON.parse(t) : null) as T;
}
const enc = encodeURIComponent;

export async function loadDashboard(days: number, includeTest: boolean): Promise<RawDashboard> {
  return rest<RawDashboard>("rpc/sam_web_dashboard", { body: { days, include_test: includeTest } });
}

const MSG_COLS = "id,conversation_id,turn_kind,qa_id,question,source,verdict,refs,model,tokens,latency_ms,error,guard_reason,created_at";
const CONV_COLS = "visitor_id,page,page_group,country,label,signals,is_test,started_at";
export const MSG_LIMIT = 5000;
/** Messages of conversations started in the window (the dashboard RPC's window), newest first. */
export async function loadMessages(days: number, includeTest: boolean, limit = MSG_LIMIT): Promise<MsgRow[]> {
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  return rest<MsgRow[]>(`sam_web_messages?select=${MSG_COLS},conv:sam_web_conversations!inner(${CONV_COLS})` +
    `&conv.started_at=gt.${enc(from)}${includeTest ? "" : "&conv.is_test=is.false"}&order=created_at.desc&limit=${limit}`);
}

export async function oldestConversation(): Promise<string | null> {
  return (await rest<{ started_at: string }[]>("sam_web_conversations?select=started_at&order=started_at.asc&limit=1"))[0]?.started_at ?? null;
}

export async function loadBank(): Promise<{ rows: QaRow[]; live: Set<string>; blocked: Blocked[]; settings: Record<string, string> }> {
  const [rows, live, blocked, settings] = await Promise.all([
    rest<QaRow[]>("sam_web_qa?select=*&order=id"),
    rest<{ id: string }[]>("sam_web_qa_public?select=id"),
    rest<Blocked[]>("sam_web_blocked_patterns?select=pattern,reason,except_case_studies&order=pattern"),
    loadSettings(),
  ]);
  return { rows, live: new Set(live.map(r => r.id)), blocked, settings };
}

export async function loadSettings(): Promise<Record<string, string>> {
  return Object.fromEntries((await rest<{ key: string; value: string }[]>("sam_web_settings?select=key,value")).map(r => [r.key, r.value]));
}

/** One pair's decision, written only if the row is still in the state the admin saw (no lost update). */
export async function writeDecision(id: string, d: Decision, by: string, edit?: string): Promise<{ ok: true; row: QaRow } | { ok: false; error: string }> {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) return { ok: false, error: "No such pair." };
  const cur = (await rest<QaRow[]>(`sam_web_qa?select=id,status,sources,answer&id=eq.${enc(id)}`))[0];
  if (!cur) return { ok: false, error: "No such pair." };
  const p = decisionPatch(d, cur, by, new Date(), edit);
  if ("error" in p) return { ok: false, error: p.error };
  const out = await rest<QaRow[]>(`sam_web_qa?id=eq.${enc(id)}&status=eq.${enc(cur.status)}`, { method: "PATCH", body: p.patch, prefer: "return=representation" });
  return out.length === 1 ? { ok: true, row: out[0] } : { ok: false, error: "Someone changed this pair a moment ago. Reload and try again." };
}

export async function insertDraft(row: Record<string, unknown>): Promise<void> {
  await rest("sam_web_qa", { body: row, prefer: "return=minimal" });
}

export async function addAlias(id: string, question: string): Promise<{ ok: boolean; error?: string; added?: boolean }> {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) return { ok: false, error: "No such pair." };
  const cur = (await rest<{ aliases: string[] }[]>(`sam_web_qa?select=aliases&id=eq.${enc(id)}`))[0];
  if (!cur) return { ok: false, error: "No such pair." };
  const next = withAlias(cur.aliases ?? [], question);
  if (!next) return { ok: true, added: false };
  await rest(`sam_web_qa?id=eq.${enc(id)}`, { method: "PATCH", body: { aliases: next }, prefer: "return=minimal" });
  return { ok: true, added: true };
}

export async function writeSettings(changes: { key: string; value: string }[]): Promise<void> {
  for (const c of changes) await rest(`sam_web_settings?key=eq.${enc(c.key)}`, { method: "PATCH", body: { value: c.value, updated_at: new Date().toISOString() }, prefer: "return=minimal" });
}

/** The digest's Website line: the last 24 hours (sam_web_dashboard(1)), today's and yesterday's IST usage rows, and the
 *  oldest stored conversation (retention). Real traffic only. */
export async function websiteDigest(now: string): Promise<WebsiteDigest> {
  const days = [istDay(Date.parse(now) - 86_400_000), istDay(now)];
  const [raw, usage, oldest] = await Promise.all([
    loadDashboard(1, false),
    rest<{ day: string; model_answers: number; groq_answers: number }[]>(`sam_web_usage_daily?select=day,model_answers,groq_answers&day=gte.${days[0]}&order=day`),
    oldestConversation(),
  ]);
  return toWebsiteDigest(raw, usage, oldest, now);
}
