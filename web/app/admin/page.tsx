import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { persistent, testUsers, realOnly, ERROR_KINDS } from "@/lib/events";
import { dashboard, conversations, cardingQueue, providerEvidence, gapWorklist, freshness, ratio, delta, rateDelta, dailyActive,
  DEFINITIONS, MIN_N, type Dashboard, type Ratio, type Delta, type ConvFilter } from "@/lib/metrics";
import { registry, syncStatus } from "@/lib/sharepoint";
import { ready, cacheState } from "@/lib/registry-cache";
import { cardCacheState, cardAssets } from "@/lib/cards-cache";
import { allAssets, assetLink, pinKey, eligibility, type Asset } from "@/lib/cards";
import { apiPublishQueue } from "@/lib/api";
import { tiers } from "@/lib/agent-openai";
import { jobStates, recentRuns, tokenRows, tokenUsage, STALE_H, INPUT_SHARE } from "@/lib/ops";
import { listRequests, unrequestedGaps, ACTIVE, NEXT, STATUS_LABEL, type RankedRequest, type Status } from "@/lib/requests";
import { loadRatings, loadClears, latestRatings, learnDemotions, wrongAssetTally, verdictOf, FEEDBACK_LABEL, DEMOTE_DAYS, DEMOTE_MIN_REPS, DEMOTE_PENALTY, type FeedbackKind, type Rating } from "@/lib/feedback";
import { saveRequest, mergeRequest, promote, clearRank, pinAsset } from "./actions";
import { TopBar } from "@/components/TopBar";
import { Sparkline, Meter, DailyColumns, BarList, Heatmap, Histogram, num, ms } from "@/components/charts";

export const dynamic = "force-dynamic";

const TABS = [["overview", "Overview"], ["usage", "Usage"], ["quality", "Quality"], ["content", "Content"], ["requests", "Requests"], ["system", "System"], ["conversations", "Conversations"]] as const;
type Tab = (typeof TABS)[number][0];
const PERIODS = [7, 30, 90] as const;
// A channel is a first-class dimension: the public website chatbot (docs/NOTE-website-chatbot.md)
// only needs a label here to appear everywhere else.
const CHANNELS: Record<string, string> = { web: "Web", whatsapp: "WhatsApp", api: "REST API", mcp: "MCP", website: "Website chatbot", teams: "Teams" };
const RUNTIMES: Record<string, string> = { "openai-compatible": "OpenAI-compatible", claude: "Claude", local: "Retrieval only", search: "Catalogue search", none: "Not answered", unknown: "Unknown" };
const INTENTS: Record<string, string> = { find_asset: "Find an asset", gap: "Nothing fit (gap)", other: "Other", answer_question: "Answer a question", share_externally: "Share externally" };
const channelName = (c: string) => CHANNELS[c] ?? c;

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const IST = "Asia/Kolkata";
const fmtDate = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST }) : "–";
const fmtDateY = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: IST }) : "–";
const fmtTime = (iso?: string | null) => iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: IST }) : "–";
function ago(iso?: string | null) {
  if (!iso) return "never";
  const h = (Date.now() - Date.parse(iso)) / 3_600_000;
  return h < 1 ? "under an hour ago" : h < 48 ? `${Math.round(h)} hours ago` : `${Math.round(h / 24)} days ago`;
}
const basename = (p: string) => p.split("/").pop()!.replace(/\.(pdf|pptx?|docx?|xlsx?)$/i, "");
/** One label for a content gap, the same on Overview and Content: "BFSI · Case Study · ZTNA", "any" left out. */
const gapLabel = (g: { vertical: string; type: string; product: string }) => [g.vertical, g.type, g.product].filter(x => x && x !== "any").join(" · ") || "Anything (no type, industry or product)";

export default async function Admin({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!user.admin) redirect("/");
  const sp = await searchParams;
  const tab: Tab = (TABS.find(t => t[0] === one(sp.tab))?.[0]) ?? "overview";
  const days = PERIODS.find(p => String(p) === one(sp.days)) ?? 30;
  const includeTest = one(sp.test) === "1";
  const href = (o: Record<string, string | number | null>) => {
    const u = new URLSearchParams();
    const cur: Record<string, string> = { tab, days: String(days), test: includeTest ? "1" : "", f: one(sp.f), ch: one(sp.ch), user: one(sp.user), limit: one(sp.limit), rv: one(sp.rv), fb: one(sp.fb), ev: one(sp.ev) };
    for (const [k, v] of Object.entries({ ...cur, ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v == null ? "" : String(v)])) })) {
      if (v && !(k === "tab" && v === "overview") && !(k === "days" && v === "30")) u.set(k, v);
    }
    const s = u.toString();
    return `/admin${s ? `?${s}` : ""}`;
  };

  const d = tab === "conversations" || tab === "system" ? null : await dashboard(days, includeTest, testUsers());
  const periodLabel = `Last ${days} days`;
  const range = d ? `${fmtDate(d.window.from)} – ${fmtDate(d.window.to)}` : "";

  return (
    <>
      <TopBar user={user} current="admin" />
      <main className="dash">
        <header className="dash-head">
          <div>
            <h1>Dashboard</h1>
            <p className="dash-sub">
              {periodLabel}{range && <> · <span className="tnum">{range}</span></>} · India time
              {includeTest && <span className="pill warn">Including test traffic</span>}
            </p>
          </div>
          <div className="controls">
            <nav className="seg" aria-label="Period">
              {PERIODS.map(p => <Link key={p} href={href({ days: p, limit: null })} aria-current={p === days ? "true" : undefined}>{p} days</Link>)}
            </nav>
            <Link className="switch" role="switch" aria-checked={includeTest} href={href({ test: includeTest ? null : "1" })}>
              <span className="knob" aria-hidden="true" />Include test traffic
            </Link>
          </div>
        </header>
        <nav className="tabs-dash" aria-label="Dashboard sections">
          {TABS.map(([k, label]) => <Link key={k} href={href({ tab: k, f: null, ch: null, user: null, limit: null, rv: null, fb: null, ev: null })} aria-current={k === tab ? "page" : undefined}>{label}</Link>)}
          <span className="spacer" />
          {/* Retyping a number out of a dashboard is how it gets transcribed wrong into a deck. */}
          <span className="export">CSV <a href="/api/v1/export?set=metrics">metrics</a> <a href="/api/v1/export?set=assets">assets</a> <a href="/api/v1/export?set=gaps">registry</a></span>
        </nav>

        {!persistent() && <div className="notice">Events are held in memory only. Add SUPABASE_URL and SUPABASE_SERVICE_KEY, run the docs/supabase-sam-*.sql files, and this becomes permanent.</div>}
        {persistent() && !d && tab !== "conversations" && tab !== "system" && <div className="notice">The dashboard query failed. Check that docs/supabase-sam-observability.sql has been applied; the server log has the status code.</div>}

        {tab === "overview" && d && <Overview d={d} days={days} href={href} includeTest={includeTest} />}
        {tab === "usage" && d && <Usage d={d} href={href} />}
        {tab === "quality" && d && <Quality d={d} sp={sp} days={days} includeTest={includeTest} href={href} />}
        {tab === "content" && d && <Content d={d} sp={sp} />}
        {tab === "requests" && d && <RequestsTab d={d} sp={sp} days={days} includeTest={includeTest} href={href} />}
        {tab === "system" && <System />}
        {tab === "conversations" && <Conversations sp={sp} days={days} includeTest={includeTest} href={href} />}

        <details className="defs" id="definitions">
          <summary>Definitions</summary>
          <dl>{DEFINITIONS.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        </details>
      </main>
    </>
  );
}

// ------------------------------------------------------------------------------------------- bits

function DeltaText({ d, goodWhen = "up", prevLabel }: { d: Delta | null; goodWhen?: "up" | "down"; prevLabel: string }) {
  if (!d) return null; // no baseline, or too few to compare: say nothing rather than "0%"
  if (d.dir === 0) return <span className="delta flat">No change vs {prevLabel}</span>;
  const good = (d.dir > 0) === (goodWhen === "up");
  return (
    <span className={`delta ${good ? "good" : "bad"}`}>
      <span aria-hidden="true">{d.dir > 0 ? "▲" : "▼"}</span> {d.dir > 0 ? "+" : "−"}{Math.abs(d.value)}{d.unit === "pt" ? " pts" : "%"}
      <span className="vs"> vs {prevLabel}</span>
    </span>
  );
}

