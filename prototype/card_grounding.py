"""Is every figure on a card in its own document? A grounding audit for SAM cards.

A card's brief and outcomes are what SAM's answer model reads and what the document lines quote, so a
number on a card that is not in the document it describes is an invented fact with SAM's name on it -
or a figure carried over from a sibling deck, which is the same thing to a rep. This script pulls every
figure out of a card's brief, key_problem, key_outcomes and use_for and checks it appears in THAT file's
text. It never edits a card: it reports, and the nightly gate turns a hit into a needs_human note.

  python prototype/card_grounding.py                      # local: corpus/cards/*.json against corpus/text/*.txt
  python prototype/card_grounding.py --batch corpus/cards/batch-auto-2026-10-27.json   # tonight's cards only
  python prototype/card_grounding.py --db                 # against the passages in Supabase (read-only)
  python prototype/card_grounding.py --max-rate 0.10      # exit 1 if more than 10% of figures are unbacked
  python prototype/card_grounding.py --self-check

What is NOT a claim, and is skipped: slide/page references ("slides 54-56", "(10)"), a document's own
length and dates ("a 62-slide deck", "last saved 18 May 2026"), years, 0-5, and numbers in the filename.
What is left and unbacked is one of three things: a figure the card brought in from elsewhere (fix the
card), a figure only in an image the extractor could not read (say so on the card), or a count the
carder made ("about 65 logos", "14 needs") - allowed, but it should read as a count, not a document claim.
Measured 26 Oct 2026 (--db): see docs/plans/2026-10-26-ingestion-roots-and-hardening.md.
"""
from __future__ import annotations
import argparse, collections, json, re, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import build_passages as bp  # noqa: E402 - the same card set and text mapping the passage build uses

MONTH = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?"
SKIP = [
    re.compile(r"\b(?:slides?|pages?|pp?\.|sections?|chapters?|tables?|figures?|steps?|annex(?:ure)?s?|appendix)\s*\(?\d[\d\s,\-–&]*(?:and\s+\d+)?\)?", re.I),
    re.compile(r"\(\s*\d+(?:\s*[-–,&]\s*\d+)*\s*\)"),                                      # "(10)", "(5-6)"
    re.compile(r"\b\d+[- ](?:slides?|pages?|minutes?|mins?|hours?|hrs?)\b", re.I),          # the document's own length
    re.compile(rf"\b\d{{1,2}}(?:st|nd|rd|th)?\s+{MONTH}\s*(?:\d{{4}})?|\b{MONTH}\s+\d{{1,2}}\b", re.I),  # dates
    re.compile(r"\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b"),                                      # 08-07-26
    re.compile(r"\bv\d+(?:\.\d+)*\b", re.I),                                                 # versions
]
NUM = re.compile(r"(?<![\w.])\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|(?<![\w.,])\d+(?:\.\d+)?")


def digits(s: str) -> str:
    return re.sub(r"(?<=\d),(?=\d)", "", s)


def claims(card: dict) -> list[tuple[str, str]]:
    """(figure, context) for every figure the card asserts about its document."""
    text = " | ".join([card.get("brief") or "", card.get("key_problem") or "", card.get("use_for") or "", *(card.get("key_outcomes") or [])])
    for rx in SKIP:
        text = rx.sub(" ", text)
    own = set(re.findall(r"\d+", (card.get("source") or "") + " " + (card.get("title") or "")))
    out, seen = [], set()
    for m in NUM.finditer(text):
        n = digits(m.group())
        if n in seen or n in own or re.fullmatch(r"(19|20)\d\d", n) or (n.isdigit() and int(n) <= 5):
            continue
        seen.add(n)
        out.append((n, text[max(0, m.start() - 45):m.end() + 25].strip()))
    return out


SCALES = (1, 1e3, 1e5, 1e6, 1e7, 1e9)   # as written, thousand, lakh, million, crore, billion


def backed(n: str, have: set[str], nums: list[float]) -> bool:
    """Written the same, or the same quantity rounded or restated in another unit: a card's "Rs 8.61 crore"
    is the deck's "8,61,10,150" and "Rs 1,196" is its "1,195.97". Within 1%, never for small whole numbers."""
    if n in have:
        return True
    v = float(n)
    if v < 10 and "." not in n:
        return False
    return any(abs(t - v * k) <= 0.01 * v * k for k in SCALES for t in nums)


def unbacked(card: dict, body: str) -> list[tuple[str, str]]:
    found = re.findall(r"\d+(?:\.\d+)?", digits(body))
    have, nums = set(found), sorted({float(x) for x in found})
    return [(n, ctx) for n, ctx in claims(card) if not backed(n, have, nums)]


