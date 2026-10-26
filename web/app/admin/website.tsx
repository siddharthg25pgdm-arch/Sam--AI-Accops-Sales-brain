/** The admin Website tab (plan 9 "Stream E"): the website chatbot's analytics, the Q&A approval queue, its
 *  conversations and its settings. Server-rendered like the rest of /admin (admin cookie checked by page.tsx and again
 *  by every action), reading with the service key through lib/web-dashboard.ts.
 *
 *  `Website` loads; `WebsiteView` only draws, so scripts can render it from fixtures (screenshots, the 0-row check).
 *  The approval previews draw the visitor's answer with Stream C's block components directly (not OpenUI's Renderer),
 *  filled by Stream B's qaBlocks: the preview is exactly what a click on that pair would show. */
import type { ReactNode } from "react";
import { Barlow } from "next/font/google";
import "@/components/blocks/blocks.css";
import "@/app/admin/website.css";
import { Answer as AnswerSchema, type Answer, type Block } from "@/lib/blocks";
import { cta as ctaBlock, qaBlocks, type Qa } from "@/lib/web/fill";
import { Answer as AnswerRoot } from "@/components/blocks/Answer";
import { Calculator } from "@/components/blocks/Calculator";
import { CompareTable } from "@/components/blocks/CompareTable";
import { Cta } from "@/components/blocks/Cta";
import { DocCard } from "@/components/blocks/DocCard";
import { Picker } from "@/components/blocks/Picker";
import { Stat } from "@/components/blocks/Stat";
import { Steps } from "@/components/blocks/Steps";
import { Text } from "@/components/blocks/Text";
import { Sparkline, Meter, BarList, num, ms } from "@/components/charts";
import { recentRuns, type OpsRun } from "@/lib/ops";
import intentIndex from "@/data/web-intent-index.json";
import reviewMeta from "@/data/web-qa-review.json";
import {
  SOURCES, SOURCE_LABEL, SOURCE_HELP, LABELS, LABEL_HELP, NO_MODEL, SETTINGS, MSG_LIMIT, MAX_WORDS, RETENTION_DAYS, WARN_SHARE,
  mapDashboard, conversationsFrom, missedRanked, stopReasons, signalCounts, topByPage, latencyBySource, previewAnswer, blockedBy, words,
  loadDashboard, loadMessages, loadBank, oldestConversation, webAdminConfigured,
  type WebDash, type MsgRow, type QaRow, type ReviewMeta, type Blocked, type WebLabel, type WebSource,
} from "@/lib/web-dashboard";
import { decidePair, draftPair, aliasPair, saveWebSettings } from "@/app/admin/website-actions";

const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--sb-font", display: "swap" });

type SP = Record<string, string | string[] | undefined>;
type Href = (o: Record<string, string | number | null>) => string;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const IST = "Asia/Kolkata";
const fmtDate = (iso?: string | null) => iso ? new Date(iso.length === 10 ? `${iso}T00:00:00+05:30` : iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: IST }) : "–";
const fmtTime = (iso?: string | null) => iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: IST }) : "–";
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const usd = (n: number | null | undefined) => n == null ? "–" : n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
const plural = (n: number, a: string, b = `${a}s`) => `${num(n)} ${n === 1 ? a : b}`;
const host = (u: string) => { try { const x = new URL(u); return `${x.host.replace(/^www\./, "")}${x.pathname === "/" ? "" : x.pathname}${x.hash}`; } catch { return u; } };

export const VIEWS = [["analytics", "Analytics"], ["approve", "Approve Q&A"], ["conversations", "Conversations"], ["settings", "Settings"]] as const;
export type View = (typeof VIEWS)[number][0];
const QA_FILTERS = [["draft", "Waiting"], ["approved", "Approved"], ["retired", "Retired"], ["all", "All"]] as const;
type QaFilter = (typeof QA_FILTERS)[number][0];

export type BankItem = QaRow & { live: boolean; held: Blocked | null; meta: ReviewMeta; preview: { answer: Answer } | { error: string }; kids: { id: string; question: string }[] };
export type IndexInfo = { built_at: string; source: string; ids: string[] };
export type WebsiteData = {
  view: View; label: WebLabel | "all"; qaf: QaFilter; days: number; includeTest: boolean; now: string;
  configured: boolean; chatOn: boolean; modelOffEnv: boolean;
  ok: string; err: string; back: string; href: Href;
  dash: WebDash | null; dashError: string | null;
  rows: MsgRow[] | null; rowsError: string | null;
  bank: BankItem[] | null; bankError: string | null; settings: Record<string, string> | null;
  index: IndexInfo; leak: OpsRun | null; leakReadable: boolean; oldest: string | null;
};

// ------------------------------------------------------------------------------------------- loading

