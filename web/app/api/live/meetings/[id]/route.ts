import { ownMeeting } from "@/lib/live/access";
import { PUBLIC_FRAMEWORK } from "@/lib/live/framework";
import { getDeal, segments } from "@/lib/live/store";

/** GET /api/live/meetings/:id -> {meeting:{...every column, deal}, segments:[{id, channel, t_ms, duration_ms, text}], framework}
 *  The whole call: for the dashboard, and for the desktop app reconnecting to a call in progress. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const got = await ownMeeting(req, params);
  if (got instanceof Response) return got;
  const { m } = got;
  const [deal, segs] = await Promise.all([m.deal_id ? getDeal(m.deal_id) : null, segments(m.id)]);
  return Response.json({ meeting: { ...m, deal }, segments: segs, framework: PUBLIC_FRAMEWORK });
}
