"""Download a random sample of in-scope PDFs and measure how many extract no text.

Scanned/image-only PDFs index as empty documents, so SAM would list them and have nothing
to say. Metadata cannot tell you this - only extraction can - so sample rather than guess.
"""
from __future__ import annotations
import json, random, subprocess, urllib.request, io as _io
from pathlib import Path
from pypdf import PdfReader

GRAPH = "https://graph.microsoft.com/v1.0"
INV = Path(__file__).parent / "data" / "sharepoint_inventory.json"
SAMPLE = 40
MAX_MB = 40  # skip giants; they are rare and slow, counted separately


def token() -> str:
    return subprocess.run("az account get-access-token --resource https://graph.microsoft.com "
                          "--query accessToken -o tsv", capture_output=True, text=True,
                          shell=True).stdout.strip()


def main() -> None:
    inv = json.loads(INV.read_text(encoding="utf-8"))
    pdfs = [(s, f) for s, v in inv.items() for f in v["items"]
            if f["kind"] == "file" and f["ext"] == "pdf"]
    random.seed(7)
    pool = [x for x in pdfs if x[1]["size"] <= MAX_MB * 1048576]
    pick = random.sample(pool, min(SAMPLE, len(pool)))
    tok = token()
    empty = thin = ok = failed = 0
    for scope, f in pick:
        drive = inv[scope]["drive_id"]
        url = f"{GRAPH}/drives/{drive}/items/{f['item_id']}/content"
        try:
            req = urllib.request.Request(url, headers={"Authorization": f"Bearer {tok}"})
            with urllib.request.urlopen(req, timeout=120) as r:
                raw = r.read()
            rd = PdfReader(_io.BytesIO(raw))
            pages = len(rd.pages)
            text = "".join((p.extract_text() or "") for p in rd.pages[:10])
            per = len(text.strip()) / max(1, min(pages, 10))
            tag = "EMPTY" if per < 20 else ("THIN" if per < 150 else "ok")
            if tag == "EMPTY": empty += 1
            elif tag == "THIN": thin += 1
            else: ok += 1
            print(f"  {tag:6s} {per:7.0f} chars/pg  {pages:4d}pg  {f['size']/1048576:6.1f}MB  {f['name'][:52]}", flush=True)
        except Exception as e:
            failed += 1
            print(f"  FAIL   {type(e).__name__:20s} {f['name'][:52]}", flush=True)
    n = len(pick)
    print(f"\nsampled {n} of {len(pdfs)} PDFs: {ok} extract fine, {thin} thin, {empty} empty(scanned), {failed} unreadable")
    if n: print(f"  -> ~{(empty+thin)*100//n}% need OCR or manual carding; extrapolates to ~{(empty+thin)*len(pdfs)//n} of {len(pdfs)} PDFs")
    print(f"  PDFs over {MAX_MB}MB skipped from sampling: {sum(1 for _, f in pdfs if f['size'] > MAX_MB*1048576)}")


if __name__ == "__main__":
    main()
