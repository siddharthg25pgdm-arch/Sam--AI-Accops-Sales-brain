"""Seed Supabase from the local inventory: the sync tables, then every in-scope file row.

Runs on the delegated Azure CLI login, so it works before the Entra app registration exists.
The webhook and nightly cron take over afterwards and keep the same rows current.

Scope matches sp_map_urls.py: all of Sales Collateral, plus only the Marketing 2.0 folders
listed there. Mapping only - no file content is read.

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
             "delta_link": v.get("delta_link"), "client_state": env("SP_CLIENT_STATE") or None}
            for scope, v in inv.items()
            # Only register drives we actually track; marketing stays out until folders are chosen.
            if scope == "sales" or MARKETING_FOLDERS]

    files = [{
        "item_id": r["item_id"], "drive_id": r["drive_id"], "scope": r["scope"], "folder": r["folder"],
        "filename": r["filename"], "ext": r["ext"], "size_bytes": int(r["size_mb"] * 1048576),
        "web_url": r["web_url"], "modified_at": (r["modified"] or None), "modified_by": r["modified_by"] or None,
        "suggest_ingest": r["suggest_ingest"] == "yes", "skip_reason": r["skip_reason"] or None,
    } for r in data]

    print(f"sync rows : {[(s['scope'], s['root_folder'], 'delta' if s['delta_link'] else 'no delta') for s in sync]}")
    print(f"file rows : {len(files)}  ({sum(1 for f in files if f['suggest_ingest'])} suggested for ingest)")
    if not write:
        print("\ndry run - pass --write to load into Supabase")
        return

    url, key = env("SUPABASE_URL").rstrip("/"), env("SUPABASE_SERVICE_KEY")
    if not url or not key:
        sys.exit("set SUPABASE_URL and SUPABASE_SERVICE_KEY (or put them in web/.env.local)")
    post(url, key, "sam_sharepoint_sync?on_conflict=drive_id", sync, prefer="resolution=merge-duplicates")
    for i in range(0, len(files), 200):          # PostgREST rejects very large single payloads
        post(url, key, "sam_sharepoint_files?on_conflict=item_id", files[i:i + 200],
             prefer="resolution=merge-duplicates")
        print(f"  wrote {min(i + 200, len(files))}/{len(files)}", flush=True)
    print("done")


if __name__ == "__main__":
    main()
