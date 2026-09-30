import { resolveCaller, unauthorized } from "./apiauth";
import { BadRequest } from "./brain";

/** Shared wrapper for every /api/v1/brain route: bearer token or session, 400 for a bad parameter,
 *  404 for null, 500 without internals, and X-Brain-Version + Server-Timing on every response. */
export async function brain(req: Request, fn: (u: URLSearchParams) => Promise<unknown | null>): Promise<Response> {
  const t0 = Date.now();
  const headers = { "Cache-Control": "no-store", "X-Brain-Version": "1" };
  if (!(await resolveCaller(req))) return unauthorized();
  try {
    const out = await fn(new URL(req.url).searchParams);
    const h = { ...headers, "Server-Timing": `brain;dur=${Date.now() - t0}` };
    return out == null ? Response.json({ error: "not found" }, { status: 404, headers: h }) : Response.json(out, { headers: h });
  } catch (e) {
    if (e instanceof BadRequest) return Response.json({ error: e.message }, { status: 400, headers });
    console.error("brain api", e);
    return Response.json({ error: "the brain read failed; the server log has the detail" }, { status: 500, headers });
  }
}
