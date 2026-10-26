"""Page cards for the public website chatbot (PRD-website-chatbot.md, section 3).

  python prototype/web_pages.py            # fetch changed pages, rebuild both card files
  python prototype/web_pages.py --refetch  # ignore the raw cache and fetch everything again
  python prototype/web_pages.py --offline  # rebuild from the raw cache only

Sources: every URL in accops.com's sitemaps (found via robots.txt) and every <section> of the Citrix LP.
Plain HTTP, 4 at a time, no scraping services. Extracted page text is cached in corpus/web-raw/ (gitignored);
only the cards in corpus/web/ are committed.

Card fields are of two kinds:
  * mechanical, recomputed every run: url, title, page_type, products, industries, cta, fetched_at, content_hash
  * judgement (summary, facts, questions_answered): written by Claude (carded_by="claude") and carried forward
    while content_hash is unchanged. A changed or new page gets an auto baseline (carded_by="auto",
    needs_recard=true): meta description as summary, verbatim number/claim sentences as facts.
Every fact's quote is re-checked against the current page text on every run; a quote that is no longer on
the page is dropped and logged, so a card can never carry a claim the page stopped making.
"""
from __future__ import annotations
import argparse, hashlib, json, re, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup, Comment

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "corpus" / "web"
RAW = ROOT / "corpus" / "web-raw" / "pages"
TERMS_SQL = ROOT / "docs" / "brain" / "01-core-reference-lists.sql"
SITE = "https://www.accops.com"
WP_API = "https://blogs.accops.com/wp-json/wp/v2/posts"
LP = "https://accops-citrix-lp.vercel.app/"
UA = {"User-Agent": "Mozilla/5.0 (SAM web carding; +https://www.accops.com)"}
WORKERS = 4  # laptop has 7.7 GB and accops.com is our own site: stay gentle

LEGAL = {"privacy-policy", "license-agreement", "terms-of-use", "cookie-preferences", "accessibility"}
INDUSTRY_SLUGS = "/industry-solutions/"
NO_FACTS = LEGAL | {"career"}
# Aliases too ambiguous on web copy: GCC is also the Gulf region, "industrial" an adjective, etc.
SKIP_ALIASES = {"gcc", "industrial", "horizontal", "it/ites", "frame", "horizon", "duo", "rbi", "cms", "nano"}
CTA_WORDS = re.compile(r"demo|talk to|contact|expert|download|register|get started|request|schedule|buy|watch|book|video", re.I)
# A sentence is a claim worth quoting if it carries a number or a named certification/regulation/analyst.
CLAIM_WORDS = re.compile(r"\d|certified|ISO 27001|Gartner|Made.in.India|STQC|CERT-In|RBI|SEBI|IRDAI|DPDP|FIPS|Common Criteria")


# ------------------------------------------------------------------ discovery
def sitemap_urls() -> list[tuple[str, str, str]]:
    """(url, sitemap name, lastmod) for every page in every sitemap robots.txt points at."""
    robots = requests.get(SITE + "/robots.txt", headers=UA, timeout=30).text
    index = re.findall(r"(?im)^sitemap:\s*(\S+)", robots) or [SITE + "/sitemap.xml"]
    maps = []
    for ix in index:
        x = requests.get(ix, headers=UA, timeout=30).text
        maps += re.findall(r"<sitemap>\s*<loc>([^<]+)</loc>", x) or [ix]
    seen, out = set(), []
    for m in maps:
        name = m.rsplit("/", 1)[-1].replace("-sitemap.xml", "")
        x = requests.get(m, headers=UA, timeout=30).text
        for block in re.findall(r"<url>(.*?)</url>", x, re.S):
            loc = re.search(r"<loc>([^<]+)</loc>", block).group(1).strip()
            lm = re.search(r"<lastmod>([^<]+)</lastmod>", block)
            if loc not in seen:  # the case-studies sitemap lists one URL twice
                seen.add(loc)
                out.append((loc, name, lm.group(1) if lm else None))
    return out


