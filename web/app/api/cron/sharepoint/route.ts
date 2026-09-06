import { configured, registry } from "@/lib/sharepoint";
import { ready, cacheState } from "@/lib/registry-cache";
import { allAssets, assetLink } from "@/lib/cards";

export const maxDuration = 60;

/** Nightly registry health check. Reports; changes nothing, in SAM or in SharePoint.
 *
 *  The Power Automate flow is the live path, but flows can be turned off, fail silently, or miss a
 *  change. This surfaces that: if nothing has been recorded for a while, the flow is probably not
 *  running, and a stale registry is how SAM ends up citing documents that have moved or gone.
 *
 *  A full reconcile against Graph would need the app registration this design deliberately avoids,
 *  so the safety net is instead: run prototype/sp_discover.py + sp_seed_registry.py --write, which
 *  work on the delegated Azure CLI login and need no IT approval. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }
  if (!configured()) {
    return Response.json({ ok: false, reason: "SUPABASE_URL / SUPABASE_SERVICE_KEY not set" });
  }

  const rows = await registry("sales", 5000);
  const synced = rows.map(r => r.modified_at).filter(Boolean).sort().reverse();
  const newest = synced[0] ?? null;
  const ageDays = newest ? (Date.now() - Date.parse(newest)) / 86_400_000 : null;

  // What the agent actually answers from, after cards and registry are merged and deduplicated.
  // Reported here because "874 rows are tracked" and "SAM can answer about 696 things" are different
  // numbers, and only the second one is what a user experiences.
  await ready();
  const answerable = allAssets();
  const withLink = answerable.filter(a => assetLink(a)).length;

  return Response.json({
    ok: true,
    ran_at: new Date().toISOString(),
    tracked: rows.length,
    answerable: answerable.length,
    answerable_with_link: withLink,
    registry_cache: cacheState(),
    newest_change: newest,
    // Sales Collateral is not a busy library, so silence is only suspicious after a while.
    flow_probably_stalled: ageDays !== null && ageDays > 30,
    // Has the Power Automate flow ever actually written here? Until the first notification lands,
    // every row is seed data and the trigger's field mapping is still unproven. list_item_id only
    // ever arrives from the flow - the seed cannot produce it, because Graph's delta does not return
    // the SharePoint list item id. So this is the unambiguous "the flow works" signal.
    flow_proven: rows.some(r => r.list_item_id != null),
    flow_touched: rows.filter(r => r.list_item_id != null).length,
    untagged: rows.filter(r => !r.asset_type?.length || r.asset_type[0] === "Other").length,
    by_type: rows.reduce<Record<string, number>>((acc, r) => {
      for (const t of r.asset_type ?? []) acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    }, {}),
  });
}
