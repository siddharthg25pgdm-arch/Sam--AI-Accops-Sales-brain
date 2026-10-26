"""Build SAM passages - what each carded document says, page by page - into Supabase sam_passages
(docs/supabase-sam-passages.sql). Runs after load_cards.py in the nightly carding job.

  python prototype/build_passages.py --dry-run     # offline: split everything, print counts, write nothing
  python prototype/build_passages.py               # upload documents whose text, audience or extractor changed
  python prototype/build_passages.py --self-check  # offline asserts: splitting, locators, scrubbing, policy

Which documents: every corpus/text/*.txt whose "# source:" header is the source of a card in
corpus/cards/*.json (no card, no passages), and only PDF, PPTX and DOCX (spreadsheets are tables of
figures, which a model misquotes; they are not evidence for a sentence).

Passages: split by page (PDF "--- page N ---"), slide (PPTX "--- slide N ---") or heading (DOCX "## "),
never across one, then packed at sentence boundaries into ~400-1,200 characters. E-mail addresses,
phone numbers, IP addresses and credentials are replaced before anything leaves the laptop.

Audience: 'public' when the card is published (visibility both, with a public URL), else 'internal'.
Policy (Siddharth, 17 Oct 2026): internal passages are indexed. SAM_PASSAGES_INTERNAL=0 in the
environment is the kill switch: public documents only, and every internal row is deleted. Set the same
variable in Vercel to stop the API serving them at once (web/lib/passages.ts).
"""
from __future__ import annotations
import argparse, hashlib, html, json, os, re, sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = Path(os.environ.get("SAM_CORPUS") or HERE.parent / "corpus")
TEXT = ROOT / "text"
CARDS = HERE.parent / "corpus" / "cards"
# Bump to rebuild every document (the comparison is on doc_version, audience and this).
EXTRACTOR = "build_passages.py@2"   # @2, 26 Oct 2026: chart and table values on their own line are kept
INDEXED = (".pdf", ".pptx", ".docx")
MIN, SOFT, TARGET, MAX = 40, 400, 1200, 2000

MARK = re.compile(r"^--- (page|slide) (\d+) ---[ \t]*$", re.M)
# Page furniture repeated on every page: page numbers, copyright and confidentiality footers, the URL.
BOILER = re.compile(r"^(.*(©|copyright|all rights reserved).*|(https?://)?(www\.)?accops\.com/?|(accops )?confidential)$", re.I)
BULLET = re.compile(r"^[•▪●◦▶➢➤✓✔■□○]+\s*")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
# International (+...), dashed or dotted groups, an Indian "98765 43210", or 10-12 bare digits. Not plain
# space-separated numbers: a table row "100 200 500 1000" is figures, not a phone number.
PHONE = re.compile(r"\+\d[\d ()-]{8,16}\d|\b\d{3,5}[-.]\d{3,4}[-.]\d{3,5}\b|\b\d{5} \d{5}\b|\b\d{10,12}\b")
IPV4 = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
SECRET = re.compile(r"(?i)\b(password|passwd|pwd|passcode|pin|api[ _-]?key|secret|token|username|user ?id|login)(\s*[:=]\s*)\S+")


def internal_enabled() -> bool:
    return os.environ.get("SAM_PASSAGES_INTERNAL", "1").strip() != "0"


def scrub(s: str) -> str:
    """The carding rule for cards applies to passages too: no contact details or credentials."""
    s = EMAIL.sub("[email]", s)
    s = SECRET.sub(lambda m: f"{m.group(1)}{m.group(2)}[redacted]", s)
    s = IPV4.sub("[ip]", s)
    return PHONE.sub(lambda m: "[phone]" if 10 <= sum(ch.isdigit() for ch in m.group()) <= 15 else m.group(), s)


def page_number(line: str, at: int | None) -> bool:
    """A bare 1-3 digit line is page furniture only when it is (about) this page's or slide's own number.
    @1 dropped every bare number, and with it every chart and table value on a line of its own: the Turbo
    benchmark's "258" (Mbps, OpenVPN) was in six documents' text and in none of their passages."""
    return line.isdigit() and len(line) <= 3 and (at is None or abs(int(line) - at) <= 2)