function RateValue({ r }: { r: Ratio }) {
  if (r.den === 0) return <b className="kv muted">–</b>;
  if (r.pct == null) return <b className="kv">{r.num}<span className="of"> of {r.den}</span></b>;
  return <b className="kv">{r.pct}<span className="unit">%</span></b>;
}

/** The n under a rate. Says "none yet" rather than "0 of 0", and does not repeat a fraction the
 *  value already shows. */
function Of({ r, what }: { r: Ratio; what: string }) {
  if (r.den === 0) return <>No {what} yet</>;
  return r.pct == null ? <>too few {what} for a rate</> : <>{num(r.num)} of {num(r.den)} {what}</>;
}

function Kpi({ label, value, deltaEl, foot, viz }: { label: string; value: React.ReactNode; deltaEl?: React.ReactNode; foot?: React.ReactNode; viz?: React.ReactNode }) {
  return (
    <div className="kpi">
      <div className="kpi-top"><span className="kl">{label}</span>{viz}</div>
      {value}
      {deltaEl && <div className="kpi-delta">{deltaEl}</div>}
      {foot && <div className="kpi-foot">{foot}</div>}
    </div>
  );
}

function Section({ title, sub, children, aside }: { title: string; sub?: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="card">
      <div className="card-head"><div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>{aside}</div>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="empty-inline">{children}</p>;

function rates(d: Dashboard) {
  const c = d.summary.cur, p = d.summary.prev;
  return {
    answered: [ratio(c.answered, c.questions), ratio(p.answered, p.questions)] as const,
    engaged: [ratio(c.engaged, c.web_answered), ratio(p.engaged, p.web_answered)] as const,
    helpful: [ratio(c.helpful, c.rated), ratio(p.helpful, p.rated)] as const,
    // Real errors: the rep saw a failure or a degraded answer. A recovered fallback (provider_error: one
    // provider failed and another model answered) is counted apart - it is invisible to the rep.
    errors: [ratio((c.errors ?? 0) - (c.recovered ?? 0), c.instrumented), ratio((p.errors ?? 0) - (p.recovered ?? 0), p.instrumented)] as const,
    recovered: [ratio(c.recovered, c.instrumented), ratio(p.recovered, p.instrumented)] as const,
    fallback: [ratio(c.fallback, c.model_attempted), ratio(p.fallback, p.model_attempted)] as const,
  };
}

function PublishQueue({ q }: { q: Awaited<ReturnType<typeof apiPublishQueue>> }) {
  if (!q.length) return null;
  // Siddharth approves these (settled 6 Sep). A rep is blocked on each one, waiting to send
  // something to a customer - so it leads the page whenever it is non-empty.
  return (
    <Section title="Publish requests waiting on you" sub="Someone wants to send an internal-only asset to a customer. Each one is a rep waiting.">
      <table><thead><tr><th>Asset</th><th>Who</th><th>Why</th><th>Asked</th></tr></thead>
        <tbody>{q.map(r => <tr key={r.id}><td>{r.asset_title}</td><td>{r.requested_by}</td><td>{r.reason ?? "–"}</td><td className="nowrap">{fmtTime(r.created_at)}</td></tr>)}</tbody></table>
    </Section>
  );
}

async function DeletionBanner() {
  const sync = await syncStatus();
  // Deletions are the one change the Power Automate flow cannot see, so a stale reconcile means SAM
  // may be citing files that no longer exist - the worst failure this project has named.
  const ageH = sync?.last_run ? (Date.now() - Date.parse(sync.last_run)) / 3_600_000 : null;
  if (ageH !== null && ageH <= 36) return null;
  return (
    <div className="notice">
      Deleted files were last checked {ageH === null ? "never" : `${Math.round(ageH)} hours ago`}. Deletions are caught by
      the daily Power Automate flow <b>SAM - daily SharePoint snapshot</b>, and only a run in write mode counts as a
      check. Until one succeeds, SAM may still point people at files that have gone. Setup: <code>docs/TASK-snapshot-flow.md</code>.
    </div>
  );
}

// ------------------------------------------------------------------------------------------- overview

async function Overview({ d, days, href, includeTest }: { d: Dashboard; days: number; href: (o: Record<string, string | number | null>) => string; includeTest: boolean }) {
  const c = d.summary.cur, p = d.summary.prev, r = rates(d);
  const pubQueue = await apiPublishQueue();
  const prevLabel = `previous ${days} days`;
  const q = c.questions ?? 0;
  const worklist = gapWorklist(d.gaps);
  return (
    <>
      <DeletionBanner />
      <PublishQueue q={pubQueue} />
      {q === 0 && (c.people ?? 0) === 0 && (
        <div className="calm">
          <b>No one has used SAM in the last {days} days.</b>{" "}
          {d.last_event_at ? <>The last question or open was on {fmtDateY(d.last_event_at)}, {ago(d.last_event_at)}.</> : <>Nothing has been recorded yet.</>}{" "}
          {days < 90 && <Link href={href({ days: 90 })}>Widen to 90 days</Link>}
        </div>
      )}
      <div className="kpis">
        <Kpi label="People" value={<b className="kv">{num(c.people)}</b>}
          viz={<Sparkline values={d.daily.map(x => x.people)} label="People per day" />}
          deltaEl={<DeltaText d={delta(c.people, p.people, "%")} prevLabel={prevLabel} />}
          foot={<>{num(c.new_people)} new · {num(c.people - c.new_people)} returning</>} />
        <Kpi label="Questions" value={<b className="kv">{num(q)}</b>}
          viz={<Sparkline values={d.daily.map(x => x.questions)} label="Questions per day" />}
          deltaEl={<DeltaText d={delta(q, p.questions ?? 0, "%")} prevLabel={prevLabel} />}
          foot={<>{(q / days).toFixed(1)} a day on average</>} />
        <Kpi label="Answered" value={<RateValue r={r.answered[0]} />} viz={<Meter pct={r.answered[0].pct} label="Answered" />}
          deltaEl={<DeltaText d={rateDelta(r.answered[0], r.answered[1])} prevLabel={prevLabel} />}
          foot={q ? <>n = {num(q)} questions</> : <>No questions yet</>} />
        <Kpi label="Engaged" value={<RateValue r={r.engaged[0]} />} viz={<Meter pct={r.engaged[0].pct} label="Engaged" />}
          deltaEl={<DeltaText d={rateDelta(r.engaged[0], r.engaged[1])} prevLabel={prevLabel} />}
          foot={c.web_answered ? <>of {num(c.web_answered)} web answers, opened or rated helpful</> : <>No web answers yet</>} />
        <Kpi label="Errors" value={<RateValue r={r.errors[0]} />} viz={<Meter pct={r.errors[0].pct} label="Errors" />}
          deltaEl={<DeltaText d={rateDelta(r.errors[0], r.errors[1])} goodWhen="down" prevLabel={prevLabel} />}
          foot={(c.instrumented ?? 0) === 0 ? <>Recording {d.instrumented_since ? `since ${fmtDate(d.instrumented_since)}` : "starts with this release"}</>
            : <>that the rep saw · n = {num(c.instrumented)}<br /><b className="tnum">{num(c.recovered ?? 0)}</b> recovered fallbacks not counted: another model answered</>} />
        <Kpi label="Response time, p95" value={<b className="kv">{c.p95 == null ? "–" : ms(c.p95)}</b>}
          deltaEl={<DeltaText d={(c.latency_n ?? 0) >= MIN_N && (p.latency_n ?? 0) >= MIN_N ? delta(c.p95 ?? null, p.p95 ?? null, "%") : null} goodWhen="down" prevLabel={prevLabel} />}
          foot={c.latency_n ? <>p50 {ms(c.p50)} · n = {num(c.latency_n)}</> : <>No timed answers yet</>} />
      </div>

      <RequestsStrip d={d} includeTest={includeTest} href={href} />

      <Section title="Questions per day" sub="Every question on every channel, and how many SAM answered.">
        <DailyColumns days={d.daily} />
      </Section>

      <div className="two">
        <Section title="Most asked" sub="Grouped by exact wording, lower-cased.">
          {d.top_questions.length === 0 ? <Empty>No questions in this period.</Empty> : (
            <table><thead><tr><th>Question</th><th className="r">Asked</th><th className="r">People</th><th className="r">Answered</th></tr></thead>
              <tbody>{d.top_questions.slice(0, 8).map(t => <tr key={t.key}><td>{t.key}</td><td className="r">{t.n}</td><td className="r">{t.people}</td><td className="r">{t.answered}</td></tr>)}</tbody></table>
          )}
        </Section>
        <Section title="Content gaps" sub="Asked for, not in the library, ranked by how many different people asked. The same list as the Content tab." aside={<Link className="more" href={href({ tab: "content" })}>All content gaps</Link>}>
          {worklist.length === 0 ? <Empty>Nothing went unanswered in this period.</Empty> : (
            <table><thead><tr><th>Wanted</th><th className="r">People</th><th className="r">Asks</th></tr></thead>
              <tbody>{worklist.slice(0, 6).map(g => <tr key={g.key}><td>{gapLabel(g)}<div className="subline">{g.examples[0]}</div></td><td className="r">{g.users.length}</td><td className="r">{g.asks}</td></tr>)}</tbody></table>
          )}
        </Section>
      </div>
    </>
  );
}

// ------------------------------------------------------------------------------------------- usage

function Usage({ d, href }: { d: Dashboard; href: (o: Record<string, string | number | null>) => string }) {
  const c = d.summary.cur;
  const qTotal = c.questions ?? 0;
  return (
    <>
      <div className="kpis four">
        <Kpi label="People" value={<b className="kv">{num(c.people)}</b>} foot="asked or opened something" />
        <Kpi label="New" value={<b className="kv">{num(c.new_people)}</b>} foot="first time ever in this period" />
        <Kpi label="Returning" value={<b className="kv">{num(c.people - c.new_people)}</b>} foot="used SAM before this period" />
        <Kpi label="Daily active, average" value={<b className="kv">{(() => { const v = dailyActive(d.daily); return v === 0 && c.people > 0 ? "< 0.1" : v; })()}</b>} foot={`over ${d.daily.length} days, quiet days included`} />
      </div>

      <Section title="By channel" sub="Where questions come from, and how each channel is served.">
        {d.channel.length === 0 ? <Empty>No questions in this period.</Empty> : (
          <table><thead><tr><th>Channel</th><th className="r">Questions</th><th className="r">Share</th><th className="r">People</th><th className="r">Answered</th><th className="r">Errors</th><th className="r">p50</th><th className="r">p95</th></tr></thead>
            <tbody>{d.channel.map(ch => {
              const a = ratio(ch.answered, ch.questions), e = ratio(ch.errors, ch.instrumented);
              return (
                <tr key={ch.key}>
                  <td>{channelName(ch.key)}</td><td className="r">{num(ch.questions)}</td>
                  <td className="r">{qTotal ? `${Math.round((ch.questions / qTotal) * 100)}%` : "–"}</td>
                  <td className="r">{num(ch.people)}</td>
                  <td className="r">{a.pct == null ? `${a.num} of ${a.den}` : `${a.pct}%`}</td>
                  <td className="r">{e.den === 0 ? "–" : e.pct == null ? `${e.num} of ${e.den}` : `${e.pct}%`}</td>
                  <td className="r">{ms(ch.p50)}</td><td className="r">{ms(ch.p95)}</td>
                </tr>
              );
            })}</tbody></table>
        )}
      </Section>

      <Section title="When people ask" sub="Questions by weekday and hour, India time.">
        {qTotal === 0 ? <Empty>No questions in this period.</Empty> : <Heatmap cells={d.heatmap} />}
      </Section>

      <Section title="People" sub="Whether sales picked SAM up, or only marketing did. Select a person to read their conversations.">
        {d.people.length === 0 ? <Empty>No one used SAM in this period.</Empty> : (
          <table><thead><tr><th>Person</th><th className="r">Questions</th><th className="r">Answered</th><th className="r">Opens</th><th>Channels</th><th>First seen</th><th>Last seen</th><th>Asks most</th></tr></thead>
            <tbody>{d.people.map(u => (
              <tr key={u.key}>
                <td><Link href={href({ tab: "conversations", user: u.key, f: null, ch: null, limit: null })}>{u.key}</Link></td>
                <td className="r">{u.questions}</td><td className="r">{u.answered}</td><td className="r">{u.opens}</td>
                <td>{(u.channels ?? []).map(channelName).join(", ") || "–"}</td>
                <td className="nowrap">{fmtDate(u.first_seen)}</td><td className="nowrap">{fmtTime(u.last_seen)}</td>
                <td className="clip">{u.top ?? "–"}</td>
              </tr>
            ))}</tbody></table>
        )}
      </Section>
    </>
  );
}

// ------------------------------------------------------------------------------------------- quality

async function Quality({ d, sp, days, includeTest, href }: { d: Dashboard; sp: SP; days: number; includeTest: boolean; href: (o: Record<string, string | number | null>) => string }) {
  const c = d.summary.cur, r = rates(d);
  const errTotal = d.errors.reduce((n, e) => n + e.n, 0);
  const ok = one(sp.ok), err = one(sp.err);
  return (
    <>
      {ok && <p className="ok-note" role="status">{ok}</p>}
      {err && <div className="notice" role="alert">{err}</div>}
      <div className="kpis">
        <Kpi label="Answered" value={<RateValue r={r.answered[0]} />} viz={<Meter pct={r.answered[0].pct} label="Answered" />} foot={<Of r={r.answered[0]} what="questions" />} />
        <Kpi label="Engaged" value={<RateValue r={r.engaged[0]} />} viz={<Meter pct={r.engaged[0].pct} label="Engaged" />} foot={<Of r={r.engaged[0]} what="web answers" />} />
        <Kpi label="Rated helpful" value={<RateValue r={r.helpful[0]} />} viz={<Meter pct={r.helpful[0].pct} label="Rated helpful" />} foot={<Of r={r.helpful[0]} what="ratings" />} />
        <Kpi label="Errors" value={<RateValue r={r.errors[0]} />} viz={<Meter pct={r.errors[0].pct} label="Errors" />} foot={<Of r={r.errors[0]} what="recorded questions" />} />
        <Kpi label="Recovered fallbacks" value={<RateValue r={r.recovered[0]} />} viz={<Meter pct={r.recovered[0].pct} label="Recovered fallbacks" />} foot={<>another model answered · <Of r={r.recovered[0]} what="recorded questions" /></>} />
        <Kpi label="Fallback rate" value={<RateValue r={r.fallback[0]} />} viz={<Meter pct={r.fallback[0].pct} label="Fallback rate" />} foot={<Of r={r.fallback[0]} what="model attempts" />} />
      </div>
      {(c.instrumented ?? 0) < (c.questions ?? 0) && (
        <p className="note">
          {num((c.questions ?? 0) - (c.instrumented ?? 0))} of {num(c.questions)} questions in this period were logged before errors were recorded
          {d.instrumented_since ? ` (recording began ${fmtDateY(d.instrumented_since)})` : ""}, so they are left out of the error and fallback rates.
        </p>
      )}

      <Section title="What went wrong" sub="Each question is counted once, under the worst thing that happened while answering it. “provider error” is a recovered fallback (another model answered, the rep saw nothing); every other kind is a real error.">
        {errTotal === 0 ? <Empty>{(c.instrumented ?? 0) === 0 ? "No questions have been recorded with error tracking in this period yet." : `No errors in ${num(c.instrumented)} recorded questions.`}</Empty> : (
          <table><thead><tr><th>Kind</th><th className="r">Questions</th><th className="r">Share</th><th>Last seen</th><th>Last detail</th></tr></thead>
            <tbody>{d.errors.map(e => (
              <tr key={e.key}>
                <td><b>{e.key.replace(/_/g, " ")}</b><div className="subline">{ERROR_KINDS[e.key as keyof typeof ERROR_KINDS] ?? ""}</div></td>
                <td className="r">{e.n}</td><td className="r">{Math.round((e.n / errTotal) * 100)}%</td>
                <td className="nowrap">{fmtTime(e.last_at)}</td><td><code className="detail">{e.last_detail ?? "–"}</code></td>
              </tr>
            ))}</tbody></table>
        )}
      </Section>

      <div className="two">
        <Section title="Response time" sub={<>p50 <b className="tnum">{ms(c.p50)}</b> · p95 <b className="tnum">{ms(c.p95)}</b> · n = {num(c.latency_n)}</>}>
          {(c.latency_n ?? 0) === 0 ? <Empty>No timed answers in this period.</Empty> : <Histogram buckets={d.latency} />}
        </Section>
        <Section title="Ratings" sub="What people said when they rated an answer.">
          {(c.rated ?? 0) === 0 ? <Empty>No one rated an answer in this period. The buttons sit under every web answer.</Empty> : (
            <BarList label="Ratings" rows={[{ key: "Helpful", n: c.helpful }, { key: "Wrong asset", n: c.wrong_asset }, { key: "What I need doesn't exist", n: c.missing }].filter(x => x.n)} />
          )}
        </Section>
      </div>

      <RepsToldUs sp={sp} days={days} includeTest={includeTest} href={href} />

      <Section title="Runtime and model" sub="Which path wrote each answer. Releases before 25 Sep 2026 logged the Groq path as “claude”, so Claude rows with no model may be Groq.">
        {d.runtime.length === 0 ? <Empty>No questions in this period.</Empty> : (
          <table><thead><tr><th>Runtime</th><th>Model</th><th className="r">Questions</th><th className="r">p50</th></tr></thead>
            <tbody>{d.runtime.map(x => <tr key={`${x.runtime}-${x.model}`}><td>{RUNTIMES[x.runtime] ?? x.runtime}</td><td>{x.model ?? "–"}</td><td className="r">{x.n}</td><td className="r">{ms(x.p50)}</td></tr>)}</tbody></table>
        )}
      </Section>

      <div className="grid4">
        <Section title="Intent"><BarList label="Intent" rows={d.intent.map(x => ({ key: INTENTS[x.key] ?? x.key, n: x.n }))} /></Section>
        <Section title="Asset type asked for"><BarList label="Asset type" rows={d.asset_type} /></Section>
        <Section title="Industry"><BarList label="Industry" rows={d.vertical} /></Section>
        <Section title="Product"><BarList label="Product" rows={d.product} /></Section>
      </div>
      <p className="note">Asset type, industry and product are the filters SAM searched with: the model&apos;s last search, or the keyword router in retrieval-only mode. “Any” means no filter.</p>
    </>
  );
}

// ------------------------------------------------------------------------------------------- what reps told us

const FB_FILTERS: [FeedbackKind | "all", string][] = [["all", "All"], ["wrong_asset", "Wrong asset"], ["missing", "Doesn't exist"], ["helpful", "Helpful"]];

/** The ratings themselves, not just their counts: what was asked, what SAM said and showed, and what
 *  the rep made of it. Plus the two things marketing acts on: documents reps keep calling the wrong
 *  answer, and the demotions search learned from that (a human can clear any of them). */
async function RepsToldUs({ sp, days, includeTest, href }: { sp: SP; days: number; includeTest: boolean; href: (o: Record<string, string | number | null>) => string }) {
  const fb = FB_FILTERS.find(x => x[0] === one(sp.fb))?.[0] ?? "all";
  const from = new Date(Date.now() - Math.max(days, DEMOTE_DAYS) * 86_400_000).toISOString();
  const periodFrom = new Date(Date.now() - days * 86_400_000).toISOString();
  const [all, clears] = await Promise.all([loadRatings({ from, real: !includeTest, limit: 2000 }), loadClears()]);
  if (!all) return <div className="notice">Could not read ratings. The server log has the status code.</div>;
  const inPeriod = latestRatings(all).filter(x => x.created_at >= periodFrom);
  const shown = inPeriod.filter(x => fb === "all" || x.feedback === fb);
  const tally = wrongAssetTally(all.filter(x => x.created_at >= periodFrom)).slice(0, 10);
  const now = new Date().toISOString();
  const demotions = learnDemotions(all, now, clears ?? []);
  // What search actually uses: real ratings only, whatever the toggle says.
  const live = new Set(learnDemotions(all.filter(x => !x.is_test), now, clears ?? []).map(x => `${x.asset}\n${x.topic.join(" ")}`));
  const back = new URLSearchParams(href({}).split("?")[1] ?? "").toString();
  const pill = (k: FeedbackKind) => <span className={`pill ${k === "helpful" ? "good" : "warn"}`}>{FEEDBACK_LABEL[k]}</span>;
  return (
    <>
      <Section title="What reps told us" sub="Every rating in this period, newest first: the question, what SAM said, the documents it showed, and the rating. One per rep per answer, the latest."
        aside={<nav className="seg small" aria-label="Rating">{FB_FILTERS.map(([k, l]) => <Link key={k} href={href({ fb: k === "all" ? null : k })} aria-current={k === fb ? "true" : undefined}>{l}{k !== "all" ? ` ${inPeriod.filter(x => x.feedback === k).length}` : ""}</Link>)}</nav>}>
        {shown.length === 0 ? <Empty>{inPeriod.length ? "No ratings of this kind in this period." : "No one rated an answer in this period. The buttons sit under every web answer."}</Empty> : (
          <ol className="convs">
            {shown.slice(0, 40).map((x: Rating) => {
              const a = x.asked!;
              return (
                <li key={x.id}>
                  <div className="cmeta">
                    <span className="tnum">{fmtTime(x.created_at)}</span><span>{x.user_id}</span><span>{channelName(a.channel)}</span>
                    {x.is_test && <span className="pill">test</span>}
                    <span className="spacer" />
                    {pill(x.feedback)}
                    <Link href={`${href({ tab: "conversations", ev: a.id, f: null, ch: null, user: null, fb: null, limit: null })}#c${a.id}`}>Conversation</Link>
                  </div>
                  <p className="cq">{a.query}</p>
                  <p className="ca">{verdictOf(a.answer) || "No answer text (catalogue search)."}</p>
                  {(a.result_titles ?? []).length > 0 && <ul className="cassets">{a.result_titles!.map((t, i) => <li key={i}>{t}</li>)}</ul>}
                </li>
              );
            })}
          </ol>
        )}
        {shown.length > 40 && <p className="note">Showing the newest 40 of {num(shown.length)}.</p>}
      </Section>

      <div className="two">
        <Section title="Documents rated wrong asset" sub="Documents shown in answers rated “Wrong asset”, by distinct reps. A rating is of the whole answer, so read it with the questions.">
          {tally.length === 0 ? <Empty>No “Wrong asset” ratings in this period.</Empty> : (
            <table><thead><tr><th>Document</th><th className="r">Reps</th><th className="r">Ratings</th></tr></thead>
              <tbody>{tally.map(t => <tr key={t.key}><td title={t.key}>{t.title}{t.questions.map(q => <div key={q} className="subline">“{q}”</div>)}</td><td className="r">{t.reps}</td><td className="r">{t.ratings}</td></tr>)}</tbody></table>
          )}
        </Section>
        <Section title="Learned demotions" sub={<>When {DEMOTE_MIN_REPS}+ reps call a document the wrong answer for the same topic, search scores it {DEMOTE_PENALTY} points lower on questions about that topic. Never removed; lapses {DEMOTE_DAYS} days after the ratings; a “Helpful” rating for the topic blocks it.</>}>
          {demotions.length === 0 ? <Empty>No document is demoted. It takes {DEMOTE_MIN_REPS} different reps agreeing.</Empty> : (
            <table id="demotions"><thead><tr><th>Document</th><th>Topic</th><th className="r">Reps</th><th /></tr></thead>
              <tbody>{demotions.map(x => {
                const topic = x.topic.join(" "), on = live.has(`${x.asset}\n${topic}`);
                return (
                  <tr key={`${x.asset}|${topic}`}>
                    <td title={x.asset}>{x.title}{x.questions.map(q => <div key={q} className="subline">“{q}”</div>)}</td>
                    <td>{x.topic.join(", ")}{!on && <div className="subline"><span className="pill">test only, not applied</span></div>}</td>
                    <td className="r">{x.reps.length}</td>
                    <td className="r">
                      <form action={clearRank}>
                        <input type="hidden" name="asset" value={x.asset} /><input type="hidden" name="topic" value={topic} /><input type="hidden" name="back" value={back} />
                        <button className="btn-line" type="submit">Clear</button>
                      </form>
                    </td>
                  </tr>
                );
              })}</tbody></table>
          )}
          {includeTest && demotions.length > 0 && <p className="note">Including test ratings. Search only ever learns from real ones.</p>}
        </Section>
      </div>
    </>
  );
}

// ------------------------------------------------------------------------------------------- content

async function Content({ d, sp }: { d: Dashboard; sp: SP }) {
  const ok = one(sp.ok), err = one(sp.err);
  const [regRows, carding, pubQueue] = await Promise.all([registry("sales", 5000), cardingQueue(), apiPublishQueue()]);
  await ready();
  const all = allAssets(), answerable = all.filter(a => !a.family || (a.family.head && a.family.eligible));
  const titleOf = new Map<string, string>();
  for (const a of all) { if (a.file?.path) titleOf.set(a.file.path, a.title); titleOf.set(a.title, a.title); }
  const linked = answerable.filter(a => assetLink(a)).length;
  // Coverage that means something: of the documents answers can use (newest of each family, 2024 or
  // later, pinned or a dated record), how many has SAM read. Images and videos have no text to card.
  // The old figure counted inventory_id, which only the bundled 77 hand-written cards carry.
  const docs = answerable.filter(a => /^(pdf|pptx?|docx?|xlsx?)$/i.test(a.file?.ext ?? "")), cardedDocs = docs.filter(a => a.carded).length;
  const cards = cardAssets(), bound = cards.filter(c => c.item_id).length;
  const olderHidden = all.filter(a => a.family && !a.family.head).length;
  const excluded = all.filter(a => a.family?.head && !a.family.eligible), pinned = all.filter(a => a.family?.pinned);
  const byFamily = new Map<string, Asset[]>();
  for (const a of all) if (a.family) byFamily.set(a.family.key, [...(byFamily.get(a.family.key) ?? []), a]);
  const multi = [...byFamily.values()].filter(g => g.length > 1).sort((x, y) => y.length - x.length);
  const stale = freshness(regRows);
  const staleTotal = stale.reduce((n, f) => n + f.stale, 0);
  const worklist = gapWorklist(d.gaps);
  return (
    <>
      {ok && <p className="ok-note" role="status">{ok}</p>}
      {err && <div className="notice" role="alert">{err}</div>}
      <PublishQueue q={pubQueue} />
      <div className="kpis four">
        <Kpi label="Tracked in SharePoint" value={<b className="kv">{num(regRows.length)}</b>} foot={`registry files, not deleted: ${num(regRows.filter(r => r.status !== "archived").length)} active (the registry CSV), ${num(regRows.filter(r => r.status === "archived").length)} in archive folders`} />
        <Kpi label="Answerable" value={<b className="kv">{num(answerable.length)}</b>} foot={`newest of each document; ${num(olderHidden)} older versions and ${num(excluded.length)} pre-2024 left out`} />
        <Kpi label="With a working link" value={<b className="kv">{num(linked)}</b>} foot={answerable.length ? `${Math.round((linked / answerable.length) * 100)}% of answerable` : ""} />
        {/* The real coverage number: everything else is findable by name but cannot be reasoned
            about, because no document text has been read. */}
        <Kpi label="Carded" value={<b className="kv">{num(cardedDocs)} <span className="of">of {num(docs.length)}</span></b>}
          foot={`answerable documents SAM has read · ${num(cards.length)} cards, ${num(bound)} bound to a file`} />
      </div>

      <Section title="Returned versus opened" sub="How often SAM offered an asset, and how often someone then opened it. Opens are only observable on web.">
        {d.assets.length === 0 ? <Empty>Nothing was returned or opened in this period.</Empty> : (
          <table><thead><tr><th>Asset</th><th className="r">Returned</th><th className="r">Opened from answer</th><th className="r">Open rate</th><th className="r">Opened from catalogue</th></tr></thead>
            <tbody>{d.assets.map(a => {
              const or = ratio(a.from_answer, a.returned);
              return (
                <tr key={a.key}>
                  <td title={a.key}>{titleOf.get(a.key) ?? basename(a.key)}</td>
                  <td className="r">{a.returned}</td><td className="r">{a.from_answer}</td>
                  <td className="r">{a.returned === 0 ? "–" : or.pct == null ? `${or.num} of ${or.den}` : `${or.pct}%`}</td>
                  <td className="r">{a.from_catalogue}</td>
                </tr>
              );
            })}</tbody></table>
        )}
      </Section>

      <Section title="Content gaps" sub="Asked for, not in the library, ranked by how many different people asked, not how many times: one person rephrasing is not demand. The Requests tab shows which of these nobody has asked marketing for.">
        {worklist.length === 0 ? <Empty>Nothing has gone unanswered in this period.</Empty> : (
          <table><thead><tr><th>Wanted</th><th className="r">People</th><th className="r">Asks</th><th>What they typed</th><th>Last asked</th></tr></thead>
            <tbody>{worklist.slice(0, 15).map(g => (
              <tr key={g.key}>
                <td>{gapLabel(g)}</td>
                <td className="r">{g.users.length}</td><td className="r">{g.asks}</td>
                <td>
                  {g.examples[0]}
                  {/* An external ask is not missing content: the asset exists and has no public URL.
                      That is a publish decision, not a writing job - conflating the two is what
                      produced the false gap on 4 September. */}
                  {g.external > 0 && <span className="pill">needs a public link, not new content</span>}
                </td>
                <td className="nowrap">{fmtDate(g.lastSeen)}</td>
              </tr>
            ))}</tbody></table>
        )}
      </Section>

      <Section title="Needs carding" sub="Registry files with no card, or changed or renamed since their card was written. A card is what lets SAM reason about a document rather than match its name."
        aside={!carding.missing && carding.total > 0 ? <span className="count">{num(carding.total)}</span> : undefined}>
        {carding.missing ? <Empty>The carding queue is not set up yet. It appears here once the sam_carding_queue view exists in Supabase.</Empty>
          : carding.rows.length === 0 ? <Empty>Every tracked file has an up-to-date card.</Empty> : (
            <table><thead><tr><th>File</th><th>Why</th><th>Modified</th><th>By</th></tr></thead>
              <tbody>{carding.rows.slice(0, 20).map(r => (
                <tr key={r.item_id}>
                  <td>{r.web_url ? <a href={r.web_url} target="_blank" rel="noreferrer">{r.filename}</a> : r.filename}<div className="subline">{r.folder}</div></td>
                  <td className="nowrap">{r.reason === "uncarded" ? "No card" : r.reason === "changed_since_card" ? "Changed since card" : r.reason === "renamed" ? "Renamed" : r.reason}
                    {r.family_role === "new_version" && <div className="subline"><span className="pill">new version of {r.canonical_filename === r.filename ? "a carded document" : r.canonical_filename}</span></div>}
                    {r.family_role === "older_version" && <div className="subline"><span className="pill">older version, skipped: {r.canonical_filename} is newer</span></div>}</td>
                  <td className="nowrap">{fmtDateY(r.modified_at)}</td><td>{r.modified_by ?? "–"}</td>
                </tr>
              ))}</tbody></table>
          )}
        {!carding.missing && carding.total > 20 && <p className="note">Showing 20 of {num(carding.total)}, most recently modified first.</p>}
      </Section>

      <Section title="Versions and editions" sub={<>Files SAM treats as one document. Answers show only the <b>lead</b> (or the edition the ask needs: sharable when sending, Japanese for Japan, MEA for the Middle East); older versions never take an answer slot. A wrong grouping is fixed with a row in <code>sam_asset_family_overrides</code>.</>}
        aside={<span className="count">{num(multi.length)}</span>}>
        {multi.length === 0 ? <Empty>No document has more than one copy.</Empty> : (
          <table><thead><tr><th>Document</th><th>Editions</th><th>Older versions, not shown</th></tr></thead>
            <tbody>{multi.slice(0, 40).map(g => {
              const lead = g.find(a => a.family!.canonical) ?? g[0];
              const sibs = g.filter(a => a.family!.head && a !== lead), old = g.filter(a => !a.family!.head);
              const nm = (a: Asset) => (a.file?.path ?? a.title).split("/").pop()!;
              const yr = (a: Asset) => a.file?.year ? ` (${a.file.year})` : "";
              return (
                <tr key={lead.family!.key}>
                  <td>{lead.title}<div className="subline">{nm(lead)}{yr(lead)}{!lead.family!.eligible && <> · <span className="pill">excluded: {lead.family!.excluded}</span></>}</div></td>
                  <td>{sibs.length ? sibs.map(a => <div key={nm(a)} className="subline">{a.family!.edition || "default"}: {nm(a)}{yr(a)}</div>) : "–"}</td>
                  <td>{old.length ? old.map(a => <div key={nm(a)} className="subline">{nm(a)}{yr(a)}{a.family!.superseded ? " · superseded" : ""}</div>) : "–"}</td>
                </tr>
              );
            })}</tbody></table>
        )}
        {multi.length > 40 && <p className="note">Showing the 40 largest of {num(multi.length)}.</p>}
      </Section>

      <Section title="Excluded from answers" sub={<>Documents published before 2024 (read from the card; for an uncarded file, the year SharePoint last saw it modified). Certificates, analyst reports, regulations and brand assets (logos, icons, email signatures) stay whatever their year. Files a human excluded (<code>sam_asset_family_overrides.exclude</code>) and files whose card says they are empty are out whatever their year or pin. Excluded documents never answer and never stand in as a substitute, so a topic with only old material becomes an honest gap with the request button. <b>Pin</b> one that still holds.</>}
        aside={<span className="count">{num(excluded.length)}</span>}>
        <div id="excluded" />
        {pinned.length > 0 && (
          <table><thead><tr><th>Pinned</th><th>Why it was out</th><th /></tr></thead>
            <tbody>{pinned.map(a => (
              <tr key={pinKey(a)}>
                <td>{a.title}<div className="subline">{(a.file?.path ?? "").split("/").pop()}</div></td>
                <td>{eligibility(a, new Set()).excluded ?? "–"}</td>
                <td className="r"><form action={pinAsset}><input type="hidden" name="key" value={pinKey(a)} /><input type="hidden" name="pin" value="0" /><input type="hidden" name="back" value="tab=content" /><button className="btn-line" type="submit">Unpin</button></form></td>
              </tr>
            ))}</tbody></table>
        )}
        {excluded.length === 0 ? <Empty>Nothing is excluded.</Empty> : (
          <details open={excluded.length <= 40}>
            <summary>{num(excluded.length)} excluded, oldest reason first</summary>
            <table><thead><tr><th>Document</th><th>Why</th><th /></tr></thead>
              <tbody>{[...excluded].sort((x, y) => (x.family!.excluded ?? "").localeCompare(y.family!.excluded ?? "")).map(a => (
                <tr key={pinKey(a)} className="muted">
                  <td>{a.title}<div className="subline">{a.asset_type} · {(a.file?.path ?? "").split("/").pop()}</div></td>
                  <td className="nowrap">{/^(published|year unknown)/.test(a.family!.excluded ?? "") ? "pre-2024: " : ""}{a.family!.excluded}</td>
                  <td className="r"><form action={pinAsset}><input type="hidden" name="key" value={pinKey(a)} /><input type="hidden" name="back" value="tab=content" /><button className="btn-line" type="submit">Pin</button></form></td>
                </tr>
              ))}</tbody></table>
          </details>
        )}
      </Section>

      <Section title="Stale assets, by owner" sub={<><b>{num(staleTotal)}</b> documents untouched for over a year. This is SharePoint&apos;s last-modified date, not a publication date: a file touched last week can still hold 2022 numbers, so treat it as a floor.</>}>
        {stale.length === 0 ? <Empty>Nothing older than a year.</Empty> : (
          <table><thead><tr><th>Owner</th><th className="r">Stale</th><th className="r">Of</th><th>Oldest</th></tr></thead>
            <tbody>{stale.slice(0, 10).map(f => <tr key={f.owner}><td>{f.owner}</td><td className="r">{f.stale}</td><td className="r">{f.total}</td><td className="nowrap">{f.oldest ? new Date(f.oldest).toLocaleDateString("en-IN", { month: "short", year: "numeric" }) : "–"}</td></tr>)}</tbody></table>
        )}
      </Section>
    </>
  );
}

// ------------------------------------------------------------------------------------------- requests

const REQ_CHANNELS: Record<string, string> = { ...CHANNELS, gap: "Asked SAM", feedback: "Rated “doesn't exist”" };
const ALL_STATUSES: Status[] = ["open", "planned", "in_progress", "done", "declined", "merged"];
const facetLine = (r: { asset_type: string | null; product: string | null; vertical: string | null }) => [r.asset_type, r.product, r.vertical].filter(Boolean).join(" · ");

/** The Overview's headline for requests: how many are open, how many reps wait, what is most wanted. */
async function RequestsStrip({ d, includeTest, href }: { d: Dashboard; includeTest: boolean; href: (o: Record<string, string | number | null>) => string }) {
  const all = await listRequests({ includeTest, statuses: ALL_STATUSES });
  if (!all) return null; // table not there yet: say nothing rather than zeros
  const active = all.filter(r => ACTIVE.includes(r.status));
  const waiting = new Set(active.flatMap(r => r.votes.map(v => v.user_id))).size;
  const top = active[0];
  const unrequested = unrequestedGaps(d.gaps, all.map(r => r.topic_key));
  return (
    <div className="kpis three">
      <Kpi label="Open content requests" value={<b className="kv">{num(active.length)}</b>} foot={<>{num(waiting)} {waiting === 1 ? "rep" : "reps"} waiting · <Link href={href({ tab: "requests" })}>Open the queue</Link></>} />
      <Kpi label="Most wanted" value={top ? <b className="kv small">{top.title}</b> : <b className="kv muted">–</b>}
        foot={top ? <>{top.demand} {top.demand === 1 ? "rep" : "reps"} · {STATUS_LABEL[top.status]}</> : "Nothing requested yet"} />
      <Kpi label="Content gaps nobody requested" value={<b className="kv">{num(unrequested.length)}</b>} foot="asked SAM, not in the library, never asked of marketing" />
    </div>
  );
}

async function RequestsTab({ d, sp, days, includeTest, href }: { d: Dashboard; sp: SP; days: number; includeTest: boolean; href: (o: Record<string, string | number | null>) => string }) {
  const all = await listRequests({ includeTest, statuses: ALL_STATUSES });
  if (!all) return <div className="notice">Content requests are not set up yet. Apply <code>docs/supabase-sam-content-requests.sql</code>.</div>;
  const VIEWS = [["active", "Active"], ["done", "Delivered"], ["declined", "Declined"], ["all", "All"]] as const;
  const view = VIEWS.find(v => v[0] === one(sp.rv))?.[0] ?? "active";
  const live = all.filter(r => r.status !== "merged");
  const active = live.filter(r => ACTIVE.includes(r.status));
  const shown = view === "active" ? active : view === "all" ? live : live.filter(r => r.status === view);
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  const delivered = live.filter(r => r.status === "done" && (r.closed_at ?? "") >= from).length;
  const waiting = new Set(active.flatMap(r => r.votes.map(v => v.user_id))).size;
  const gaps = unrequestedGaps(d.gaps, all.map(r => r.topic_key));
  const backQ = new URLSearchParams(href({}).split("?")[1] ?? "").toString();
  const ok = one(sp.ok), err = one(sp.err);
  return (
    <>
      {ok && <p className="ok-note" role="status">{ok}</p>}
      {err && <div className="notice" role="alert">{err}</div>}
      <div className="kpis three">
        <Kpi label="Active requests" value={<b className="kv">{num(active.length)}</b>} foot="open, planned or in progress" />
        <Kpi label="Reps waiting" value={<b className="kv">{num(waiting)}</b>} foot="distinct people on an active request" />
        <Kpi label={`Delivered, last ${days} days`} value={<b className="kv">{num(delivered)}</b>} foot="each rep who asked was told" />
      </div>

      <Section title="Requests, ranked by demand" sub="Demand is distinct reps: one person asking five ways counts once. Repeat asks for the same kind of document merge automatically; merge anything the matching missed."
        aside={<nav className="seg small" aria-label="Show">{VIEWS.map(([k, l]) => <Link key={k} href={href({ rv: k === "active" ? null : k, ok: null, err: null })} aria-current={k === view ? "true" : undefined}>{l}</Link>)}</nav>}>
        {shown.length === 0 ? <Empty>{view === "active" ? "No open requests. When a rep asks marketing to create something, it appears here." : "Nothing here yet."}</Empty> : (
          <ol className="reqs">
            {shown.map(r => <RequestItem key={r.id} r={r} others={active.filter(x => x.id !== r.id)} back={backQ} />)}
          </ol>
        )}
      </Section>

      <Section title="Content gaps nobody has requested" sub="The weaker, automatic signal: content gaps (asked SAM, not in the library) in this period that nobody turned into a request to marketing. Promote one to put it in the queue; the people who asked will hear when it is delivered.">
        {gaps.length === 0 ? <Empty>Every content gap in this period is already a request, or there were none.</Empty> : (
          <table><thead><tr><th>Wanted</th><th className="r">People</th><th className="r">Asks</th><th>Last asked</th><th /></tr></thead>
            <tbody>{gaps.slice(0, 15).map(g => (
              <tr key={g.key}>
                <td>{g.title}<div className="subline">{[facetLine(g.facets), g.examples.filter(x => x !== g.title).slice(0, 1).map(x => `“${x}”`)[0]].filter(Boolean).join(" · ")}</div></td>
                <td className="r">{g.users.length}</td><td className="r">{g.asks}</td><td className="nowrap">{fmtDate(g.lastSeen)}</td>
                <td className="r">
                  <form action={promote}>
                    <input type="hidden" name="key" value={g.key} /><input type="hidden" name="title" value={g.title} />
                    <input type="hidden" name="users" value={JSON.stringify(g.users)} /><input type="hidden" name="example" value={g.examples[0] ?? ""} />
                    <input type="hidden" name="back" value={backQ} />
                    <button className="btn-line" type="submit">Make it a request</button>
                  </form>
                </td>
              </tr>
            ))}</tbody></table>
        )}
      </Section>
    </>
  );
}

function RequestItem({ r, others, back }: { r: RankedRequest; others: RankedRequest[]; back: string }) {
  const active = ACTIVE.includes(r.status);
  const options = [r.status, ...NEXT[r.status]];
  return (
    <li id={`r${r.id}`}>
      <div className="demand"><b>{r.demand}</b><span>{r.demand === 1 ? "rep" : "reps"}</span></div>
      <div>
        <div className="rq-top">
          <h3>{r.title}</h3>
          <span className={`pill ${r.status === "done" ? "good" : r.status === "declined" ? "bad" : r.status === "open" ? "warn" : ""}`}>{STATUS_LABEL[r.status]}</span>
          {r.source === "gap" && <span className="pill">from a gap</span>}
          {r.source === "feedback" && <span className="pill">from a rating</span>}
          {r.is_test && <span className="pill">test</span>}
        </div>
        <div className="rq-meta">
          {facetLine(r) && <span>{facetLine(r)}</span>}
          <span>First asked {fmtDate(r.firstAsked)}</span>
          {r.lastAsked !== r.firstAsked && <span>Last asked {fmtDate(r.lastAsked)}</span>}
          <span>{r.channels.map(c => REQ_CHANNELS[c] ?? c).join(", ")}</span>
          {r.owner && <span>Owner {r.owner}</span>}
          {r.due_date && active && <span>Due {fmtDateY(r.due_date)}</span>}
        </div>
        {(r.examples.length > 0 || r.notes_from_reps.length > 0) && (
          <ul className="rq-ex">
            {r.examples.map(q => <li key={q}>{q}</li>)}
            {r.notes_from_reps.map((n, i) => <li key={i} className="note">Note: {n}</li>)}
          </ul>
        )}
        {r.status === "done" && r.delivered_url && <p className="subline">Delivered: <a href={r.delivered_url} target="_blank" rel="noreferrer">{r.delivered_title ?? r.delivered_url}</a> · {fmtDate(r.closed_at)}</p>}
        {r.status === "declined" && <p className="subline">Declined: {r.decline_reason}</p>}
        <details className="rq-edit">
          <summary>{active ? "Update" : "Details"}</summary>
          <form action={saveRequest} className="rq-form">
            <input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={back} />
            <label>Status
              <select name="status" defaultValue={r.status}>{options.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
            </label>
            <label>Owner<input name="owner" defaultValue={r.owner ?? ""} placeholder="Who in marketing" /></label>
            <label>Due<input type="date" name="due_date" defaultValue={r.due_date ?? ""} /></label>
            <label className="half">Delivered asset title<input name="delivered_title" defaultValue={r.delivered_title ?? ""} placeholder="Needed to mark it delivered" /></label>
            <label>Link to it<input type="url" name="delivered_url" defaultValue={r.delivered_url ?? ""} placeholder="https://" /></label>
            <label className="wide">Reason, if declining<input name="decline_reason" defaultValue={r.decline_reason ?? ""} placeholder="The reps who asked will read this" /></label>
            <label className="wide">Notes for marketing<textarea name="notes" rows={2} defaultValue={r.notes ?? ""} /></label>
            <div className="actions">
              <button className="btn-accent" type="submit">Save</button>
              <span className="hint">Delivered needs a title and a link; everyone who asked sees it, on WhatsApp too.</span>
            </div>
          </form>
          {active && others.length > 0 && (
            <form action={mergeRequest} className="rq-merge">
              <input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={back} />
              <span>Same as another request?</span>
              <select name="into" aria-label="Merge into" defaultValue="">
                <option value="" disabled>Choose one</option>
                {others.map(o => <option key={o.id} value={o.id}>{o.title} ({o.demand})</option>)}
              </select>
              <button className="btn-line" type="submit">Merge into it</button>
            </form>
          )}
        </details>
      </div>
    </li>
  );
}

// ------------------------------------------------------------------------------------------- system

async function System() {
  // Provider health is about the pipe, not about usage, so it reads every answer whatever the toggle:
  // with real traffic only, "Last model answer: not recorded yet" showed while Groq answered test
  // traffic daily (30 Sep: last real model answer = none, last model answer = 29 Sep).
  const [regRows, sync, evidence, ops, toks] = await Promise.all([registry("sales", 5000), syncStatus(), providerEvidence("id=gt.0"),
    recentRuns(), tokenRows(new Date(Date.now() - 8 * 86_400_000).toISOString())]);
  const now = new Date().toISOString();
  const jobs = ops ? jobStates(ops.runs, now, ops.since) : null;
  const usage = tokenUsage(toks);
  await ready();
  const reg = cacheState(), cards = cardCacheState();
  const flowLast = regRows.map(r => r.last_synced).filter(Boolean).sort().reverse()[0] ?? null;
  const delAgeH = sync?.last_run ? (Date.now() - Date.parse(sync.last_run)) / 3_600_000 : null;
  // Every configured tier in the order ask() tries them, so "OpenAI, then Groq" is visible, not just the first.
  const chain = [...tiers().map(t => `${t.provider === "openai" ? "OpenAI" : "OpenAI-compatible"} · ${t.models.join(", ")}`),
    ...(process.env.ANTHROPIC_API_KEY ? [`Anthropic · ${process.env.CLAUDE_MODEL ?? "claude-sonnet-5"}`] : [])];
  const provider = chain.length ? chain.join(" → then ") : null;
  const failNewer = evidence.lastFailure && (!evidence.lastAnswer || evidence.lastFailure.created_at > evidence.lastAnswer.created_at);
  type Row = { name: string; state: "ok" | "warn" | "bad" | "off"; value: React.ReactNode; note?: React.ReactNode };
  const rows: Row[] = [
    { name: "Model provider", state: !provider ? "off" : failNewer ? "warn" : "ok",
      value: provider ?? "None configured: retrieval only",
      note: <>Last model answer {evidence.lastAnswer ? `${fmtTime(evidence.lastAnswer.created_at)} (${evidence.lastAnswer.model})` : "not recorded yet"}.
        {evidence.lastFailure && <> Last failure {fmtTime(evidence.lastFailure.created_at)}: {evidence.lastFailure.error_kind.replace(/_/g, " ")}.</>}
        {" "}<a href="/api/v1/provider">Live check</a></> },
    { name: "Event store", state: persistent() ? "ok" : "bad", value: persistent() ? "Supabase, sam_events" : "In memory only, lost on restart" },
    { name: "SharePoint flow", state: !flowLast ? "warn" : (Date.now() - Date.parse(flowLast)) / 86_400_000 > 14 ? "warn" : "ok",
      value: flowLast ? `Last write ${fmtTime(flowLast)}` : "No write recorded",
      note: "The Power Automate flow writes a registry row whenever a file is added or changed. Weeks of silence usually means the flow is off, not that nobody changed anything." },
    { name: "Deletion check", state: delAgeH === null || delAgeH > 36 ? "bad" : "ok",
      value: sync?.last_run ? `Last run ${fmtTime(sync.last_run)} (${ago(sync.last_run)})` : "Never run",
      note: <>{sync?.last_result ? <>Result: {sync.last_result}. </> : null}Deletions are caught by the daily Power Automate snapshot flow; report-mode and refused runs show a result here but do not count as a check. Stale after 36 hours.</> },
    { name: "Registry cache", state: reg.count ? "ok" : "bad", value: `${num(reg.count)} usable files of ${num(regRows.length)} tracked`,
      note: <>Usable = active, not in an archive folder, not a temp file, shortcut or CSV: what answers are built from. Tracked = every registry file not deleted (the Content tab&apos;s figure). {reg.loadedAt ? `Loaded ${fmtTime(new Date(reg.loadedAt).toISOString())} on this server instance.` : "Not loaded."}</> },
    { name: "Card cache", state: cards.count ? "ok" : "bad", value: `${num(cards.count)} cards`, note: cards.loadedAt ? `Every row of sam_asset_cards. Loaded ${fmtTime(new Date(cards.loadedAt).toISOString())} on this server instance` : "Not loaded" },
  ];
  const label = { ok: "OK", warn: "Check", bad: "Needs attention", off: "Off" };
  const hours = (h: number | null) => h == null ? "–" : h < 1 ? "under an hour" : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`;
  const days = [...new Set(usage.map(u => u.day))].slice(0, 7);
  return (
    <>
      <DeletionBanner />
      <section className="card">
        <ul className="health">
          {rows.map(r => (
            <li key={r.name}>
              <span className={`status ${r.state}`}><i aria-hidden="true" />{label[r.state]}</span>
              <div><b>{r.name}</b><span className="hv">{r.value}</span>{r.note && <p>{r.note}</p>}</div>
            </li>
          ))}
        </ul>
      </section>

      <Section title="Scheduled jobs" sub={<>The last run of every daily job (<code>sam_ops_runs</code>). Not run for {STALE_H} hours shows here and in the morning digest, so a quiet day and a missed run look different. Times are India time.{ops?.since ? <> Run logging began {fmtDateY(ops.since)}.</> : null}</>}>
        {!jobs ? <div className="notice">Could not read <code>sam_ops_runs</code>. Apply <code>docs/supabase-sam-ops.sql</code>; the server log has the status.</div> : (
          <div className="scroll-x"><table><thead><tr><th>Job</th><th>Status</th><th>Last run</th><th className="r">Age</th><th>Next expected</th><th>Last result</th></tr></thead>
            <tbody>{jobs.map(j => (
              <tr key={j.job}>
                <td>{j.label}<div className="subline">{j.writer}</div></td>
                <td className="nowrap"><span className={`status ${j.state}`}><i aria-hidden="true" />{j.stale ? "Not run" : j.last ? j.last.status : "No run yet"}</span></td>
                <td className="nowrap">{j.last ? fmtTime(j.last.started_at) : "–"}</td>
                <td className="r nowrap">{hours(j.ageH)}</td>
                <td className="nowrap">{fmtTime(j.next)}<div className="subline">daily {j.at}</div></td>
                <td className="clip" title={j.last?.summary ?? ""}>{j.last?.summary || "–"}</td>
              </tr>
            ))}</tbody></table></div>
        )}
      </Section>

      <Section title="Model tokens, last 7 days" sub={<>Tokens the answering model used per day (India time), test traffic included: it spends the same quota. Groq&apos;s free tier caps each model at about 200,000 tokens a day, after which SAM falls back to the next model. OpenAI has no daily cap; its cost is an estimate from the price table in <code>lib/ops.ts</code>, assuming {Math.round(INPUT_SHARE * 100)}% of tokens are prompt.</>}>
        {usage.length === 0 ? <Empty>No answer has recorded tokens yet. Token recording began with this release; retrieval-only answers (local development) use none.</Empty> : (
          <div className="scroll-x"><table><thead><tr><th>Day</th><th>Model</th><th>Provider</th><th className="r">Answers</th><th className="r">Tokens</th><th className="r">Of daily quota</th><th className="r">Est. cost</th></tr></thead>
            <tbody>{usage.filter(u => days.includes(u.day)).map(u => (
              <tr key={`${u.day}|${u.model}`}>
                <td className="nowrap">{new Date(`${u.day}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}</td>
                <td>{u.model}</td><td>{u.provider}</td><td className="r">{num(u.answers)}</td><td className="r tnum">{num(u.tokens)}</td>
                <td className="r">{u.pctOfQuota == null ? "no daily cap" : <><span className={u.pctOfQuota >= 80 ? "pill warn" : ""}>{u.pctOfQuota}%</span><div className="subline">of {num(u.quota)}</div></>}</td>
                <td className="r">{u.usd == null ? (u.quota ? "free tier" : "not in price table") : `USD ${u.usd.toFixed(2)}`}</td>
              </tr>
            ))}</tbody></table></div>
        )}
      </Section>
    </>
  );
}

