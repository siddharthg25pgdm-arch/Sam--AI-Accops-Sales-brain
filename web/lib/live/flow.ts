/** After a call: one POST to the Power Automate HTTP-trigger flow (LIVE_FLOW_URL), which emails the rep the
 *  summary and follow-up draft and adds a row to the LiveCalls table in "SAM Live Calls.xlsx". The URL
 *  carries a signature (sig=...), so it is never logged and never part of a stored status. */
import { FRAMEWORK, field } from "./framework";
import type { Deal, Meeting, Summary } from "./store";

export type FlowPayload = {
  meeting_id: string; rep: string; rep_email: string | null; company: string; contact_name: string; contact_email: string; contact_title: string;
  started_at: string; ended_at: string; duration_min: number; deal_score: number; overview: string; next_steps: string;
  follow_up_subject: string; follow_up_body: string; qualification_text: string; dashboard_url: string;
};

/** LIVE_REP_EMAILS="siddharth:siddharth.gupta@accops.com,rahul:rahul@accops.com"; else LIVE_FALLBACK_EMAIL. */
export function repEmail(id: string): string | null {
  for (const entry of (process.env.LIVE_REP_EMAILS ?? "").split(",")) {
    const i = entry.indexOf(":");
    if (i > 0 && entry.slice(0, i).trim().toLowerCase() === id.toLowerCase()) return entry.slice(i + 1).trim() || null;
  }
  return process.env.LIVE_FALLBACK_EMAIL?.trim() || null;
}

/** Plain-text lines the flow can drop straight into an email or a cell: "Budget (partial): tied to the renewal". */
export function qualificationText(s: Summary): string {
  return FRAMEWORK.map(f => {
    const q = field(s.qualification?.[f.key]);
    return `${f.label} (${q.status})${q.value ? `: ${q.value}` : ""}`;
  }).join("\n");
}

export function flowPayload(m: Meeting, deal: Deal | null, s: Summary, origin: string): FlowPayload {
  const ended = m.ended_at ?? new Date().toISOString();
  return {
    meeting_id: m.id, rep: m.owner, rep_email: repEmail(m.owner),
    company: deal?.company ?? "", contact_name: deal?.contact_name ?? "", contact_email: deal?.contact_email ?? "", contact_title: deal?.contact_title ?? "",
    started_at: m.started_at, ended_at: ended, duration_min: Math.max(0, Math.round((Date.parse(ended) - Date.parse(m.started_at)) / 60_000)),
    deal_score: s.deal_score, overview: s.overview, next_steps: s.next_steps.map(x => `- ${x}`).join("\n"),
    follow_up_subject: s.follow_up_email.subject, follow_up_body: s.follow_up_email.body, qualification_text: qualificationText(s),
    dashboard_url: `${origin.replace(/\/$/, "")}/live/${m.id}`,
  };
}

/** The status stored on the meeting: sent | failed: <short reason> | not_configured. Never throws. */
export async function sendFlow(p: FlowPayload): Promise<string> {
  const url = process.env.LIVE_FLOW_URL?.trim();
  if (!url) return "not_configured";
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p), signal: AbortSignal.timeout(10_000) });
    return r.ok ? "sent" : `failed: HTTP ${r.status}`;
  } catch (e) {
    // The reason is chosen here, not copied from the error: fetch errors can quote the URL.
    return `failed: ${(e as Error)?.name === "TimeoutError" ? "timed out after 10 s" : "could not reach the flow"}`;
  }
}
