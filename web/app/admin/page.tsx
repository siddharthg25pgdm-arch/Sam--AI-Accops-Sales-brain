import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { persistent, testUsers, realOnly, ERROR_KINDS } from "@/lib/events";
import { dashboard, conversations, cardingQueue, providerEvidence, gapWorklist, freshness, ratio, delta, rateDelta, dailyActive,
  DEFINITIONS, MIN_N, type Dashboard, type Ratio, type Delta, type ConvFilter } from "@/lib/metrics";
import { registry, syncStatus } from "@/lib/sharepoint";
import { ready, cacheState } from "@/lib/registry-cache";
import { cardCacheState } from "@/lib/cards-cache";
import { allAssets, assetLink } from "@/lib/cards";
import { apiPublishQueue } from "@/lib/api";
import { openAICompatConfigured } from "@/lib/agent-openai";
import { TopBar } from "@/components/TopBar";
import { Sparkline, Meter, DailyColumns, BarList, Heatmap, Histogram, num, ms } from "@/components/charts";

export const dynamic = "force-dynamic";

const TABS = [["overview", "Overview"], ["usage", "Usage"], ["quality", "Quality"], ["content", "Content"], ["system", "System"], ["conversations", "Conversations"]] as const;
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
    const cur: Record<string, string> = { tab, days: String(days), test: includeTest ? "1" : "", f: one(sp.f), ch: one(sp.ch), user: one(sp.user), limit: one(sp.limit) };
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
          {TABS.map(([k, label]) => <Link key={k} href={href({ tab: k, f: null, ch: null, user: null, limit: null })} aria-current={k === tab ? "page" : undefined}>{label}</Link>)}
          <span className="spacer" />
          {/* Retyping a number out of a dashboard is how it gets transcribed wrong into a deck. */}
          <span className="export">CSV <a href="/api/v1/export?set=metrics">metrics</a> <a href="/api/v1/export?set=assets">assets</a> <a href="/api/v1/export?set=gaps">registry</a></span>
        </nav>

        {!persistent() && <div className="notice">Events are held in memory only. Add SUPABASE_URL and SUPABASE_SERVICE_KEY, run the docs/supabase-sam-*.sql files, and this becomes permanent.</div>}
        {persistent() && !d && tab !== "conversations" && tab !== "system" && <div className="notice">The dashboard query failed. Check that docs/supabase-sam-observability.sql has been applied; the server log has the status code.</div>}

        {tab === "overview" && d && <Overview d={d} days={days} href={href} />}
        {tab === "usage" && d && <Usage d={d} href={href} />}
        {tab === "quality" && d && <Quality d={d} />}
        {tab === "content" && d && <Content d={d} />}
        {tab === "system" && <System includeTest={includeTest} />}
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
    errors: [ratio(c.errors, c.instrumented), ratio(p.errors, p.instrumented)] as const,
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
      Deleted files were last checked {ageH === null ? "never" : `${Math.round(ageH)} hours ago`}. The SharePoint delete
      trigger needs a site-collection-admin connection, so deletions are caught by a reconcile instead:
      run <code>python prototype/sp_reconcile.py --write</code>. Until then SAM may still point people at files that have gone.
    </div>
  );
}

// ------------------------------------------------------------------------------------------- overview

