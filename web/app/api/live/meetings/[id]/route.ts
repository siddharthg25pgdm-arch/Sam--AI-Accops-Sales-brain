import { ownMeeting } from "@/lib/live/access";
import { PUBLIC_FRAMEWORK } from "@/lib/live/framework";
import { attachDeal, deleteMeeting, getDeal, patchMeeting, segments, touchDeal, type Deal } from "@/lib/live/store";

/** GET /api/live/meetings/:id -> {meeting:{...every column, deal}, segments:[{id, channel, t_ms, duration_ms, text}], framework}
 *  The whole call: for the dashboard, and for the desktop app reconnecting to a call in progress. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const got = await ownMeeting(req, params);
  if (got instanceof Response) return got;
  const { m } = got;
  const [deal, segs] = await Promise.all([m.deal_id ? getDeal(m.deal_id) : null, segments(m.id)]);
  return Response.json({ meeting: { ...m, deal }, segments: segs, framework: PUBLIC_FRAMEWORK });
}

/** DELETE /api/live/meetings/:id -> {deleted: id, deal_deleted: boolean}
 *  The call and its transcript; its deal too when no other call is on it. Owner or admin. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const got = await ownMeeting(req, params);
  if (got instanceof Response) return got;
  const deal_deleted = await deleteMeeting(got.m);
  return Response.json({ deleted: got.m.id, deal_deleted });
}

/** PATCH /api/live/meetings/:id  {company?, contact_name?, contact_title?, contact_email?, title?} -> {meeting, deal}
 *  Who the call was with, set after the fact (a call the desktop app started on its own has no deal). A
 *  company puts the call on the meeting owner's deal of that name (any case), created when there is none;
 *  a deal the call leaves is deleted if no other call is on it. Contact fields alone update the call's
 *  current deal (400 when it has none). Live or ended calls; owner or admin. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const got = await ownMeeting(req, params);
  if (got instanceof Response) return got;
  let m = got.m;
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return Response.json({ error: "Send JSON: {company?, contact_name?, contact_title?, contact_email?, title?}." }, { status: 400 });
  const company = typeof b.company === "string" ? b.company.trim() : "";
  const contact = { contact_name: b.contact_name, contact_title: b.contact_title, contact_email: b.contact_email };
  const hasContact = Object.values(contact).some(v => typeof v === "string" && v.trim());
  const hasTitle = typeof b.title === "string";
  if (!company && !hasContact && !hasTitle) return Response.json({ error: "Nothing to change: send company, a contact field or title." }, { status: 400 });
  let deal: Deal | null = m.deal_id ? await getDeal(m.deal_id) : null;
  if (company) ({ meeting: m, deal } = await attachDeal(m, company, contact));
  else if (hasContact) {
    if (!deal) return Response.json({ error: "Set the company first: the contact belongs to a deal." }, { status: 400 });
    deal = await touchDeal(deal, contact);
  }
  if (hasTitle) m = (await patchMeeting(m.id, { title: b.title.trim().slice(0, 200) || null })) ?? m;
  return Response.json({ meeting: m, deal });
}