/** Turn the bank's rows into approval items: live state, the blocked claim holding it back, review notes, preview. */
export function bankItems(rows: QaRow[], live: Set<string>, blocked: Blocked[], settings: Record<string, string>, meta: Record<string, ReviewMeta>): BankItem[] {
  const s = { enabled: true, model_enabled: true, cta_url: settings.cta_url ?? "", cta_label: settings.cta_label ?? "" };
  return rows.map(r => {
    const kids = rows.filter(k => k.parent_id === r.id && k.status !== "retired").sort((a, b) => b.nudge_weight - a.nudge_weight || a.id.localeCompare(b.id)).map(k => ({ id: k.id, question: k.question }));
    const preview = previewAnswer(r, kids, { qaBlocks: q => qaBlocks(q as unknown as Qa), cta: q => ctaBlock(s, q as unknown as Qa), parse: a => AnswerSchema.safeParse(a) as never });
    return { ...r, live: live.has(r.id), held: r.status === "approved" && !live.has(r.id) ? blockedBy(r, blocked) : null, meta: meta[r.id] ?? {}, preview, kids };
  });
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

export async function Website({ sp, days, includeTest, href }: { sp: SP; days: number; includeTest: boolean; href: Href }) {
  const view = (VIEWS.find(v => v[0] === one(sp.wv))?.[0]) ?? "analytics";
  const label = (LABELS.find(l => l === one(sp.lb))) ?? "all";
  const qaf = (QA_FILTERS.find(f => f[0] === one(sp.qaf))?.[0]) ?? "draft";
  const now = new Date().toISOString();
  const configured = webAdminConfigured();
  const wref: Href = o => {
    const u = new URL(href({}), "http://x");
    const cur: Record<string, string> = { wv: view === "analytics" ? "" : view, lb: label === "all" ? "" : label, qaf: qaf === "draft" ? "" : qaf };
    for (const [k, v] of Object.entries({ ...cur, ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v == null ? "" : String(v)])) })) {
      if (v) u.searchParams.set(k, v); else u.searchParams.delete(k);
    }
    return `${u.pathname}${u.search}`;
  };
  const back = new URLSearchParams(wref({}).split("?")[1] ?? "").toString();
  const data: WebsiteData = {
    view, label, qaf, days, includeTest, now, configured, chatOn: process.env.WEB_CHAT_ENABLED === "1", modelOffEnv: process.env.WEB_MODEL_OFF === "1",
    ok: one(sp.ok), err: one(sp.err), back, href: wref,
    dash: null, dashError: null, rows: null, rowsError: null, bank: null, bankError: null, settings: null,
    index: { built_at: intentIndex.built_at, source: intentIndex.source, ids: intentIndex.intents.map(i => i.qa_id) }, leak: null, leakReadable: false, oldest: null,
  };
  if (!configured) return <WebsiteView d={data} />;
  const needDash = view === "analytics", needRows = view === "analytics" || view === "conversations";
  const needBank = view === "approve" || view === "analytics" || view === "settings";
  const [dash, rows, bank, runs, oldest] = await Promise.all([
    needDash ? loadDashboard(days, includeTest).then(r => ({ r }), e => ({ e: errText(e) })) : null,
    needRows ? loadMessages(days, includeTest).then(r => ({ r }), e => ({ e: errText(e) })) : null,
    needBank ? loadBank().then(r => ({ r }), e => ({ e: errText(e) })) : null,
    view === "analytics" ? recentRuns() : null,
    view === "analytics" ? oldestConversation().catch(() => null) : null,
  ]);
  if (dash) "r" in dash ? (data.dash = mapDashboard(dash.r, now, label)) : (data.dashError = dash.e);
  if (rows) "r" in rows ? (data.rows = rows.r) : (data.rowsError = rows.e);
  if (bank) {
    if ("r" in bank) { data.bank = bankItems(bank.r.rows, bank.r.live, bank.r.blocked, bank.r.settings, reviewMeta as Record<string, ReviewMeta>); data.settings = bank.r.settings; }
    else data.bankError = bank.e;
  }
  data.leakReadable = !!runs;
  data.leak = runs?.runs.filter(r => r.job === "web_leak").sort((a, b) => b.started_at.localeCompare(a.started_at))[0] ?? null;
  data.oldest = oldest;
  return <WebsiteView d={data} />;
}

// ------------------------------------------------------------------------------------------- bits (the dashboard's own markup)

function Kpi({ label, value, foot, viz }: { label: string; value: ReactNode; foot?: ReactNode; viz?: ReactNode }) {
  return (
    <div className="kpi">
      <div className="kpi-top"><span className="kl">{label}</span>{viz}</div>
      {value}
      {foot && <div className="kpi-foot">{foot}</div>}
    </div>
  );
}
function Section({ title, sub, children, aside, id, className }: { title: string; sub?: ReactNode; children: ReactNode; aside?: ReactNode; id?: string; className?: string }) {
  return (
    <section className={`card ${className ?? ""}`} id={id}>
      <div className="card-head"><div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>{aside}</div>
      {children}
    </section>
  );
}
const Empty = ({ children }: { children: ReactNode }) => <p className="empty-inline">{children}</p>;
const Sw = ({ s }: { s: WebSource }) => <i className={`sw s-${s}`} aria-hidden="true" />;

// ------------------------------------------------------------------------------------------- the view

