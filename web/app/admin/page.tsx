import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { recentEvents, persistent } from "@/lib/events";
import { TopBar } from "@/components/TopBar";

export const dynamic = "force-dynamic";

export default async function Admin() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!user.admin) redirect("/");
  const events = await recentEvents(2000);
  const queries = events.filter(e => e.kind === "query");
  const feedback = events.filter(e => e.kind === "feedback");
  const opens = events.filter(e => e.kind === "catalogue_open");
  const gaps = events.filter(e => e.kind === "gap");
  const users = new Set(events.map(e => e.user_id));
  const zero = queries.filter(q => q.intent === "gap" || (q.result_count ?? 0) === 0).length;
  const helpful = feedback.filter(f => f.feedback === "helpful").length;
  const resolved = queries.length ? Math.round(((queries.length - zero) / queries.length) * 100) : null;

  // top queries, grouped loosely by lowercase text
  const top = new Map<string, number>();
  for (const q of queries) { const k = (q.query ?? "").toLowerCase().trim(); if (k) top.set(k, (top.get(k) ?? 0) + 1); }
  const topList = [...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const topAssets = new Map<string, number>();
  for (const e of [...opens, ...queries]) for (const p of (e.kind === "catalogue_open" ? [e.asset_path] : (e.result_ids ?? []))) if (p) topAssets.set(String(p), (topAssets.get(String(p)) ?? 0) + 1);
  const topAssetList = [...topAssets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  // last 14 days of queries
  const days: { label: string; n: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i); const key = d.toISOString().slice(0, 10);
    days.push({ label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }).replace(" ", " "), n: queries.filter(q => (q.created_at ?? "").slice(0, 10) === key).length });
  }
  const max = Math.max(1, ...days.map(d => d.n));
  const fmt = (iso?: string) => iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <>
      <TopBar user={user} current="admin" />
      <main className="admin">
        <h1>Dashboard</h1>
        <p className="sub">Who is asking, what they ask, and whether SAM answered.</p>
        {!persistent() && <div className="notice">Events are held in memory only. Add SUPABASE_URL and SUPABASE_SERVICE_KEY, run docs/supabase-sam-events.sql, and this becomes permanent.</div>}

        <div className="stats">
          <div className="stat"><small>People who used SAM</small><b className="tnum">{users.size}</b></div>
          <div className="stat"><small>Questions asked</small><b className="tnum">{queries.length}</b></div>
          <div className="stat"><small>Answered with an exact match</small><b className="tnum">{resolved === null ? "–" : `${resolved}%`}</b></div>
          <div className="stat"><small>Rated helpful</small><b className="tnum">{feedback.length ? `${helpful}/${feedback.length}` : "–"}</b></div>
          <div className="stat"><small>Catalogue opens</small><b className="tnum">{opens.length}</b></div>
          <div className="stat"><small>Content gaps logged</small><b className="tnum">{gaps.length}</b></div>
        </div>

        <div className="panel">
          <h2>Questions per day, last two weeks</h2>
          <div className="bars" style={{ marginBottom: 22 }}>{days.map(d => <div key={d.label} style={{ height: `${(d.n / max) * 100}%` }} title={`${d.label}: ${d.n}`}><span>{d.label}</span></div>)}</div>
        </div>

        <div className="two">
          <div className="panel">
            <h2>Top questions</h2>
            {topList.length === 0 ? <p style={{ color: "var(--ink-3)" }}>No questions yet.</p> : (
              <table><thead><tr><th>Question</th><th className="tnum">Asked</th></tr></thead>
                <tbody>{topList.map(([k, n]) => <tr key={k}><td>{k}</td><td className="tnum">{n}</td></tr>)}</tbody></table>
            )}
          </div>
          <div className="panel">
            <h2>Most surfaced assets</h2>
            {topAssetList.length === 0 ? <p style={{ color: "var(--ink-3)" }}>Nothing surfaced yet.</p> : (
              <table><thead><tr><th>Asset</th><th className="tnum">Times</th></tr></thead>
                <tbody>{topAssetList.map(([k, n]) => <tr key={k}><td>{k.split("/").pop()}</td><td className="tnum">{n}</td></tr>)}</tbody></table>
            )}
          </div>
        </div>

        <div className="two">
          <div className="panel">
            <h2>Unanswered, in the asker&apos;s words</h2>
            {gaps.length === 0 ? <p style={{ color: "var(--ink-3)" }}>Every question so far found at least one asset.</p> : (
              <table><thead><tr><th>Question</th><th>Who</th><th>When</th></tr></thead>
                <tbody>{gaps.slice(0, 15).map(g => <tr key={g.id}><td>{g.query}</td><td>{g.user_id}</td><td>{fmt(g.created_at)}</td></tr>)}</tbody></table>
            )}
          </div>
          <div className="panel">
            <h2>Feedback</h2>
            {feedback.length === 0 ? <p style={{ color: "var(--ink-3)" }}>No ratings yet.</p> : (
              <table><thead><tr><th>Rating</th><th>On question</th><th>Who</th><th>When</th></tr></thead>
                <tbody>{feedback.slice(0, 15).map(f => {
                  const ref = queries.find(q => q.id === f.ref_event_id);
                  return <tr key={f.id}><td>{f.feedback === "helpful" ? "Helpful" : f.feedback === "wrong_asset" ? "Wrong asset" : "Doesn't exist"}</td><td>{ref?.query ?? f.query ?? ""}</td><td>{f.user_id}</td><td>{fmt(f.created_at)}</td></tr>;
                })}</tbody></table>
            )}
          </div>
        </div>

        <div className="panel">
          <h2>Recent questions</h2>
          {queries.length === 0 ? <p style={{ color: "var(--ink-3)" }}>None yet.</p> : (
            <table><thead><tr><th>When</th><th>Who</th><th>Question</th><th>Intent</th><th className="tnum">Results</th><th>Runtime</th><th className="tnum">ms</th></tr></thead>
              <tbody>{queries.slice(0, 30).map(q => <tr key={q.id}><td>{fmt(q.created_at)}</td><td>{q.user_id}</td><td>{q.query}</td><td>{q.intent}</td><td className="tnum">{q.result_count}</td><td>{q.runtime}</td><td className="tnum">{q.latency_ms}</td></tr>)}</tbody></table>
          )}
        </div>
      </main>
    </>
  );
}