def page_type(url: str, sitemap: str) -> str:
    path = url.replace(SITE, "").strip("/")
    slug = path.rsplit("/", 1)[-1]
    if slug in LEGAL:
        return "legal"
    if sitemap == "products" or path in ("hyseries", "cloud-services/accops-daas", "product-software"):
        return "product"
    if sitemap == "solutions":
        return "industry" if path.startswith(INDUSTRY_SLUGS.strip("/")) and path != "industry-solutions" else "solution"
    if sitemap == "case-studies":
        return "case-study"
    if sitemap == "news":
        return "blog"
    if sitemap in ("webinars", "ebooks", "solution-documents") or path in ("videos", "product-documentation", "whats-new"):
        return "resource"
    if sitemap == "partner-awards" or path.startswith("about-us") or path in (
            "investor-relations", "sustainability", "partners", "events", "contact-us", "why-accops",
            "why-accops-digital-transformation", "schedule-a-free-demo", "buy", "career"):
        return "company"
    return "other"


# ------------------------------------------------------------------ extraction
# Site chrome rendered inside the main element: related-items rails, the contact band, form toasts.
STOP_AT = {"You May Also Like", "Ready to get started?"}
CHROME = {"The case study has been sent to your mail ID.", "Your details have been shared with Accops.",
          "copy", "URL copied!", "email", "Share", "Talk to an Expert", "Let us contact you", "Find a local partner"}


BLOCKS = ["p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "section", "td", "th", "tr", "ul", "ol", "table",
          "details", "summary", "blockquote", "figcaption", "article", "dt", "dd"]


def clean_lines(root) -> list[str]:
    """One line per block element; inline markup and source line-wraps are joined, so a sentence stays whole."""
    for c in root.find_all(string=lambda x: isinstance(x, Comment)):
        c.extract()  # the LP's build notes ("ANGLE A", "Step 1: low-threat questions first") live in comments
    for t in root.find_all(string=True):
        t.replace_with(re.sub(r"\s+", " ", t))
    for br in root.find_all("br"):
        br.replace_with("\n")
    for el in root.find_all(BLOCKS):
        el.insert_before("\n")
        el.insert_after("\n")
    lines, prev = [], None
    for ln in root.get_text(" ").split("\n"):
        ln = re.sub(r"\s+([,.;:!?])", r"\1", re.sub(r"\s+", " ", ln)).strip()
        if ln in STOP_AT:
            break
        if (len(ln) > 1 or ln.isalnum()) and ln != prev and ln not in CHROME:  # keep a lone "0" stat
            lines.append(ln)
        prev = ln
    return lines


def links(root, base: str) -> list[dict]:
    out = []
    for a in root.find_all("a", href=True):
        t = re.sub(r"\s+", " ", a.get_text(" ", strip=True))
        h = a["href"]
        if t and not h.lower().startswith(("#", "javascript:", "mailto:", "tel:")):
            out.append({"label": t[:80], "url": urljoin(base, h)})
    return out


def extract_accops(html: str, url: str) -> dict:
    s = BeautifulSoup(html, "html.parser")
    meta = lambda **k: (s.find("meta", attrs=k) or {}).get("content")
    root = s.select_one(".accops_main") or s.body
    for t in root.select("script, style, noscript, svg, header, footer, nav, form, .toaster, button.scroll__top"):
        t.decompose()
    stop = root.find(string=lambda x: x and x.strip() in STOP_AT)
    if stop:  # drop the related-items rail and contact band so their links are not taken as this page's CTA
        for el in list(stop.find_all_next()):
            el.extract()
    for f in root.find_all("iframe", src=True):  # webinar pages are mostly an embedded video
        f.replace_with(s.new_tag("a", href=f["src"], string="Watch the video"))
    lines = clean_lines(root)
    # og:title is often "Accops" or a whole sentence on this site; the page's own h1 (or first line) is reliable
    h1 = root.find("h1")
    title = (h1.get_text(" ", strip=True) if h1 else "") or (s.title.string if s.title else "") or ""
    if title.strip() in ("", "Accops", "Accops - Home") and lines:
        title = lines[0]
    return {"title": title.strip(), "description": (meta(name="description") or "").strip(),
            "lines": lines, "links": links(root, url)}


