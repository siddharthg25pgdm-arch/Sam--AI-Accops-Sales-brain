"""Seed Supabase from the local inventory: the sync tables, then every in-scope file row.

Runs on the delegated Azure CLI login, so it works before the Entra app registration exists.
The webhook and nightly cron take over afterwards and keep the same rows current.

Scope matches sp_map_urls.py: all of Sales Collateral, plus only the Marketing 2.0 folders
listed there. Mapping only - no file content is read.

Target project: accops-marketing-dashboard (ref iwqhayuoxnrhqzozznes), shared with the marketing
dashboard on the free tier. Only sam_-prefixed tables are written, so the dashboard's own tables
are never touched - but because the database is shared, --write refuses to run unless the target
tables already exist. Run docs/supabase-sharepoint-files.sql first.

  python sp_seed_registry.py            # dry run, prints what it would write
  python sp_seed_registry.py --write    # actually write to Supabase
"""
from __future__ import annotations
import json, os, sys, urllib.request, urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from sp_map_urls import rows as mapped_rows, MARKETING_FOLDERS  # single source of truth for scope

HERE = Path(__file__).parent
INV = HERE / "data" / "sharepoint_inventory.json"
EXPECT_REF = "iwqhayuoxnrhqzozznes"   # accops-marketing-dashboard


def env(name: str) -> str:
    v = os.environ.get(name, "")
    if not v:
        # Fall back to web/.env.local so this matches whatever the deployed app is pointed at.
        envfile = HERE.parent / "web" / ".env.local"
        if envfile.exists():
            for line in envfile.read_text(encoding="utf-8").splitlines():
                if line.strip().startswith(name + "="):
                    return line.split("=", 1)[1].strip().strip('"')
    return v


def post(url: str, key: str, path: str, payload: list[dict] | dict, method: str = "POST", prefer: str = "") -> None:
    body = json.dumps(payload).encode()
    req = urllib.request.Request(f"{url}/rest/v1/{path}", data=body, method=method, headers={
        "apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json",
        **({"Prefer": prefer} if prefer else {})})
    try:
        urllib.request.urlopen(req, timeout=120).read()
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {path} -> {e.code}: {e.read().decode()[:500]}")


def main() -> None:
    write = "--write" in sys.argv
    inv = json.loads(INV.read_text(encoding="utf-8"))
    data = mapped_rows()

    sync = [{"drive_id": v["drive_id"], "scope": scope, "root_folder": v["root_folder"],
             "delta_link": v.get("delta_link")}
            for scope, v in inv.items()
            # Only register drives we actually track; marketing stays out until folders are chosen.
            if scope == "sales" or MARKETING_FOLDERS]

    files = [{
        "item_id": r["item_id"], "drive_id": r["drive_id"], "scope": r["scope"], "folder": r["folder"],
        "filename": r["filename"], "ext": r["ext"], "size_bytes": int(r["size_mb"] * 1048576),
        "web_url": r["web_url"], "modified_at": (r["modified"] or None), "modified_by": r["modified_by"] or None,
        "created_at": (r["created"] or None), "suggest_ingest": r["suggest_ingest"] == "yes",
        "skip_reason": r["skip_reason"] or None,
        # Tags travel with the row so the catalogue can filter before any document is carded.
        "asset_type": [x.strip() for x in r["asset_type"].split(";") if x.strip()],
        "industry": [x.strip() for x in r["industry"].split(";") if x.strip()],
        "product": [x.strip() for x in r["product"].split(";") if x.strip()],
        "competitor": [x.strip() for x in r["competitor"].split(";") if x.strip()],
        "team": "Sales" if r["scope"] == "sales" else "Marketing", "status": r["status"],
    } for r in data]

    print(f"sync rows : {[(s['scope'], s['root_folder'], 'delta' if s['delta_link'] else 'no delta') for s in sync]}")
    print(f"file rows : {len(files)}  ({sum(1 for f in files if f['suggest_ingest'])} suggested for ingest)")
    if not write:
        print("\ndry run - pass --write to load into Supabase")
        return

    url, key = env("SUPABASE_URL").rstrip("/"), env("SUPABASE_SERVICE_KEY")
    if not url or not key:
        sys.exit("set SUPABASE_URL and SUPABASE_SERVICE_KEY (or put them in web/.env.local)")
    if EXPECT_REF not in url:
        sys.exit(f"refusing to write: SUPABASE_URL is {url!r}, expected project ref {EXPECT_REF}. "
                 f"Change EXPECT_REF if you really mean a different project.")
    # A shared database means a typo writes into someone else's app. Prove the tables are ours first.
    probe = urllib.request.Request(f"{url}/rest/v1/sam_sharepoint_files?select=item_id&limit=1",
                                   headers={"apikey": key, "Authorization": f"Bearer {key}"})
    try:
        urllib.request.urlopen(probe, timeout=30).read()
    except urllib.error.HTTPError as e:
        sys.exit(f"sam_sharepoint_files not reachable ({e.code}). Run docs/supabase-sharepoint-files.sql "
                 f"in the {EXPECT_REF} project first.")
    post(url, key, "sam_sharepoint_sync?on_conflict=drive_id", sync, prefer="resolution=merge-duplicates")
    for i in range(0, len(files), 200):          # PostgREST rejects very large single payloads
        post(url, key, "sam_sharepoint_files?on_conflict=item_id", files[i:i + 200],
             prefer="resolution=merge-duplicates")
        print(f"  wrote {min(i + 200, len(files))}/{len(files)}", flush=True)
    print("done")


if __name__ == "__main__":
    main()
