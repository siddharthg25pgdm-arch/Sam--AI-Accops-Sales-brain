/** Server-rendered pieces shared by the /live pages. No client JS. */
import Link from "next/link";
import { FRAMEWORK, field, progress, type Qualification, type Status } from "@/lib/live/framework";
import type { MeetingRow } from "@/lib/live/store";

const IST = "Asia/Kolkata";
export const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: IST });
export const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: IST });
export const shortDay = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST });
export const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: IST });

/** A call marked live for longer than this was abandoned (app closed without End), not still going. */
const STALE_LIVE_MS = 4 * 3_600_000;
export const abandoned = (m: { status: string; started_at: string }) => m.status === "live" && Date.now() - Date.parse(m.started_at) > STALE_LIVE_MS;

export function length(m: { status: string; started_at: string; ended_at: string | null }): string {
  if (!m.ended_at) return m.status === "live" && !abandoned(m) ? "In progress" : "";
  const min = Math.round((Date.parse(m.ended_at) - Date.parse(m.started_at)) / 60_000);
  return min < 1 ? "Under a minute" : `${min} min`;
}

/** 1:05, or 1:02:05 past an hour: an utterance's place in the call. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(mm).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
}

export const STATUS_LABEL: Record<Status, string> = { done: "Answered", partial: "Partly", open: "Open" };

/** The call's qualification at a glance: one tick per field, filled as it is answered. */
export function QualBar({ q }: { q: Qualification | null | undefined }) {
  const p = progress(q);
  return (
    <span className="lv-bar" role="img" aria-label={`Qualification ${p.pct}%: ${p.done} answered, ${p.partial} partly, ${p.open} open`}>
      {FRAMEWORK.map(f => <i key={f.key} data-s={field(q?.[f.key]).status} />)}
    </span>
  );
}

export function Dot({ s, title }: { s: Status; title?: string }) {
  return <span className="lv-dot" data-s={s} role="img" aria-label={STATUS_LABEL[s]} title={title} />;
}

export function CallPills({ m }: { m: Pick<MeetingRow, "status" | "started_at" | "is_test"> }) {
  return (
    <>
      {m.status === "live" && (abandoned(m) ? <span className="pill warn">Not ended</span> : <span className="pill good">Live</span>)}
      {m.is_test && <span className="pill">Test</span>}
    </>
  );
}

/** A list of calls, newest first. `owner` shows whose call it is (the admin view). */
export function CallList({ rows, owner, me }: { rows: MeetingRow[]; owner?: boolean; me: { id: string; admin: boolean } }) {
  return (
    <>
    <div className="lv-calls-head" aria-hidden="true"><span>Call</span><span className="lv-call-side"><span className="q">Qualified</span><span className="s">Score</span></span></div>
    <ol className="lv-calls">
      {rows.map(m => {
        const p = progress(m.qualification), mine = m.owner === me.id || me.admin;
        const who = [m.deal?.contact_name, m.deal?.contact_title].filter(Boolean).join(", ");
        const body = (
          <>
            <div className="lv-call-main">
              <div className="lv-call-title"><b>{m.deal?.company ?? m.title ?? "Untitled call"}</b><CallPills m={m} /></div>
              <p className="subline">
                {[who, m.title && m.deal ? m.title : "", when(m.started_at), length(m), owner ? m.owner : ""].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="lv-call-side">
              <QualBar q={m.qualification} />
              <span className="lv-call-pct tnum">{p.pct}%</span>
              <span className="lv-call-score tnum" title="Deal score">{m.deal_score ?? "–"}</span>
            </div>
          </>
        );
        return <li key={m.id}>{mine ? <Link href={`/live/${m.id}`}>{body}</Link> : <div className="lv-call-row">{body}</div>}</li>;
      })}
    </ol>
    </>
  );
}
