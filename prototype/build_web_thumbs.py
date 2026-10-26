"""DocCard thumbnails: the first page of every public PDF the website Q&A bank links to -> web/public/web-thumbs/<slug>.webp
(640 x 400, 16:10, cropped from the top of the page, so the cover title shows).

usage (repo root):  python prototype/build_web_thumbs.py [extra-pdf-url ...]
Reads doc_card URLs from corpus/web/qa-citrix-lp.json (read only). Needs PyMuPDF + Pillow, both already used here.
Pages (not PDFs) use their og:image instead (sam_web_pages.thumb_url); this script does not touch them.
The loader sets visual_data.thumb = "/web-thumbs/<slug>.webp" when the file exists.
"""
import io
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "public" / "web-thumbs"
W, H = 640, 400


def slug(url: str) -> str:
    name = urllib.parse.unquote(url.rsplit("/", 1)[-1]).replace("+", " ")
    return re.sub(r"[^a-z0-9]+", "-", re.sub(r"\.pdf$", "", name, flags=re.I).lower()).strip("-")


def bank_pdfs() -> list[str]:
    bank = json.loads((ROOT / "corpus" / "web" / "qa-citrix-lp.json").read_text(encoding="utf-8"))
    urls = [c["url"] for q in bank if (q.get("visual") or {}).get("type") == "doc_card"
            for c in (q["visual"].get("data") or {}).get("cards", [])]
    return sorted({u for u in urls if re.search(r"\.pdf($|\?)", u, re.I)})


def thumb(pdf: bytes) -> bytes:
    page = fitz.open(stream=pdf, filetype="pdf")[0]
    pix = page.get_pixmap(matrix=fitz.Matrix(W / page.rect.width, W / page.rect.width), alpha=False)
    img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
    if img.height < H:                                    # landscape page: letterbox on white
        bg = Image.new("RGB", (W, H), "white")
        bg.paste(img, (0, (H - img.height) // 2))
        img = bg
    buf = io.BytesIO()
    img.crop((0, 0, W, H)).save(buf, "WEBP", quality=80, method=6)
    return buf.getvalue()


def main(extra: list[str]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for url in bank_pdfs() + extra:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (sam-accops web thumbs)"})
        try:
            data = urllib.request.urlopen(req, timeout=60).read()
            out = OUT / f"{slug(url)}.webp"
            out.write_bytes(thumb(data))
            print(f"ok   {out.name}  {out.stat().st_size // 1024} KB")
        except Exception as e:                             # one bad asset never blocks the rest
            print(f"FAIL {url}: {e}")


if __name__ == "__main__":
    assert slug("https://x/Accops%20DaaS%20Brochure%20V4%202026.pdf") == "accops-daas-brochure-v4-2026"
    assert slug("https://x/City+Pharmacy+Case+Study+.pdf") == "city-pharmacy-case-study"
    main(sys.argv[1:])
