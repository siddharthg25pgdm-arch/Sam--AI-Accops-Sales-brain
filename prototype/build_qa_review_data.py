"""Write web/data/web-qa-review.json: what the admin Website tab's approval view shows beside each draft pair and the
database does not store - why it needs Siddharth's sign-off, the drafter's note, and the verbatim evidence quotes.

  python prototype/build_qa_review_data.py            # from corpus/web/qa-*.json
  python prototype/build_qa_review_data.py --check    # exit 1 if the committed file is stale

load_web_knowledge.py keeps evidence and notes out of sam_web_qa on purpose (the review sheet carries them), so the tab
reads them from this file instead. Public data only (quotes from public pages); admin code imports it, website code never
does (scripts/web-guard.mjs flags any web/data file other than the intent index reached from a website entry).
Re-run after the web-knowledge agent changes the bank.
"""
from __future__ import annotations
import argparse, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "data" / "web-qa-review.json"


def build() -> dict:
    out: dict[str, dict] = {}
    for f in sorted((ROOT / "corpus" / "web").glob("qa-*.json")):
        raw = json.loads(f.read_text(encoding="utf-8"))
        items = raw if isinstance(raw, list) else raw.get("pairs") or raw.get("qa") or raw.get("items") or []
        for q in items:
            out[q["id"]] = {
                "reasons": [str(r) for r in q.get("approval_reasons") or []],
                "notes": (q.get("notes") or "").strip() or None,
                "evidence": [{"url": e["url"], "quote": e["quote"]} for e in q.get("evidence") or [] if e.get("url") and e.get("quote")],
            }
    return dict(sorted(out.items()))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    text = json.dumps(build(), ensure_ascii=False, indent=1) + "\n"
    if a.check:
        ok = OUT.exists() and OUT.read_text(encoding="utf-8") == text
        print("web-qa-review.json is current" if ok else "web-qa-review.json is stale: re-run without --check")
        sys.exit(0 if ok else 1)
    OUT.write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(json.loads(text))} pairs")


if __name__ == "__main__":
    main()
