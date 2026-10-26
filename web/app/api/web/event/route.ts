import { z } from "zod";
import { redact } from "@/lib/redact";
import { cleanPage } from "@/lib/web/fill";
import { logEvent, webReady } from "@/lib/web/db";

const NAMES = ["chat_opened", "chat_closed", "popup_shown", "popup_clicked", "popup_dismissed", "question_clicked",
  "answer_shown", "doc_opened", "talk_to_sales_clicked", "filter_used", "step_viewed"] as const;
const Id = z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/);
// Strict: an unknown name or any extra field (free text) is rejected. No field can hold a sentence (no spaces).
const Event = z.strictObject({ conversation_id: Id.optional(), visitor_id: Id, page: z.string().max(500).regex(/^\S*$/),
  name: z.enum(NAMES), qa_id: Id.optional(), ref: z.string().max(300).regex(/^[\w.:/#?=&%-]+$/).optional() });

const allowed = (req: Request) => {
  const o = req.headers.get("origin");
  if (!o || !URL.canParse(o)) return false;
  const origins = (process.env.WEB_EMBED_ORIGINS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  return origins.includes(new URL(o).origin) || new URL(o).host === new URL(req.url).host;
};

/** Widget and loader analytics (plan 6). JSON or text/plain JSON (sendBeacon). 204, nothing echoed back. */
export async function POST(req: Request) {
  if (!webReady()) return Response.json({ error: "unavailable" }, { status: 503 });
  if (!allowed(req)) return new Response(null, { status: 403 });
  const raw = await req.text();
  let body: unknown = null;
  try { body = raw.length <= 2000 ? JSON.parse(raw) : null; } catch { /* rejected below */ }
  const e = Event.safeParse(body);
  if (!e.success) return new Response(null, { status: 400 });
  try { await logEvent({ ...e.data, page: cleanPage(e.data.page), country: req.headers.get("x-vercel-ip-country") }); }
  catch (err) { console.warn(`web event: ${redact(err)}`); }
  return new Response(null, { status: 204 });
}
