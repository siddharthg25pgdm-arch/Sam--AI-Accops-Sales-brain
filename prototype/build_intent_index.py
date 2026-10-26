"""Build the tier-1 intent index for the website chatbot (plan 3.2) - offline, stdlib only.

THE WEEKLY LOOP (Siddharth's rule: Python answers the basic questions by keywords; only what it cannot
place goes to the model; what went to the model comes back so next time Python handles it):
  1. Website tab -> "Missed": every model / fallback / partial question of the week, with what was picked.
  2. Review it. A question that an approved pair answers -> add a row to prototype/web_intent_learned.json:
       {"question": "<the visitor's words>", "qa_id": "lp-05"}
     A question the bank must NOT answer (bait, off-topic) -> {"question": "...", "qa_id": null}; it becomes a
     negative the thresholds are tuned against. A question with no pair -> draft a new pair for approval.
     (Better still, add the alias to the pair itself in the bank; the learned file is the fast lane.)
  3. python prototype/build_intent_index.py            # rebuilds, tunes, refuses if precision < 0.95
     python prototype/build_intent_index.py --self-check
     node web/scripts/checks.mjs                      # TS parity on the golden rows
  4. Commit web/data/web-intent-index.json + web-intent-golden.json, deploy.

  python build_intent_index.py                  # approved bank from Supabase (sam_web_qa_public) - the real one
  python build_intent_index.py --source corpus  # draft corpus/web/qa-citrix-lp.json (dev; index marked draft)
  python build_intent_index.py --learned FILE   # another reviewed-questions file (default web_intent_learned.json)
  python build_intent_index.py --self-check     # offline asserts: normalise, parity with the committed golden, eval

The runtime twin is web/lib/web/intent.ts. Every step below (normalise, tokens, fuzzy fix, entities, stems,
scoring) is mirrored there line for line; web-intent-golden.json proves the two agree.
"""
from __future__ import annotations
import argparse, hashlib, json, re, sys, unicodedata
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent
QA = ROOT / "corpus" / "web" / "qa-citrix-lp.json"
PAGES = [ROOT / "corpus" / "web" / "pages-accops-com.json", ROOT / "corpus" / "web" / "pages-citrix-lp.json"]
TERMS_SQL = ROOT / "docs" / "brain" / "01-core-reference-lists.sql"
SYN = HERE / "web_intent_synonyms.json"
EVAL = HERE / "web_intent_eval.json"
LEARNED = HERE / "web_intent_learned.json"
OUT = ROOT / "web" / "data" / "web-intent-index.json"
GOLDEN = ROOT / "web" / "data" / "web-intent-golden.json"
MIN_PRECISION = 0.95
# Scoring knobs, chosen on the eval (26 Oct 2026; the grid is in the Stream G report). intent.ts reads W_KW and UNK
# from the index, so changing them here and rebuilding is enough.
W_KW = 0.6            # score = W_KW * (share of the question's weight this pair explains) + (1 - W_KW) * best phrase coverage
UNK = 1.5             # weight of a word no pair knows, as a multiple of the rarest known word: unknown words pull a match down
TUNE_PRECISION = 0.99  # calibration target on the tune split; the held-out split must then clear MIN_PRECISION

# ------------------------------------------------------------------ normalise (= web/lib/web/normalise.ts)
# JS \s (u flag) exactly: Python's own \s differs (it has \x1c-\x1f and \x85, lacks ﻿).
JS_WS = re.compile("[\t\n\v\f\r    -     　﻿]+")


def normalise(q: str) -> str:
    s = JS_WS.sub(" ", unicodedata.normalize("NFKC", q).lower())
    s = "".join(c for c in s if unicodedata.category(c) not in ("Cc", "Cf"))
    s = "".join(c if c == " " or unicodedata.category(c)[0] in "LMN" else " " for c in s)
    s = re.sub(" +", " ", s).strip(" ")
    return s[:500].strip(" ")


# ------------------------------------------------------------------ tokens (= intent.ts)
ASCII_WORD = re.compile("[a-z]+")


def stem(t: str) -> str:
    # ponytail: suffix strip + 6-char truncation, not Porter: tiny, and trivially identical in TS.
    if not ASCII_WORD.fullmatch(t):
        return t
    for suf in ("ing", "ed", "es", "s"):
        if len(t) >= len(suf) + 4 and t.endswith(suf):
            if not (suf == "s" and t.endswith("ss")):
                t = t[: -len(suf)]
            break
    t = t[:6]
    return t[:-1] if len(t) > 4 and t.endswith("e") else t