def flow(text: str, at: int | None = None) -> str:
    """Extracted lines -> one paragraph. A line that ends a sentence or wraps into a lowercase line joins
    with a space; otherwise it was a bullet or a heading, kept apart with " · "."""
    out = ""
    for line in (BULLET.sub("", l.strip()) for l in html.unescape(text).splitlines()):
        if not line or BOILER.match(line) or page_number(line, at):
            continue
        if not out:
            out = line
        elif re.search(r"[.!?:;,]$", out) or line[0].islower():
            out += " " + line
        else:
            out += " · " + line
    return re.sub(r"\s+", " ", out).strip()


def units(body: str) -> list[tuple[dict, str]]:
    """(locator, text) per page or slide; a document without markers is split at its "## " headings."""
    parts = MARK.split(body)
    if len(parts) > 1:
        out = [({}, parts[0])] if parts[0].strip() else []
        out += [({parts[i]: int(parts[i + 1])}, parts[i + 2]) for i in range(1, len(parts) - 2, 3)]
        return out
    out, sec, buf = [], None, []
    for line in body.splitlines():
        if line.startswith("## "):
            if "".join(buf).strip():
                out.append(({"section": sec} if sec else {}, "\n".join(buf)))
            sec, buf = line[3:].strip()[:120], [line[3:]]
        else:
            buf.append(line)
    if "".join(buf).strip():
        out.append(({"section": sec} if sec else {}, "\n".join(buf)))
    return out


def pack(text: str) -> list[str]:
    """One unit's paragraph -> passages of ~SOFT..TARGET characters, cut after a sentence or before a
    bullet; never more than MAX. A short tail joins the passage before it."""
    pieces: list[str] = []
    for p in re.split(r"(?<=[.!?])\s+|\s+(?=·\s)", text):
        while len(p) > TARGET:  # a table or a run-on line: cut at a word boundary
            cut = p.rfind(" ", 0, TARGET)
            cut = cut if cut > SOFT else TARGET
            pieces.append(p[:cut]); p = p[cut:].strip()
        if p:
            pieces.append(p)
    out: list[str] = []
    cur = ""
    for p in pieces:
        if cur and (len(cur) + 1 + len(p) > MAX or (len(cur) >= SOFT and len(cur) + 1 + len(p) > TARGET)):
            out.append(cur); cur = p
        else:
            cur = f"{cur} {p}" if cur else p
    if cur:
        if out and len(cur) < 200 and len(out[-1]) + 1 + len(cur) <= MAX:
            out[-1] += " " + cur
        else:
            out.append(cur)
    return [s for s in (re.sub(r"^·\s*", "", o).strip() for o in out) if len(s) >= MIN]


def passages(body: str, audience: str) -> list[dict]:
    """A document's text (after the "# source:" header) -> sam_passages_replace rows."""
    body = body.replace("\x00", "")  # PDF glyphs the extractor lost ("Pro\x00ile"); Postgres text rejects NUL
    version = hashlib.sha256(body.encode("utf-8")).hexdigest()[:16]
    rows, seen = [], set()
    for loc, text in units(body):
        n = loc.get("page") or loc.get("slide")
        for t in pack(scrub(flow(text, n if n else None))):
            if t.lower() in seen:  # the same footer or disclaimer on every page
                continue
            seen.add(t.lower())
            rows.append({"ordinal": len(rows), "locator": loc, "text": t, "audience": audience,
                         "doc_version": version, "extractor": EXTRACTOR})
    return rows


def cards() -> dict[str, dict]:
    out = {}
    for f in sorted(CARDS.glob("batch-*.json")):
        for c in json.loads(f.read_text(encoding="utf-8"))["cards"]:
            out[c["source"]] = c
    return out


def stem(source: str) -> str:
    """'sharepoint/Deck v2.pptx' -> 'sharepoint/deckv2': the folder plus load_cards.stem()."""
    folder, _, name = source.rpartition("/")
    return f"{folder}/{re.sub(r'[^a-z0-9]', '', re.sub(r'[.](pdf|docx|pptx|doc|ppt|xlsx)$', '', name.lower()))}"


def audience_of(card: dict) -> str:
    """lib/cards-cache.ts: 'both' + a public URL = published; everything else is internal."""
    return "public" if card.get("visibility") == "both" and (card.get("public_url") or "").strip() else "internal"