def local_texts(cards: dict[str, dict]) -> dict[str, str]:
    """source -> extracted text, mapped exactly as build_passages.plan() maps it (PDF/PPTX twins share a file)."""
    twin: dict[str, list[str]] = {}
    for s in cards:
        twin.setdefault(bp.stem(s), []).append(s)
    out: dict[str, str] = {}
    for f in sorted(bp.TEXT.glob("*.txt")):
        head, _, body = f.read_text(encoding="utf-8", errors="ignore").partition("\n")
        src = head.removeprefix("# source:").strip()
        if src not in cards and len(twin.get(bp.stem(src), [])) == 1:
            src = twin[bp.stem(src)][0]
        if src in cards:
            out[src] = body
    return out


def db_texts() -> dict[str, str]:
    from load_cards import env, rest_all
    url, key = env()
    out: dict[str, list[str]] = collections.defaultdict(list)
    for r in rest_all(url, key, "sam_passages?select=source,ordinal,text&order=source,ordinal"):
        out[r["source"]].append(r["text"])
    return {s: " ".join(v) for s, v in out.items()}


def report(cards: dict[str, dict], texts: dict[str, str], show: int = 25) -> tuple[int, int, list]:
    total = bad = 0
    rows = []
    for src, c in cards.items():
        if src not in texts:
            continue
        cl = claims(c)
        miss = unbacked(c, texts[src])
        total += len(cl); bad += len(miss)
        if miss:
            rows.append((src, len(miss), len(cl), miss))
    rows.sort(key=lambda r: (-r[1], r[0]))
    checked = sum(1 for s in cards if s in texts)
    print(f"{checked} cards with text, {len(cards) - checked} without | {total} figures, {bad} not in the card's own text "
          f"({bad * 100 / max(total, 1):.1f}%) | {len(rows)} cards with at least one")
    for src, m, t, miss in rows[:show]:
        print(f"  {m}/{t}  {src}")
        for n, ctx in miss[:3]:
            print(f"        [{n}] ...{ctx}...")
    return total, bad, rows


def self_check() -> None:
    card = {"source": "sharepoint/Deck V4 2026.pptx", "title": "Deck V4",
            "brief": "A 62-slide deck (last saved 18 May 2026). Slides 54-56 list 900+ customers; index (5-6).",
            "key_outcomes": ["45,000 vendors on MFA at a large bank", "1,011 Mbps vs 258 Mbps for OpenVPN", "3 offices, 2M+ users"]}
    got = [n for n, _ in claims(card)]
    assert got == ["900", "45000", "1011", "258"], got
    body = "--- slide 3 ---\n900+ enterprise customers\n--- slide 9 ---\nMFA for 45,000 vendors. Throughput 1,011 Mbps."
    assert [n for n, _ in unbacked(card, body)] == ["258"], "258 is the one figure the deck does not contain"
    assert unbacked({**card, "key_outcomes": []}, body) == [], "a card backed by its text has nothing to report"
    tco = {"source": "x.pptx", "brief": "3-year TCO sized for about 20,000 users: Rs 8.61 crore (Rs 1,196/user/month)."}
    assert [n for n, _ in unbacked(tco, "Capex 3 Tier: 8,61,10,150.00 total, 43,055.08 per user, 1,195.97 per user per month (2,000 users)")] == ["20000"],         "unit restatements and rounding are backed; the tenfold sizing error is not"
    print("card_grounding self-check: ok")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", action="store_true")
    ap.add_argument("--batch")
    ap.add_argument("--max-rate", type=float)
    ap.add_argument("--show", type=int, default=25)
    ap.add_argument("--json")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args()
    if a.self_check:
        return self_check()
    cards = bp.cards()
    if a.batch:
        d = json.loads(Path(a.batch).read_text(encoding="utf-8"))
        want = {c["source"] for c in (d["cards"] if isinstance(d, dict) else d)}
        cards = {s: c for s, c in cards.items() if s in want} or {c["source"]: c for c in (d["cards"] if isinstance(d, dict) else d)}
    texts = db_texts() if a.db else local_texts(cards)
    total, bad, rows = report(cards, texts, a.show)
    if a.json:
        Path(a.json).write_text(json.dumps([{"source": s, "unbacked": [n for n, _ in m], "figures": t} for s, _, t, m in rows], indent=1), encoding="utf-8")
    if a.max_rate is not None and total and bad / total > a.max_rate:
        sys.exit(1)


if __name__ == "__main__":
    main()
