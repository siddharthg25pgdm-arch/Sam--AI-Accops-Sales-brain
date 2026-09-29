"""Prepare tonight's carding work: pull the carding queue, copy each file from the OneDrive-synced
Sales Collateral folder into corpus/sharepoint/, and extract its text into corpus/text/.

The deterministic half of the nightly carding job. The other half - reading each document and
writing its card - needs Claude (the carding boundary: no document body goes to another model), and
is done by the `/sam-nightly-carding` skill, which runs this first and then works from the JSON it
writes. Kept separate so the copy/extract step can be run and checked on its own:

  python prototype/carding_prep.py            # prep up to 15 files, write corpus/queue-tonight.json
  python prototype/carding_prep.py --limit 5
  python prototype/carding_prep.py --dry-run  # show the queue, copy nothing

Why OneDrive: Microsoft Graph is blocked by a Conditional Access policy, but the OneDrive client
syncs the whole library to this laptop (Siddharth set it to "Always keep on this device").
"""
import json, os, shutil, subprocess, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).parent.parent
ONEDRIVE = Path(os.environ["USERPROFILE"]) / "OneDrive - Accops Systems Private Limited" / "Company - Sales Collateral"
TEXTABLE = {".pdf", ".docx", ".pptx", ".xlsx"}


def env() -> dict:
    out = {}
    for line in (ROOT / "web" / ".env.local").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"')
    return out


def queue() -> list[dict]:
    e = env()
    url, key = e["SUPABASE_URL"].rstrip("/"), e["SUPABASE_SERVICE_KEY"]
    req = urllib.request.Request(f"{url}/rest/v1/sam_carding_queue?select=item_id,folder,filename,reason,modified_at&order=modified_at.desc.nullslast&limit=500",
                                 headers={"apikey": key, "Authorization": f"Bearer {key}"})
    return json.load(urllib.request.urlopen(req, timeout=60))


def xlsx_text(p: Path) -> str:
    import re, zipfile
    with zipfile.ZipFile(p) as z:
        strings = re.findall(r"<t[^>]*>([^<]*)</t>", z.read("xl/sharedStrings.xml").decode("utf-8", "ignore")) if "xl/sharedStrings.xml" in z.namelist() else []
    return "\n".join(s for s in strings if s.strip())


def main() -> None:
    dry = "--dry-run" in sys.argv
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else 15
    rows = queue()
    print(f"queue: {len(rows)} ({', '.join(f'{r} {sum(1 for x in rows if x['reason']==r)}' for r in sorted({x['reason'] for x in rows}))})" if rows else "queue: empty")
    todo, skipped = [], []
    names = [r["filename"].lower() for r in rows]
    for r in rows:
        if len(todo) >= limit:
            break
        src = ONEDRIVE.joinpath(*[p for p in r["folder"].split("/") if p], r["filename"])
        if Path(r["filename"]).suffix.lower() not in TEXTABLE:
            skipped.append({**r, "why": "not a text document"}); continue
        if not src.exists():
            skipped.append({**r, "why": "not in the OneDrive folder yet (still syncing?)"}); continue
        dest = ROOT / "corpus" / "sharepoint" / r["filename"]
        if names.count(r["filename"].lower()) > 1 and dest.exists():
            skipped.append({**r, "why": "same filename in two folders - card by hand"}); continue
        if not dry:
            shutil.copy2(src, dest)
        todo.append({**r, "local": str(dest.relative_to(ROOT)), "text": f"corpus/text/{Path(r['filename']).stem}.txt"})
    if not dry and todo:
        subprocess.run([sys.executable, str(ROOT / "prototype" / "extract_text.py")], check=False)
        for t in todo:  # extract_text.py skips spreadsheets; do them here
            if t["filename"].lower().endswith(".xlsx"):
                txt = xlsx_text(ROOT / t["local"])
                if txt:
                    (ROOT / t["text"]).write_text(f"# source: sharepoint/{t['filename']}\n\n{txt}", encoding="utf-8")
        for t in todo:
            p = ROOT / t["text"]
            t["has_text"] = p.exists() and p.stat().st_size > 300
    out = {"todo": todo, "skipped": skipped, "queue_total": len(rows)}
    if not dry:
        (ROOT / "corpus" / "queue-tonight.json").write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"to card tonight: {len(todo)} | skipped: {len(skipped)}")
    for t in todo:
        print(f"  {t['reason']:<20} {t['filename']}" + ("" if dry or t.get("has_text") else "  (NO TEXT - card from title/folder, low confidence)"))
    for s in skipped:
        print(f"  skip  {s['filename']}: {s['why']}")


if __name__ == "__main__":
    main()
