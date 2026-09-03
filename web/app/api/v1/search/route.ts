import { resolveCaller, unauthorized } from "@/lib/apiauth";
import { apiSearch } from "@/lib/api";

/** GET /api/v1/search?q=...&vertical=BFSI&type=Case%20Study&product=ZTNA&audience=external&limit=5 */
export async function GET(req: Request) {
  const who = await resolveCaller(req); if (!who) return unauthorized();
  const u = new URL(req.url); const g = (k: string) => u.searchParams.get(k) ?? undefined;
  const audience = g("audience") === "external" ? "external" : "internal";
  const out = await apiSearch({ query: g("q") ?? g("query"), asset_type: g("type") ?? g("asset_type"), vertical: g("vertical"), product: g("product"), audience, limit: Number(g("limit") ?? 5) }, who.id, who.via === "token" ? "api" : "web");
  return Response.json(out);
}