def extract_lp(html: str) -> list[dict]:
    """One record per <section> of the Citrix LP. The page's own drafting notes (class .ph: PLACEHOLDER,
    NEEDS SIGN-OFF) are visible on the live page but are not claims, so they are cut before carding."""
    s = BeautifulSoup(html, "html.parser")
    for t in s.select("script, style, noscript, svg, .ph"):
        t.decompose()
    out = []
    for i, sec in enumerate(s.select("main section"), 1):
        head = sec.find(["h1", "h2"])
        title = re.sub(r"\s+", " ", head.get_text(" ", strip=True)) if head else f"Section {i}"
        anchor = sec.get("id") or f"section-{i}"
        out.append({"url": f"{LP}#{anchor}", "title": title, "description": "",
                    "lines": clean_lines(sec), "links": links(sec, LP)})
    return out


def wordpress_post(url: str) -> dict | None:
    """accops.com renders /news/<slug> client-side from its public WordPress API (blogs.accops.com)."""
    slug = url.rstrip("/").rsplit("/", 1)[-1]
    try:
        r = requests.get(WP_API, params={"slug": slug, "_fields": "title,content,date"}, headers=UA, timeout=45)
        posts = r.json() if r.ok else []
    except (requests.RequestException, ValueError):
        return None
    if not posts:
        return None
    body = BeautifulSoup(posts[0]["content"]["rendered"], "html.parser")
    for t in body.select("script, style, form"):
        t.decompose()
    title = BeautifulSoup(posts[0]["title"]["rendered"], "html.parser").get_text()
    return {"title": title, "lines": clean_lines(body), "links": links(body, url), "published": posts[0]["date"][:10]}


def fetch(url: str) -> tuple[str, str | None]:
    try:
        r = requests.get(url, headers=UA, timeout=45)
        return (r.text, None) if r.ok else ("", f"HTTP {r.status_code}")
    except requests.RequestException as e:
        return "", type(e).__name__


# ------------------------------------------------------------------ cards
def load_terms() -> dict[str, list[tuple[str, list[str]]]]:
    """facet -> [(label, aliases)] from the core.terms seed, so the cards use the master-list names."""
    sql = TERMS_SQL.read_text(encoding="utf-8")
    terms: dict[str, list] = {"industry": [], "product": []}
    for facet, label, aliases in re.findall(r"\('(industry|product)', '([^']+)', '\{([^}]*)\}'", sql):
        al = [a.strip('"') for a in re.findall(r'"[^"]*"|[^,]+', aliases)]
        terms[facet].append((label, [a for a in al if a and a not in SKIP_ALIASES]))
    return terms


def tag(text: str, entries) -> list[str]:
    """Labels case-sensitive (HyID, IRIS, Turbo...), aliases case-insensitive, whole words only."""
    low, hits = text.lower(), []
    for label, aliases in entries:
        if re.search(rf"(?<![\w-]){re.escape(label)}(?![\w-])", text) or any(
                re.search(rf"(?<![\w-]){re.escape(a)}(?![\w-])", low) for a in aliases):
            hits.append(label)
    return hits


def norm(s: str) -> str:
    """Comparison form for quote checks. A " | " in a quote marks a line break on the page."""
    return re.sub(r"\s+", " ", s.replace("|", " ").replace("’", "'").replace("‘", "'").replace("“", '"')
                  .replace("”", '"').replace("–", "-").replace("—", "-")).strip().lower().replace(" ,", ",").replace(" .", ".")


def auto_facts(lines: list[str], limit: int = 6) -> list[dict]:
    out = []
    for ln in lines:
        for sent in re.split(r"(?<=[.!?])\s+(?=[A-Z\"])", ln):
            if 40 <= len(sent) <= 280 and sent[-1] in ".!?" and CLAIM_WORDS.search(sent) and not re.search(r"cookie|©|copyright", sent, re.I):
                if not any(norm(sent) == norm(f["quote"]) for f in out):
                    out.append({"fact": sent, "quote": sent})
            if len(out) >= limit:
                return out
    return out