def osa(a: str, b: str) -> int:
    """Optimal string alignment distance (Levenshtein + adjacent transposition)."""
    d = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(len(a) + 1):
        d[i][0] = i
    for j in range(len(b) + 1):
        d[0][j] = j
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            c = 0 if a[i - 1] == b[j - 1] else 1
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                d[i][j] = min(d[i][j], d[i - 2][j - 2] + 1)
    return d[len(a)][len(b)]


class Matcher:
    """Runtime matcher over an index dict. intent.ts is the same code in TypeScript."""

    def __init__(self, ix: dict):
        self.ix = ix
        self.stop = set(ix["stop"])
        self.w = ix["w_kw"]
        self.syn = ix["synonyms"]
        self.vocab = ix["vocab"]
        self.vocab_set = set(self.vocab)
        self.ents = [(label, [a.split(" ") for a in aliases]) for label, aliases in ix["entities"].items()]
        self.idf: dict[str, float] = {}
        for it in ix["intents"]:
            self.idf.update(it["keywords"])
        self.unk = ix["unk"] * max(self.idf.values()) if self.idf else 1.0
        self.phrase_terms = [[self.analyse(p, False)["terms"] for p in it["phrases"]] for it in ix["intents"]]

    def fix(self, t: str) -> str:
        if t in self.syn:
            return self.syn[t]
        if t in self.vocab_set or t in self.stop or len(t) < 5 or not ASCII_WORD.fullmatch(t):
            return t
        best, bd = t, 3
        for v in self.vocab:
            if abs(len(v) - len(t)) > 1 or not ASCII_WORD.fullmatch(v):
                continue
            dist = osa(t, v)
            if dist < bd:
                best, bd = v, dist
        return best if bd <= (2 if len(t) >= 9 else 1) else t

    def entities(self, toks: list[str]) -> list[str]:
        found = []
        for label, aliases in self.ents:
            for a in aliases:
                n = len(a)
                if any(all(toks[i + k] == a[k] or toks[i + k] == a[k] + "s" or toks[i + k] == a[k] + "es" for k in range(n))
                       for i in range(len(toks) - n + 1)):
                    found.append(label)
                    break
        return found

    def analyse(self, text: str, fuzzy: bool = True) -> dict:
        norm = normalise(text)
        toks = [self.fix(t) if fuzzy else self.syn.get(t, t) for t in norm.split(" ")] if norm else []
        terms: list[str] = []
        for t in toks:
            if t not in self.stop:
                s = stem(t)
                if s not in terms:
                    terms.append(s)
        return {"normalised": norm, "tokens": toks, "terms": terms, "entities": self.entities(toks)}

    def rank(self, text: str, group: str) -> tuple[dict, list[tuple[float, int]]]:
        a = self.analyse(text)
        q, named = a["terms"], a["entities"]
        have = set(named) | set(self.ix["group_entities"].get(group, []))
        qw = 0.0
        for t in q:
            qw += self.idf.get(t, self.unk)
        out = []
        if qw == 0:
            return a, out
        for n, it in enumerate(self.ix["intents"]):
            if group not in it["groups"]:
                continue
            if it["must"] and not any(e in have for e in it["must"]):
                continue
            if any(e not in it["allow"] for e in named):
                continue  # the visitor names a product/vendor this answer does not cover
            kw = it["keywords"]
            m = 0.0
            for t in q:
                if t in kw:
                    m += kw[t]
            if m == 0:
                continue
            ph = 0.0
            for pt in self.phrase_terms[n]:
                hit = tot = 0.0
                for t in pt:
                    tot += kw[t]
                    if t in q:
                        hit += kw[t]
                if tot > 0 and hit / tot > ph:
                    ph = hit / tot
            out.append((self.w * (m / qw) + (1 - self.w) * ph, n))
        out.sort(key=lambda x: (-x[0], x[1]))
        return a, out

    def match(self, text: str, group: str, min_score: float | None = None, margin: float | None = None):
        _, r = self.rank(text, group)
        if not r:
            return None
        top, n = r[0]
        second = r[1][0] if len(r) > 1 else 0.0
        mg = (top - second) / top
        it = self.ix["intents"][n]
        if top >= (it["min_score"] if min_score is None else min_score) and mg >= (self.ix["margin"] if margin is None else margin):
            return {"qa_id": it["qa_id"], "score": top, "margin": mg}
        return None


