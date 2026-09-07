"""Reconcile the registry against SharePoint, and tombstone anything that has gone.

Why this exists. The Power Automate "When a file is deleted" trigger does not fire on Siddharth's
connection - verified 7 September 2026: a real file was uploaded and deleted, the modify flow ran
five times and the delete flow ran zero, with identical site, list, folder and recurrence config.
That matches Microsoft's documented requirement that the trigger needs a site-collection-admin
connection to read a deleted file's properties. It is a total no-fire, not a fields-come-back-empty
degradation, so the (folder, filename) fallback in applyDelete never gets a chance to run.

Graph's delta feed reports deletions and needs no admin, so this closes the hole without an IT
ticket. Section 3 of the task document argues deletion is the case that matters most - SAM citing a
document that no longer exists is worse than SAM missing one - so an unhandled delete is not
acceptable, and a nightly reconcile is the answer the design already anticipated.

Mapping only; no file content is read.

  python sp_reconcile.py            # report what would change
  python sp_reconcile.py --write    # tombstone the missing, un-tombstone the returned
"""
from __future__ import annotations
import json, subprocess, sys, urllib.parse, urllib.request, urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from sp_seed_registry import env, from_pat, EXPECT_REF

HERE = Path(__file__).parent
DRIVE = json.loads((HERE / "data" / "sharepoint_inventory.json").read_text(encoding="utf-8"))["sales"]["drive_id"]
ROOT = "Sales/Sales Collateral"


def graph_token() -> str:
    out = subprocess.run("az account get-access-token --resource https://graph.microsoft.com "
                         "--query accessToken -o tsv", shell=True, capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"az failed: {out.stderr[:200]}")
    return out.stdout.strip()


def live_items(tok: str) -> tuple[set[str], set[tuple[str, str]]]:
    """Everything currently under the scope root, as both Graph ids and (folder, filename) pairs.

    Two keys because the registry holds two kinds of row. Seeded rows carry a Graph driveItem id.
    Rows the Power Automate flow created carry its {Identifier}, which is a URL-encoded path, not a
    Graph id - so those can only be checked by name. (folder, filename) is unique across the whole
    registry, which is what makes the second key safe."""
    ids: set[str] = set()
    pairs: set[tuple[str, str]] = set()
    stack = [urllib.parse.quote(ROOT)]
    while stack:
        path = stack.pop()
        url = (f"https://graph.microsoft.com/v1.0/drives/{DRIVE}/root:/{path}:/children"
               "?$select=id,name,folder&$top=200")
        while url:
            try:
                d = json.loads(urllib.request.urlopen(urllib.request.Request(
                    url, headers={"Authorization": f"Bearer {tok}"}), timeout=60).read())
            except urllib.error.HTTPError as e:
                print(f"  warn: {path[:60]} -> {e.code}")
                break
            rel = urllib.parse.unquote(path)
            rel = rel[len(ROOT) + 1:] if rel.startswith(ROOT + "/") else ("" if rel == ROOT else rel)
            for it in d.get("value", []):
                ids.add(it["id"])
                pairs.add((rel, it["name"]))
                if "folder" in it:
                    stack.append(path + "/" + urllib.parse.quote(it["name"]))
            url = d.get("@odata.nextLink")
    return ids, pairs


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
    H = {"apikey": key, "Authorization": f"Bearer {key}"}

    rows = json.loads(urllib.request.urlopen(urllib.request.Request(
        f"{url}/rest/v1/sam_sharepoint_files?scope=eq.sales&select=item_id,filename,folder,deleted&limit=5000",
        headers=H), timeout=60).read())
    print(f"registry rows: {len(rows)}")

    live, livePairs = live_items(graph_token())
    print(f"live in SharePoint: {len(live)}")

    # Rows whose Graph id is no longer present. Only ids that LOOK like Graph ids are checked: a row
    # created by the modify flow carries the trigger's URL-encoded path instead, and comparing that
    # against a set of Graph ids would tombstone every one of them on the first run.
    def present(r: dict) -> bool:
        if r["item_id"].startswith("01"):
            return r["item_id"] in live
        # Flow-created row: no Graph id, so fall back to the name pair.
        return (r["folder"], r["filename"]) in livePairs

    gone = [r for r in rows if not r["deleted"] and not present(r)]
    back = [r for r in rows if r["deleted"] and present(r)]
    skipped: list[dict] = []

    print(f"to tombstone : {len(gone)}")
    print(f"to restore   : {len(back)}")

    for r in gone[:15]:
        print(f"   gone: {r['folder'][:40]}/{r['filename'][:40]}")
    for r in back[:5]:
        print(f"   back: {r['filename'][:50]}")

    if not write:
        print("\nreport only - pass --write")
        return

    def patch(item_id: str, body: dict) -> None:
        urllib.request.urlopen(urllib.request.Request(
            f"{url}/rest/v1/sam_sharepoint_files?item_id=eq.{urllib.parse.quote(item_id)}",
            data=json.dumps(body).encode(), method="PATCH",
            headers={**H, "Content-Type": "application/json"}), timeout=30).read()

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    for r in gone:
        patch(r["item_id"], {"deleted": True, "deleted_at": now})
    for r in back:
        # A file restored from the recycle bin should come back, not stay a tombstone.
        patch(r["item_id"], {"deleted": False, "deleted_at": None})
    print(f"tombstoned {len(gone)}, restored {len(back)}")


if __name__ == "__main__":
    main()