def auto_questions(title: str, lines: list[str], ptype: str) -> list[str]:
    # ponytail: only the page's own FAQ headings; a templated question would read as a real one. Claude adds the rest.
    return [ln for ln in lines if ln.endswith("?") and 15 < len(ln) < 140][:5]


def auto_summary(rec: dict) -> str:
    d = rec["description"]
    if len(d) > 60 and "corporate website" not in d:
        return d
    sents = re.split(r"(?<=[.!?])\s+", " ".join(l for l in rec["lines"] if len(l) > 60))
    return " ".join(sents[:2])[:400] or rec["title"]


def pick_cta(lk: list[dict]) -> dict | None:
    for l in lk:
        if CTA_WORDS.search(l["label"]):
            return l
    return None


def build_card(rec: dict, ptype: str, terms, old: dict | None, log: list) -> dict:
    lines, url = rec["lines"], rec["url"]
    text = " ".join(lines)
    chash = hashlib.sha1(text.encode()).hexdigest()[:16]
    head = " ".join([rec["title"], rec["description"]] + lines[:40])
    card = {"url": url, "title": rec["title"], "page_type": ptype,
            "products": tag(head, terms["product"]), "industries": tag(head, terms["industry"]),
            "summary": auto_summary(rec), "facts": [], "questions_answered": [],
            "cta": pick_cta(rec["links"]), "published": rec.get("published"), "lastmod": rec.get("lastmod"), "fetched_at": rec["fetched_at"],
            "content_hash": chash, "words": len(text.split()), "carded_by": "auto", "needs_recard": True}
    slug = url.rstrip("/").rsplit("/", 1)[-1]
    if old and old.get("carded_by") == "claude" and old.get("content_hash") == chash:
        for k in ("title", "summary", "facts", "questions_answered", "page_type", "products", "industries", "carded_by"):
            card[k] = old[k]
        card["needs_recard"] = False
    elif not (slug in NO_FACTS or ptype == "legal"):
        card["facts"] = auto_facts(lines)
        card["questions_answered"] = auto_questions(rec["title"], lines, ptype)
    if old and old.get("carded_by") == "claude" and old.get("content_hash") != chash:
        log.append({"url": url, "issue": "page changed since Claude carded it; auto baseline until re-carded"})
    page = norm(text)
    kept = [f for f in card["facts"] if norm(f["quote"]) in page]
    for f in card["facts"]:
        if f not in kept:
            log.append({"url": url, "issue": "fact quote not on page, dropped", "quote": f["quote"]})
    card["facts"] = kept
    if card["words"] < 40:
        log.append({"url": url, "issue": f"thin page text ({card['words']} words): rendered client-side or a listing"})
    return card


def selftest():
    """python prototype/web_pages.py --selftest : the quote check and tagging, no network."""
    rec = {"url": "u", "title": "T", "description": "", "fetched_at": "now",
           "lines": ["Accops HyID adds MFA — “for legacy apps”.", "1000+", "Organisations"], "links": []}
    old = {"url": "u", "carded_by": "claude", "title": "T", "summary": "s", "page_type": "product", "products": [],
           "industries": [], "questions_answered": [], "facts": [
               {"fact": "ok", "quote": 'HyID adds MFA - "for legacy apps".'}, {"fact": "ok", "quote": "1000+ | Organisations"},
               {"fact": "invented", "quote": "2000+ Organisations"}]}
    old["content_hash"] = build_card(rec, "product", load_terms(), None, [])["content_hash"]
    log = []
    card = build_card(rec, "product", load_terms(), old, log)
    assert [f["quote"] for f in card["facts"]] == ['HyID adds MFA - "for legacy apps".', "1000+ | Organisations"], card["facts"]
    assert log and log[0]["quote"] == "2000+ Organisations", log
    assert tag("Accops HyID with iris scanning", load_terms()["product"]) == ["HyID"]
    print("selftest ok")


# ------------------------------------------------------------------ main
def raw_path(url: str) -> Path:
    return RAW / (hashlib.sha1(url.encode()).hexdigest()[:16] + ".json")


