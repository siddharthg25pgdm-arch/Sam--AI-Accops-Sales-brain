import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { FRAMEWORK, field, progress, type Qualification } from "@/lib/live/framework";
import { vendor } from "@/lib/live/insight";
import { getDeal, getMeeting, segments, type Card, type Meeting, type Segment, type Summary } from "@/lib/live/store";
import { TopBar } from "@/components/TopBar";
import { CallPills, Dot, QualBar, STATUS_LABEL, abandoned, clock, day, length, time } from "@/components/LiveBits";
import { CopyButton, DeleteCall, EndCall } from "@/components/LiveActions";

export const dynamic = "force-dynamic";

/** One call: summary, follow-up, qualification with the customer's own words, the collateral SAM brought
 *  up, and the transcript. A call left live (the app closed before End) can be summarised from here. */
export default async function Call({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const m = await getMeeting((await params).id);
  if (!m || (m.owner !== user.id && !user.admin)) notFound();
  const [deal, segs] = await Promise.all([m.deal_id ? getDeal(m.deal_id) : null, segments(m.id)]);
  const s = m.summary;
  const who = [deal?.contact_name, deal?.contact_title].filter(Boolean).join(", ");

  return (
    <>
      <TopBar user={user} current="live" />
      <main className="dash live">
        <nav className="lv-crumbs" aria-label="Breadcrumb">
          <Link href="/live">Live calls</Link>
          {deal && <><span aria-hidden="true">/</span><Link href={`/live/deals/${deal.id}`}>{deal.company}</Link></>}
        </nav>
        <header className="lv-head">
          <div>
            <h1>{deal?.company ?? m.title ?? "Untitled call"}</h1>
            <p className="dash-sub">
              {[who, `${day(m.started_at)}, ${time(m.started_at)}`, length(m), user.admin && m.owner !== user.id ? `by ${m.owner}` : ""].filter(Boolean).join(" · ")}
              <CallPills m={m} />
            </p>
            {m.title && deal && <p className="lv-title">{m.title}</p>}
          </div>
          {s && <div className="lv-score" title="How qualified the deal is and how likely it is to progress, judged from this call"><b className="tnum">{s.deal_score}</b><span>Deal score</span></div>}
        </header>

        {m.status === "live" && (
          <div className="calm lv-live">
            <p>{abandoned(m) ? "This call was never ended: the app probably closed before End was pressed." : "This call is still in progress."} The transcript so far is saved, and SAM can write the summary and follow-up from it.</p>
            <EndCall id={m.id} />
          </div>
        )}

        <div className="lv-cols">
          <div className="lv-main">
            {s ? <SummaryCard s={s} /> : (
              <section className="card">
                <h2>Summary</h2>
                <p className="empty-inline">Written when the call ends, together with the follow-up email.</p>
              </section>
            )}
            {s?.follow_up_email.body && <FollowUp s={s} to={deal?.contact_name ?? null} />}
          </div>
          <aside className="lv-side">
            <QualCard q={m.qualification} />
            <Cards cards={m.battlecards ?? []} />
            <After m={m} />
            <section className="card lv-delete">
              <h2>Delete</h2>
              <p className="lv-note">Removes the call and its transcript{deal ? `, and the ${deal.company} deal if it has no other calls` : ""}.</p>
              <DeleteCall id={m.id} />
            </section>
          </aside>
          <Transcript segs={segs} live={m.status === "live"} />
        </div>
      </main>
    </>
  );
}

function SummaryCard({ s }: { s: Summary }) {
  const lists: [string, string[], string][] = [["Pains", s.pains, "None stated."], ["Objections", s.objections, "None raised."],
    ["Next steps", s.next_steps, "None agreed."], ["Risks", s.risks, "None seen."]];
  return (
    <section className="card">
      <h2>Summary</h2>
      <p className="lv-overview">{s.overview}</p>
      {s.competitors.length > 0 && <p className="lv-chips"><span>Competitors</span>{[...new Set(s.competitors.map(vendor))].map(c => <span key={c} className="pill">{c}</span>)}</p>}
      <div className="lv-facts">
        {lists.map(([title, items, none]) => (
          <div key={title}>
            <h3>{title}</h3>
            {items.length ? <ul>{items.map(x => <li key={x}>{x}</li>)}</ul> : <p className="lv-none">{none}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

function FollowUp({ s, to }: { s: Summary; to: string | null }) {
  const { subject, body } = s.follow_up_email;
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Follow-up email</h2>
          <p>A draft from you{to ? ` to ${to}` : ""}. Read it through, then send it from Outlook.</p>
        </div>
        <div className="lv-copy">
          {subject && <CopyButton text={subject} label="Copy subject" />}
          <CopyButton text={body} label="Copy email" />
        </div>
      </div>
      <div className="lv-mail">
        {subject && <p className="lv-mail-subject"><span>Subject</span>{subject}</p>}
        <div className="lv-mail-body">{body}</div>
      </div>
    </section>
  );
}

const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function QualCard({ q }: { q: Qualification }) {
  const p = progress(q);
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Qualification</h2>
          <p>{p.done} of {FRAMEWORK.length} answered{p.partial ? `, ${p.partial} partly` : ""}</p>
        </div>
        <QualBar q={q} />
      </div>
      <ol className="lv-fields">
        {FRAMEWORK.map(f => {
          const v = field(q?.[f.key]);
          // A value that is the quote itself (models do that) is shown once.
          const quote = v.evidence && words(v.evidence) !== words(v.value) ? v.evidence : "";
          return (
            <li key={f.key} data-s={v.status}>
              <div className="lv-f-top"><Dot s={v.status} /><b>{f.label}</b><span className="lv-f-status">{STATUS_LABEL[v.status]}</span></div>
              {v.value ? <p className="lv-val">{v.value}</p> : <p className="lv-hint">{f.hint}</p>}
              {quote && <blockquote className="lv-quote">{quote}</blockquote>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Cards({ cards }: { cards: Card[] }) {
  return (
    <section className="card">
      <h2>Shown during the call</h2>
      {cards.length ? (
        <ul className="lv-cards">
          {cards.map(c => (
            <li key={`${c.trigger}-${c.title}`}>
              <span className="lv-trigger">{c.trigger}</span>
              {c.link ? <a href={c.link} target="_blank" rel="noreferrer" title={c.title}>{c.title}</a> : <b title={c.title}>{c.title}</b>}
              {c.brief && <p>{c.brief}</p>}
              <span className={`pill ${c.shareable ? "good" : ""}`}>{c.shareable ? "Can be sent to the customer" : "Internal only"}</span>
            </li>
          ))}
        </ul>
      ) : <p className="empty-inline">Nothing came up. Collateral appears here when the customer names a competitor, raises an objection or asks something SAM has material for.</p>}
    </section>
  );
}

function After({ m }: { m: Meeting }) {
  const f = m.flow_status;
  const [state, head, note] = !f ? ["off", m.status === "live" ? "Runs when the call ends" : "Not run", ""]
    : f === "sent" ? ["ok", "Emailed and logged", "The summary and follow-up are in your inbox, and the call is a row in SAM Live Calls."]
    : f === "not_configured" ? ["off", "Not set up yet", "Once the Power Automate flow is connected, the summary is emailed to you and the call logged to a sheet."]
    : ["bad", "Did not go through", `${f.replace(/^failed:\s*/, "")}. Everything is still here.`];
  return (
    <section className="card lv-after">
      <h2>After the call</h2>
      <p className={`status ${state}`}><i aria-hidden="true" />{head}</p>
      {note && <p className="lv-note">{note}</p>}
      {m.summary?.model && <p className="lv-note">Summary written by {m.summary.model.replace(":", " · ")}</p>}
    </section>
  );
}

function Transcript({ segs, live }: { segs: Segment[]; live: boolean }) {
  return (
    <section className="card lv-tx">
      <div className="card-head">
        <div>
          <h2>Transcript</h2>
          <p>{segs.length ? `${segs.length} utterances · Accops on the right` : live ? "Lines appear as the call goes on." : "Nothing was transcribed."}</p>
        </div>
      </div>
      {segs.length > 0 && (
        <ol className="lv-thread">
          {segs.map((x, i) => {
            const first = i === 0 || segs[i - 1].channel !== x.channel;
            return (
              <li key={x.id} data-who={x.channel} data-first={first ? "" : undefined}>
                {first && <span className="lv-who">{x.channel === "rep" ? "Accops" : "Customer"}</span>}
                <p><span>{x.text}</span><time className="tnum">{clock(x.t_ms)}</time></p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