// ------------------------------------------------------------------------------------------- conversations

async function Conversations({ sp, days, includeTest, href }: { sp: SP; days: number; includeTest: boolean; href: (o: Record<string, string | number | null>) => string }) {
  const f = (["all", "errors", "gaps", "fallbacks"] as const).find(x => x === one(sp.f)) ?? "all";
  const ch = one(sp.ch), who = one(sp.user), ev = Number(one(sp.ev)) || undefined;
  const limit = Math.min(500, Math.max(25, Number(one(sp.limit)) || 50));
  // One conversation (the link from a rating): whatever its age, test or not.
  const from = ev ? "2000-01-01T00:00:00Z" : new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = await conversations({ from, filter: f as ConvFilter, channel: ch || undefined, user: who || undefined, limit, real: includeTest || ev ? undefined : realOnly(), id: ev });
  await ready();
  const titleOf = new Map<string, string>();
  for (const a of allAssets()) if (a.file?.path) titleOf.set(a.file.path, a.title);
  const tu = testUsers();
  const FILTERS: [ConvFilter, string][] = [["all", "All"], ["errors", "Errors"], ["fallbacks", "Fallbacks"], ["gaps", "Gaps"]];
  return (
    <>
      <div className="filters">
        <nav className="seg small" aria-label="Show">
          {FILTERS.map(([k, l]) => <Link key={k} href={href({ f: k === "all" ? null : k, limit: null })} aria-current={k === f ? "true" : undefined}>{l}</Link>)}
        </nav>
        <nav className="seg small" aria-label="Channel">
          <Link href={href({ ch: null, limit: null })} aria-current={!ch ? "true" : undefined}>Every channel</Link>
          {["web", "whatsapp", "api", "mcp"].map(c => <Link key={c} href={href({ ch: c, limit: null })} aria-current={c === ch ? "true" : undefined}>{channelName(c)}</Link>)}
        </nav>
        {who && <span className="pill">Person: {who} <Link href={href({ user: null })} aria-label={`Clear person filter ${who}`}>×</Link></span>}
        {ev && <span className="pill">One conversation <Link href={href({ ev: null })} aria-label="Show all conversations">×</Link></span>}
      </div>
      <section className="card flush">
        {rows.length === 0 ? <Empty>No conversations match. {f !== "all" || ch || who ? "Try clearing a filter or widening the period." : `Nothing was asked in the last ${days} days.`}</Empty> : (
          <ol className="convs">
            {rows.map(r => {
              const titles = r.result_titles ?? (r.result_ids ?? []).map(p => titleOf.get(p) ?? basename(p));
              const fb = r.reactions.filter(x => x.kind === "feedback");
              const opened = r.reactions.some(x => x.kind === "catalogue_open");
              const gap = r.intent === "gap" || r.reactions.some(x => x.kind === "gap") || (r.result_count ?? 0) === 0;
              return (
                <li key={r.id} id={`c${r.id}`}>
                  <div className="cmeta">
                    <span className="tnum">{fmtTime(r.created_at)}</span><span>{r.user_id}</span><span>{channelName(r.channel)}</span>
                    <span>{r.model ?? RUNTIMES[r.runtime ?? "unknown"] ?? r.runtime}</span>
                    {r.latency_ms != null && r.runtime !== "search" && <span className="tnum">{ms(r.latency_ms)}</span>}
                    {(r.is_test || tu.includes(r.user_id.toLowerCase())) && <span className="pill">test</span>}
                    <span className="spacer" />
                    {r.error_kind && <span className="pill bad">{r.error_kind.replace(/_/g, " ")}</span>}
                    {gap && <span className="pill warn">gap</span>}
                    {fb.map((x, i) => <span key={i} className={`pill ${x.feedback === "helpful" ? "good" : "warn"}`}>{x.feedback === "helpful" ? "Helpful" : x.feedback === "wrong_asset" ? "Wrong asset" : "Doesn't exist"}</span>)}
                    {opened && <span className="pill good">Opened</span>}
                    {r.reactions.some(x => x.kind === "request") && <span className="pill good">Asked marketing</span>}
                  </div>
                  <p className="cq">{r.query}</p>
                  {r.answer ? (
                    r.answer.length > 240
                      ? <details className="ca"><summary>{r.answer.slice(0, 240)}…</summary><p>{r.answer}</p></details>
                      : <p className="ca">{r.answer}</p>
                  ) : <p className="ca muted">{(r.schema_version ?? 0) >= 2 ? "No answer text (catalogue search)." : "No answer text: logged by a release that did not record it."}</p>}
                  {titles.length > 0 && <ul className="cassets">{titles.map((t, i) => <li key={i}>{t}</li>)}</ul>}
                  {r.error_detail && <code className="detail block">{r.error_detail}</code>}
                </li>
              );
            })}
          </ol>
        )}
      </section>
      {rows.length === limit && limit < 500 && <p className="more-row"><Link href={href({ limit: limit + 50 })}>Show 50 more</Link></p>}
    </>
  );
}
