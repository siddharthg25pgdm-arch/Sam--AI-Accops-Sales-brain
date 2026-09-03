import { resolveCaller, unauthorized } from "@/lib/apiauth";
import { apiPublicLink } from "@/lib/api";

/** GET /api/v1/public-link?asset=<title or file path> */
export async function GET(req: Request) {
  const who = await resolveCaller(req); if (!who) return unauthorized();
  const asset = new URL(req.url).searchParams.get("asset") ?? "";
  if (!asset) return Response.json({ error: "asset is required" }, { status: 400 });
  return Response.json(apiPublicLink(asset));
}
