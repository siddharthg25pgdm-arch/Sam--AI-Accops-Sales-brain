"""Map every in-scope SharePoint file to its real Graph webUrl, into a CSV you can open as a sheet.

Mapping only - no file content is downloaded. Siddharth downloads the documents he wants
carded and hands them over; this just records what exists and where it lives.

Scope:
  - ALL of Sales/Sales Collateral (every file, archives included but flagged).
  - Marketing 2.0 only for the folders named in MARKETING_FOLDERS below - empty by default,
    because Marketing 2.0 is a 960 GB media library and blanket-including it is never right.

  python sp_discover.py   # refresh data/sharepoint_inventory.json first
  python sp_map_urls.py   # -> data/sharepoint_url_map.csv
"""
from __future__ import annotations
import csv, json, re
from pathlib import Path

HERE = Path(__file__).parent
INV = HERE / "data" / "sharepoint_inventory.json"
OUT = HERE / "data" / "sharepoint_url_map.csv"

# Folder paths under "Marketing 2.0", relative to that folder. Add the ones Siddharth names.
# Example: ["Resources/Case Studies", "Resources/WhitePapers", "Resources/Brochures & Datasheets"]
MARKETING_FOLDERS: list[str] = []

DOC_EXT = {"pdf", "docx", "doc", "pptx", "ppt", "xlsx", "xls", "txt", "md", "rtf"}
# z-prefixed folders are this tenant's convention for "sorted to the bottom, do not use".
DEAD = re.compile(r"(z*archive|do ?not ?use|donotuse|obsolete|deprecated|backup"
                  r"|(^|[ _/(-])(old|wip|draft|drafts|temp|tmp|raw)([ _/)-]|$))", re.I)


def rows() -> list[dict]:
    inv = json.loads(INV.read_text(encoding="utf-8"))
    out: list[dict] = []
    for scope, v in inv.items():
        root = v["root_folder"]
        for f in v["items"]:
            if f["kind"] != "file":
                continue
            rel = f["path"][len(root):].lstrip("/")        # path inside the scope root
            folder = rel.rsplit("/", 1)[0] if "/" in rel else ""
            if scope == "marketing":
                if not any(folder == m or folder.startswith(m + "/") for m in MARKETING_FOLDERS):
                    continue
            dead = bool(DEAD.search("/" + f["path"]))
            doc = f["ext"] in DOC_EXT
            out.append({
                "scope": scope,
                "folder": folder,
                "filename": f["name"],
                "ext": f["ext"],
                "size_mb": round(f["size"] / 1048576, 2),
                "modified": (f["modified"] or "")[:10],
                "modified_by": f["modified_by"] or "",
                # Suggestion, not a decision - Siddharth picks what to download and card.
                "suggest_ingest": "no" if (dead or not doc) else "yes",
                "skip_reason": "archive/draft folder" if dead else ("not a document" if not doc else ""),
                "web_url": f["web_url"] or "",
                "drive_id": inv[scope]["drive_id"],
                "item_id": f["item_id"],
            })
    out.sort(key=lambda r: (r["scope"], r["folder"], r["filename"]))
    return out


def main() -> None:
    if not INV.exists():
        raise SystemExit(f"missing {INV} - run sp_discover.py first")
    data = rows()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", newline="", encoding="utf-8-sig") as fh:  # utf-8-sig so Excel keeps accents
        w = csv.DictWriter(fh, fieldnames=list(data[0].keys()))
        w.writeheader()
        w.writerows(data)
    yes = sum(1 for r in data if r["suggest_ingest"] == "yes")
    by_scope: dict[str, int] = {}
    for r in data:
        by_scope[r["scope"]] = by_scope.get(r["scope"], 0) + 1
    print(f"{len(data)} files mapped ({yes} suggested for ingest)  {by_scope}")
    print("marketing folders included:", MARKETING_FOLDERS or "(none yet - add to MARKETING_FOLDERS)")
    print("->", OUT)


if __name__ == "__main__":
    main()
