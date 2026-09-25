import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { myRequests, markSeen, STATUS_LABEL, type MyRequest } from "@/lib/requests";
import { TopBar } from "@/components/TopBar";

export const dynamic = "force-dynamic";

const IST = "Asia/Kolkata";
const fmt = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST }) : "";
const STEPS = ["open", "planned", "in_progress", "done"] as const;

/** A rep's own requests: what they asked marketing for, where each one is, and the link once it exists. */
export default async function Requests() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const mine = (await myRequests(user.id)).filter(m => m.request);
  // Seeing it here counts as seeing the delivery notice.
  await markSeen(user.id, mine.filter(m => m.request.status === "done" && !m.seen_at).map(m => m.id));
  const active = mine.filter(m => m.request.status !== "done" && m.request.status !== "declined");
  const closed = mine.filter(m => m.request.status === "done" || m.request.status === "declined");
  return (
    <>
      <TopBar user={user} current="requests" />
      <main className="dash mine">
        <header className="dash-head">
          <div>
            <h1>Your requests</h1>
            <p className="dash-sub">What you have asked marketing to create. You will see the link here the moment it is ready.</p>
          </div>
        </header>
        {mine.length === 0 ? (
          <section className="card calm-empty">
            <b>Nothing requested yet.</b>
            <p>When SAM cannot find what you need, choose <i>Ask marketing to create this</i> under the answer. It lands here, and marketing sees how many people want it.</p>
            <Link href="/">Ask SAM</Link>
          </section>
        ) : (
          <>
            {active.length > 0 && <List title="In progress" items={active} />}
            {closed.length > 0 && <List title="Finished" items={closed} />}
          </>
        )}
      </main>
    </>
  );
}

function List({ title, items }: { title: string; items: MyRequest[] }) {
  return (
    <section className="card flush">
      <h2 className="list-h">{title}</h2>
      <ol className="myreqs">{items.map(m => <Item key={m.id} m={m} />)}</ol>
    </section>
  );
}

function Item({ m }: { m: MyRequest }) {
  const r = m.request, others = Math.max(0, (r.votes?.[0]?.count ?? 1) - 1);
  const at = STEPS.indexOf(r.status as (typeof STEPS)[number]);
  return (
    <li>
      <div className="mr-top">
        <b className="mr-title">{r.title}</b>
        <span className={`pill ${r.status === "done" ? "good" : r.status === "declined" ? "bad" : ""}`}>{STATUS_LABEL[r.status]}</span>
      </div>
      {r.status !== "declined" && (
        <ol className="steps" aria-label={`Status: ${STATUS_LABEL[r.status]}`}>
          {STEPS.map((s, i) => <li key={s} data-on={i <= at ? "" : undefined} aria-current={i === at ? "step" : undefined}>{STATUS_LABEL[s]}</li>)}
        </ol>
      )}
      <p className="subline">
        Asked {fmt(m.created_at)}{others ? ` · ${others} other${others === 1 ? "" : "s"} asked too` : ""}{r.due_date && r.status !== "done" ? ` · expected by ${fmt(r.due_date)}` : ""}
      </p>
      {m.note && <p className="subline">Your note: {m.note}</p>}
      {r.status === "declined" && r.decline_reason && <p className="mr-reason">Marketing: {r.decline_reason}</p>}
      {r.status === "done" && r.delivered_url && (
        <a className="mr-open" href={r.delivered_url} target="_blank" rel="noreferrer">Open {r.delivered_title ?? r.title}</a>
      )}
    </li>
  );
}
