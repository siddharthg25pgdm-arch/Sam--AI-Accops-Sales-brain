import { getPassage, passagesRoute } from "@/lib/passages";

/** GET /api/v1/passages/:id  (id = '<source>#<ordinal>', URL-encoded): one passage and its neighbours.
 *  404 when it does not exist or the caller may not see it (internal without the passages:internal scope). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return passagesRoute(req, c => getPassage(c, decodeURIComponent(id)));
}
