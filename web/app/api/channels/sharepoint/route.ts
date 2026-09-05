import { after } from "next/server";
import { applyChange, tagsFor, type IncomingFile } from "@/lib/sharepoint";

export const maxDuration = 60;

/** SharePoint change tracker. SAM records that a file changed; it never writes to SharePoint.
 *
 *  This endpoint is READ-ONLY with respect to SharePoint: no create, no move, no rename, no delete,
 *  no content fetch. Everything it does happens inside SAM's own registry table. Siddharth downloads
 *  the documents he wants carded and hands them over, so the file bodies never travel.
 *
 *  Fed by a Power Automate flow running on Siddharth's own connection - which is why there is no
 *  Entra app registration here. Power Automate's SharePoint trigger already has permission to watch
 *  the folder as him, so nothing needs IT approval. The flow POSTs one JSON body per change:
 *
 *    { "secret": "...", "event": "created" | "modified" | "deleted",
 *      "itemId": "...", "driveId": "...", "scope": "sales",
 *      "name": "Bank Case Study.pdf", "folder": "zCase Studies/BFSI",
 *      "webUrl": "https://propalmsnetwork.sharepoint.com/...",
 *      "size": 123456, "created": "2024-01-01T00:00:00Z",
 *      "modified": "2026-09-05T10:00:00Z", "modifiedBy": "Sandip Mallik", "etag": "...", "cTag": "..." }
 *
 *  Acknowledge fast and do the work in after(): Power Automate retries on a slow response, which
 *  would double-apply a change that is already recorded. */
export async function POST(req: Request) {
  let body: IncomingFile & { secret?: string };
  try { body = await req.json(); } catch { return new Response("bad json", { status: 400 }); }

  // Shared secret, same discipline as the WhatsApp signature check: this URL is public.
  const expected = process.env.SP_WEBHOOK_SECRET;
  if (expected && body.secret !== expected) return new Response("bad secret", { status: 401 });
  if (!body.itemId) return new Response("itemId required", { status: 400 });

  after(async () => {
    try {
      const r = await applyChange(body);
      console.log(`sharepoint ${body.event ?? "modified"} ${body.name ?? body.itemId}: ${r}`);
    } catch (e) {
      // Never throw after the ack: the nightly reconcile is what makes a missed change survivable.
      console.error("sharepoint change failed", e);
    }
  });

  return Response.json({ ok: true, itemId: body.itemId, tags: tagsFor(body.folder ?? "", body.name ?? "") }, { status: 202 });
}

/** Lets Siddharth confirm the endpoint is reachable from the Power Automate flow designer. */
export async function GET() {
  return Response.json({ ok: true, endpoint: "sharepoint change tracker", writes_to_sharepoint: false });
}
