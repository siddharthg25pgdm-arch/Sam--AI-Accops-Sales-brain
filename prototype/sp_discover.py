"""Walk the two in-scope SharePoint folders and dump every file's Graph metadata.

Delegated auth via the Azure CLI's token, so this needs no app registration and no
Sites.Selected grant - it runs as whoever `az login` signed in. That is enough for
discovery; the unattended pipeline on Vercel is what needs the app registration.

  az login && python sp_discover.py    ->  data/sharepoint_inventory.json
"""
from __future__ import annotations
import json, subprocess, sys, urllib.parse, urllib.request
from pathlib import Path

GRAPH = "https://graph.microsoft.com/v1.0"
SCOPES = [  # (label, site path, folder inside the default document library)
    ("sales", "propalmsnetwork.sharepoint.com:/sites/Company", "Sales/Sales Collateral"),
    ("marketing", "propalmsnetwork.sharepoint.com:/sites/MarketingTeam", "Marketing 2.0"),
]
SELECT = "id,name,size,file,folder,webUrl,createdDateTime,lastModifiedDateTime,lastModifiedBy,parentReference"
OUT = Path(__file__).parent / "data" / "sharepoint_inventory.json"


def token() -> str:
    # shell=True: az is a .cmd shim on Windows, so CreateProcess cannot find it directly.
    r = subprocess.run("az account get-access-token --resource https://graph.microsoft.com "
                       "--query accessToken -o tsv", capture_output=True, text=True, shell=True)
    if r.returncode:
        sys.exit(f"az token failed - run `az login`:\n{r.stderr[:400]}")
    return r.stdout.strip()


def get(url: str, tok: str) -> dict:
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {tok}"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def crawl(drive_id: str, folder: str, tok: str) -> tuple[list[dict], str | None]:
    """Every item under `folder`, via one delta enumeration of the drive.

    Walking /children recurses one request per folder, which is hundreds of round trips on a
    tree this shape. Delta returns the whole drive recursively in ~200-item pages, and hands
    back the deltaLink the nightly reconcile needs anyway (design section 5, T2)."""
    prefix = f"root:/{folder}"  # parentReference.path is /drives/{id}/root:/<folder>/...
    url = f"{GRAPH}/drives/{drive_id}/root/delta?$top=200"
    items, pages, seen = [], 0, 0
    while url:
        page = get(url, tok)
        pages += 1
        for it in page.get("value", []):
            seen += 1
            path = urllib.parse.unquote((it.get("parentReference") or {}).get("path") or "")
            cut = path.find("root:/")
            if cut < 0:
                continue
            path = path[cut:]
            if not (path == prefix or path.startswith(prefix + "/")):
                continue  # delta covers the whole library; keep only our scope
            rel = (path[len("root:/"):] + "/" + it["name"]).lstrip("/")
            if "folder" in it:
                items.append({"kind": "folder", "path": rel,
                              "child_count": it["folder"].get("childCount", 0), "web_url": it.get("webUrl")})
            elif "file" in it:
                items.append({
                    "kind": "file", "path": rel, "name": it["name"],
                    "ext": Path(it["name"]).suffix.lower().lstrip("."), "size": it.get("size", 0),
                    "item_id": it["id"], "web_url": it.get("webUrl"),
                    "created": it.get("createdDateTime"), "modified": it.get("lastModifiedDateTime"),
                    "modified_by": (it.get("lastModifiedBy") or {}).get("user", {}).get("displayName"),
                    "mime": (it.get("file") or {}).get("mimeType"),
                })
        print(f"    page {pages}: {seen} items scanned, {len(items)} in scope", flush=True)
        url = page.get("@odata.nextLink")
        if not url:
            return items, page.get("@odata.deltaLink")
    return items, None


def main() -> None:
    tok = token()
    result = {}
    for label, site_path, folder in SCOPES:
        site = get(f"{GRAPH}/sites/{site_path}", tok)
        drive = get(f"{GRAPH}/sites/{site['id']}/drive", tok)
        print(f"  {label}: crawling {folder}", flush=True)
        items, delta_link = crawl(drive["id"], folder, tok)
        result[label] = {"site_id": site["id"], "site_url": site["webUrl"], "drive_id": drive["id"],
                         "root_folder": folder, "delta_link": delta_link, "items": items}
        files = [i for i in items if i["kind"] == "file"]
        print(f"{label:10s} {len(files):4d} files  {sum(f['size'] for f in files)/1048576:8.1f} MB  "
              f"{sum(1 for i in items if i['kind']=='folder'):3d} folders")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print("->", OUT)


if __name__ == "__main__":
    main()
