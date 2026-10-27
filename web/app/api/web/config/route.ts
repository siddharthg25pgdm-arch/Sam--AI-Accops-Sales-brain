import { cleanSection, embedOrigins } from "@/app/embed/bridge";
import { pageHuman } from "@/lib/web/bot";
import { settings, webReady } from "@/lib/web/db";
import { cleanPage } from "@/lib/web/fill";
import { offers, persist, VID, welcome } from "@/lib/web/recall";
import { suggest } from "@/lib/web/suggest";

/** The loader's config and kill switch (plan 6), CORS *. `section` (the part of the page being read, SEC-allowlisted)
 *  makes the teaser and chips page-aware (suggest.ts). `persist` tells the loader whether to keep its visitor id on the
 *  device for 90 days (false for EU/EEA/UK/CH: this visit only; recall.ts, from Vercel's country header).
 *  Without `vid` (a device with no stored id) the response is public: CDN-cached 300 s per full URL and per country.
 *  With `vid` (a device that may be returning) the teaser is the welcome-back line for a human request with something
 *  to recall: personal, so `private, no-store`, never cached by the CDN across visitors. */
export async function GET(req: Request) {
  const cors = { "Access-Control-Allow-Origin": "*" };
  const off = () => Response.json({ error: "unavailable" }, { status: 503, headers: { ...cors, "Cache-Control": "no-store" } });
  if (!webReady()) return off();
  const q = new URL(req.url).searchParams, vid = q.get("vid");
  const cache = { ...cors, ...(vid === null ? { "Cache-Control": "public, s-maxage=300", Vary: "X-Vercel-IP-Country" } : { "Cache-Control": "private, no-store" }) };
  try {
    if (!(await settings())?.enabled) return Response.json({ enabled: false, teaser: null, chips: [] }, { headers: cache });
    const page = cleanPage(q.get("page"));
    const [rows, back] = await Promise.all([suggest(page, cleanSection(q.get("section"))),
      vid && VID.test(vid) && pageHuman(req.headers, embedOrigins()) ? welcome(vid, page).catch(() => null) : null]);
    const [first, ...rest] = rows;
    // the teaser card's title is plain text (the loader sets textContent; the card is already bold), so no ** markers
    const teaser = back ? { after_s: 15, qa_id: back.qa_id, label: back.line.replace(/\*\*/g, "") }
      : first ? { after_s: 15, qa_id: first.id, label: first.label } : null;
    return Response.json({ enabled: true, persist: persist(req.headers.get("x-vercel-ip-country")), teaser,
      chips: back ? offers(back, rows, 7, [back.qa_id]) : rest }, { headers: cache });
  } catch { return off(); } // migrations not applied yet, or the database is down
}