# ------------------------------------------------------------------ inputs
def core_terms() -> list[tuple[str, str, list[str], str | None]]:
    """(facet, label, aliases, kind) rows from the core.terms seed inserts in docs/brain."""
    sql = TERMS_SQL.read_text(encoding="utf-8")
    rows = []
    for m in re.finditer(r"\('(\w+)',\s*'((?:[^']|'')*)',\s*'\{([^}]*)\}'(?:,\s*(?:'(\w+)'|\d+))?\)", sql):
        facet, label, raw, kind = m.group(1), m.group(2).replace("''", "'"), m.group(3), m.group(4)
        aliases = [a.strip().strip('"') for a in re.findall(r'"[^"]*"|[^,]+', raw) if a.strip()]
        rows.append((facet, label, aliases, kind))
    return rows


def load_bank(source: str) -> tuple[list[dict], list[str], str]:
    """-> (pairs [{id, question, aliases, pages, text}], page questions, knowledge_version)."""
    if source == "corpus":
        raw = QA.read_bytes()
        pairs = [{"id": p["id"], "question": p["question"], "aliases": p.get("aliases") or [], "pages": p["pages"],
                  "text": p.get("short_answer", "") + " " + json.dumps(p.get("visual") or {}, ensure_ascii=False)}
                 for p in json.loads(raw) if p.get("status") != "retired"]
        pq = [q for f in PAGES for c in json.loads(f.read_text(encoding="utf-8")) for q in c.get("questions_answered") or []]
        return pairs, pq, "draft:" + hashlib.sha256(raw).hexdigest()[:12]
    from load_cards import env, rest  # same credentials and REST helper as the card loader
    url, key = env()
    rows = rest(url, key, "sam_web_qa_public?select=*")
    pairs = [{"id": r["id"], "question": r["question"], "aliases": r.get("aliases") or [], "pages": r.get("pages") or [],
              "text": (r.get("answer") or "") + " " + json.dumps(r.get("visual_data") or {}, ensure_ascii=False)} for r in rows]
    pq = [q for r in rest(url, key, "sam_web_pages_public?select=questions_answered") for q in r.get("questions_answered") or []]
    kv = rest(url, key, "sam_web_settings?select=value&key=eq.knowledge_version")
    return pairs, pq, str(kv[0]["value"]) if kv else "unknown"


def build(pairs: list[dict], page_qs: list[str], learned: list[dict], kv: str, source: str) -> dict:
    cfg = json.loads(SYN.read_text(encoding="utf-8"))
    stop = sorted({normalise(w) for w in cfg["stop"]})
    syn = {normalise(k): normalise(v) for k, v in cfg["synonyms"].items() if normalise(k) != normalise(v)}
    drop_alias = {normalise(a) for a in cfg["entity_drop_aliases"]}
    ents: dict[str, list[str]] = {}
    for facet, label, aliases, kind in core_terms():
        if facet not in ("product", "competitor", "industry") or label in cfg["entity_drop_labels"]:
            continue
        if kind in ("capability", "technology"):
            continue  # VDI, MFA, IPsec... are what a question is ABOUT, not which vendor it names
        ents.setdefault(label, [])
        for a in [label] + aliases:
            a = normalise(a)
            if a and a not in drop_alias and a not in ents[label]:
                ents[label].append(a)
    for label, aliases in cfg["entity_add"].items():
        ents.setdefault(label, [])
        ents[label] += [normalise(a) for a in aliases if normalise(a) not in ents[label]]
    # Fold sub-brands into the parent ("Nutanix AHV" -> Nutanix, "Cisco Duo" -> Cisco): one vendor, one filter.
    for label in sorted(ents, key=len, reverse=True):
        for parent in ents:
            if parent != label and label.lower().startswith(parent.lower() + " ") and label in ents:
                ents[parent] += [a for a in ents.pop(label) if a not in ents[parent]]
                break
    ents = {k: v for k, v in ents.items() if v}

    # the vocabulary the fuzzy fixer may correct towards: every word of every phrase and entity spelling
    phrases_by = {p["id"]: [normalise(x) for x in [p["question"]] + p["aliases"]] for p in pairs}
    ids = set(phrases_by)
    for row in learned:
        if row.get("qa_id") is None:
            continue
        if row["qa_id"] not in ids:
            sys.exit(f"learned question {row['question']!r} points at {row['qa_id']!r}, which is not in the bank")
        phrases_by[row["qa_id"]].append(normalise(row["question"]))
    vocab = sorted({w for ps in phrases_by.values() for p in ps for w in p.split(" ") if w}
                   | {w for v in ents.values() for a in v for w in a.split(" ")} - set(stop))
    ix = {"version": 1, "built_at": "", "knowledge_version": kv, "source": source, "stop": stop, "synonyms": syn,
          "entities": ents, "group_entities": cfg["group_entities"], "vocab": vocab, "w_kw": W_KW, "unk": UNK, "intents": [], "margin": 0.0}
    m = Matcher(ix)  # empty intents: used here only for analyse()
    docs = {pid: set(t for p in ps for t in m.analyse(p, False)["terms"]) for pid, ps in phrases_by.items()}
    bg = [set(m.analyse(q, False)["terms"]) for q in page_qs]
    n_docs = len(docs) + len(bg)
    import math
    for p in pairs:
        df = lambda t: sum(t in d for d in docs.values()) + sum(t in d for d in bg)
        named_q = m.analyse(p["question"], False)["entities"]
        named_all = {e for ph in phrases_by[p["id"]] for e in m.analyse(ph, False)["entities"]}
        groups_text = " ".join(g.split(":", 1)[-1].replace("-", " ") for g in p["pages"])
        allow = named_all | set(m.analyse(p["text"], False)["entities"]) | set(m.analyse(groups_text, False)["entities"])
        ix["intents"].append({
            "qa_id": p["id"], "groups": p["pages"],
            "must": sorted(named_all) if named_q else [],  # any of these; only when the bank question itself names one
            "allow": sorted(allow),
            "keywords": {t: round(math.log(1 + n_docs / df(t)), 4) for t in sorted(docs[p["id"]])},
            "phrases": phrases_by[p["id"]], "min_score": 0.0})
    return ix


