import { ownMeeting } from "@/lib/live/access";
import { flowPayload, sendFlow } from "@/lib/live/flow";
import { NoModel } from "@/lib/live/llm";
import { getDeal, getMeeting, patchMeeting, segments } from "@/lib/live/store";
import { summarise } from "@/lib/live/summary";
import { redact } from "@/lib/redact";

// Summary models (OpenAI, then Groq 120b, then 20b) up to ~42 s, then the Power Automate flow up to 10 s.
export const maxDuration = 60;

/** POST /api/live/meetings/:id/end -> {summary, flow_status}
 *  Summarises first and flips the meeting to ended in one conditional write, so a retry or a second End
 *  (desktop and dashboard) gets the first summary back and the flow runs once. If summarising fails the
 *  call stays live and End can be pressed again; the transcript is already saved. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const t0 = Date.now();
  const got = await ownMeeting(req, params);
  if (got instanceof Response) return got;
  const { m } = got;
  if (m.summary) return Response.json({ summary: m.summary, flow_status: m.flow_status });
  const [deal, segs] = await Promise.all([m.deal_id ? getDeal(m.deal_id) : null, segments(m.id)]);
  let summary;
  try {
    summary = await summarise(m, deal, segs, t0 + 42_000);
  } catch (e) {
    console.error("live summary failed", redact(e));
    if (e instanceof NoModel && e.unconfigured) return Response.json({ error: "No summary model is configured on the server." }, { status: 503 });
    return Response.json({ error: "Could not summarise the call just now. The transcript is saved; press End again in a minute." }, { status: 502 });
  }
  const ended = await patchMeeting(m.id, { status: "ended", ended_at: new Date(t0).toISOString(), summary, qualification: summary.qualification }, "status=eq.live");
  if (!ended) {
    const now = await getMeeting(m.id);
    return now?.summary ? Response.json({ summary: now.summary, flow_status: now.flow_status })
      : Response.json({ error: "This call is already being summarised." }, { status: 409 });
  }
  const flow_status = await sendFlow(flowPayload(ended, deal, summary, new URL(req.url).origin));
  await patchMeeting(m.id, { flow_status });
  return Response.json({ summary, flow_status });
}