def get_raw(url: str, refetch: bool, offline: bool, lp: bool = False) -> tuple[list[dict], str | None]:
    p = raw_path(url)
    if p.exists() and not refetch:
        return json.loads(p.read_text(encoding="utf-8")), None
    if offline:
        return [], "not cached (offline)"
    html, err = fetch(url)
    if err:
        return [], err
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    recs = extract_lp(html) if lp else [{**extract_accops(html, url), "url": url}]
    if "/news/" in url and len(" ".join(recs[0]["lines"]).split()) < 80:
        wp = wordpress_post(url)
        if wp:
            recs[0].update({k: v for k, v in wp.items() if v}, source="wordpress-api")
    for r in recs:
        r["fetched_at"] = now
    p.write_text(json.dumps(recs, ensure_ascii=False), encoding="utf-8")
    return recs, None


def write(name: str, cards: list[dict]):
    (OUT / name).write_text(json.dumps(cards, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def qa_check(qa_file: Path, review_md: Path) -> int:
    """Every evidence quote in the Q&A bank must be on its source page (or in the public asset's card);
    answers stay <= 60 words. Writes the line-by-line approval table. Returns the number of errors."""
    lp = {r["url"]: r for r in json.loads(raw_path(LP).read_text(encoding="utf-8"))}
    assets_f = RAW.parent / "public-assets.json"  # cached read-only from Supabase view sam_v1_public_assets
    assets = {a["public_url"]: a for a in json.loads(assets_f.read_text(encoding="utf-8"))} if assets_f.exists() else {}

    def source_text(url):
        if url in lp:
            return " ".join(lp[url]["lines"])
        p = raw_path(url)  # a public page beats an asset card when a case study is both
        if p.exists():
            return " ".join(json.loads(p.read_text(encoding="utf-8"))[0]["lines"])
        if url in assets:
            a = assets[url]
            return " ".join([a["title"], a["brief"] or ""] + (a["key_outcomes"] or []))
        return None

    qa, errors = json.loads(qa_file.read_text(encoding="utf-8")), []
    ids = {q["id"] for q in qa}
    for q in qa:
        words = len(q["short_answer"].split())
        if words > 60:
            errors.append(f"{q['id']}: answer is {words} words")
        if q["parent_id"] and q["parent_id"] not in ids:
            errors.append(f"{q['id']}: orphan (parent {q['parent_id']})")
        if not q["evidence"]:
            errors.append(f"{q['id']}: no evidence")
        for ev in q["evidence"]:
            text = source_text(ev["url"])
            if text is None:
                errors.append(f"{q['id']}: source not carded or cached: {ev['url']}")
            elif norm(ev["quote"]) not in norm(text):
                errors.append(f"{q['id']}: quote not found on {ev['url']}: {ev['quote'][:70]}")
            if ev["url"] not in q["sources"]:
                errors.append(f"{q['id']}: evidence url missing from sources: {ev['url']}")
        if not q["needs_approval"] and re.search(r"ISO|certif|Gartner|HDX|NetScaler|\d+%", q["short_answer"]):
            errors.append(f"{q['id']}: looks like a number/certification/competitor claim but needs_approval is false")

    cell = lambda s: str(s).replace("|", "\\|").replace("\n", " ")
    short = lambda u: u.replace("https://www.accops.com", "").replace("https://accops-citrix-lp.vercel.app/", "LP").replace(
        "https://downloads.accops.com/", "PDF:") or "/"
    rows = ["| # | Question | Answer | Visual | Sources | Needs approval | Notes | Approve? |", "|---|---|---|---|---|---|---|---|"]
    for i, q in enumerate(qa, 1):
        tree = f"{q['id']}" + (f" (under {q['parent_id']})" if q["parent_id"] else " (root)")
        appr = ("**Yes**: " + ", ".join(q["approval_reasons"])) if q["needs_approval"] else "No"
        rows.append(f"| {i} | {cell(q['question'])}<br><sub>{tree}</sub> | {cell(q['short_answer'])} | {q['visual']['type']} | "
                    f"{'<br>'.join(cell(short(s)) for s in q['sources'])} | {appr} | {cell(q['notes'])} | ☐ |")
    n_appr = sum(q["needs_approval"] for q in qa)
    review_md.write_text(
        "# Website chatbot: Citrix LP Q&A bank, review sheet\n\n"
        f"Generated from `corpus/web/qa-citrix-lp.json` by `python prototype/web_pages.py --qa`. "
        f"{len(qa)} draft pairs, {n_appr} need approval (they state a number, certification, customer, analyst or "
        "competitor claim). Every answer is grounded in the quoted evidence in the JSON; the check re-verifies each "
        "quote against the live page text on every run.\n\n"
        "**How to approve:** tick the last column, or edit the answer in the JSON and re-run `--qa`. Only approved pairs "
        "ever reach the `sam_web_qa` view (PRD section 6). 'Talk to sales' goes to accops.com/schedule-a-free-demo "
        "because the LP's own form is not wired yet.\n\n" + "\n".join(rows) + "\n", encoding="utf-8")
    for e in errors:
        print("QA:", e)
    print(f"qa: {len(qa)} pairs, {n_appr} need approval, {len(errors)} errors -> {review_md}")
    return len(errors)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refetch", action="store_true")
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--apply", metavar="NOTES.json",
                    help="merge Claude-written {url: {summary, facts, questions_answered[, page_type, products, industries]}} "
                         "into the card files, then rebuild offline so every quote is re-checked")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--qa", action="store_true", help="check corpus/web/qa-citrix-lp.json and write docs/web-qa-review.md")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if a.qa:
        return 1 if qa_check(OUT / "qa-citrix-lp.json", ROOT / "docs" / "web-qa-review.md") else 0
    if a.apply:
        notes = json.loads(Path(a.apply).read_text(encoding="utf-8"))
        for name in ("pages-accops-com.json", "pages-citrix-lp.json"):
            cards = json.loads((OUT / name).read_text(encoding="utf-8"))
            for c in cards:
                if c["url"] in notes:
                    c.update(notes.pop(c["url"]), carded_by="claude", needs_recard=False)
            write(name, cards)
        if notes:
            print("no card for:", *notes, sep="\n  ")
        a.offline = True
    RAW.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    terms = load_terms()
    log: list[dict] = []

    def old_cards(name):
        f = OUT / name
        return {c["url"]: c for c in json.loads(f.read_text(encoding="utf-8"))} if f.exists() else {}

    # accops.com
    urls = sitemap_urls() if not a.offline else json.loads((RAW.parent / "urls.json").read_text())
    (RAW.parent / "urls.json").write_text(json.dumps(urls))
    old = old_cards("pages-accops-com.json")
    with ThreadPoolExecutor(WORKERS) as ex:
        raws = list(ex.map(lambda u: get_raw(u[0], a.refetch, a.offline), urls))
    cards = []
    for (url, smap, lastmod), (recs, err) in zip(urls, raws):
        if err:
            log.append({"url": url, "issue": f"fetch failed: {err}"})
            continue
        rec = {**recs[0], "lastmod": lastmod}
        cards.append(build_card(rec, page_type(url, smap), terms, old.get(url), log))
    write("pages-accops-com.json", cards)

    # Citrix LP, one card per section
    old = old_cards("pages-citrix-lp.json")
    recs, err = get_raw(LP, a.refetch, a.offline, lp=True)
    if err:
        log.append({"url": LP, "issue": f"fetch failed: {err}"})
    lp_cards = [build_card(r, "comparison", terms, old.get(r["url"]), log) for r in recs]
    write("pages-citrix-lp.json", lp_cards)

    (OUT / "fetch-log.json").write_text(json.dumps(log, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    by = {}
    for c in cards + lp_cards:
        by.setdefault(c["page_type"], [0, 0, 0])
        by[c["page_type"]][0] += 1
        by[c["page_type"]][1] += c["carded_by"] == "claude"
        by[c["page_type"]][2] += c["words"] == 0
    print(f"sitemap urls {len(urls)}, carded {len(cards)}, lp sections {len(lp_cards)}, log entries {len(log)}")
    for k, (n, cl, empty) in sorted(by.items()):
        print(f"  {k:11} {n:4}  claude-carded {cl:3}  empty {empty}")


if __name__ == "__main__":
    sys.exit(main())
