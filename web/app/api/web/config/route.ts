import { cleanSection } from "@/app/embed/bridge";
import { settings, webReady } from "@/lib/web/db";
import { cleanPage } from "@/lib/web/fill";
import { suggest } from "@/lib/web/suggest";

/** The loader's config and kill switch (plan 6): public data only, CDN-cached 300 s, CORS *. `section` (the part of the
 *  page being read, SEC-allowlisted) makes the teaser and chips page-aware (suggest.ts); the CDN key is the full URL,
 *  so every (page, section) is cached on its own. */
export async function GET(req: Request) {
  const cors = { "Access-Control-Allow-Origin": "*" };
  const off = () => Response.json({ error: "unavailable" }, { status: 503, headers: { ...cors, "Cache-Control": "no-store" } });
  if (!webReady()) return off();
  const cache = { ...cors, "Cache-Control": "public, s-maxage=300" };
  try {
    if (!(await settings())?.enabled) return Response.json({ enabled: false, teaser: null, chips: [] }, { headers: cache });
    const q = new URL(req.url).searchParams;
    const [first, ...rest] = await suggest(cleanPage(q.get("page")), cleanSection(q.get("section")));
    return Response.json({ enabled: true, teaser: first ? { after_s: 15, qa_id: first.id, label: first.label } : null, chips: rest },
      { headers: cache });
  } catch { return off(); } // migrations not applied yet, or the database is down
}
