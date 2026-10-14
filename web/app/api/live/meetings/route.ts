import { resolveCaller, unauthorized } from "@/lib/apiauth";
import { merge, PUBLIC_FRAMEWORK } from "@/lib/live/framework";
import { createMeeting, dealFor, getDeal, lastQualification, touchDeal } from "@/lib/live/store";

/** POST /api/live/meetings  {deal_id} | {company, contact_name?, contact_email?, contact_title?}, title?
 *  -> {meeting:{id, deal_id, title, started_at, qualification}, framework:[{key, label, hint}]}
 *  A company name lands on the rep's existing deal of that name when there is one. The qualification
 *  starts from the deal's previous meeting, so a second call picks up where the first left off. */
export async function POST(req: Request) {
  const who = await resolveCaller(req);
  if (!who) return unauthorized();
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return Response.json({ error: "Send JSON: {deal_id} or {company, contact_name?, contact_email?, contact_title?}." }, { status: 400 });
  const contact = { contact_name: b.contact_name, contact_email: b.contact_email, contact_title: b.contact_title };
  let deal;
  if (b.deal_id) {
    const d = await getDeal(String(b.deal_id));
    if (!d || (d.owner !== who.id && !who.admin)) return Response.json({ error: "No such deal." }, { status: 404 });
    deal = await touchDeal(d, contact);
  } else {
    const company = typeof b.company === "string" ? b.company.trim() : "";
    if (!company) return Response.json({ error: "Send deal_id, or the company name." }, { status: 400 });
    deal = await dealFor(who.id, company, contact);
  }
  const title = typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 200) : null;
  const m = await createMeeting({ owner: who.id, deal_id: deal.id, title, qualification: merge(await lastQualification(deal.id), null) });
  return Response.json({ meeting: { id: m.id, deal_id: m.deal_id, title: m.title, started_at: m.started_at, qualification: m.qualification }, framework: PUBLIC_FRAMEWORK });
}
