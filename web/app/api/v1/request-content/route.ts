import { resolveCaller, unauthorized } from "@/lib/apiauth";
import { fileRequest } from "@/lib/requests";

/** POST /api/v1/request-content  { title?, question?, note?, event_id? }  (title or question required)
 *  Ask marketing to create something the library does not have. Repeat asks for the same thing merge
 *  onto one request; the response carries demand (distinct reps) and a sentence to show the rep.
 *  POST-only, like request-publish: a GET that files a request is triggerable by a link preview. */
export async function POST(req: Request) {
  const who = await resolveCaller(req); if (!who) return unauthorized();
  const b = await req.json().catch(() => ({}));
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  if (!str(b.title)?.trim() && !str(b.question)?.trim()) return Response.json({ ok: false, error: "title or question is required" }, { status: 400 });
  const r = await fileRequest({ title: str(b.title), question: str(b.question), note: str(b.note), eventId: Number.isInteger(b.event_id) ? b.event_id : null },
    who.id, who.via === "token" ? "api" : "web");
  return Response.json(r, { status: r.ok ? 200 : 400 });
}