async function Overview({ d, days, href }: { d: Dashboard; days: number; href: (o: Record<string, string | number | null>) => string }) {
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
          foot={<>n = {num(q)} questions</>} />
        <Kpi label="Engaged" value={<RateValue r={r.engaged[0]} />} viz={<Meter pct={r.engaged[0].pct} label="Engaged" />}
          deltaEl={<DeltaText d={rateDelta(r.engaged[0], r.engaged[1])} prevLabel={prevLabel} />}
          foot={<>of {num(c.web_answered)} web answers, opened or rated helpful</>} />
        <Kpi label="Error rate" value={<RateValue r={r.errors[0]} />} viz={<Meter pct={r.errors[0].pct} label="Error rate" />}
          deltaEl={<DeltaText d={rateDelta(r.errors[0], r.errors[1])} goodWhen="down" prevLabel={prevLabel} />}
          foot={(c.instrumented ?? 0) === 0 ? <>Recording {d.instrumented_since ? `since ${fmtDate(d.instrumented_since)}` : "starts with this release"}</> : <>n = {num(c.instrumented)} recorded questions</>} />
        <Kpi label="Response time, p95" value={<b className="kv">{c.p95 == null ? "–" : ms(c.p95)}</b>}
          deltaEl={<DeltaText d={(c.latency_n ?? 0) >= MIN_N && (p.latency_n ?? 0) >= MIN_N ? delta(c.p95 ?? null, p.p95 ?? null, "%") : null} goodWhen="down" prevLabel={prevLabel} />}
          foot={<>p50 {ms(c.p50)} · n = {num(c.latency_n)}</>} />
      </div>

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
        <Section title="Gaps worth filling" sub="What people asked for and did not get, ranked by how many different people asked." aside={<Link className="more" href={href({ tab: "content" })}>All gaps</Link>}>
          {worklist.length === 0 ? <Empty>Nothing went unanswered in this period.</Empty> : (
            <table><thead><tr><th>Wanted</th><th className="r">People</th><th className="r">Asks</th></tr></thead>
              <tbody>{worklist.slice(0, 6).map(g => <tr key={g.key}><td>{[g.vertical, g.type, g.product].filter(x => x && x !== "any").join(" · ") || "Unspecified"}<div className="subline">{g.examples[0]}</div></td><td className="r">{g.users.length}</td><td className="r">{g.asks}</td></tr>)}</tbody></table>
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

function Quality({ d }: { d: Dashboard }) {
  const c = d.summary.cur, r = rates(d);
  const errTotal = d.errors.reduce((n, e) => n + e.n, 0);
  return (
    <>
      <div className="kpis five">
        <Kpi label="Answered" value={<RateValue r={r.answered[0]} />} viz={<Meter pct={r.answered[0].pct} label="Answered" />} foot={<Of r={r.answered[0]} what="questions" />} />
        <Kpi label="Engaged" value={<RateValue r={r.engaged[0]} />} viz={<Meter pct={r.engaged[0].pct} label="Engaged" />} foot={<Of r={r.engaged[0]} what="web answers" />} />
        <Kpi label="Rated helpful" value={<RateValue r={r.helpful[0]} />} viz={<Meter pct={r.helpful[0].pct} label="Rated helpful" />} foot={<Of r={r.helpful[0]} what="ratings" />} />
        <Kpi label="Error rate" value={<RateValue r={r.errors[0]} />} viz={<Meter pct={r.errors[0].pct} label="Error rate" />} foot={<Of r={r.errors[0]} what="recorded questions" />} />
        <Kpi label="Fallback rate" value={<RateValue r={r.fallback[0]} />} viz={<Meter pct={r.fallback[0].pct} label="Fallback rate" />} foot={<Of r={r.fallback[0]} what="model attempts" />} />
      </div>
      {(c.instrumented ?? 0) < (c.questions ?? 0) && (
        <p className="note">
          {num((c.questions ?? 0) - (c.instrumented ?? 0))} of {num(c.questions)} questions in this period were logged before errors were recorded
          {d.instrumented_since ? ` (recording began ${fmtDateY(d.instrumented_since)})` : ""}, so they are left out of the error and fallback rates.
        </p>
      )}

      <Section title="What went wrong" sub="Each question is counted once, under the worst thing that happened while answering it.">
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

// ------------------------------------------------------------------------------------------- content

async function Content({ d }: { d: Dashboard }) {
  const [regRows, carding, pubQueue] = await Promise.all([registry("sales", 5000), cardingQueue(), apiPublishQueue()]);
  await ready();
  const answerable = allAssets();
  const titleOf = new Map<string, string>();
  for (const a of answerable) { if (a.file?.path) titleOf.set(a.file.path, a.title); titleOf.set(a.title, a.title); }
  const linked = answerable.filter(a => assetLink(a)).length;
  const carded = answerable.filter(a => a.inventory_id !== null).length;
  const stale = freshness(regRows);
  const staleTotal = stale.reduce((n, f) => n + f.stale, 0);
  const worklist = gapWorklist(d.gaps);
  return (
    <>
      <PublishQueue q={pubQueue} />
      <div className="kpis four">
        <Kpi label="Tracked in SharePoint" value={<b className="kv">{num(regRows.length)}</b>} foot="registry rows, not deleted" />
        <Kpi label="Answerable" value={<b className="kv">{num(answerable.length)}</b>} foot="after merge and dedupe" />
        <Kpi label="With a working link" value={<b className="kv">{num(linked)}</b>} foot={answerable.length ? `${Math.round((linked / answerable.length) * 100)}% of answerable` : ""} />
        {/* The real coverage number: everything else is findable by name but cannot be reasoned
            about, because no document text has been read. */}
        <Kpi label="Carded" value={<b className="kv">{num(carded)}</b>} foot={answerable.length ? `${Math.round((carded / answerable.length) * 100)}% have document detail` : ""} />
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

      <Section title="Content gaps, ranked by demand" sub="Ranked by how many different people asked, not how many times: one person rephrasing is not demand.">
        {worklist.length === 0 ? <Empty>Nothing has gone unanswered in this period.</Empty> : (
          <table><thead><tr><th>Industry</th><th>Type</th><th>Product</th><th className="r">People</th><th className="r">Asks</th><th>What they typed</th><th>Last asked</th></tr></thead>
            <tbody>{worklist.slice(0, 15).map(g => (
              <tr key={g.key}>
                <td>{g.vertical}</td><td>{g.type}</td><td>{g.product || "–"}</td>
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
                  <td className="nowrap">{r.reason === "uncarded" ? "No card" : r.reason === "changed_since_card" ? "Changed since card" : r.reason === "renamed" ? "Renamed" : r.reason}</td>
                  <td className="nowrap">{fmtDateY(r.modified_at)}</td><td>{r.modified_by ?? "–"}</td>
                </tr>
              ))}</tbody></table>
          )}
        {!carding.missing && carding.total > 20 && <p className="note">Showing 20 of {num(carding.total)}, most recently modified first.</p>}
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

// ------------------------------------------------------------------------------------------- system

async function System({ includeTest }: { includeTest: boolean }) {
  const real = includeTest ? "" : realOnly();
  const [regRows, sync, evidence] = await Promise.all([registry("sales", 5000), syncStatus(), providerEvidence(real || "id=gt.0")]);
  await ready();
  const reg = cacheState(), cards = cardCacheState();
  const flowLast = regRows.map(r => r.last_synced).filter(Boolean).sort().reverse()[0] ?? null;
  const delAgeH = sync?.last_run ? (Date.now() - Date.parse(sync.last_run)) / 3_600_000 : null;
  const provider = openAICompatConfigured() ? "OpenAI-compatible" : process.env.ANTHROPIC_API_KEY ? "Anthropic" : null;
  const model = openAICompatConfigured() ? process.env.OPENAI_COMPAT_MODEL : process.env.ANTHROPIC_API_KEY ? (process.env.CLAUDE_MODEL ?? "claude-sonnet-5") : null;
  const failNewer = evidence.lastFailure && (!evidence.lastAnswer || evidence.lastFailure.created_at > evidence.lastAnswer.created_at);
  type Row = { name: string; state: "ok" | "warn" | "bad" | "off"; value: React.ReactNode; note?: React.ReactNode };
  const rows: Row[] = [
    { name: "Model provider", state: !provider ? "off" : failNewer ? "warn" : "ok",
      value: provider ? `${provider} · ${model}` : "None configured: retrieval only",
      note: <>Last model answer {evidence.lastAnswer ? `${fmtTime(evidence.lastAnswer.created_at)} (${evidence.lastAnswer.model})` : "not recorded yet"}.
        {evidence.lastFailure && <> Last failure {fmtTime(evidence.lastFailure.created_at)}: {evidence.lastFailure.error_kind.replace(/_/g, " ")}.</>}
        {" "}<a href="/api/v1/provider">Live check</a></> },
    { name: "Event store", state: persistent() ? "ok" : "bad", value: persistent() ? "Supabase, sam_events" : "In memory only, lost on restart" },
    { name: "SharePoint flow", state: !flowLast ? "warn" : (Date.now() - Date.parse(flowLast)) / 86_400_000 > 14 ? "warn" : "ok",
      value: flowLast ? `Last write ${fmtTime(flowLast)}` : "No write recorded",
      note: "The Power Automate flow writes a registry row whenever a file is added or changed. Weeks of silence usually means the flow is off, not that nobody changed anything." },
    { name: "Deletion check", state: delAgeH === null || delAgeH > 36 ? "bad" : "ok",
      value: sync?.last_run ? `Last run ${fmtTime(sync.last_run)} (${ago(sync.last_run)})` : "Never run",
      note: <>{sync?.last_result ? <>Result: {sync.last_result}. </> : null}Deletions are caught by <code>prototype/sp_reconcile.py</code>, which is blocked while Microsoft Graph is behind Conditional Access. Stale after 36 hours.</> },
    { name: "Registry cache", state: reg.count ? "ok" : "bad", value: `${num(reg.count)} rows`, note: reg.loadedAt ? `Loaded ${fmtTime(new Date(reg.loadedAt).toISOString())} on this server instance` : "Not loaded" },
    { name: "Card cache", state: cards.count ? "ok" : "bad", value: `${num(cards.count)} cards`, note: cards.loadedAt ? `Loaded ${fmtTime(new Date(cards.loadedAt).toISOString())} on this server instance` : "Not loaded" },
  ];
  const label = { ok: "OK", warn: "Check", bad: "Needs attention", off: "Off" };
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
    </>
  );
}

// ------------------------------------------------------------------------------------------- conversations

async function Conversations({ sp, days, includeTest, href }: { sp: SP; days: number; includeTest: boolean; href: (o: Record<string, string | number | null>) => string }) {
  const f = (["all", "errors", "gaps", "fallbacks"] as const).find(x => x === one(sp.f)) ?? "all";
  const ch = one(sp.ch), who = one(sp.user);
  const limit = Math.min(500, Math.max(25, Number(one(sp.limit)) || 50));
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = await conversations({ from, filter: f as ConvFilter, channel: ch || undefined, user: who || undefined, limit, real: includeTest ? undefined : realOnly() });
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
                <li key={r.id}>
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
