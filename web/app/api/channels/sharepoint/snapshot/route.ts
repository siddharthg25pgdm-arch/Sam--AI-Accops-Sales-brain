import { applySnapshot, configured, type Snapshot } from "@/lib/sharepoint";

export const maxDuration = 60;

/** Daily deletion reconcile, fed by the Power Automate flow "SAM - daily SharePoint snapshot".
 *  Read-only with respect to SharePoint, like the change tracker next door.
 *
 *    { "secret": "...", "mode": "report" | "write", "scope": "sales", "complete": true,
 *      "count": 912, "files": [{ "id": 33480, "name": "x.pdf", "path": "Shared Documents/...", "isFolder": false }] }
 *
 *  Answers synchronously rather than acking and working in after(): the diff is one registry read
 *  and at most two PATCHes, well inside the flow's HTTP timeout, and the response body - what WOULD
 *  be tombstoned - is the whole point of report mode, readable in the flow's run history. A retry is
 *  harmless: the diff is idempotent. All the safety guards live in diffSnapshot(). */
export async function POST(req: Request) {
  let body: Snapshot & { secret?: string };
  try { body = await req.json(); } catch { return new Response("bad json", { status: 400 }); }

  // Unlike the change route, a missing secret is not "open": this endpoint can tombstone rows.
  const expected = process.env.SP_WEBHOOK_SECRET;
  if (!expected) return new Response("SP_WEBHOOK_SECRET not configured", { status: 503 });
  if (body.secret !== expected) return new Response("bad secret", { status: 401 });
  if (!configured()) return new Response("supabase not configured", { status: 503 });

  const r = await applySnapshot(body);
  console.log(`sharepoint snapshot: ${r.result}`);
  // A refusal is 409, so the flow run goes RED instead of green-while-nothing-happened. Power
  // Automate's default retry policy retries 408/429/5xx only, so a 409 is not re-sent.
  return Response.json(r, { status: r.ok ? 200 : 409 });
}

export async function GET() {
  return Response.json({ ok: true, endpoint: "sharepoint snapshot reconcile", modes: ["report", "write"], writes_to_sharepoint: false });
}
