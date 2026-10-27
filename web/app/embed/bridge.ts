/** The iframe side of the loader bridge (plan 7.1): which parent origins may talk to the widget, and what an
 *  analytics event may carry. Pure, no React, so web-widget.check.mjs can load it. public/embed.js holds the
 *  parent side (plain JS, it cannot import this). No typed text ever crosses the bridge: names are allowlisted,
 *  ids and refs are reduced to a character set that cannot hold a sentence. */

/** Stage 1: accops.com + the Citrix LP. WEB_EMBED_ORIGINS adds more (comma-separated), e.g. an LP preview host.
 *  next.config.ts builds the /embed frame-ancestors from the same list (web-widget.check proves they match). */
export const EMBED_ORIGINS = ["https://www.accops.com", "https://accops.com", "https://accops-citrix-lp.vercel.app"];

export function embedOrigins(env = process.env.WEB_EMBED_ORIGINS): string[] {
  const extra = (env ?? "").split(",").map(s => s.trim()).filter(s => URL.canParse(s) && new URL(s).protocol === "https:" && new URL(s).origin === s);
  return [...new Set([...EMBED_ORIGINS, ...extra])];
}

/** /embed framed by SAM itself (the admin "Test the bot" page): the browser-set Sec-Fetch headers say the framing
 *  page is our own origin, and that origin must be in the trusted list (WEB_EMBED_ORIGINS). A third-party page in a
 *  browser is always cross-site here, whatever it puts in the URL. */
export function selfFramed(h: { get(k: string): string | null }, allowed: string[]) {
  const r = h.get("referer") ?? "";
  return h.get("sec-fetch-site") === "same-origin" && h.get("sec-fetch-dest") === "iframe" && URL.canParse(r) && allowed.includes(new URL(r).origin);
}

/** /api/web/event's is_test, decided server-side, never by a body flag: a test chat's widget events ("t_" ids, which
 *  /embed mints only when SAM frames itself) or the loader's own beacons (no conversation) from a page on SAM's own
 *  host (the test page). A forged "t_" id can only hide the sender's own events. */
export const testEvent = (origin: string | null, ownHost: string, conversation_id?: string) =>
  conversation_id ? conversation_id.startsWith("t_") : !!origin && new URL(origin).host === ownHost;

/** The loader's `init`: only from an allowed origin AND from the window that framed us. */
export function acceptInit(e: { origin: string; source: unknown; data: unknown }, allowed: string[], parent: unknown) {
  const d = e.data as { t?: unknown; visitor_id?: unknown; consent?: unknown } | null;
  if (!allowed.includes(e.origin) || e.source !== parent || !d || d.t !== "init") return null;
  return { origin: e.origin, visitor_id: typeof d.visitor_id === "string" && ID.test(d.visitor_id) ? d.visitor_id : null, consent: d.consent === true };
}

/** The Microsoft Bookings host the chat may open inside its panel (settings booking_url). next.config.ts frames exactly
 *  this origin on /embed (frame-src; web-widget.check proves they match) and the Website tab refuses any other. */
export const BOOKING_ORIGIN = "https://bookings.cloud.microsoft";
/** booking_url as the widget may use it: an https link on BOOKING_ORIGIN, else "" (the CTA keeps opening cta_url). */
export function bookingUrl(v: unknown): string {
  if (typeof v !== "string" || v.length > 500 || !URL.canParse(v.trim())) return "";
  const u = new URL(v.trim());
  return u.origin === BOOKING_ORIGIN && !u.username && !u.password ? u.href : "";
}
/** A talk-to-sales CTA opens the calendar in the panel when there is one; an open_url CTA (a document, a page) never does. */
export const opensBooking = (booking: string, action?: string) => !!booking && action !== "open_url";

export const ID = /^[A-Za-z0-9_.:-]{1,80}$/;
/** The section the visitor is reading, as the loader reports it (an element id, or the cards' "section-N"): never free text. */
export const SEC = /^[a-z0-9][a-z0-9-]{0,40}$/;
export const cleanSection = (s: unknown) => (typeof s === "string" && SEC.test(s) ? s : "");
/** Events the widget reports (the loader reports popup_*, chat_opened, chat_closed and talk_to_sales_clicked itself).
 *  booking_opened: the calendar opened in the panel (no text; GA4 gets it through the loader's sam_chat push). */
export const WIDGET_EVENTS = ["question_clicked", "answer_shown", "doc_opened", "filter_used", "step_viewed", "talk_to_sales_clicked", "booking_opened"] as const;
export type WidgetEvent = (typeof WIDGET_EVENTS)[number];
export const SOURCES = ["bank", "intent", "cache", "model", "fallback", "guard", "limited", "repeat", "root", "chip", "picker", "teaser"] as const;

/** A ref (doc URL, filter name, step) as the event route accepts it: no spaces, no free text, <= 300 chars. */
export const cleanRef = (v: unknown) => {
  const s = String(v ?? "").replace(/\s+/g, "_").replace(/[^\w.:/#?=&%-]/g, "").slice(0, 300);
  return s || undefined;
};

/** The parent-bound message for an event, or null. Only these four fields, never text. */
export function eventMessage(name: string, p: { qa_id?: unknown; source?: unknown; ref?: unknown } = {}) {
  if (!(WIDGET_EVENTS as readonly string[]).includes(name)) return null;
  return {
    t: "event" as const, name,
    ...(typeof p.qa_id === "string" && ID.test(p.qa_id) ? { qa_id: p.qa_id } : {}),
    ...(typeof p.source === "string" && (SOURCES as readonly string[]).includes(p.source) ? { source: p.source } : {}),
    ...(cleanRef(p.ref) ? { ref: cleanRef(p.ref) } : {}),
  };
}
