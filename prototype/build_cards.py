"""Build data/asset_cards.json: the local RAG source for the SAM prototype.

Mirrors the codelab's menu.json, but built from real Accops collateral:
  1. Parse the hand-written 68-document inventory (type, industry, products, brief, use-for).
  2. Match each inventory entry to a file on disk under Downloads/Assets.
  3. Pull page count and first-pages text from each PDF with pypdf (free, local, no LLM).

Re-run whenever the inventory or the Assets folder changes:  python build_cards.py
"""
from __future__ import annotations
import json, re, sys, hashlib
from urllib.parse import quote
from pathlib import Path
from rapidfuzz import fuzz, process
from pypdf import PdfReader

HOME = Path.home()
INVENTORY = HOME / "Downloads" / "Accops_Project_Document_Inventory (1).md"
ASSETS = HOME / "Downloads" / "Assets"
OUT = Path(__file__).parent / "data" / "asset_cards.json"
MAX_TEXT_PAGES = 3          # first pages only: enough for retrieval, cheap to extract
SKIP_TEXT_OVER_MB = 50      # the 208 MB compiled Govt PDF is image-heavy; metadata only

FIELD_RE = re.compile(r"\*\*(?P<k>[A-Za-z /-]+):\*\*\s*(?P<v>.*?)(?=\s{2,}\*\*[A-Za-z /-]+:\*\*|$)")

def norm(s: str) -> str:
    s = s.lower()
    s = re.sub(r"\.(pdf|docx)$", "", s).replace("_", " ")
    s = s.replace("accops", "").replace("case study", "").replace("casestudy", "")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())

def parse_inventory(md: str) -> list[dict]:
    cards, section = [], ""
    blocks = re.split(r"\n(?=### \d+\. )", md)
    for b in blocks:
        head = re.match(r"### (\d+)\. (.+)", b)
        if not head:
            continue
        # section header for this block lives in the text before it; track separately
        n, fname = int(head.group(1)), head.group(2).strip()
        body = b[head.end():]
        fields: dict[str, str] = {}
        for line in body.splitlines():
            line = line.strip()
            if not line.startswith("**"):
                continue
            # a line can hold several "**Key:** value |" pairs
            for part in re.split(r"\s\|\s", line):
                m = re.match(r"\*\*([A-Za-z /-]+):\*\*\s*(.*)", part.strip())
                if m:
                    fields[m.group(1).strip()] = m.group(2).strip().rstrip("|").strip()
        outcomes = re.findall(r"^- (.+)$", body, flags=re.M)
        cards.append({
            "inventory_id": n,
            "inventory_filename": fname,
            "title": fields.get("Title") or " ".join(re.sub(r"(?<=[a-z])(?=[A-Z])", " ", fname.replace("_", " ").replace(".pdf", "")).split()),
            "asset_type": fields.get("Type", "").split("|")[0].strip(),
            "industry": fields.get("Industry", ""),
            "client": fields.get("Client", ""),
            "products": [p.strip() for p in re.split(r",|/", fields.get("Products", "")) if p.strip()],
            "key_problem": fields.get("Key Problem", ""),
            "key_outcomes": outcomes,
            "brief": fields.get("Brief", ""),
            "use_for": fields.get("Use for", ""),
        })
    # attach section (vertical grouping) by scanning headers in order
    sec_iter = [(m.start(), m.group(1)) for m in re.finditer(r"^## (SECTION \d+: .+)$", md, flags=re.M)]
    for c in cards:
        pos = md.find(f"### {c['inventory_id']}. ")
        c["section"] = next((name for start, name in reversed(sec_iter) if start < pos), "")
    return cards

def disk_files() -> list[Path]:
    return sorted(p for p in ASSETS.rglob("*") if p.suffix.lower() in {".pdf", ".docx"})

