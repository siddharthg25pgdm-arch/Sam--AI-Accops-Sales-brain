"""Extract text from corpus/ documents into corpus/text/, one .txt per source.

Separate from carding on purpose. Extraction is deterministic and cheap; carding costs a model call.
Splitting them means a card can be rewritten - a better prompt, a corrected schema - without
re-reading the PDFs, and a scanned document is caught here rather than silently producing an empty
card.

  python extract_text.py
"""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent / "corpus"
OUT = ROOT / "text"
# Below this, a document almost certainly has no text layer: it is scanned pages or pure imagery.
# prototype/build_cards.py already hit this with a 208 MB image-only government PDF.
MIN_CHARS = 200


def from_pdf(p: Path) -> str:
    from pypdf import PdfReader
    return "".join((pg.extract_text() or "") for pg in PdfReader(str(p)).pages)


def from_docx(p: Path) -> str:
    import zipfile, re
    with zipfile.ZipFile(p) as z:
        xml = z.read("word/document.xml").decode("utf-8", "ignore")
    # Paragraph breaks first, then strip tags - otherwise every paragraph runs together.
    xml = re.sub(r"</w:p>", "\n", xml)
    return re.sub(r"<[^>]+>", "", xml)


def from_pptx(p: Path) -> str:
    import zipfile, re
    out = []
    with zipfile.ZipFile(p) as z:
        slides = sorted((n for n in z.namelist() if n.startswith("ppt/slides/slide") and n.endswith(".xml")),
                        key=lambda n: int(re.search(r"slide(\d+)", n).group(1)))
        for i, n in enumerate(slides, 1):
            xml = z.read(n).decode("utf-8", "ignore")
            xml = re.sub(r"</a:p>", "\n", xml)
            text = re.sub(r"<[^>]+>", "", xml).strip()
            # Slide numbers travel with the text: a card that can cite "slide 7" is far more useful
            # to a rep than one that can only name the deck.
            if text:
                out.append(f"--- slide {i} ---\n{text}")
    return "\n\n".join(out)


READERS = {".pdf": from_pdf, ".docx": from_docx, ".pptx": from_pptx}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    done = skipped = empty = failed = 0
    for src in sorted([*(ROOT / "public").glob("*"), *(ROOT / "sharepoint").glob("*")]):
        if src.suffix.lower() not in READERS:
            continue
        dest = OUT / (src.stem + ".txt")
        if dest.exists() and dest.stat().st_mtime > src.stat().st_mtime:
            skipped += 1
            continue
        try:
            text = READERS[src.suffix.lower()](src).strip()
        except Exception as e:
            print(f"  FAIL   {src.name[:50]}: {str(e)[:60]}")
            failed += 1
            continue
        if len(text) < MIN_CHARS:
            # Flag rather than write: an empty card looks like a real one to everything downstream.
            print(f"  EMPTY  {src.name[:50]}  ({len(text)} chars - scanned? card by hand)")
            empty += 1
            continue
        # Source recorded in the file so a card can always be traced back to the document it came from.
        dest.write_text(f"# source: {src.parent.name}/{src.name}\n\n{text}", encoding="utf-8")
        print(f"  {len(text):>7} chars  {src.name[:50]}")
        done += 1
    print(f"\nextracted {done} | up to date {skipped} | no text {empty} | failed {failed}")


if __name__ == "__main__":
    main()