export function WebsiteView({ d }: { d: WebsiteData }) {
  const waiting = d.bank?.filter(b => b.status === "draft").length ?? null;
  return (
    <div className={`wt ${barlow.variable}`}>
      <div className="wt-sub">
        <nav className="seg" aria-label="Website view">
          {VIEWS.map(([k, l]) => (
            <a key={k} href={d.href({ wv: k === "analytics" ? null : k, lb: null, ok: null, err: null })} aria-current={k === d.view ? "true" : undefined}>
              {l}{k === "approve" && waiting ? <span className="n hot" aria-label={`${waiting} waiting`}>{waiting}</span> : null}
            </a>
          ))}
        </nav>
        <span className="hint">The website chatbot on the Citrix LP. India time.</span>
      </div>
      {d.ok && <p className="ok-note" role="status">{d.ok}</p>}
      {d.err && <div className="notice" role="alert">{d.err}</div>}
      {!d.configured ? <div className="notice">SUPABASE_URL and SUPABASE_SERVICE_KEY are not set, so the Website tab has nothing to read.</div> : (
        <>
          {d.view === "analytics" && <Analytics d={d} />}
          {d.view === "approve" && <Approve d={d} />}
          {d.view === "conversations" && <Conversations d={d} />}
          {d.view === "settings" && <Settings d={d} />}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------- analytics

function Analytics({ d }: { d: WebsiteData }) {
  if (d.dashError) return <div className="notice">The website dashboard query failed ({d.dashError}). Check that docs/supabase-sam-web-03-log.sql is applied.</div>;
  const w = d.dash!;
  const rows = d.rows ?? [];
  const approved = d.bank?.filter(b => b.status === "approved").length ?? 0, drafts = d.bank?.filter(b => b.status === "draft").length ?? 0;
  const wm = w.withoutModel;
  const dailyMsgs = w.mix.map(x => x.total);
  const popup = { shown: w.events.popup_shown ?? 0, clicked: w.events.popup_clicked ?? 0 };
  const missed = missedRanked(rows), stops = stopReasons(rows), signals = signalCounts(rows), pages = topByPage(rows), lat = latencyBySource(rows);
  const today = w.today;
  return (
    <>
      {d.bank && approved === 0 && drafts > 0 && (
        <section className="card attention">
          <div className="lead-cta">
            <div>
              <b>Nothing is public yet: {plural(drafts, "draft pair")} {drafts === 1 ? "waits" : "wait"} for your approval.</b>
              <p>Until a pair is approved the website can show no answer from the bank, only the fallback line and Talk to sales.</p>
            </div>
            <a className="btn-accent" href={d.href({ wv: "approve" })}>Review the drafts</a>
          </div>
        </section>
      )}
      <Status d={d} />
      {d.rowsError && <div className="notice">The conversation lists could not be read ({d.rowsError}); the totals below come from sam_web_dashboard.</div>}

      <div className="kpis">
        <Kpi label="Conversations" value={<b className="kv">{num(w.conv.total)}</b>} viz={<Sparkline values={dailyMsgs} label="Messages per day" />}
          foot={w.conv.total ? <>{num(w.conv.human)} human · {num(w.conv.suspect)} suspect · {num(w.conv.bot)} bot</> : <>None in the last {w.days} days</>} />
        <Kpi label="Messages per conversation" value={<b className="kv">{w.perConv ?? "–"}</b>} foot={<>{plural(w.messages, "message")}</>} />
        <Kpi label="Answered without the model" value={wm.pct == null ? <b className="kv muted">–</b> : <b className="kv">{wm.pct}<span className="unit">%</span></b>}
          viz={wm.pct == null ? undefined : <span className="wt-meter"><Meter pct={wm.pct} label="Answered without the model" /><i style={{ left: "60%" }} aria-hidden="true" /></span>}
          foot={wm.den ? <>{num(wm.num)} of {num(wm.den)} human answers · target 60%</> : <>No human answers yet · target 60%</>} />
        <Kpi label="Cost per human conversation" value={<b className="kv">{usd(w.usdPerHumanConv)}</b>}
          foot={<>{usd(w.usd)} estimated · {num(w.tokens)} tokens</>} />
        <Kpi label="Model answers today" value={<b className="kv">{num(today.model)}<span className="of"> of {num(w.ceiling)}</span></b>}
          viz={<Meter pct={today.modelPct ?? 0} label="Model answers against the daily ceiling" />}
          foot={<>Groq fallback {num(today.groq)} of {num(w.groqCap)}{(today.modelPct ?? 0) >= WARN_SHARE * 100 && <span className="pill warn">over 70%</span>}</>} />
        <Kpi label="Talk-to-sales clicks" value={<b className="kv">{num(w.cta)}</b>}
          foot={popup.shown ? <>popup shown {num(popup.shown)} → opened {num(popup.clicked)} ({Math.round((popup.clicked / popup.shown) * 100)}%)</> : <>popup not shown yet</>} />
      </div>

      <Section title="How questions were answered, by day" sub={<>Cheapest first: the bank, the intent matcher and the shared cache cost nothing; a model answer costs about {usd(0.00028)}. Guard, limited and repeat stopped before answering.</>}
        aside={<nav className="seg small" aria-label="Label">{(["all", ...LABELS] as const).map(l => <a key={l} href={d.href({ lb: l === "all" ? null : l })} aria-current={l === d.label ? "true" : undefined}>{l === "all" ? "Everyone" : l[0].toUpperCase() + l.slice(1)}</a>)}</nav>}>
        <TierColumns mix={w.mix} totals={w.totals} />
      </Section>

      <div className="two">
        <Section title="Model use against the daily ceiling" sub={<>OpenAI answers per India-time day, reserved in Postgres before each call. The morning digest warns at 70%; at the ceiling the website answers from the bank only until midnight.</>}>
          <CeilingColumns usage={w.usage} mixDays={w.mix.map(x => x.day)} ceiling={w.ceiling} groqCap={w.groqCap} />
        </Section>
        <Section title="Who is asking" sub="Every conversation is labelled; a label only escalates. Bots and suspects never reach the model and are left out of the rates and the cost.">
          {w.conv.total === 0 ? <Empty>No conversations in this period.</Empty> : (
            <>
              <BarList label="Conversations by label" rows={LABELS.map(l => ({ key: l[0].toUpperCase() + l.slice(1), n: w.conv[l] }))} />
              {signals.length > 0 && <><p className="subline" style={{ margin: "16px 0 8px" }}>What raised a label (conversations)</p><BarList label="Signals" rows={signals} /></>}
            </>
          )}
        </Section>
      </div>

      <Section id="missed" className="missed" title="Missed questions" sub={<>Typed by humans and answered by the model, the fallback or a partial match, ranked by distinct visitors. Each one is either a new pair to draft or another way of asking a pair you have; the intent matcher learns aliases at its next build.</>}
        aside={missed.length ? <span className="count">{num(missed.length)}</span> : undefined}>
        {missed.length === 0 ? <Empty>{rows.length ? "Every human question was answered from the bank, the intent matcher or the cache." : "No questions in this period."}</Empty> : (
          <table>
            <thead><tr><th>Question</th><th className="r">Visitors</th><th className="r">Asks</th><th>Answered by</th><th>Last asked</th><th /></tr></thead>
            <tbody>{missed.slice(0, 25).map(m => (
              <tr key={m.key}>
                <td>{m.question}{m.refs.length > 0 && <div className="subline">picked {m.refs.slice(0, 3).join(", ")}</div>}</td>
                <td className="r">{num(m.visitors)}</td><td className="r">{num(m.asks)}</td>
                <td className="nowrap">{[m.model && `model ${m.model}`, m.fallback && `fallback ${m.fallback}`, m.partial && `partial ${m.partial}`].filter(Boolean).join(" · ")}</td>
                <td className="nowrap">{fmtTime(m.last)}</td>
                <td><MissedActions d={d} question={m.question} pageGroup={m.page_group} /></td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {missed.length > 25 && <p className="note" style={{ marginTop: 12 }}>Showing the top 25 of {num(missed.length)}.</p>}
      </Section>

      <div className="two">
        <Section title="Stopped before answering" sub="Pre-guard rules (the rule's name is logged, never matched text), rate limits and repeats. All labels.">
          {stops.length === 0 ? <Empty>Nothing was stopped in this period.</Empty> : <BarList label="Stopped" rows={stops.map(s => ({ key: s.label, n: s.n }))} />}
        </Section>
        <Section title="Countries" sub="From the visitor's IP at Vercel's edge; the IP itself is never stored.">
          {w.countries.length === 0 ? <Empty>No conversations in this period.</Empty> : <BarList label="Countries" rows={w.countries.map(c => ({ key: c.key === "?" ? "Unknown" : c.key, n: c.n }))} />}
        </Section>
      </div>

      <div className="two">
        <Section title="From popup to sales" sub="Widget events; no typed text is ever sent with them.">
          <Funnel events={w.events} />
        </Section>
        <Section title="Response time by tier" sub="Server time per answer. Launch gates: bank and intent p50 under 300 ms, model p95 under 5 s.">
          {lat.length === 0 ? <Empty>No answers in this period.</Empty> : (
            <table><thead><tr><th>Tier</th><th className="r">Answers</th><th className="r">p50</th><th className="r">p95</th></tr></thead>
              <tbody>{lat.map(l => {
                const bad = ((l.source === "bank" || l.source === "intent") && (l.p50 ?? 0) >= 300) || (l.source === "model" && (l.p95 ?? 0) >= 5000);
                return <tr key={l.source}><td><Sw s={l.source} /> {SOURCE_LABEL[l.source]}</td><td className="r">{num(l.n)}</td><td className="r">{ms(l.p50)}</td><td className="r">{ms(l.p95)}{bad && <span className="pill warn">over the gate</span>}</td></tr>;
              })}</tbody></table>
          )}
        </Section>
      </div>

      <Section title="Top questions by page" sub="What humans typed on each page group, and how it was answered.">
        {pages.length === 0 ? <Empty>No typed questions in this period.</Empty> : (
          <table><thead><tr><th>Page</th><th>Question</th><th className="r">Asked</th><th>Answered by</th></tr></thead>
            <tbody>{pages.flatMap(p => p.questions.map((q, i) => (
              <tr key={`${p.page_group}|${q.question}`}><td className="nowrap">{i === 0 ? <b>{p.page_group}</b> : ""}</td><td>{q.question}</td><td className="r">{num(q.n)}</td><td className="subline">{q.sources}</td></tr>
            )))}</tbody></table>
        )}
      </Section>
      {d.rows && d.rows.length >= MSG_LIMIT && <p className="note">The lists above read the newest {num(MSG_LIMIT)} messages of the period; the totals and the tier mix count everything.</p>}
    </>
  );
}

function Status({ d }: { d: WebsiteData }) {
  const s = d.settings ?? {};
  const approved = d.bank?.filter(b => b.status === "approved") ?? [];
  const live = d.bank?.filter(b => b.live).length ?? 0;
  const builtMs = Date.parse(d.index.built_at), draftIndex = d.index.source !== "supabase";
  const since = approved.filter(b => b.approved_at && Date.parse(b.approved_at) > builtMs).length;
  const missing = approved.filter(b => !d.index.ids.includes(b.id)).length;
  const ageDays = Math.floor((Date.parse(d.now) - builtMs) / 86_400_000);
  const oldestDays = d.oldest ? Math.floor((Date.parse(d.now) - Date.parse(d.oldest)) / 86_400_000) : null;
  const leakAgeDays = d.leak ? (Date.parse(d.now) - Date.parse(d.leak.started_at)) / 86_400_000 : null;
  type Item = { k: string; state: "ok" | "warn" | "bad" | "off"; v: ReactNode; p: ReactNode };
  const items: Item[] = [
    { k: "Website", state: d.chatOn && s.enabled !== "false" ? "ok" : "off",
      v: !d.chatOn ? "Off on this deployment" : s.enabled === "false" ? "Launcher hidden (setting)" : "Live",
      p: !d.chatOn ? <>/api/web/* answers 503 until WEB_CHAT_ENABLED=1 and the reader env are set (plan section 5).</> : <>Launcher on the Citrix LP; config cached 5 minutes.</> },
    { k: "Q&A bank", state: !d.bank ? "warn" : approved.length === 0 ? "bad" : "ok",
      v: d.bank ? <>{num(approved.length)} approved · {num(live)} public · {num(d.bank.filter(b => b.status === "draft").length)} waiting</> : "Not readable",
      p: d.bank ? <>Approved but not public = held back by a blocked claim or past its review date. <a href={d.href({ wv: "approve" })}>Approve Q&A</a></> : d.bankError },
    { k: "Model", state: d.modelOffEnv || s.model_enabled === "false" ? "off" : "ok",
      v: d.modelOffEnv ? "Off (WEB_MODEL_OFF=1)" : s.model_enabled === "false" ? "Off (setting)" : `gpt-6-luna, then Groq · ceiling ${s.model_ceiling ?? "–"} a day`,
      p: <>Humans only, after bank, intent and cache. <a href={d.href({ wv: "settings" })}>Switch off</a></> },
    { k: "Intent index", state: draftIndex || since || missing ? "warn" : "ok",
      v: <>Built {fmtDate(d.index.built_at)} ({ageDays === 0 ? "today" : `${ageDays} ${ageDays === 1 ? "day" : "days"} ago`}){draftIndex ? " from the draft bank" : ""}</>,
      p: draftIndex ? <>Development only. After approving, rebuild from the approved bank: <code>python prototype/build_intent_index.py</code></>
        : since || missing ? <>{plural(since, "pair")} approved since, {num(missing)} not in it. Rebuild: <code>python prototype/build_intent_index.py</code></> : <>Every approved pair is in it.</> },
    { k: "Leak test", state: !d.leakReadable ? "warn" : !d.leak ? "off" : d.leak.status === "ok" && (leakAgeDays ?? 99) <= 8 ? "ok" : d.leak.status === "ok" ? "warn" : "bad",
      v: !d.leakReadable ? "Run log not readable" : d.leak ? <>{d.leak.status} · {fmtTime(d.leak.started_at)}</> : "No run yet",
      p: <>Weekly live probe (scripts/web-leak.mjs, job <code>web_leak</code>). The prebuild guard runs on every deploy and fails the build on any finding, so a live deploy has passed it.</> },
    { k: "Retention", state: oldestDays != null && oldestDays > RETENTION_DAYS - 10 ? "warn" : "ok",
      v: oldestDays == null ? "No conversations stored" : <>Oldest conversation {oldestDays} {oldestDays === 1 ? "day" : "days"} old</>,
      p: <>Kept {RETENTION_DAYS} days, then purged (sam_web_purge). The purge is scheduled in stage 2; the digest warns 10 days before the first one is due.</> },
  ];
  const word = { ok: "OK", warn: "Check", bad: "Needs you", off: "Off" };
  return (
    <section className="card">
      <ul className="status-list">
        {items.map(i => (
          <li key={i.k}>
            <span className={`status ${i.state}`}><i aria-hidden="true" />{i.k} · {word[i.state]}</span>
            <b>{i.v}</b>
            <p>{i.p}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

const niceMax = (v: number) => { if (v <= 1) return 1; const p = 10 ** Math.floor(Math.log10(v)), m = v / p; return ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(s => m <= s && Number.isInteger((s * p) / 2)) ?? 10) * p; };
const labelled = (i: number, n: number) => { const every = Math.ceil(n / 6), last = n - 1; return i === last || (i % every === 0 && last - i >= every / 2); };

/** Messages per day, stacked by tier: blue = no model, orange = model, grey = not answered. Bottom to top in SOURCES order. */
function TierColumns({ mix, totals }: { mix: WebDash["mix"]; totals: WebDash["totals"] }) {
  const max = niceMax(Math.max(0, ...mix.map(x => x.total)));
  const total = mix.reduce((n, x) => n + x.total, 0);
  const grp = (t: string, ss: WebSource[]) => [<span key={t} className="grp">{t}</span>, ...ss.map(s => <span key={s} title={SOURCE_HELP[s]}><Sw s={s} />{SOURCE_LABEL[s]}</span>)];
  return (
    <figure className="chart">
      <div className="legend" aria-hidden="true">
        {grp("No model", NO_MODEL)}{grp("Model", ["model"])}{grp("Not answered", ["fallback", "guard", "limited", "repeat"])}
      </div>
      <div className="cols" role="img" aria-label={`Messages per day by tier: ${total} in ${mix.length} days. ${SOURCES.map(s => `${SOURCE_LABEL[s]} ${totals[s]}`).join(", ")}.`}>
        <div className="cgrid" aria-hidden="true">{[max, max / 2, 0].map(t => <div key={t} className="gl"><span>{num(t)}</span></div>)}</div>
        <div className="bars-row" aria-hidden="true">
          {mix.map(x => (
            <div key={x.day} className="col tip" data-tip={`${dayLabel(x.day)} · ${x.total} · ${SOURCES.filter(s => x.by[s]).map(s => `${SOURCE_LABEL[s]} ${x.by[s]}`).join(", ") || "none"}`}>
              <div className="stack" style={{ height: `${(x.total / max) * 100}%` }}>
                {[...SOURCES].reverse().map(s => x.by[s] > 0 && <span key={s} className={`s-${s} seg-on`} style={{ flexGrow: x.by[s] }} />)}
              </div>
            </div>
          ))}
        </div>
        {total === 0 && <p className="chart-empty">No messages in this period.</p>}
      </div>
      <div className="xaxis" aria-hidden="true">{mix.map((x, i) => <span key={x.day}>{labelled(i, mix.length) ? dayLabel(x.day) : ""}</span>)}</div>
      <details className="twin">
        <summary>Show as table</summary>
        <table><thead><tr><th>Tier</th><th className="r">Messages</th><th>What it means</th></tr></thead>
          <tbody>{SOURCES.map(s => <tr key={s}><td className="nowrap"><Sw s={s} /> {SOURCE_LABEL[s]}</td><td className="r">{num(totals[s])}</td><td className="subline">{SOURCE_HELP[s]}</td></tr>)}</tbody></table>
      </details>
    </figure>
  );
}

function CeilingColumns({ usage, mixDays, ceiling, groqCap }: { usage: WebDash["usage"]; mixDays: string[]; ceiling: number | null; groqCap: number | null }) {
  const by = new Map(usage.map(u => [u.day, u]));
  const days = mixDays.map(day => by.get(day) ?? { day, model: 0, groq: 0, tokens: 0, modelPct: null, groqPct: null });
  const cap = ceiling ?? 0, max = niceMax(Math.max(cap, ...days.map(x => x.model)));
  const peak = days.reduce((m, x) => Math.max(m, x.model), 0);
  return (
    <figure className="chart">
      <div className="cols wt-ceil" role="img" aria-label={`Model answers per day; peak ${peak} against a ceiling of ${cap}.`}>
        <div className="cgrid" aria-hidden="true">{[max, max / 2, 0].map(t => <div key={t} className="gl"><span>{num(t)}</span></div>)}</div>
        {cap > 0 && <div className="line" style={{ bottom: `${(cap / max) * 100}%` }} aria-hidden="true"><span>ceiling {num(cap)}</span></div>}
        {cap > 0 && <div className="line warn" style={{ bottom: `${(cap * WARN_SHARE / max) * 100}%` }} aria-hidden="true"><span>70%</span></div>}
        <div className="bars-row" aria-hidden="true">
          {days.map(x => (
            <div key={x.day} className="col tip" data-tip={`${dayLabel(x.day)} · ${x.model} model · ${x.groq} Groq`}>
              <div className="stack" style={{ height: `${(x.model / max) * 100}%` }}>{x.model > 0 && <span className={`seg-accent ${cap && x.model >= cap * WARN_SHARE ? "hot" : ""}`} style={{ flexGrow: 1 }} />}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="xaxis" aria-hidden="true">{days.map((x, i) => <span key={x.day}>{labelled(i, days.length) ? dayLabel(x.day) : ""}</span>)}</div>
      <details className="twin">
        <summary>Show as table</summary>
        <table><thead><tr><th>Day</th><th className="r">Model</th><th className="r">Of {num(ceiling)}</th><th className="r">Groq</th><th className="r">Of {num(groqCap)}</th><th className="r">Tokens</th></tr></thead>
          <tbody>{days.filter(x => x.model || x.groq || x.tokens).map(x => <tr key={x.day}><td>{dayLabel(x.day)}</td><td className="r">{x.model}</td><td className="r">{x.modelPct ?? "–"}%</td><td className="r">{x.groq}</td><td className="r">{x.groqPct ?? "–"}%</td><td className="r">{num(x.tokens)}</td></tr>)}</tbody></table>
      </details>
    </figure>
  );
}

const FUNNEL: [string, string][] = [["popup_shown", "Popup shown"], ["popup_clicked", "Popup clicked"], ["chat_opened", "Chat opened"], ["question_clicked", "Question clicked"],
  ["answer_shown", "Answer shown"], ["doc_opened", "Document opened"], ["talk_to_sales_clicked", "Talk to sales"]];
function Funnel({ events }: { events: Record<string, number> }) {
  const rows = FUNNEL.map(([k, l]) => ({ key: l, n: events[k] ?? 0 }));
  if (rows.every(r => r.n === 0)) return <Empty>No widget events in this period.</Empty>;
  return <BarList label="From popup to sales" rows={rows} fold={FUNNEL.length} total={rows[0].n || undefined} />;
}

function MissedActions({ d, question, pageGroup }: { d: WebsiteData; question: string; pageGroup: string }) {
  const pairs = (d.bank ?? []).filter(b => b.status !== "retired");
  return (
    <div className="row-actions">
      <details>
        <summary className="btn-line">Draft a pair</summary>
        <div className="pop">
          <form action={draftPair} className="rq-form">
            <input type="hidden" name="back" value={d.back} /><input type="hidden" name="page_group" value={pageGroup} />
            <label>Question<input name="question" defaultValue={question} maxLength={200} required /></label>
            <label>Answer, in the words the visitor will see (at most {MAX_WORDS} words)<textarea name="answer" rows={4} maxLength={600} required /></label>
            <label>Source page (www.accops.com or the Citrix LP)<input name="source" type="url" placeholder="https://www.accops.com/..." required /></label>
            <label>Follow-up of (optional)<select name="parent_id" defaultValue=""><option value="">None: a root question</option>{pairs.map(p => <option key={p.id} value={p.id}>{p.id} · {p.question}</option>)}</select></label>
            <div className="actions"><button className="btn-accent" type="submit">Save as a draft</button><span className="hint">It joins Approve Q&A; nothing is public until you approve it.</span></div>
          </form>
        </div>
      </details>
      {pairs.length > 0 && (
        <details>
          <summary className="btn-line">Add as alias</summary>
          <div className="pop">
            <form action={aliasPair} className="rq-form">
              <input type="hidden" name="back" value={d.back} /><input type="hidden" name="question" value={question} />
              <label>Another way of asking<select name="id" defaultValue="" required><option value="" disabled>Choose the pair that answers it</option>{pairs.map(p => <option key={p.id} value={p.id}>{p.id} · {p.question}</option>)}</select></label>
              <div className="actions"><button className="btn-accent" type="submit">Add alias</button><span className="hint">Typed questions match it after the next intent-index build.</span></div>
            </form>
          </div>
        </details>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------- approve

function Approve({ d }: { d: WebsiteData }) {
  if (d.bankError) return <div className="notice">The Q&A bank could not be read ({d.bankError}). Check that docs/supabase-sam-web-01-knowledge.sql and 02 are applied.</div>;
  const bank = d.bank ?? [];
  const count = (s: string) => bank.filter(b => b.status === s).length;
  const shown = bank.filter(b => d.qaf === "all" || b.status === d.qaf);
  return (
    <>
      <div className="kpis four">
        <Kpi label="Waiting for you" value={<b className="kv">{num(count("draft"))}</b>} foot="drafts: nothing in them is public" />
        <Kpi label="Approved" value={<b className="kv">{num(count("approved"))}</b>} foot="review again 12 months after approval" />
        <Kpi label="Public now" value={<b className="kv">{num(bank.filter(b => b.live).length)}</b>} foot={d.chatOn ? "in sam_web_qa_public" : "in sam_web_qa_public; the website is still off"} />
        <Kpi label="Retired" value={<b className="kv">{num(count("retired"))}</b>} foot="never shown; can be approved again" />
      </div>
      <Section title="Approve Q&A" sub={<>Read each answer with its evidence and the preview, then Approve, Edit the answer (it is approved as you save it) or Retire it. Approval needs a source page and stamps your login, the time and a review date 12 months out. In bulk: decide in the review spreadsheet, then <code>python prototype/import_qa_review.py --dry-run</code> and the same without <code>--dry-run</code>.</>}
        aside={<nav className="seg small" aria-label="Show">{QA_FILTERS.map(([k, l]) => <a key={k} href={d.href({ qaf: k === "draft" ? null : k, ok: null, err: null })} aria-current={k === d.qaf ? "true" : undefined}>{l} {k === "all" ? bank.length : count(k)}</a>)}</nav>}>
        {shown.length === 0 && <Empty>{d.qaf === "draft" ? "Nothing is waiting. Every pair has a decision." : "No pairs here."}</Empty>}
      </Section>
      <div className="wt-qas">{shown.map(b => <QaCard key={b.id} b={b} d={d} />)}</div>
    </>
  );
}

function QaCard({ b, d }: { b: BankItem; d: WebsiteData }) {
  const ev = b.meta.evidence ?? [];
  const evPages = new Set(ev.map(e => e.url.split("#")[0])).size;
  const statusPill = b.status === "approved" ? <span className="pill good">{b.live ? "Approved · public" : "Approved"}</span>
    : b.status === "retired" ? <span className="pill bad">Retired</span> : <span className="pill warn">Waiting</span>;
  const Decide = ({ decision, label, cls }: { decision: string; label: string; cls: string }) => (
    <form action={decidePair}>
      <input type="hidden" name="id" value={b.id} /><input type="hidden" name="decision" value={decision} /><input type="hidden" name="back" value={d.back} />
      <button className={cls} type="submit">{label}</button>
    </form>
  );
  return (
    <article className={`wt-qa is-${b.status}`} id={`qa-${b.id}`}>
      <div>
        <div className="wt-qa-top">
          <span className="wt-id">{b.id}</span>{statusPill}
          <span>{b.parent_id ? <>follow-up of <a href={`#qa-${b.parent_id}`}>{b.parent_id}</a></> : "root question"}</span>
          {b.visual && <span>visual: {b.visual.replace(/_/g, " ")}</span>}
          {b.origin === "missed" && <span>drafted from a missed question</span>}
        </div>
        <h3>{b.question}</h3>
        {b.aliases.length > 0 && <p className="wt-aliases">Also matches: {b.aliases.slice(0, 8).join(" · ")}{b.aliases.length > 8 ? " …" : ""}</p>}
        {(b.meta.reasons?.length ?? 0) > 0 && b.status === "draft" && (
          <div className="wt-why"><span>Needs your sign-off:</span>{b.meta.reasons!.map(r => <span key={r} className="pill">{r}</span>)}</div>
        )}
        {b.meta.notes && <p className="wt-note">{b.meta.notes}</p>}
        <div className="wt-answer"><p>{b.answer}</p><span className="count">{words(b.answer)} of {MAX_WORDS} words</span></div>
        {ev.length > 0 && (
          <details className="wt-ev" open={b.status === "draft"}>
            <summary>Evidence: {plural(ev.length, "quote")} from {plural(evPages, "page")}</summary>
            <ul>{ev.map((e, i) => <li key={i}><blockquote>{e.quote}</blockquote><a className="src" href={e.url} target="_blank" rel="noreferrer">{host(e.url)}</a></li>)}</ul>
          </details>
        )}
        <div className="wt-srcs"><span>Sources:</span>{b.sources.length ? b.sources.map(s => <a key={s} href={s} target="_blank" rel="noreferrer">{host(s)}</a>) : <span className="pill bad">none: cannot be approved</span>}</div>
        {b.held && <p className="wt-held">Approved, but not public: it matches the blocked claim <code>{b.held.pattern}</code> ({b.held.reason}). It stays hidden until that claim is signed off and its pattern removed.</p>}
        {b.status === "approved" && !b.live && !b.held && <p className="wt-held">Approved, but not public: it may be past its review date or held by a blocked claim the database applies. Check sam_web_qa_public.</p>}
        {b.status !== "draft" && b.approved_by && <p className="wt-stamp">Approved by {b.approved_by} on {fmtDate(b.approved_at)}{b.review_by ? ` · review by ${fmtDate(b.review_by)}` : ""}{b.status === "retired" ? " · then retired" : ""}</p>}
        <div className="wt-actions">
          {b.status !== "approved" && (b.sources.length ? <Decide decision="approve" label={b.status === "retired" ? "Approve again" : "Approve"} cls="btn-accent" /> : <span className="disabled">Add a source to approve</span>)}
          <details className="wt-edit">
            <summary className="btn-line">Edit answer</summary>
            <form action={decidePair}>
              <input type="hidden" name="id" value={b.id} /><input type="hidden" name="decision" value="edit" /><input type="hidden" name="back" value={d.back} />
              <label className="sb-sr" htmlFor={`ans-${b.id}`}>Answer for {b.id}</label>
              <textarea id={`ans-${b.id}`} name="answer" defaultValue={b.answer} maxLength={600} required />
              <div className="row"><button className="btn-accent" type="submit">Save and approve</button><span>At most {MAX_WORDS} words and 600 characters. The visual and sources stay as they are.</span></div>
            </form>
          </details>
          {b.status !== "retired" && <Decide decision="retire" label="Retire" cls="btn-line danger" />}
        </div>
      </div>
      <div className="wt-preview">
        <Preview b={b} />
        <p className="wt-cap">{b.status === "approved" && b.live ? "What a visitor sees when they click this question." : "What a visitor would see once approved."} Drawn with the website&apos;s own blocks.</p>
      </div>
    </article>
  );
}

function Preview({ b }: { b: BankItem }) {
  return (
    <div className="wt-phone" aria-label={`Preview of ${b.id}`}>
      <div className="wt-phone-head"><i aria-hidden="true" />Ask Accops<span>Answers from accops.com</span></div>
      <div className="wt-phone-body">
        <div className="wt-bubble">{b.question}</div>
        {"error" in b.preview ? <p className="wt-bad">{b.preview.error}</p>
          : <AnswerRoot lead={b.preview.answer.lead} chips={b.preview.answer.chips} blocks={b.preview.answer.blocks.map((x, i) => <BlockView key={i} b={x} />)} />}
      </div>
    </div>
  );
}

function BlockView({ b }: { b: Block }) {
  switch (b.type) {
    case "text": { const { type: _t, ...p } = b; return <Text {...p} />; }
    case "doc_card": { const { type: _t, ...p } = b; return <DocCard {...p} />; }
    case "compare_table": { const { type: _t, ...p } = b; return <CompareTable {...p} />; }
    case "steps": { const { type: _t, ...p } = b; return <Steps {...p} />; }
    case "stat": { const { type: _t, ...p } = b; return <Stat {...p} />; }
    case "picker": { const { type: _t, ...p } = b; return <Picker {...p} />; }
    case "calculator": { const { type: _t, ...p } = b; return <Calculator {...p} />; }
    case "cta": { const { type: _t, ...p } = b; return <Cta {...p} />; }
  }
}

// ------------------------------------------------------------------------------------------- conversations

function Conversations({ d }: { d: WebsiteData }) {
  if (d.rowsError) return <div className="notice">Conversations could not be read ({d.rowsError}).</div>;
  const convs = conversationsFrom(d.rows ?? [], d.label);
  const all = conversationsFrom(d.rows ?? []);
  return (
    <>
      <div className="filters">
        <nav className="seg small" aria-label="Label">
          {(["all", ...LABELS] as const).map(l => (
            <a key={l} href={d.href({ lb: l === "all" ? null : l })} aria-current={l === d.label ? "true" : undefined}>
              {l === "all" ? "Everyone" : l[0].toUpperCase() + l.slice(1)} {l === "all" ? all.length : all.filter(c => c.label === l).length}
            </a>
          ))}
        </nav>
        {d.label !== "all" && <span className="subline">{LABEL_HELP[d.label]}</span>}
      </div>
      <section className="card flush">
        {convs.length === 0 ? <Empty>No conversations {d.label === "all" ? "" : `labelled ${d.label} `}in the last {d.days} days.</Empty> : (
          <ol className="convs">
            {convs.slice(0, 60).map(c => (
              <li key={c.id}>
                <div className="cmeta">
                  <span className="tnum">{fmtTime(c.started_at)}</span>
                  <span>{c.page_group}</span>
                  {c.country && <span>{c.country}</span>}
                  <span>{plural(c.turns.length, "message")}</span>
                  {c.is_test && <span className="pill">test</span>}
                  <span className="spacer" />
                  {c.signals.filter(s => s !== "eval").slice(0, 4).map(s => <span key={s} className="pill">{s.replace(/_/g, " ")}</span>)}
                  <span className={`pill lb-${c.label}`}>{c.label}</span>
                </div>
                <ul className="turns">
                  {c.turns.map(t => (
                    <li key={t.id}>
                      <span className="src"><Sw s={t.source} />{SOURCE_LABEL[t.source]}</span>
                      <span className={`q ${t.turn_kind}`}>
                        {t.turn_kind === "typed" ? t.question : <>clicked <code>{t.qa_id}</code></>}
                        {t.guard_reason && <span className="pill">{t.guard_reason}</span>}
                        {t.verdict === "partial" && <span className="pill warn">partial</span>}
                        {t.error && <span className="pill bad">{t.error}</span>}
                      </span>
                      <span className="m">{[t.model, t.tokens ? `${num(t.tokens)} tok` : "", t.latency_ms != null ? ms(t.latency_ms) : ""].filter(Boolean).join(" · ")}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </section>
      {convs.length > 60 && <p className="note" style={{ marginTop: 12 }}>Showing the newest 60 of {num(convs.length)}.</p>}
    </>
  );
}

// ------------------------------------------------------------------------------------------- settings

function Settings({ d }: { d: WebsiteData }) {
  if (d.bankError || !d.settings) return <div className="notice">Settings could not be read{d.bankError ? ` (${d.bankError})` : ""}.</div>;
  const s = d.settings;
  return (
    <Section id="settings" title="Chatbot settings" sub={<>Stored in <code>sam_web_settings</code>; no deploy needed. {d.modelOffEnv && <b>WEB_MODEL_OFF=1 is set on this deployment, so the model stays off whatever the switch says.</b>}</>}>
      <form action={saveWebSettings}>
        <input type="hidden" name="back" value={d.back} />
        <div className="wt-settings">
          {SETTINGS.map(x => (
            <div className="set" key={x.key}>
              <div><label htmlFor={`set-${x.key}`}><b>{x.label}</b></label>{x.help && <p>{x.help}</p>}</div>
              {x.kind === "bool" ? (
                <span className="tog"><input id={`set-${x.key}`} type="checkbox" role="switch" name={x.key} defaultChecked={s[x.key] === "true"} /><span aria-hidden="true" /></span>
              ) : (
                <input id={`set-${x.key}`} name={x.key} type={x.kind === "int" ? "number" : "text"} min={x.min} max={x.kind === "int" ? x.max : undefined}
                  maxLength={x.kind === "int" ? undefined : x.max} defaultValue={s[x.key] ?? ""} required inputMode={x.kind === "int" ? "numeric" : undefined} />
              )}
            </div>
          ))}
        </div>
        <div className="wt-save"><button className="btn-accent" type="submit">Save settings</button><span>Only changed values are written. A new link or button label clears the answer cache.</span></div>
      </form>
    </Section>
  );
}
