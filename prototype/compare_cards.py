"""Compare the cards in corpus/cards/ against the hand-written ones in data/asset_cards.json.

This is the build-order step 2 quality gate. It has already earned its keep twice: once catching a
hand card with zero key outcomes, and once catching four outcomes the generated cards had dropped
that the documents plainly supported.

  python compare_cards.py            # compare, print a report
  python compare_cards.py --strict   # exit 1 if any pair looks wrong, for a pre-commit hook

What it does NOT do is decide who is right. It surfaces the disagreement; a human reads the source
text and settles it. The one time this project let a similarity score decide, sp_match_public.py
reported 31 confident matches and most of them were wrong.
"""
from __future__ import annotations
import argparse, json, re, sys
from pathlib import Path

HERE = Path(__file__).parent
HAND = HERE / "data" / "asset_cards.json"
CARDS = HERE.parent / "corpus" / "cards"
TEXT = HERE.parent / "corpus" / "text"

# Words that appear in nearly every filename here and so carry no matching signal.
STOP = {"accops", "the", "and", "for", "pdf", "pptx", "docx", "with", "systems", "case", "study"}
# Below this, two documents are unrelated. Above it a human still has to confirm - see MISMATCHED_TYPE.
MATCH_FLOOR = 0.55


def toks(s: str | None) -> set[str]:
    return {t for t in re.split(r"[^a-z0-9]+", (s or "").lower()) if len(t) > 2 and t not in STOP}


def match(new: list[dict], hand: list[dict]) -> list[tuple[float, dict, dict]]:
    """Pair each new card with its closest hand-written card by filename and title tokens."""
    out = []
    for c in new:
        ct = toks(Path(c["source"]).stem)
        best, score = None, 0.0
        for h in hand:
            ht = toks(h.get("inventory_filename")) | toks(h.get("title"))
            if not ht or not ct:
                continue
            # Overlap over min() deliberately, because filenames vary in length - but it is exactly
            # why a subset scores 1.00 (a brochure against a case study for the same product), so
            # asset_type is checked below rather than trusting the number.
            ov = len(ct & ht) / min(len(ct), len(ht))
            if ov > score:
                best, score = h, ov
        if score >= MATCH_FLOOR:
            out.append((score, c, best))
    return out


def report(score: float, n: dict, h: dict) -> list[str]:
    """Return the list of disagreements worth a human's attention. Empty means the pair agrees."""
    issues = []
    nt, ht = n.get("asset_type", ""), h.get("asset_type", "")
    if nt and ht and nt.split()[0].lower() != ht.split()[0].lower():
        issues.append(f"TYPE MISMATCH - new={nt!r} hand={ht!r}. Likely not the same document at all.")
    hn, nn = len(h.get("key_outcomes") or []), len(n.get("key_outcomes") or [])
    if hn == 0:
        issues.append(f"hand card has ZERO key outcomes (new has {nn}) - the hand card is the thin one")
    elif hn > nn:
        issues.append(f"hand card has MORE outcomes ({hn}) than the new one ({nn}) - check for dropped facts")
    # An outcome only the hand card has is the case that actually cost us four facts. Compare on
    # numbers, since wording always differs but a figure either is in the document or is not.
    def figures(items):
        return {f for o in items or [] for f in re.findall(r"\d[\d,]*\+?", o)}
    only_hand = figures(h.get("key_outcomes")) - figures(n.get("key_outcomes"))
    if only_hand:
        issues.append(f"figures only in the hand card: {sorted(only_hand)} - verify each in corpus/text/ before dismissing")
    if not n.get("publish_year") and not h.get("publish_year"):
        issues.append("neither card has a publication year - SAM cannot warn that this is stale")
    return issues


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true", help="exit 1 if any pair has issues")
    a = ap.parse_args()

    hand = json.loads(HAND.read_text(encoding="utf-8"))["assets"]
    new = [c for b in sorted(CARDS.glob("batch-*.json"))
             for c in json.loads(b.read_text(encoding="utf-8"))["cards"]]
    pairs = match(new, hand)
    print(f"{len(new)} generated cards, {len(hand)} hand-written, {len(pairs)} overlap\n")

    bad = 0
    for score, n, h in sorted(pairs, key=lambda p: -p[0]):
        issues = report(score, n, h)
        flag = "!!" if issues else "ok"
        print(f"[{flag}] {score:.2f}  {Path(n['source']).name}")
        print(f"         hand: {h.get('title')}")
        for i in issues:
            print(f"         -> {i}")
        bad += bool(issues)
    print(f"\n{bad} of {len(pairs)} pairs need a human to look at the source text.")
    if a.strict and bad:
        sys.exit(1)


if __name__ == "__main__":
    main()
