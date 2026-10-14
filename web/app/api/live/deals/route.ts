import { resolveCaller, unauthorized } from "@/lib/apiauth";
import { myDeals } from "@/lib/live/store";

/** GET /api/live/deals?q= -> {deals:[{id, company, contact_name, contact_email, last_meeting_at}]}
 *  The caller's own deals, most recently touched first: the desktop's company autocomplete. */
export async function GET(req: Request) {
  const who = await resolveCaller(req);
  if (!who) return unauthorized();
  return Response.json({ deals: await myDeals(who.id, new URL(req.url).searchParams.get("q") ?? "") });
}