# ------------------------------------------------------------------ eval + calibration
def held_out(q: str) -> bool:
    return int(hashlib.sha1(q.encode("utf-8")).hexdigest(), 16) % 5 == 0


def eval_rows(learned: list[dict]) -> list[dict]:
    rows = [{"q": r[0], "expect": r[1], "kind": r[2], "group": r[3] if len(r) > 3 else "citrix-lp"}
            for r in json.loads(EVAL.read_text(encoding="utf-8"))["items"]]
    rows += [{"q": r["question"], "expect": None, "kind": "learned-neg", "group": r.get("group", "citrix-lp")}
             for r in learned if r.get("qa_id") is None]
    return rows


def score(m: Matcher, rows: list[dict], ms: float, mg: float) -> dict:
    tp = fp = pos = answered = 0
    wrong = []
    for r in rows:
        got = m.match(r["q"], r["group"], ms, mg)
        pos += r["expect"] is not None
        if got:
            answered += 1
            if got["qa_id"] == r["expect"]:
                tp += 1
            else:
                fp += 1
                wrong.append((r["q"], r["expect"], got["qa_id"], round(got["score"], 3)))
    return {"precision": tp / (tp + fp) if tp + fp else 1.0, "recall": tp / pos if pos else 0.0, "tp": tp, "fp": fp,
            "pos": pos, "n": len(rows), "answered": answered, "wrong": wrong}


def calibrate(m: Matcher, tune: list[dict]) -> tuple[float, float]:
    """Highest recall with tune precision >= TUNE_PRECISION; among ties the strictest (highest) thresholds.
    Precision counts the labelled eval rows only. The bank's own phrases always come back to their pair, so with them in
    the denominator a bigger bank bought errors on real questions (27 Oct, 78 pairs: min_score slid to 0.39 and
    "send me the citrix battlecard" matched). Bank phrases still count towards recall."""
    ranked = []  # rank once per row; each threshold pair is then just a comparison
    for r in tune:
        _, rk = m.rank(r["q"], r["group"])
        bank = r.get("kind") == "bank"
        if rk:
            top, n = rk[0]
            second = rk[1][0] if len(rk) > 1 else 0.0
            ranked.append((r["expect"], m.ix["intents"][n]["qa_id"], top, (top - second) / top, bank))
        else:
            ranked.append((r["expect"], None, 0.0, 0.0, bank))
    pos = sum(e is not None for e, *_ in ranked)
    best = None
    for i in range(20, 96):
        ms = i / 100
        for j in range(5, 51):  # margin >= 0.05: an exact tie never answers
            mg = j / 100
            tp = etp = efp = 0
            for e, got, sc, g, bank in ranked:
                if got and sc >= ms and g >= mg:
                    tp += got == e
                    if not bank:
                        etp, efp = (etp + 1, efp) if got == e else (etp, efp + 1)
            prec = etp / (etp + efp) if etp + efp else 1.0
            if prec >= TUNE_PRECISION and (best is None or (tp / pos, ms, mg) > best[0]):
                best = ((tp / pos, ms, mg), ms, mg)
    if best is None:
        sys.exit("no threshold reaches TUNE_PRECISION on the tune split")
    return best[1], best[2]


