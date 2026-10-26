import { roots, settings, webReady } from "@/lib/web/db";
import { chips, cleanPage } from "@/lib/web/fill";

/** The loader's config and kill switch (plan 6): public data only, CDN-cached 300 s, CORS *. */
export async function GET(req: Request) {
  const cors = { "Access-Control-Allow-Origin": "*" };
  const off = () => Response.json({ error: "unavailable" }, { status: 503, headers: { ...cors, "Cache-Control": "no-store" } });
  if (!webReady()) return off();
  const cache = { ...cors, "Cache-Control": "public, s-maxage=300" };
  try {
    if (!(await settings())?.enabled) return Response.json({ enabled: false, teaser: null, chips: [] }, { headers: cache });
    const [first, ...rest] = chips(await roots(cleanPage(new URL(req.url).searchParams.get("page"))));
    return Response.json({ enabled: true, teaser: first ? { after_s: 15, qa_id: first.id, label: first.label } : null, chips: rest },
      { headers: cache });
  } catch { return off(); } // migrations not applied yet, or the database is down
}
