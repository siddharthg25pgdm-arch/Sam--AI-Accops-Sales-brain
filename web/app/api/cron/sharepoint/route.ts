import { configured, syncRows, syncDrive, ensureSubscription } from "@/lib/sharepoint";

export const maxDuration = 300;

/** Nightly reconcile. Vercel cron hits this; it can also be run by hand with the cron secret.
 *
 *  This exists because Graph change notifications are explicitly not guaranteed delivery. It does
 *  two jobs the webhook cannot:
 *    - a full delta pass, which is what makes deletions and moves correct. SAM citing a document
 *      that no longer exists is worse than SAM missing one.
 *    - renewing the subscriptions, which Graph expires in at most three days.
 *
 *  Both run per drive and a failure on one drive must not stop the other, so results are collected
 *  rather than thrown. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });
  }
  if (!configured()) {
    return Response.json({ ok: false, reason: "SharePoint sync not configured (SP_* and SUPABASE_* env vars)" }, { status: 200 });
  }

  const base = process.env.SAM_PUBLIC_URL ?? `https://${req.headers.get("host")}`;
  const notificationUrl = `${base}/api/channels/sharepoint`;
  const results: Record<string, unknown>[] = [];

  for (const row of await syncRows()) {
    const entry: Record<string, unknown> = { scope: row.scope, drive_id: row.drive_id };
    try {
      const s = await syncDrive(row);
      entry.sync = { upserts: s.upserts, deletes: s.deletes, scanned: s.scanned };
    } catch (e) {
      entry.sync_error = String(e).slice(0, 300);
    }
    try {
      const sub = await ensureSubscription(row, notificationUrl);
      entry.subscription = { id: sub.id, expires: sub.expires, created: sub.created };
    } catch (e) {
      entry.subscription_error = String(e).slice(0, 300);
    }
    results.push(entry);
  }

  return Response.json({ ok: true, ran_at: new Date().toISOString(), notificationUrl, results });
}
