import { resolveCaller, unauthorized, type Caller } from "../apiauth";
import { getMeeting, type Meeting } from "./store";

/** The caller and their meeting, or the response to send instead: 401 without a login, 404 unless the
 *  meeting is theirs (an admin sees every meeting). 404 rather than 403, so ids cannot be probed. */
export async function ownMeeting(req: Request, params: Promise<{ id: string }>): Promise<{ who: Caller; m: Meeting } | Response> {
  const who = await resolveCaller(req);
  if (!who) return unauthorized();
  const m = await getMeeting((await params).id);
  return m && (m.owner === who.id || who.admin) ? { who, m } : Response.json({ error: "No such call." }, { status: 404 });
}
