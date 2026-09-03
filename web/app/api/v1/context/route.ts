import { resolveCaller, unauthorized } from "@/lib/apiauth";
import { apiContextForAccount } from "@/lib/api";

export const maxDuration = 60;
/** POST /api/v1/context {company, person_title?, country?, industry?, intent?} → brief for the Dwight extension */
export async function POST(req: Request) {
  const who = await resolveCaller(req); if (!who) return unauthorized();
  const b = await req.json().catch(() => ({}));
  if (!b.company) return Response.json({ error: "company is required" }, { status: 400 });
  return Response.json(await apiContextForAccount(b, who.id, who.via === "token" ? "api" : "web"));
}