def pdf_meta(p: Path) -> dict:
    meta = {"pages": None, "text_excerpt": "", "pdf_title": ""}
    if p.suffix.lower() != ".pdf":
        return meta
    try:
        r = PdfReader(str(p))
        meta["pages"] = len(r.pages)
        meta["pdf_title"] = (r.metadata.title or "") if r.metadata else ""
        if p.stat().st_size / 1_048_576 <= SKIP_TEXT_OVER_MB:
            txt = " ".join((pg.extract_text() or "") for pg in r.pages[:MAX_TEXT_PAGES])
            meta["text_excerpt"] = re.sub(r"\s+", " ", txt)[:1500]
    except Exception as e:  # keep going; a bad PDF should not sink the build
        meta["error"] = str(e)[:120]
    return meta

def main() -> None:
    md = INVENTORY.read_text(encoding="utf-8")
    cards = parse_inventory(md)
    files = disk_files()
    choices = {norm(p.name): p for p in files}
    matched, unmatched_files = set(), set(files)
    for c in cards:
        q = norm(c["inventory_filename"])
        best = process.extractOne(q, list(choices.keys()), scorer=fuzz.token_set_ratio)
        if not (best and best[1] >= 70):
            # second pass ignoring spaces: "iitbombay" vs "iit bombay"
            squished = {k.replace(" ", ""): k for k in choices}
            b2 = process.extractOne(q.replace(" ", ""), list(squished.keys()), scorer=fuzz.ratio)
            best = (squished[b2[0]], b2[1]) if b2 and b2[1] >= 80 else None
        if best and best[1] >= 70:
            p = choices[best[0]]
            c["file"] = {
                "path": str(p.relative_to(ASSETS)).replace("\\", "/"),
                "ext": p.suffix.lower().lstrip("."),
                "size_mb": round(p.stat().st_size / 1_048_576, 2),
                "match_score": best[1],
                "sha1": hashlib.sha1(p.read_bytes()).hexdigest()[:12] if p.stat().st_size < 60_000_000 else None,
            }
            c["file"].update(pdf_meta(p))
            matched.add(p); unmatched_files.discard(p)
        else:
            c["file"] = None
    # visibility placeholder: everything on disk is the private SharePoint copy until the bucket map exists
    for c in cards:
        c["visibility"] = "private"
        c["public_url"] = None
        c["sharepoint_url"] = "https://accops.sharepoint.com/sites/Sales/Shared%20Documents/" + quote(c["file"]["path"]) if c.get("file") else None
    # files on disk that the inventory does not know about
    extras = []
    for p in sorted(unmatched_files):
        m = pdf_meta(p)
        extras.append({
            "inventory_id": None, "inventory_filename": None, "title": p.stem,
            "asset_type": "Whitepaper" if "white paper" in str(p).lower() else "Case Study",
            "industry": p.parent.name, "client": "", "products": [], "key_problem": "", "key_outcomes": [],
            "brief": "", "use_for": "", "section": "UNINVENTORIED",
            "file": {"path": str(p.relative_to(ASSETS)).replace("\\", "/"), "ext": p.suffix.lower().lstrip("."),
                     "size_mb": round(p.stat().st_size / 1_048_576, 2), "match_score": None, "sha1": None, **m},
            "visibility": "private", "public_url": None,
            "sharepoint_url": "https://accops.sharepoint.com/sites/Sales/Shared%20Documents/" + quote(str(p.relative_to(ASSETS)).replace(chr(92), "/")),
        })
    out = {"generated_from": {"inventory": INVENTORY.name, "assets_dir": str(ASSETS)},
           "counts": {"inventory_entries": len(cards), "matched_to_disk": sum(1 for c in cards if c["file"]),
                      "files_on_disk": len(files), "uninventoried_files": len(extras)},
           "assets": cards + extras}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(out["counts"], indent=2))
    print("unmatched inventory entries:")
    for c in cards:
        if not c["file"]:
            print("  -", c["inventory_filename"])
    print("uninventoried files:")
    for e in extras:
        print("  -", e["file"]["path"])

if __name__ == "__main__":
    main()
