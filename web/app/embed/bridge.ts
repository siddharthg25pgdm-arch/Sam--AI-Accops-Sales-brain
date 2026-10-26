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

/** The loader's `init`: only from an allowed origin AND from the window that framed us. */
export function acceptInit(e: { origin: string; source: unknown; data: unknown }, allowed: string[], parent: unknown) {
  const d = e.data as { t?: unknown; visitor_id?: unknown; consent?: unknown } | null;
  if (!allowed.includes(e.origin) || e.source !== parent || !d || d.t !== "init") return null;
  return { origin: e.origin, visitor_id: typeof d.visitor_id === "string" && ID.test(d.visitor_id) ? d.visitor_id : null, consent: d.consent === true };
}

export const ID = /^[A-Za-z0-9_.:-]{1,80}$/;
/** Events the widget reports (the loader reports popup_*, chat_opened, chat_closed and talk_to_sales_clicked itself). */
export const WIDGET_EVENTS = ["question_clicked", "answer_shown", "doc_opened", "filter_used", "step_viewed", "talk_to_sales_clicked"] as const;
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