def plan() -> tuple[dict[str, list[dict]], dict[str, int]]:
    """source -> passages for every document to index, plus counts of what was left out and why."""
    cs, out = cards(), {}
    # extract_text.py names a text file after the document's stem, so a PDF/PPTX twin pair shares one
    # file (the PPTX, read last, wins). A card written for the PDF twin is the same document: use it.
    twin: dict[str, list[str]] = {}
    for s in cs:
        twin.setdefault(stem(s), []).append(s)
    why = {"no card": 0, "not pdf/pptx/docx": 0, "internal, switched off": 0, "no passages": 0}
    for f in sorted(TEXT.glob("*.txt")):
        raw = f.read_text(encoding="utf-8", errors="ignore")
        head, _, body = raw.partition("\n")
        source = head.removeprefix("# source:").strip()
        if source not in cs and len(twin.get(stem(source), [])) == 1:
            source = twin[stem(source)][0]
        card = cs.get(source)
        if not card:
            why["no card"] += 1; continue
        if not source.lower().endswith(INDEXED):
            why["not pdf/pptx/docx"] += 1; continue
        aud = audience_of(card)
        if aud == "internal" and not internal_enabled():
            why["internal, switched off"] += 1; continue
        rows = passages(body, aud)
        if not rows:
            why["no passages"] += 1; continue
        out[source] = rows
    return out, why


