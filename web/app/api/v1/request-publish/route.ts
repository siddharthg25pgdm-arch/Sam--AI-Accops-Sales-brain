import { resolveCaller, unauthorized } from "@/lib/apiauth";
import { apiRequestPublish } from "@/lib/api";

/** POST /api/v1/request-publish  { asset, reason? }
 *  The other half of public_link's can_request_publish, which promised a rep they could ask and
 *  gave them nowhere to ask. POST-only, unlike the read routes: a GET that files a request would
 *  be triggerable by a link preview or a crawler. */
export async function POST(req: Request) {
  const who = await resolveCaller(req); if (!who) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const asset = String(body.asset ?? "").trim();
  if (!asset) return Response.json({ error: "asset is required" }, { status: 400 });
  const r = await apiRequestPublish({ asset, reason: body.reason }, who.id, who.via === "token" ? "api" : "web");
  return Response.json(r, { status: r.ok ? 200 : 400 });
}
