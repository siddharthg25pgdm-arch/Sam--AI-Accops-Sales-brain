"""Load the website chatbot's knowledge (corpus/web/*.json) into Supabase sam_web_pages and sam_web_qa.

  python load_web_knowledge.py --dry-run      # validate and show what would be written; GETs only, writes nothing
  python load_web_knowledge.py                # write
  python load_web_knowledge.py --self-check   # offline asserts (validators, write planning), no network
  --ref claude/web-knowledge                  # read the corpus from a branch (git show) instead of corpus/web/
  --base http://127.0.0.1:PORT                # a local PostgREST emulator instead of the shared project (tests only)

Inputs (owned by the web-knowledge agent; this script never edits them):
  pages-*.json  page cards  {url, title, page_type, products, industries, summary, facts[{fact, quote}],
                questions_answered, cta, lastmod, fetched_at, content_hash, needs_recard, ...}
  qa-*.json     the Q&A bank (plan 7.7) {id, question, aliases, answer, pages, parent, nudge_weight, cta, cta_url,
                sources, visual, visual_data}; a list, or an object holding the list under pairs/qa/items

Rules (plan section 9, stream A):
  - pages upsert by url; a page whose row hash is unchanged is not sent. page_group is set by the table's trigger
    from sam_web_page_rules, so it is never computed here.
  - Q&A go in as status 'draft'. A pair that exists is updated only while it is still a draft (the PATCH filters
    on status=eq.draft, so an approval that lands mid-run is not overwritten). Approved and retired pairs are
    never touched; approving is a person's job in the Website tab.
  - visual_data is validated against the block contract (web/lib/blocks.ts, mirrored below); a Stat value must
    appear verbatim on its source page; a calculator needs figures_approved: true (the table refuses it too).
  - Re-running with unchanged input writes nothing (and so does not bump knowledge_version).

Credentials come from web/.env.local (SUPABASE_URL / SUPABASE_SERVICE_KEY), as load_cards.py does.
"""
from __future__ import annotations
import argparse, hashlib, json, re, subprocess, sys, urllib.error, urllib.parse, urllib.request
from pathlib import Path

HERE = Path(__file__).parent
REPO = HERE.parent
CORPUS = "corpus/web"
ENV = REPO / "web" / ".env.local"
EXPECT_REF = "iwqhayuoxnrhqzozznes"

PAGE_COLS = ["url", "title", "page_type", "products", "industries", "summary", "facts", "questions_answered", "cta",
             "lastmod", "needs_recard", "fetched_at"]
QA_COLS = ["id", "question", "aliases", "answer", "visual", "visual_data", "pages", "parent_id", "nudge_weight",
           "regions", "cta", "cta_url", "sources"]
QA_RENAME = {"parent": "parent_id"}
VISUALS = {"text", "doc_card", "compare_table", "steps", "stat", "picker", "calculator", "cta"}
MOJIBAKE = re.compile("â€|Ã[\u0080-¿]|â„")

# ---------------------------------------------------------------- the block contract, mirrored (plan 7.4)
# field: (kind, max_len_or_None, required). kind: str | url | int | num | enum:<a|b> | list:<item> | obj:<SPEC name>
S = lambda n, req=True: ("str", n, req)
SPECS: dict[str, dict] = {
    "doc_card": {"title": S(120), "kind": S(30), "summary": S(220), "meta": S(60, False), "url": ("url", None, True),
                 "action": ("enum:read|download", None, True), "thumb": S(200, False)},
    "compare_table": {"title": S(80), "columns": ("list:str30", (2, 3), True), "rows": ("list:obj:row", (1, 12), True),
                      "filters": ("list:str24", (0, 5), False), "footnote": S(160, False)},
    "row": {"label": S(40), "cells": ("list:str80", (0, 99), True), "group": S(24, False), "detail": S(240, False),
            "accent": ("int0..2", None, False)},
    "steps": {"title": S(80), "steps": ("list:obj:step", (2, 7), True)},
    "step": {"title": S(60), "body": S(200, False), "need": ("list:str60", (0, 4), False)},
    "stat": {"value": S(12), "label": S(80), "context": S(140, False)},
    "picker": {"prompt": S(80), "options": ("list:obj:option", (2, 6), True)},
    "option": {"label": S(40), "qa_id": S(80)},
    "calculator": {"title": S(80), "input": ("obj:input", None, True), "columns": ("list:str30", (2, 2), True),
                   "rows": ("list:obj:calcrow", (1, 5), True), "disclaimer": S(200), "figures_approved": ("bool", None, True)},
    "input": {"label": S(40), "min": ("num", None, True), "max": ("num", None, True), "step": ("num", None, True),
              "default": ("num", None, True), "unit": S(16)},
    "calcrow": {"label": S(40), "per_unit": ("list:num", (2, 2), True), "currency": S(4)},
    "cta": {"label": S(28), "action": ("enum:talk_to_sales|open_url", None, True), "url": S(300), "sub": S(80, False)},
}


