import { after } from "next/server";
import { configured, syncRows, syncDrive } from "@/lib/sharepoint";

export const maxDuration = 60;

/** Graph change notifications for the watched SharePoint drives.
 *
 *  Two hard requirements from Microsoft, both easy to get wrong:
 *
 *  1. On subscription creation Graph POSTs here with ?validationToken=... and expects that exact
 *     string back as text/plain within 10 seconds. Anything else and the subscription is refused.
 *  2. Every later notification must also be answered inside 10 seconds or Graph retries and
 *     eventually drops the subscription. So acknowledge first and sync in after(), the same shape
 *     the WhatsApp route uses.
 *
 *  Notifications carry no file data - only "something changed in this drive" - so the work is a
 *  delta query regardless. That is why there is no per-item handling here. */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const validationToken = url.searchParams.get("validationToken");
  if (validationToken) {
    return new Response(validationToken, { status: 200, headers: { "Content-Type": "text/plain" } });
  }

  let body: { value?: { clientState?: string; resource?: string; subscriptionId?: string }[] };
  try { body = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
  const notifications = body.value ?? [];

  // clientState is the shared secret proving this really came from our subscription. Same discipline
  // as the WhatsApp signature check: anyone can POST this public URL.
  const expected = process.env.SP_CLIENT_STATE;
  if (expected && notifications.some(n => n.clientState !== expected)) {
    return new Response("bad clientState", { status: 401 });
  }

  if (configured() && notifications.length) {
    const driveIds = new Set(
      notifications.map(n => /drives\/([^/]+)/.exec(n.resource ?? "")?.[1]).filter(Boolean) as string[]
    );
    after(async () => {
      try {
        const rows = await syncRows();
        // Several notifications can land per change; sync each affected drive once, not per message.
        for (const row of rows.filter(r => driveIds.size === 0 || driveIds.has(r.drive_id))) {
          const r = await syncDrive(row);
          console.log(`sharepoint sync ${row.scope}: ${r.upserts} upserts, ${r.deletes} deletes`);
        }
      } catch (e) {
        // Never throw here: Graph has already had its 202 and a throw would only crash the lambda.
        // The nightly reconcile is what makes a missed notification survivable.
        console.error("sharepoint sync failed", e);
      }
    });
  }

  return new Response(null, { status: 202 });
}
