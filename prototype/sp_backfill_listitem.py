"""Backfill list_item_id on sam_sharepoint_files from Graph.

Why this exists. Power Automate's delete trigger carries only the SharePoint LIST ITEM id, and its
create/modify trigger's {Identifier} turned out to be a URL-encoded path rather than the Graph
driveItem id (first real notification, 7 September 2026). So list_item_id is the only stable key
shared by both triggers and the registry.

Without it, a RENAME creates a duplicate: (folder, filename) cannot match a file whose name just
changed, which is exactly what happened when a deck was renamed Confidential -> Public-Shareable.
A list item id survives renames and moves, so backfilling it closes that hole for all 874 rows
instead of waiting for each file to be touched once.

Graph exposes it as sharepointIds.listItemId on the driveItem. Mapping only - no file content is
read, so the rule in design section 2 still holds.

  python sp_backfill_listitem.py            # dry run
  python sp_backfill_listitem.py --write
"""
from __future__ import annotations
import json, subprocess, sys, urllib.request, urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from sp_seed_registry import env, from_pat, EXPECT_REF

HERE = Path(__file__).parent
DRIVE = json.loads((HERE / "data" / "sharepoint_inventory.json").read_text(encoding="utf-8"))["sales"]["drive_id"]


def graph_token() -> str:
    out = subprocess.run("az account get-access-token --resource https://graph.microsoft.com "
                         "--query accessToken -o tsv", shell=True, capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"az failed: {out.stderr[:200]}")
    return out.stdout.strip()


def main() -> None:
    write = "--write" in sys.argv
    url, key = env("SUPABASE_URL").rstrip("/"), env("SUPABASE_SERVICE_KEY")
    if not key:
        url2, key = from_pat()
        url = url or url2
    if not url or not key:
        sys.exit("no Supabase credentials")
    if EXPECT_REF not in url:
        sys.exit(f"refusing to write: expected project {EXPECT_REF}")

    rows = json.loads(urllib.request.urlopen(urllib.request.Request(
        f"{url}/rest/v1/sam_sharepoint_files?select=item_id,filename,list_item_id&limit=5000",
        headers={"apikey": key, "Authorization": f"Bearer {key}"}), timeout=60).read())
    todo = [r for r in rows if r.get("list_item_id") is None]
    print(f"rows: {len(rows)}  missing list_item_id: {len(todo)}")
    if not todo:
        print("nothing to do"); return

    tok = graph_token()
    updates, missing = [], 0
    for i, r in enumerate(todo, 1):
        req = urllib.request.Request(
            f"https://graph.microsoft.com/v1.0/drives/{DRIVE}/items/{r['item_id']}?$select=id,sharepointIds",
            headers={"Authorization": f"Bearer {tok}"})
        try:
            d = json.loads(urllib.request.urlopen(req, timeout=30).read())
            lid = d.get("sharepointIds", {}).get("listItemId")
            if lid:
                updates.append({"item_id": r["item_id"], "list_item_id": int(lid)})
            else:
                missing += 1
        except urllib.error.HTTPError as e:
            # A 404 here means the file is gone from SharePoint but still in the registry - which is
            # itself worth knowing, so count it rather than dying on it.
            missing += 1
            if e.code not in (404, 410):
                print(f"  {r['filename'][:40]}: HTTP {e.code}")
        if i % 100 == 0:
            print(f"  {i}/{len(todo)}", flush=True)

    print(f"resolved {len(updates)}, unresolved {missing}")
    if not write:
        print("dry run - pass --write"); return

    # PATCH one at a time: PostgREST upsert would need every not-null column restated, and this
    # runs once. ponytail: slow but correct, batch it only if it is ever re-run at scale.
    for i, u in enumerate(updates, 1):
        req = urllib.request.Request(
            f"{url}/rest/v1/sam_sharepoint_files?item_id=eq.{urllib.parse.quote(u['item_id'])}",
            data=json.dumps({"list_item_id": u["list_item_id"]}).encode(), method="PATCH",
            headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=30).read()
        if i % 100 == 0:
            print(f"  wrote {i}/{len(updates)}", flush=True)
    print(f"done: {len(updates)} rows now have list_item_id")


if __name__ == "__main__":
    import urllib.parse
    main()