def self_check() -> None:
    pdf = ("--- page 1 ---\nAccops HySecure\nZero Trust Network Access\n© 2026 Accops - All Rights Reserved\n3\n\n"
           "--- page 2 ---\n" + "HySecure checks device posture before it grants access to an application. " * 30 +
           "\nContact sales@accops.com or +91 98765 43210. Admin password: Hunter2! Gateway at 10.20.30.40.\n"
           "It supports 1,200 concurrent users per gateway &amp; scales out. Sizing: 100 200 500 1000 2000 users.\n\n--- page 3 ---\nShort.\n")
    rows = passages(pdf, "internal")
    assert rows[0]["locator"] == {"page": 1} and rows[0]["text"].startswith("Accops HySecure · Zero Trust"), rows[0]
    assert all("All Rights" not in r["text"] for r in rows), "boilerplate dropped"
    p2 = [r for r in rows if r["locator"] == {"page": 2}]
    assert len(p2) >= 2 and all(MIN <= len(r["text"]) <= MAX for r in rows), [len(r["text"]) for r in rows]
    assert all(len(r["text"]) <= TARGET + 200 for r in p2[:-1]), "packed near the target"
    tail = p2[-1]["text"]
    assert "[email]" in tail and "[phone]" in tail and "password: [redacted]" in tail and "[ip]" in tail, tail
    assert "Hunter2" not in tail and "98765" not in tail and "1,200 concurrent users" in tail and "& scales" in tail, tail
    assert "100 200 500 1000 2000 users" in tail, "figures in a table are not phone numbers"
    chart = passages("--- page 7 ---\nAccops Turbo throughput, higher is better.\n1011\n258\n7\nMbps\n", "internal")[0]["text"]
    assert "258" in chart and "1011" in chart and " 7 " not in f" {chart} ", f"chart values stay, the page's own number goes: {chart}"
    assert not any(r["locator"] == {"page": 3} for r in rows), "a page under 40 characters gives no passage"
    assert [r["ordinal"] for r in rows] == list(range(len(rows))) and len({r["doc_version"] for r in rows}) == 1
    assert passages(pdf, "internal")[0]["doc_version"] == rows[0]["doc_version"], "version is the text's hash"
    assert passages(pdf + "x", "internal")[0]["doc_version"] != rows[0]["doc_version"], "new text, new version"
    deck = "--- slide 1 ---\nWhy Accops\n800+\nEnterprise customers served across banking and government\n\n--- slide 7 ---\n" \
           "HyWorks replaces Citrix without new hardware.\nMigration takes six weeks for a typical bank."
    d = passages(deck, "public")
    assert [r["locator"] for r in d] == [{"slide": 1}, {"slide": 7}] and d[1]["audience"] == "public", d
    doc = "## Overview\nAccops Digital Workspace lets staff work from home securely on any device they own.\n" \
          "## Architecture\nThe gateway sits in the DMZ and brokers every session to the data centre."
    assert [r["locator"] for r in passages(doc, "internal")] == [{"section": "Overview"}, {"section": "Architecture"}]
    assert passages("x" * 30, "public") == [], "nothing under MIN"
    assert "\x00" not in passages("--- page 1 ---\n" + "Reviewer Pro\x00ile. " * 10, "public")[0]["text"], "Postgres rejects NUL"
    # Policy: the kill switch and the card gate.
    global TEXT, CARDS
    import tempfile
    with tempfile.TemporaryDirectory() as t:
        TEXT, CARDS = Path(t) / "text", Path(t) / "cards"
        TEXT.mkdir(); CARDS.mkdir()
        (CARDS / "batch-01.json").write_text(json.dumps({"cards": [
            {"source": "sharepoint/In.pdf", "visibility": "internal", "public_url": ""},
            {"source": "public/Out.pdf", "visibility": "both", "public_url": "https://www.accops.com/x.pdf"},
            {"source": "sharepoint/Sheet.xlsx", "visibility": "internal", "public_url": ""},
            {"source": "sharepoint/Twin Deck.pdf", "visibility": "internal", "public_url": ""}]}), encoding="utf-8")
        for name, src in (("In", "sharepoint/In.pdf"), ("Out", "public/Out.pdf"), ("Sheet", "sharepoint/Sheet.xlsx"), ("Orphan", "sharepoint/Orphan.pdf"),
                          ("Twin Deck", "sharepoint/Twin Deck.pptx")):
            (TEXT / f"{name}.txt").write_text(f"# source: {src}\n\n{pdf}", encoding="utf-8")
        got, why = plan()
        assert set(got) == {"sharepoint/In.pdf", "public/Out.pdf", "sharepoint/Twin Deck.pdf"}, "a PPTX text indexes its carded PDF twin"
        assert got["sharepoint/In.pdf"][0]["audience"] == "internal"
        assert got["public/Out.pdf"][0]["audience"] == "public" and why["no card"] == 1 and why["not pdf/pptx/docx"] == 1, why
        os.environ["SAM_PASSAGES_INTERNAL"] = "0"
        try:
            got, why = plan()
        finally:
            del os.environ["SAM_PASSAGES_INTERNAL"]
        assert set(got) == {"public/Out.pdf"} and why["internal, switched off"] == 2, "kill switch: public only"
    print("build_passages self-check: ok")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args()
    if a.self_check:
        return self_check()
    want, why = plan()
    n = sum(len(v) for v in want.values())
    lens = sorted(len(r["text"]) for v in want.values() for r in v)
    aud = {k: sum(1 for v in want.values() if v[0]["audience"] == k) for k in ("public", "internal")}
    located = sum(1 for v in want.values() for r in v if r["locator"])
    print(f"internal passages: {'ON' if internal_enabled() else 'OFF (SAM_PASSAGES_INTERNAL=0)'}")
    print(f"{len(want)} documents ({aud['public']} public, {aud['internal']} internal) -> {n} passages"
          + (f" | length p10/p50/p90 {lens[len(lens) // 10]}/{lens[len(lens) // 2]}/{lens[len(lens) * 9 // 10]}"
             f" | with a page/slide/section {located * 100 // max(n, 1)}%" if n else ""))
    print("  left out: " + ", ".join(f"{k} {v}" for k, v in why.items()))
    if a.dry_run:
        print("  dry run: nothing written.")
        return
    from load_cards import env, rest, rest_all  # same credentials and project check as the card loader
    url, key = env()
    # Paged: a capped read would make every document past the 1,000th look new (re-uploaded nightly).
    have = {r["source"]: r for r in rest_all(url, key, "sam_passages?select=source,doc_version,extractor,audience&ordinal=eq.0&order=source")}
    changed = [s for s, rows in want.items()
               if (have.get(s) or {}).get("doc_version") != rows[0]["doc_version"]
               or have[s].get("extractor") != EXTRACTOR or have[s].get("audience") != rows[0]["audience"]]
    gone = [s for s in have if s not in want]
    for s in changed:
        rest(url, key, "rpc/sam_passages_replace", "POST", {"p_source": s, "p_rows": want[s]})
    for s in gone:  # text removed, card gone to a spreadsheet, or internal with the switch off
        rest(url, key, "rpc/sam_passages_replace", "POST", {"p_source": s, "p_rows": []})
    if not internal_enabled():  # belt and braces: nothing internal survives the switch
        rest(url, key, "sam_passages?audience=eq.internal", "DELETE")
    stats = (rest(url, key, "rpc/sam_passages_stats", "POST", {}) or [{}])[0]
    print(f"\nwrote {len(changed)} documents, removed {len(gone)}, {len(want) - len(changed)} unchanged"
          f" | table: {stats.get('documents')} documents, {stats.get('passages')} passages ({stats.get('internal_passages')} internal)")


if __name__ == "__main__":
    main()