def check_value(kind: str, lim, v, path: str) -> list[str]:
    if kind == "str" or kind.startswith("str"):
        n = lim if kind == "str" else int(kind[3:])
        return [] if isinstance(v, str) and len(v) <= n else [f"{path}: string <= {n} chars"]
    if kind == "url":
        return [] if isinstance(v, str) and re.match(r"^https://\S+$", v) else [f"{path}: https URL"]
    if kind == "bool":
        return [] if v is True else [f"{path}: must be true"]
    if kind == "num":
        return [] if isinstance(v, (int, float)) and not isinstance(v, bool) else [f"{path}: number"]
    if kind == "int0..2":
        return [] if isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 2 else [f"{path}: integer 0-2"]
    if kind.startswith("enum:"):
        return [] if v in kind[5:].split("|") else [f"{path}: one of {kind[5:]}"]
    if kind.startswith("obj:"):
        return check_obj(kind[4:], v, path)
    if kind.startswith("list:"):
        lo, hi = lim
        if not isinstance(v, list) or not lo <= len(v) <= hi:
            return [f"{path}: list of {lo}-{hi}"]
        return [e for i, x in enumerate(v) for e in check_value(kind[5:], None, x, f"{path}[{i}]")]
    raise ValueError(kind)


def check_obj(spec: str, v, path: str) -> list[str]:
    fields = SPECS[spec]
    if not isinstance(v, dict):
        return [f"{path}: object"]
    errs = [f"{path}.{k}: unknown field" for k in v if k not in fields]
    for k, (kind, lim, req) in fields.items():
        if k not in v or v[k] is None:
            errs += [f"{path}.{k}: required"] if req else []
        else:
            errs += check_value(kind, lim, v[k], f"{path}.{k}")
    return errs


def page_text(p: dict) -> str:
    return " ".join([p.get("title") or "", p.get("summary") or ""]
                    + [f"{f.get('fact', '')} {f.get('quote', '')}" for f in p.get("facts") or []])


def validate_qa(q: dict, ids: set[str], pages: dict[str, dict]) -> list[str]:
    errs = []
    if not re.match(r"^[a-z0-9][a-z0-9-]{0,79}$", q.get("id") or ""):
        errs.append("id: lowercase slug <= 80 chars")
    if not 3 <= len(q.get("question") or "") <= 200:
        errs.append("question: 3-200 chars")
    ans = q.get("answer") or ""
    if not ans or len(ans) > 600 or len(ans.split()) > 80:
        errs.append("answer: 1-80 words, <= 600 chars")
    src = q.get("sources") or []
    if not src or not all(isinstance(s, str) and s.startswith("https://") for s in src):
        errs.append("sources: at least one https URL")
    if q.get("parent_id") and q["parent_id"] not in ids:
        errs.append(f"parent {q['parent_id']}: not in the bank")
    if q.get("cta_url") and not re.match(r"^(https://|#)", q["cta_url"]):
        errs.append("cta_url: https or #anchor")
    v, data = q.get("visual"), q.get("visual_data")
    if v is not None and v not in VISUALS:
        errs.append(f"visual: unknown type {v}")
    elif v in ("text", None):
        if data:
            errs.append("visual_data: must be empty for a text answer")
    elif v == "calculator" and not (isinstance(data, dict) and data.get("figures_approved") is True):
        errs.append("calculator: refused without figures_approved (the LP's per-seat rates are placeholders)")
    else:
        errs += check_obj(v, data, "visual_data")
        if v == "stat" and isinstance(data, dict) and isinstance(data.get("value"), str):
            page = pages.get(src[0]) if src else None
            if page is None:
                errs.append(f"stat: source page {src[0] if src else '-'} is not in the page cards")
            elif data["value"] not in page_text(page):
                errs.append(f"stat: value {data['value']!r} is not on {src[0]}")
        if v == "picker" and isinstance(data, dict):
            errs += [f"picker: option qa_id {o.get('qa_id')} not in the bank" for o in data.get("options") or []
                     if isinstance(o, dict) and o.get("qa_id") not in ids]
    return errs