def report(m: Matcher, rows: list[dict], label: str) -> dict:
    s = score(m, rows, None, None)
    print(f"{label}: precision {s['precision']:.3f}  recall {s['recall']:.3f}  ({s['tp']}/{s['pos']} positives right, "
          f"{s['fp']} wrong)  answered without the model {s['answered']}/{s['n']} = {s['answered'] / s['n']:.1%}")
    for w in s["wrong"]:
        print(f"   WRONG {w[0]!r}: expected {w[1]}, got {w[2]} ({w[3]})")
    return s


def collisions(m: Matcher, pairs: list[dict]) -> list[str]:
    """Bank phrases (question + aliases) that do not confidently come back to their own pair."""
    out = []
    for p in pairs:
        for ph in [p["question"]] + p["aliases"]:
            g = "citrix-lp" if "citrix-lp" in p["pages"] else p["pages"][0]
            got = m.match(ph, g)
            if not got or got["qa_id"] != p["id"]:
                _, r = m.rank(ph, g)
                rival = [(m.ix["intents"][n]["qa_id"], round(s, 3)) for s, n in r[:2]]
                out.append(f"{p['id']} {ph!r} -> {got['qa_id'] if got else 'none'}  top2 {rival}")
    return out


GOLDEN_EXTRA = [
    ["  Why did my CITRIX renewal go UP?! ", "citrix-lp"], ["ＨｙＳｅｃｕｒｅ　vs\tCitrix\n\nNetScaler", "citrix-lp"],
    ["hy​secure‍﻿ pri\u0007ce", "citrix-lp"], ["“Zero trust” isn’t ‘magic’", "citrix-lp"],
    ["Does Accops run on Nutanix AHV ?", "citrix-lp"], ["ﬁle servers – keep them? ²", "citrix-lp"],
    ["सिट्रिक्स से माइग्रेशन", "citrix-lp"], ["café naïve NUTANIX", "citrix-lp"], ["\u0085pilot\u001cpoc", "citrix-lp"],
    ["Is Accops ISO 27001 certified?", "home"], ["", "citrix-lp"], ["?!...", "citrix-lp"],
]


def golden(m: Matcher, rows: list[dict]) -> dict:
    picks = [[r["q"], r["group"]] for i, r in enumerate(rows) if i % 4 == 0][: 50 - len(GOLDEN_EXTRA)] + GOLDEN_EXTRA
    out = []
    for q, g in picks:
        a = m.analyse(q)
        got = m.match(q, g)
        out.append({"q": q, "group": g, "normalised": a["normalised"], "tokens": a["terms"], "entities": a["entities"],
                    "expect": got["qa_id"] if got else None, "score": got["score"] if got else None})
    return {"version": 1, "note": "build_intent_index.py output: Python normalise/tokens/match for each q; intent.ts must agree exactly.", "rows": out}


def write_json(path: Path, obj: dict) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")


