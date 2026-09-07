"""Match SAM's assets to their public accops.com pages, so a rep has something sendable.

Why this exists. Every asset in SAM has public_url = null, which is why an audience=external search
returned nothing on 4 September and SAM reported a false gap while 18 BFSI case studies sat in the
library. The assets are not missing - they are just not marked as publicly available anywhere.

accops.com already publishes 64 of them: 37 case studies, 4 ebooks, 9 solution documents, 18
webinars. Matching by title fills public_url without needing an object-storage bucket that nobody
could confirm exists.

Matching notes, learned from the real data:
- The URL SLUG is the primary key, not <title>. 8 of 64 pages have the summary paragraph in their
  title tag ("With remote desktop tools restricted by cybersecurity mandates, a major..."), and
  fuzzy-matching a filename against 200 characters of prose produces confident nonsense.
- Everything is scored and nothing is auto-applied below a threshold. A wrong public link is worse
  than no public link: it sends a customer to the wrong company's case study.

  python sp_match_public.py            # report only
  python sp_match_public.py --write    # write public_url into the cards file
"""
from __future__ import annotations
import json, re, sys
from pathlib import Path

HERE = Path(__file__).parent
PAGES = HERE / "data" / "public_pages.json"
CARDS = HERE.parent / "web" / "data" / "asset_cards.json"

STOP = {"accops", "case", "study", "casestudy", "the", "a", "an", "for", "and", "of", "at", "in",
        "to", "with", "on", "v1", "v2", "v3", "final", "new", "old", "copy", "pdf", "docx", "pptx"}


def tokens(s: str) -> set[str]:
    s = re.sub(r"[^a-z0-9 ]+", " ", (s or "").lower())
    return {w for w in s.split() if len(w) > 2 and w not in STOP}


# A page whose slug is one or two generic words ("ztna", "vdi", "mfa", "daas for bfsi") is a category
# landing page, not a document. Overlap-over-min scores those 1.00 against every asset mentioning the
# word - seven different whitepapers all matched "ztna" on the first run, each with full confidence.
# A wrong public link sends a customer to the wrong page, so these are excluded from matching
# entirely rather than merely down-weighted.
GENERIC = {"ztna", "vdi", "mfa", "daas", "sso", "euc", "bfsi", "vpn", "byod"}


def is_landing(tok: set[str]) -> bool:
    return len(tok) <= 2 and tok.issubset(GENERIC)


def score(a: set[str], b: set[str]) -> float:
    """Overlap relative to the SMALLER set, not Jaccard.

    A short filename ("Kyoto University.pdf") against a long page title should score high when every
    word it has appears there. Jaccard punishes that for the length difference alone, which is the
    wrong instinct: the question is "is the short one contained in the long one", not "are these the
    same length".

    The floor matters as much as the ratio. min() over a one-token set is 1, so a single shared word
    scores a perfect 1.00 - which is how "ztna" beat every real candidate. Require at least two
    shared tokens before a match can be confident."""
    if not a or not b:
        return 0.0
    shared = a & b
    if len(shared) < 2:
        return 0.0
    return len(shared) / min(len(a), len(b))


def main() -> None:
    write = "--write" in sys.argv
    pages = json.loads(PAGES.read_text(encoding="utf-8"))
    data = json.loads(CARDS.read_text(encoding="utf-8"))
    assets = data["assets"]

    for p in pages:
        # Slug first: short, human-authored, stable. Title is a fallback and sometimes a paragraph.
        p["_slug_tok"] = tokens(p["slug_title"])
        p["_title_tok"] = tokens(p["title"])
        p["_landing"] = is_landing(p["_slug_tok"])

    hits, ambiguous, misses = [], [], []
    for a in assets:
        if a.get("public_url"):
            continue
        at = tokens(a.get("title", "")) | tokens(Path((a.get("file") or {}).get("path", "") or "").stem)
        scored = []
        for p in pages:
            if p["_landing"]:
                continue
            s = max(score(at, p["_slug_tok"]), score(at, p["_title_tok"]))
            if s > 0:
                scored.append((s, p))
        scored.sort(key=lambda x: -x[0])
        if not scored or scored[0][0] < 0.5:
            misses.append(a.get("title", "?"))
            continue
        best, second = scored[0], (scored[1] if len(scored) > 1 else (0.0, None))
        # A clear winner needs to beat the runner-up, not just pass the threshold. Two pages scoring
        # 0.8 and 0.79 means the filename is generic and neither is trustworthy.
        if best[0] >= 0.7 and best[0] - second[0] >= 0.15:
            hits.append((a, best[1], best[0]))
        else:
            ambiguous.append((a.get("title", "?"), [(round(s, 2), p["slug_title"][:44]) for s, p in scored[:3]]))

    print(f"assets without a public link : {sum(1 for a in assets if not a.get('public_url'))}")
    print(f"confident matches            : {len(hits)}")
    print(f"ambiguous, needs a human     : {len(ambiguous)}")
    print(f"no candidate                 : {len(misses)}")
    print("\n--- confident ---")
    for a, p, s in hits:
        print(f"  {s:.2f}  {a['title'][:48]:<50} -> {p['slug_title'][:44]}")
    if ambiguous:
        print("\n--- ambiguous (not written) ---")
        for title, cands in ambiguous[:10]:
            print(f"  {title[:48]}")
            for s, c in cands:
                print(f"        {s}  {c}")

    if not write:
        print("\nreport only - pass --write to fill public_url")
        return

    by_title = {a["title"]: a for a in assets}
    for a, p, _ in hits:
        by_title[a["title"]]["public_url"] = p["url"]
        # visibility says where the asset may go, and a published page means it can go outside.
        if by_title[a["title"]].get("visibility") == "private":
            by_title[a["title"]]["visibility"] = "both"
    CARDS.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"\nwrote {len(hits)} public_url values into {CARDS.name}")


if __name__ == "__main__":
    main()
