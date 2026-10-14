import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { FRAMEWORK, field } from "@/lib/live/framework";
import { dealMeetings, getDeal } from "@/lib/live/store";
import { TopBar } from "@/components/TopBar";
import { CallList, Dot, STATUS_LABEL, day, shortDay, time } from "@/components/LiveBits";

export const dynamic = "force-dynamic";

/** One deal across its calls: how each qualification field moved from call to call, and the calls. */
export default async function Deal({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const deal = await getDeal((await params).id);
  if (!deal || (deal.owner !== user.id && !user.admin)) notFound();
  const calls = await dealMeetings(deal.id);
  const latest = calls.at(-1);
  const scored = [...calls].reverse().find(c => c.deal_score != null);
  const sub = [[deal.contact_name, deal.contact_title].filter(Boolean).join(", "), deal.contact_email,
    calls.length ? `${calls.length} call${calls.length === 1 ? "" : "s"} since ${day(calls[0].started_at)}` : "No calls yet"].filter(Boolean);

  return (
    <>
      <TopBar user={user} current="live" />
      <main className="dash live">
        <nav className="lv-crumbs" aria-label="Breadcrumb"><Link href="/live">Live calls</Link><span aria-hidden="true">/</span><span>{deal.company}</span></nav>
        <header className="lv-head">
          <div>
            <h1>{deal.company}</h1>
            <p className="dash-sub">{sub.join(" · ")}{user.admin && deal.owner !== user.id ? ` · ${deal.owner}'s deal` : ""}</p>
          </div>
          {scored && <div className="lv-score" title="From the most recent summarised call"><b className="tnum">{scored.deal_score}</b><span>Deal score</span></div>}
        </header>

        {calls.length > 0 && (
          <section className="card">
            <div className="card-head">
              <div>
                <h2>Qualification across calls</h2>
                <p>Where each field stood at the end of every call, oldest first. Hover a mark for what was said.</p>
              </div>
              <span className="lv-legend" aria-hidden="true"><Dot s="done" />Answered<Dot s="partial" />Partly<Dot s="open" />Open</span>
            </div>
            <div className="scroll-x">
              <table className="lv-matrix">
                <thead>
                  <tr>
                    <th>Field</th>
                    {calls.map(c => {
                      const twice = calls.filter(x => shortDay(x.started_at) === shortDay(c.started_at)).length > 1;
                      return <th key={c.id} className="c"><Link href={`/live/${c.id}`} title={c.title ?? undefined}>{shortDay(c.started_at)}{twice && <small>{time(c.started_at)}</small>}</Link></th>;
                    })}
                    <th>Latest</th>
                  </tr>
                </thead>
                <tbody>
                  {FRAMEWORK.map(f => {
                    const now = field(latest?.qualification?.[f.key]);
                    return (
                      <tr key={f.key}>
                        <td className="nowrap">{f.label}</td>
                        {calls.map(c => { const v = field(c.qualification?.[f.key]); return <td key={c.id} className="c"><Dot s={v.status} title={`${STATUS_LABEL[v.status]}${v.value ? `: ${v.value}` : ""}`} /></td>; })}
                        <td className="lv-latest">{now.value || <span className="lv-none">{f.hint}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="card flush">
          <h2 className="list-h">Calls</h2>
          {calls.length ? <CallList rows={[...calls].reverse()} owner={user.admin} me={user} />
            : <p className="empty-inline">No calls on this deal yet. Start one from SAM Live on Windows and pick {deal.company}.</p>}
        </section>
      </main>
    </>
  );
}
