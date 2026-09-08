import { configured, registry, syncStatus } from "@/lib/sharepoint";
import { ready, cacheState } from "@/lib/registry-cache";
import { cardCacheState } from "@/lib/cards-cache";
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

  const [rows, sync] = await Promise.all([registry("sales", 5000), syncStatus()]);
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
    // The carded corpus, reported for the same reason the registry cache is: a cache that is warm
    // but EMPTY is the failure mode this project has already been caught by, and it is invisible
    // unless the count is on the health endpoint. 0 here means SAM is answering without any of the
    // publication years, expiries or visibility flags that carding produced.
    cards_cache: cardCacheState(),
    newest_change: newest,
    // Sales Collateral is not a busy library, so silence is only suspicious after a while.
    flow_probably_stalled: ageDays !== null && ageDays > 30,
    // Has the flow written here recently? list_item_id stopped being the signal on 7 Sep, when
    // sp_backfill_listitem.py populated all 874 from Graph to make renames match - so it now says
    // "backfilled", not "a notification arrived". last_synced is the honest one: only applyChange
    // sets it to now(), so a value newer than the backfill means a real notification landed.
    // ponytail: a dedicated last_notification column would be cleaner, add it if this gets fiddly.
    flow_last_write: rows.map(r => r.last_synced).filter(Boolean).sort().reverse()[0] ?? null,
    // Deletions are NOT covered by the flow - see syncStatus(). This is the one number that says
    // whether SAM might still be citing files that no longer exist.
    deletes_last_checked: sync?.last_run ?? null,
    deletes_last_result: sync?.last_result ?? null,
    deletes_stale: sync?.last_run ? (Date.now() - Date.parse(sync.last_run)) > 36 * 3_600_000 : true,
    untagged: rows.filter(r => !r.asset_type?.length || r.asset_type[0] === "Other").length,
    by_type: rows.reduce<Record<string, number>>((acc, r) => {
      for (const t of r.asset_type ?? []) acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    }, {}),
  });
}
