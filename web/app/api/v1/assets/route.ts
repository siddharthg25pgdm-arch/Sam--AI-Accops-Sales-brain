import { resolveCaller, unauthorized } from "@/lib/apiauth";
import { apiAssets } from "@/lib/api";

/** GET /api/v1/assets?vertical=&type=&product=  → the catalogue as the web app sees it, plus facet counts */
export async function GET(req: Request) {
  const who = await resolveCaller(req); if (!who) return unauthorized();
  const u = new URL(req.url); const g = (k: string) => u.searchParams.get(k) ?? undefined;
  return Response.json(apiAssets({ vertical: g("vertical"), type: g("type"), product: g("product") }));
}
