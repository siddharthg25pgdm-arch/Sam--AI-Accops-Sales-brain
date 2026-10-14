import { ownMeeting } from "@/lib/live/access";
import { nextAssist, searchAssist } from "@/lib/live/assist";
import { redact } from "@/lib/redact";

// next: one model call, ~3 s (at most ~11 s with the fallback); search: collateral in process, plus the web up to ~23 s.
export const maxDuration = 30;

/** POST /api/live/meetings/:id/assist  {question?}
 *  -> {mode:"next", say:{line, intent, why}, cards, web:null, model} without a question;
 *     {mode:"search", cards, web:{answer, sources:[{title, url}], unverified:true} | null, model} with one.
 *  cards: [{trigger, title, brief, link, shareable}]. 409 once the call has ended. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const got = await ownMeeting(req, params);
  if (got instanceof Response) return got;
  const { m } = got;
  if (m.status !== "live") return Response.json({ error: "This call has ended." }, { status: 409 });
  const b = await req.json().catch(() => ({}));
  const question = typeof b?.question === "string" ? b.question.trim().replace(/\s+/g, " ").slice(0, 300) : "";
  try {
    return Response.json(question ? await searchAssist(question) : await nextAssist(m));
  } catch (e) {
    console.error("live assist failed", redact(e));
    return Response.json({ error: "SAM could not help just now. Try again." }, { status: 502 });
  }
}
