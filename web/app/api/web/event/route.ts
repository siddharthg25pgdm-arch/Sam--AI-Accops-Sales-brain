import { z } from "zod";
import { redact } from "@/lib/redact";
import { cleanPage } from "@/lib/web/fill";
import { BOT_UA } from "@/lib/web/bot";
import { logEvent, webReady } from "@/lib/web/db";
import { valid } from "@/lib/web/qualify";
import { embedOrigins, testEvent } from "@/app/embed/bridge";

const NAMES = ["chat_opened", "chat_closed", "popup_shown", "popup_clicked", "popup_dismissed", "question_clicked",
  "answer_shown", "doc_opened", "talk_to_sales_clicked", "filter_used", "step_viewed", "booking_opened", "page_viewed",
  "qualify_answered", "routing_book", "routing_support", "routing_partner"] as const;
// 05 SQL adds booking_opened to the table's check, 07 adds page_viewed (the loader's one per page load: what welcome-back
// memory reads as "pages this device read"; until 07 is applied the insert fails and is only warned about), 08 adds
// qualify_answered (ref "users:5000_plus") and the routing bar's routing_book / routing_support / routing_partner.
const Id = z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/);
// Strict: an unknown name or any extra field (free text) is rejected. No field can hold a sentence (no spaces).
const Event = z.strictObject({ conversation_id: Id.optional(), visitor_id: Id, page: z.string().max(500).regex(/^\S*$/),
  name: z.enum(NAMES), qa_id: Id.optional(), ref: z.string().max(300).regex(/^[\w.:/#?=&%-]+$/).optional() });

// Only the trusted list (bridge.ts): SAM's own origin (the /embed iframe, the test page) only when WEB_EMBED_ORIGINS has it.
const origin = (req: Request) => { const o = req.headers.get("origin"); return o && URL.canParse(o) ? new URL(o).origin : null; };

/** Widget and loader analytics (plan 6). JSON or text/plain JSON (sendBeacon). 204, nothing echoed back. */
export async function POST(req: Request) {
  if (!webReady()) return Response.json({ error: "unavailable" }, { status: 503 });
  if (!embedOrigins().includes(origin(req) ?? "")) return new Response(null, { status: 403 });
  const raw = await req.text();
  let body: unknown = null;
  try { body = raw.length <= 2000 ? JSON.parse(raw) : null; } catch { /* rejected below */ }
  const e = Event.safeParse(body);
  if (!e.success) return new Response(null, { status: 400 });
  // the qualifying card's answer: an allowlisted key:value only (qualify.ts), never anything else in ref
  const qz = (e.data.ref ?? "").split(":");
  if (e.data.name === "qualify_answered" && !(qz.length === 2 && valid(qz[0], qz[1]))) return new Response(null, { status: 400 });
  // crawlers that run the loader would fill the page history with ids that never come back
  if (e.data.name === "page_viewed" && BOT_UA.test(req.headers.get("user-agent") ?? "")) return new Response(null, { status: 204 });
  try { await logEvent({ ...e.data, page: cleanPage(e.data.page), country: req.headers.get("x-vercel-ip-country"),
    is_test: testEvent(origin(req), new URL(req.url).host, e.data.conversation_id) }); }
  catch (err) { console.warn(`web event: ${redact(err)}`); }
  return new Response(null, { status: 204 });
}