def validate_page(p: dict) -> list[str]:
    errs = []
    if not re.match(r"^https://\S+$", p.get("url") or "") or len(p["url"]) > 500:
        errs.append("url: https, <= 500 chars")
    if not p.get("title"):
        errs.append("title: required")
    facts = p.get("facts")
    if not isinstance(facts, list) or not all(isinstance(f, dict) and isinstance(f.get("fact"), str)
                                              and isinstance(f.get("quote"), str) for f in facts):
        errs.append("facts: list of {fact, quote}")
    return errs

# ---------------------------------------------------------------- mapping


def map_page(p: dict) -> dict:
    row = {k: p.get(k) for k in PAGE_COLS}
    for k in ("products", "industries", "questions_answered"):
        row[k] = row[k] or []
    row["facts"] = [{"fact": f["fact"], "quote": f["quote"]} for f in p.get("facts") or []]
    row["needs_recard"] = bool(row["needs_recard"])
    row["lastmod"] = (row["lastmod"] or None) and str(row["lastmod"])[:10]
    # ponytail: content_hash = hash of what we write (not the fetcher's page hash), so a re-card with an unchanged
    # page still reaches the table. fetched_at is left out of it: a re-fetch alone is not a change.
    row["content_hash"] = hashlib.sha256(json.dumps({k: v for k, v in row.items() if k != "fetched_at"},
                                                    sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]
    return row


def map_qa(q: dict) -> dict:
    q = {QA_RENAME.get(k, k): v for k, v in q.items()}
    row = {k: q.get(k) for k in QA_COLS}
    for k in ("aliases", "pages", "regions", "sources"):
        row[k] = row[k] or []
    row["nudge_weight"] = int(row["nudge_weight"] or 0)
    return row


def plan(pages: list[dict], qa: list[dict], db_pages: dict[str, str], db_qa: dict[str, dict]):
    """-> (page rows to upsert, qa rows to insert, qa rows to patch (drafts only), ids kept because approved/retired)"""
    up = [p for p in pages if db_pages.get(p["url"]) != p["content_hash"]]
    ins, patch, kept = [], [], []
    for r in qa:
        cur = db_qa.get(r["id"])
        if cur is None:
            ins.append(r)
        elif cur.get("status") != "draft":
            kept.append(r["id"])
        elif any(cur.get(k) != r[k] for k in QA_COLS):
            patch.append(r)
    return up, ins, patch, kept

# ---------------------------------------------------------------- IO


def read_corpus(ref: str | None) -> tuple[list[dict], list[dict], list[str]]:
    if ref:
        names = subprocess.run(["git", "-C", str(REPO), "ls-tree", "--name-only", f"{ref}:{CORPUS}/"],
                               capture_output=True, text=True, check=True).stdout.split()
        read = lambda n: subprocess.run(["git", "-C", str(REPO), "show", f"{ref}:{CORPUS}/{n}"],
                                        capture_output=True, check=True).stdout.decode("utf-8")
    else:
        d = REPO / CORPUS
        if not d.is_dir():
            sys.exit(f"no {d}; pass --ref claude/web-knowledge to read the corpus from that branch")
        names = sorted(p.name for p in d.iterdir())
        read = lambda n: (d / n).read_text(encoding="utf-8")
    pages, qa, files = [], [], []
    for n in sorted(names):
        if re.match(r"^pages-.*\.json$", n):
            pages += json.loads(read(n)); files.append(n)
        elif re.match(r"^qa-.*\.json$", n):
            d = json.loads(read(n))
            qa += d if isinstance(d, list) else d.get("pairs") or d.get("qa") or d.get("items") or []
            files.append(n)
    return pages, qa, files


class Db:
    def __init__(self, base: str | None):
        if base:
            if not re.match(r"^http://(127\.0\.0\.1|localhost)(:\d+)?$", base.rstrip("/")):
                sys.exit("--base is for a local emulator only (http://127.0.0.1:PORT)")
            self.url, self.key = base.rstrip("/"), "local"
            return
        url = key = ""
        for line in ENV.read_text(encoding="utf-8").splitlines():
            if line.startswith("SUPABASE_URL="):
                url = line.split("=", 1)[1].strip().strip('"').rstrip("/")
            elif line.startswith("SUPABASE_SERVICE_KEY="):
                key = line.split("=", 1)[1].strip().strip('"')
        if not url or not key:
            sys.exit(f"no Supabase credentials in {ENV}")
        if EXPECT_REF not in url:
            sys.exit(f"refusing: expected project {EXPECT_REF}, got {url}")
        self.url, self.key = url, key

    def rest(self, path: str, method: str = "GET", body=None, prefer: str = "", missing_ok: bool = False):
        headers = {"apikey": self.key, "Authorization": f"Bearer {self.key}", "Content-Type": "application/json"}
        if prefer:
            headers["Prefer"] = prefer
        data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
        req = urllib.request.Request(f"{self.url}/rest/v1/{path}", data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:400]
            if missing_ok and e.code == 404:
                return None
            sys.exit(f"supabase {method} {path.split('?')[0]} -> {e.code}: {msg}")   # never the key or the full query


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--ref")
    ap.add_argument("--base")
    a = ap.parse_args()
    if a.self_check:
        return self_check()
    raw_pages, raw_qa, files = read_corpus(a.ref)
    print(f"corpus: {', '.join(files) or 'nothing'}{f' (from {a.ref})' if a.ref else ''}")

    bad = 0
    pages, seen = [], set()
    for p in raw_pages:
        errs = validate_page(p) + (["duplicate url"] if p.get("url") in seen else [])
        seen.add(p.get("url"))
        if errs:
            bad += 1; print(f"  REJECT page {p.get('url')}: {'; '.join(errs)}"); continue
        pages.append(map_page(p))
    dropped = sorted({k for p in raw_pages for k in p} - set(PAGE_COLS) - {"content_hash"})
    print(f"pages: {len(pages)} valid of {len(raw_pages)} | not stored: {', '.join(dropped) or '-'}")
    moj = sum(1 for p in pages for f in p["facts"] if MOJIBAKE.search(f["quote"] + f["fact"]))
    if moj:
        print(f"  WARN {moj} facts carry mojibake (UTF-8 read as cp1252, e.g. 'â€™'); fix in the web-knowledge corpus")

    if raw_qa:
        unknown = sorted({k for q in raw_qa for k in q} - set(QA_COLS) - set(QA_RENAME))
        print(f"Q&A mapping: parent -> parent_id; ignored: {', '.join(unknown) or '-'}")
    qa_rows = [map_qa(q) for q in raw_qa]
    ids = {q["id"] for q in qa_rows if q.get("id")}
    by_url = {p["url"]: p for p in raw_pages if p.get("url")}
    qa = []
    for q in qa_rows:
        errs = validate_qa(q, ids, by_url)
        if errs:
            bad += 1; print(f"  REJECT qa {q.get('id')}: {'; '.join(errs)}"); continue
        qa.append(q)
    print(f"Q&A: {len(qa)} valid of {len(qa_rows)}" + ("" if raw_qa else " (no qa-*.json in the corpus yet)"))

    db = Db(a.base)
    got_p = db.rest("sam_web_pages?select=url,content_hash", missing_ok=True)
    got_q = db.rest(f"sam_web_qa?select=status,{','.join(QA_COLS)}", missing_ok=True)
    if got_p is None or got_q is None:
        print("  (sam_web_pages / sam_web_qa not in the database yet: planning against empty tables)")
        if not a.dry_run:
            sys.exit("apply docs/supabase-sam-web-01-knowledge.sql first")
    up, ins, patch, kept = plan(pages, qa, {r["url"]: r["content_hash"] for r in got_p or []},
                                {r["id"]: r for r in got_q or []})
    print(f"would write: pages upsert {len(up)} (unchanged {len(pages) - len(up)}) | Q&A insert {len(ins)} as draft, "
          f"update {len(patch)} drafts, keep {len(kept)} approved/retired | rejected {bad}")
    if a.dry_run:
        print("dry run: nothing written.")
        sys.exit(1 if bad else 0)

    for i in range(0, len(up), 100):
        db.rest("sam_web_pages?on_conflict=url", "POST", up[i:i + 100], prefer="resolution=merge-duplicates,return=minimal")
    if ins:
        db.rest("sam_web_qa?on_conflict=id", "POST", [{**r, "status": "draft", "origin": "bank"} for r in ins],
                prefer="resolution=ignore-duplicates,return=minimal")
    for r in patch:
        db.rest(f"sam_web_qa?id=eq.{urllib.parse.quote(r['id'])}&status=eq.draft", "PATCH",
                {k: v for k, v in r.items() if k != "id"}, prefer="return=minimal")
    print(f"written: {len(up)} pages, {len(ins)} new drafts, {len(patch)} drafts updated")
    sys.exit(1 if bad else 0)

# ---------------------------------------------------------------- self-check

LP = "https://accops-citrix-lp.vercel.app/"
# A small bank in the plan 7.7 shape, sourced from the real LP page cards. Used by --self-check and by the local
# PGlite proof (docs/plans/web-s1-a-APPROVAL.md). Not a real bank: the web-knowledge agent writes qa-citrix-lp.json.
FIXTURE_QA = [
    {"id": "lp-citrix-alternative", "question": "Is Accops a Citrix alternative?", "aliases": ["replace citrix", "citrix replacement"],
     "answer": "Yes. Accops delivers Windows apps and desktops with VDI, ZTNA gateway, MFA and SSO in a single platform, "
               "on infrastructure you already own, and runs alongside Citrix until you decide to switch off.",
     "pages": ["citrix-lp"], "parent": None, "nudge_weight": 10, "cta": None, "cta_url": None,
     "sources": [LP + "#comparison"], "visual": "compare_table",
     "visual_data": {"title": "Accops vs Citrix", "columns": ["", "Accops", "Citrix"],
                     "rows": [{"label": "Gateway & load balancing", "cells": ["Built into the platform", "Typically requires NetScaler / ADC"],
                               "group": "Infrastructure"},
                              {"label": "Site database", "cells": ["Bundled", "SQL Server licence"], "group": "Licensing"}]}},
    {"id": "lp-component-count", "question": "How many products does a Citrix estate need?", "aliases": [],
     "answer": "A typical Citrix estate needs separate products for load balancing, monitoring, the site database and printing. "
               "Accops ships those as built-in components of one product.",
     "pages": ["citrix-lp"], "parent": "lp-citrix-alternative", "nudge_weight": 5, "sources": [LP + "#section-4"],
     "visual": "stat", "visual_data": {"value": "8 → 1", "label": "Products to license and patch"}},
    {"id": "lp-migration", "question": "How does migration from Citrix work?", "aliases": ["citrix migration steps"],
     "answer": "Four steps alongside your existing Citrix estate: assessment, a pilot, a phased migration in batches, "
               "and go-live with direct OEM support. Nothing is switched off until you decide.",
     "pages": ["citrix-lp"], "parent": None, "nudge_weight": 8, "sources": [LP + "#migration"], "visual": "steps",
     "visual_data": {"title": "Migration alongside Citrix", "steps": [{"title": "Assessment"}, {"title": "Pilot / POC"},
                                                                     {"title": "Phased migration"}, {"title": "Go-live"}]}},
    {"id": "lp-hypervisors", "question": "Which hypervisors does Accops support?", "aliases": ["vmware nutanix hyper-v"],
     "answer": "Accops is hypervisor-agnostic: VMware, Nutanix and Hyper-V, and it integrates with Azure, AWS, GCP and OCI.",
     "pages": ["citrix-lp"], "parent": "lp-migration", "nudge_weight": 0, "sources": [LP + "#faq"], "visual": None, "visual_data": None},
    {"id": "lp-replacing", "question": "What are you replacing?", "aliases": [], "answer": "Pick what you run today.",
     "pages": ["citrix-lp"], "parent": None, "nudge_weight": 1, "sources": [LP + "#comparison"], "visual": "picker",
     "visual_data": {"prompt": "What are you replacing?", "options": [{"label": "Citrix Virtual Apps", "qa_id": "lp-citrix-alternative"},
                                                                     {"label": "Migration", "qa_id": "lp-migration"}]}},
    {"id": "lp-tco-calculator", "question": "What would we save?", "aliases": [], "answer": "Estimate your three-year licensing.",
     "pages": ["citrix-lp"], "parent": None, "nudge_weight": 0, "sources": [LP + "#section-7"], "visual": "calculator",
     "visual_data": {"title": "Three-year cost", "input": {"label": "Seats", "min": 50, "max": 5000, "step": 50, "default": 500, "unit": "seats"},
                     "columns": ["Citrix", "Accops"], "rows": [{"label": "Licensing", "per_unit": [220, 132], "currency": "USD"}],
                     "disclaimer": "Illustrative only; your quoted pricing will vary."}},
]
FIXTURE_PAGES = [
    {"url": LP + "#section-4", "title": "Component teardown", "summary": "Citrix vs Accops.", "facts": [
        {"fact": "8 products to 1.", "quote": "8 → 1 | Products to license and patch"}], "words": 10, "carded_by": "claude"},
    {"url": LP + "#comparison", "title": "Accops vs Citrix", "summary": "", "facts": []},
    {"url": LP + "#migration", "title": "Migration", "summary": "", "facts": []},
    {"url": LP + "#faq", "title": "FAQ", "summary": "", "facts": []},
    {"url": LP + "#section-7", "title": "Cost", "summary": "", "facts": []},
]


def self_check() -> None:
    rows = [map_qa(q) for q in FIXTURE_QA]
    ids = {r["id"] for r in rows}
    by_url = {p["url"]: p for p in FIXTURE_PAGES}
    errs = {r["id"]: validate_qa(r, ids, by_url) for r in rows}
    assert all(not e for k, e in errs.items() if k != "lp-tco-calculator"), errs
    assert any("figures_approved" in e for e in errs["lp-tco-calculator"]), errs
    ok_calc = {**rows[-1], "visual_data": {**rows[-1]["visual_data"], "figures_approved": True}}
    assert validate_qa(ok_calc, ids, by_url) == [], validate_qa(ok_calc, ids, by_url)

    stat = {**rows[1], "visual_data": {"value": "10x", "label": "Faster"}}
    assert any("not on" in e for e in validate_qa(stat, ids, by_url))
    wide = {**rows[0], "visual_data": {**rows[0]["visual_data"], "columns": ["a", "b", "c", "d"]}}
    assert any("columns" in e for e in validate_qa(wide, ids, by_url))
    typo = {**rows[0], "visual_data": {**rows[0]["visual_data"], "colums": []}}
    assert any("colums: unknown" in e for e in validate_qa(typo, ids, by_url))
    pick = {**rows[4], "visual_data": {"prompt": "x", "options": [{"label": "a", "qa_id": "nope"}, {"label": "b", "qa_id": "lp-migration"}]}}
    assert any("nope" in e for e in validate_qa(pick, ids, by_url))
    long = {**rows[3], "answer": "word " * 81}
    assert any("80 words" in e for e in validate_qa(long, ids, by_url))
    orphan = {**rows[3], "parent_id": "missing"}
    assert any("parent" in e for e in validate_qa(orphan, ids, by_url))
    assert any("sources" in e for e in validate_qa({**rows[3], "sources": []}, ids, by_url))
    assert map_qa({"id": "x", "parent": "y"})["parent_id"] == "y"

    p = map_page(FIXTURE_PAGES[0])
    assert "words" not in p and "carded_by" not in p and p["products"] == [] and p["needs_recard"] is False
    assert map_page({**FIXTURE_PAGES[0], "fetched_at": "2030-01-01"})["content_hash"] == p["content_hash"]
    assert map_page({**FIXTURE_PAGES[0], "summary": "changed"})["content_hash"] != p["content_hash"]
    assert validate_page({"url": "http://x", "title": "", "facts": [{"fact": 1}]}) and not validate_page(FIXTURE_PAGES[0])

    good = [r for r in rows if not errs[r["id"]]]
    up, ins, patch, kept = plan([p], good, {}, {})
    assert (len(up), len(ins), patch, kept) == (1, 5, [], [])
    db_q = {r["id"]: {**r, "status": "draft"} for r in good}
    db_q["lp-migration"]["status"] = "approved"
    db_q["lp-migration"]["answer"] = "approved wording"              # never overwritten
    db_q["lp-hypervisors"] = {**db_q["lp-hypervisors"], "answer": "old draft"}   # draft: updated
    up, ins, patch, kept = plan([p], good, {p["url"]: p["content_hash"]}, db_q)
    assert up == [] and ins == [] and [r["id"] for r in patch] == ["lp-hypervisors"] and kept == ["lp-migration"]
    assert MOJIBAKE.search("Accopsâ€™ VDI") and not MOJIBAKE.search("Accops’ VDI — é")
    print("load_web_knowledge self-check: ok")


if __name__ == "__main__":
    main()
