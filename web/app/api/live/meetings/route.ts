import { resolveCaller, unauthorized } from "@/lib/apiauth";
import { merge, PUBLIC_FRAMEWORK } from "@/lib/live/framework";
import { createMeeting, dealFor, getDeal, lastQualification, platformOf, touchDeal, type Deal } from "@/lib/live/store";

/** POST /api/live/meetings  {deal_id} | {company, contact_name?, contact_email?, contact_title?} | {}, title?, platform?, auto_started?
 *  -> {meeting:{id, deal_id, title, started_at, qualification, platform, auto_started}, framework:[{key, label, hint}]}
 *  A company name lands on the rep's existing deal of that name when there is one. Neither deal_id nor
 *  company (a call the desktop app started on its own): no deal yet; PATCH or End attaches one. The
 *  qualification starts from the deal's previous meeting, so a second call picks up where the first left off.
 *  platform: phone-link | teams | zoom | meet | whatsapp | webex | slack | browser | manual, anything else null. */
export async function POST(req: Request) {
  const who = await resolveCaller(req);
  if (!who) return unauthorized();
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return Response.json({ error: "Send JSON: {deal_id}, {company, contact_name?, contact_email?, contact_title?} or {}." }, { status: 400 });
  const contact = { contact_name: b.contact_name, contact_email: b.contact_email, contact_title: b.contact_title };
  const company = typeof b.company === "string" ? b.company.trim() : "";
  let deal: Deal | null = null;
  if (b.deal_id) {
    const d = await getDeal(String(b.deal_id));
    if (!d || (d.owner !== who.id && !who.admin)) return Response.json({ error: "No such deal." }, { status: 404 });
    deal = await touchDeal(d, contact);
  } else if (company) {
    deal = await dealFor(who.id, company, contact);
  }
  const title = typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 200) : null;
  const m = await createMeeting({ owner: who.id, deal_id: deal?.id ?? null, title, platform: platformOf(b.platform), auto_started: b.auto_started === true,
    qualification: merge(deal ? await lastQualification(deal.id) : null, null) });
  return Response.json({ meeting: { id: m.id, deal_id: m.deal_id, title: m.title, started_at: m.started_at, qualification: m.qualification,
    platform: m.platform, auto_started: m.auto_started }, framework: PUBLIC_FRAMEWORK });
}
