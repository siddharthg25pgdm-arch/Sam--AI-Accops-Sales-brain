import { resolveCaller, unauthorized } from "@/lib/apiauth";
import { apiGaps } from "@/lib/api";

/** GET /api/v1/gaps → industry × type × product combinations with no asset, ranked by how often asked */
export async function GET(req: Request) {
  const who = await resolveCaller(req); if (!who) return unauthorized();
  return Response.json({ gaps: await apiGaps() });
}