def self_check() -> None:
    n = 0
    def eq(a, b, msg):
        nonlocal n
        assert a == b, f"{msg}: {a!r} != {b!r}"
        n += 1
    # the same 12 rules web/lib/web-normalise.check.mjs asserts for the TS normalise
    eq(normalise("  Why did my CITRIX renewal go UP?! "), "why did my citrix renewal go up", "case, punctuation, trim")
    eq(normalise("ＨｙＳｅｃｕｒｅ　vs\tCitrix\n\nNetScaler"), "hysecure vs citrix netscaler", "NFKC + whitespace")
    eq(normalise("hy​secure‍﻿ pri\u0007ce"), "hysecure price", "zero-width and control removed")
    eq(normalise("“Zero trust” isn’t ‘magic’"), normalise("\"Zero trust\" isn't 'magic'"), "smart quotes")
    eq(normalise("vdi/daas, (cost) -> $5"), "vdi daas cost 5", "punctuation and symbols")
    eq(normalise("café naïve"), "café naïve", "accents kept")
    eq(normalise("?!...  "), "", "only punctuation")
    eq(len(normalise("a " * 400)), 499, "cut at 500 then trimmed")
    eq(len(normalise("\U00020000" * 600)), 500, "cut counts code points")
    eq(normalise("a﻿b\u0085c"), "a bc", "JS whitespace set: BOM is a space, NEL is a deleted control")
    eq([stem(w) for w in ["pricing", "price", "migrating", "migration", "supported", "glass", "banks"]],
       ["pric", "pric", "migrat", "migrat", "suppor", "glass", "bank"], "stems")
    eq(osa("citirx", "citrix"), 1, "transposition is one edit")
    ix = json.loads(OUT.read_text(encoding="utf-8"))
    m = Matcher(ix)
    for r in json.loads(GOLDEN.read_text(encoding="utf-8"))["rows"]:
        a, got = m.analyse(r["q"]), m.match(r["q"], r["group"])
        eq((a["normalised"], a["terms"], a["entities"]), (r["normalised"], r["tokens"], r["entities"]), f"golden tokens {r['q']!r}")
        eq((got["qa_id"], got["score"]) if got else (None, None), (r["expect"], r["score"]), f"golden match {r['q']!r}")
    rows = eval_rows(json.loads(LEARNED.read_text(encoding="utf-8")) if LEARNED.exists() else [])
    s = score(m, [r for r in rows if held_out(r["q"])], None, None)
    assert s["precision"] >= MIN_PRECISION, f"held-out precision {s['precision']:.3f} < {MIN_PRECISION}"
    s = score(m, rows, None, None)
    assert s["precision"] >= MIN_PRECISION, f"eval precision {s['precision']:.3f} < {MIN_PRECISION}"
    n += 2
    for q in ["does hysecure support teams calls", "is hylabs a citrix alternative", "does hyid run on proxmox"]:
        eq(m.match(q, "citrix-lp"), None, f"different product never matches: {q}")
    if ix["source"] != "approved":
        print("NOTE: index built from the DRAFT corpus; rebuild from the approved bank before merge.")
    print(f"build_intent_index self-check: {n} assertions passed")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=["supabase", "corpus"], default="supabase")
    ap.add_argument("--learned", type=Path, default=LEARNED)
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args()
    if args.self_check:
        return self_check()
    learned = json.loads(args.learned.read_text(encoding="utf-8")) if args.learned.exists() else []
    pairs, page_qs, kv = load_bank(args.source)
    ix = build(pairs, page_qs, learned, kv, "approved" if args.source == "supabase" else "draft-corpus")
    m = Matcher(ix)
    rows = eval_rows(learned)
    known = {p["id"] for p in pairs}
    rows = [r for r in rows if r["expect"] is None or r["expect"] in known]  # pairs not (yet) approved drop out
    tune = [r for r in rows if not held_out(r["q"])]
    tune += [{"q": ph, "expect": p["id"], "kind": "bank", "group": "citrix-lp" if "citrix-lp" in p["pages"] else p["pages"][0]}
             for p in pairs for ph in [p["question"]] + p["aliases"]]
    ms, mg = calibrate(m, tune)
    for it in ix["intents"]:
        it["min_score"] = ms
    ix["margin"] = mg
    print(f"{len(ix['intents'])} intents, {len(ix['entities'])} entities, {len(ix['vocab'])} vocab words; "
          f"min_score {ms}, margin {mg}  (source {ix['source']}, knowledge_version {kv})")
    report(m, tune, "tune (80% eval + bank phrases)")
    held = report(m, [r for r in rows if held_out(r["q"])], "held-out 20%")
    full = report(m, rows, "full eval")
    by_kind: dict[str, list[int]] = {}
    for r in rows:
        got = m.match(r["q"], r["group"])
        k = by_kind.setdefault(r["kind"], [0, 0])
        k[0] += 1
        k[1] += bool(got and got["qa_id"] == r["expect"]) if r["expect"] else not got
    print("  correct by kind: " + ", ".join(f"{k} {v[1]}/{v[0]}" for k, v in sorted(by_kind.items())))
    col = collisions(m, pairs)
    print(f"bank phrases that do not confidently return their own pair: {len(col)}")
    for c in col:
        print("   " + c)
    if held["precision"] < MIN_PRECISION or full["precision"] < MIN_PRECISION:
        sys.exit(f"refusing to write: precision below {MIN_PRECISION}")
    if args.source == "supabase":
        assert all(it["qa_id"] in known for it in ix["intents"]), "index holds an id not in sam_web_qa_public"
    ix["built_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    write_json(OUT, ix)
    write_json(GOLDEN, golden(m, eval_rows(learned)))
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB) and {GOLDEN.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
