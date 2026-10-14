import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { progress } from "@/lib/live/framework";
import { vendor } from "@/lib/live/insight";
import { listMeetings, teamMeetings, PLATFORM_LABEL, type TeamRow } from "@/lib/live/store";
import { TopBar } from "@/components/TopBar";
import { CallList } from "@/components/LiveBits";

export const dynamic = "force-dynamic";

/** Monday 00:00 India time, as an ISO instant. */
function weekStart(now = Date.now()): string {
  const IST = 5.5 * 3_600_000, d = new Date(now + IST);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)) - IST).toISOString();
}

// ponytail: keyword buckets so "the price is double" and "too expensive" count as one objection; an
// objection no bucket knows is counted by its own first words. A model-assigned category is the upgrade.
const BUCKETS: [RegExp, string][] = [
  [/\b(pric\w*|cost\w*|budget\w*|expensive|licen[cs]\w*|discount\w*|double)\b/i, "Price"],
  [/\b(migrat\w*|downtime|disrupt\w*|cut-?over|transition)\b/i, "Migration risk"],
  [/\b(latenc\w*|slow\w*|performance|bandwidth|lag)\b/i, "Performance"],
  [/\b(train\w*|workflow|used to|adoption|user experience|change)\b/i, "User change"],
  [/\b(integrat\w*|active directory|ldap|compatib\w*)\b/i, "Integration"],
  [/\b(secur\w*|complian\w*|audit\w*|residency|certif\w*)\b/i, "Security & compliance"],
  [/\b(support|partner|presence|references?|track record)\b/i, "Vendor confidence"],
];
const bucket = (s: string) => BUCKETS.find(([re]) => re.test(s))?.[1] ?? s.split(/\s+/).slice(0, 4).join(" ");

/** Most frequent first, each counted once per call. */
function top(rows: TeamRow[], pick: (r: TeamRow) => string[], n = 3): [string, number][] {
  const c = new Map<string, number>();
  for (const r of rows) for (const k of new Set(pick(r).filter(Boolean))) c.set(k, (c.get(k) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
}

export default async function Live({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  // Admins can count test calls too, as on /admin: how the strip is checked before there is real use.
  const withTest = user.admin && (await searchParams).test === "1";
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString(), monday = weekStart();
  const [rows, team] = await Promise.all([listMeetings(user.admin ? null : user.id), teamMeetings(since, withTest)]);
  const ended = team.filter(r => r.status === "ended");
  const week = team.filter(r => r.started_at >= monday).length;
  const avg = ended.length ? Math.round(ended.reduce((n, r) => n + progress(r.qualification).pct, 0) / ended.length) : null;
  const rivals = top(ended, r => (r.competitors ?? []).map(c => vendor(c).trim()));
  const worries = top(ended, r => (r.objections ?? []).map(bucket));
  const platforms = top(team, r => [r.platform ? PLATFORM_LABEL[r.platform] ?? r.platform : "Not recorded"], 4);
  const download = process.env.LIVE_DOWNLOAD_URL?.trim();

  return (
    <>
      <TopBar user={user} current="live" />
      <main className="dash live">
        <header className="dash-head">
          <div>
            <h1>Live calls</h1>
            <p className="dash-sub">What SAM Live heard on each call: how qualified it is, the summary and the follow-up.
              {withTest && <span className="pill warn">Including test calls</span>}</p>
          </div>
          <div className="controls">
            {user.admin && <Link className="switch" role="switch" aria-checked={withTest} href={withTest ? "/live" : "/live?test=1"}><span className="knob" aria-hidden="true" />Include test calls</Link>}
            {download && <a className="btn-accent lv-dl" href={download}><WindowsMark />Download for Windows</a>}
          </div>
        </header>

        <section className="kpis five lv-team" aria-label="Team, last 30 days">
          <div className="kpi">
            <span className="kl">Calls this week</span>
            <b className="kv tnum">{week}</b>
            <span className="kpi-foot">Whole team, since Monday</span>
          </div>
          <div className="kpi">
            <span className="kl">Average qualification</span>
            {avg === null ? <b className="kv muted">–</b> : <b className="kv tnum">{avg}<span className="unit">%</span></b>}
            <span className="kpi-foot">{ended.length ? `Of ${ended.length} finished call${ended.length === 1 ? "" : "s"}` : "No finished calls yet"}</span>
          </div>
          <div className="kpi">
            <span className="kl">Top competitors</span>
            {rivals.length ? <Ranked items={rivals} /> : <b className="kv small muted">None named yet</b>}
          </div>
          <div className="kpi">
            <span className="kl">Top objections</span>
            {worries.length ? <Ranked items={worries} /> : <b className="kv small muted">None raised yet</b>}
          </div>
          <div className="kpi">
            <span className="kl">Calls by platform</span>
            {platforms.length ? <Ranked items={platforms} /> : <b className="kv small muted">No calls yet</b>}
          </div>
        </section>
        <p className="note">Team figures cover the last 30 days{withTest ? " and include test calls." : " and leave out test calls."}</p>

        {rows.length === 0 ? (
          <section className="card calm-empty lv-empty">
            <b>No calls yet.</b>
            <p>Install SAM Live on your Windows laptop and sign in with your SAM login. When a customer call starts, press Start: SAM listens to both
              sides, keeps the qualification checklist current, suggests what to ask next and brings up the right battlecard. When you press End,
              the summary and a follow-up email draft arrive here and in your inbox.</p>
            {download ? <a className="btn-accent lv-dl" href={download}><WindowsMark />Download for Windows</a>
              : <p className="subline">The Windows installer link appears here once it is published.</p>}
          </section>
        ) : (
          <section className="card flush">
            <h2 className="list-h">{user.admin ? "Everyone's calls" : "Your calls"}</h2>
            <CallList rows={rows} owner={user.admin} me={user} />
          </section>
        )}
      </main>
    </>
  );
}

function Ranked({ items }: { items: [string, number][] }) {
  return (
    <ol className="lv-ranked">
      {items.map(([k, n]) => <li key={k}><span>{k}</span><span className="tnum">{n}</span></li>)}
    </ol>
  );
}

function WindowsMark() {
  return <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor"><path d="M0 2.2 6.5 1.3v6.2H0zM7.3 1.2 16 0v7.5H7.3zM0 8.3h6.5v6.3L0 13.7zM7.3 8.3H16V16l-8.7-1.2z" /></svg>;
}
