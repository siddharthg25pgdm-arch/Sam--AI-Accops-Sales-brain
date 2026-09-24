"""Load corpus/cards/batch-*.json into Supabase sam_asset_cards.

The step that makes carding matter. Cards sit in git as the reviewable record; this puts them where
SAM can read them. Idempotent - upserts on `source`, so re-running after fixing a card is the normal
way to correct one.

  python load_cards.py --dry-run     # show what would be written, touch nothing
  python load_cards.py               # upsert every card
  python load_cards.py --check       # read back and compare against the files
  python load_cards.py --self-check  # offline asserts for card binding and carded_at

Each card is bound to the registry item_id it describes (sam_asset_cards.item_id), so a rename in
SharePoint does not detach it, and carded_at moves only when the card's content changes - that is
what sam_carding_queue compares a file's modified_at against.

Credentials come from web/.env.local, the same SUPABASE_URL / SUPABASE_SERVICE_KEY the app uses.
"""
from __future__ import annotations
import argparse, hashlib, json, os, re, sys, urllib.request, urllib.error
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).parent
CARDS = HERE.parent / "corpus" / "cards"
ENV = HERE.parent / "web" / ".env.local"
TABLE = "sam_asset_cards"
# The project every sam_ table lives in. Checked before writing, exactly as sp_reconcile.py does:
# the credentials in .env.local are a service key, so a wrong URL writes real rows somewhere else.
EXPECT_REF = "iwqhayuoxnrhqzozznes"

# Columns the table has. Anything else in a card file (schema_notes, pairs_with, extraction_note,
# compliance_note ...) is commentary for a human reading the JSON and is deliberately not stored -
# a column nobody queries is a column that drifts.
COLUMNS = {
    "source", "filename", "origin", "title", "asset_type", "industry", "client", "client_actual",
    "client_named", "products", "competitors", "personas", "regulations", "key_problem",
    "key_outcomes", "brief", "use_for", "publish_year", "expired", "expiry_date", "stale_risk",
    "superseded_by", "visibility", "internal_reason", "public_url", "confidence", "needs_human",
    "batch", "generated_by", "carded_at",
}
# Written by this script, not by a card (carded_at may be set by hand to confirm a card still fits a
# re-saved file): which registry row the card describes, and a hash so carded_at moves only when the
# card's content changes. See bind_and_stamp.
DERIVED = {"item_id", "card_hash", "carded_at", "batch", "generated_by"}

# Per-column empty value, matching the table's own defaults. Only the types that are not text.
DEFAULTS: dict[str, object] = {
    "products": [], "competitors": [], "personas": [], "regulations": [], "key_outcomes": [],
    "client_named": False, "expired": False, "confidence": 0,
    "publish_year": None, "expiry_date": None,
}


def env() -> tuple[str, str]:
    url = key = ""
    for line in ENV.read_text(encoding="utf-8").splitlines():
        if line.startswith("SUPABASE_URL="):
            url = line.split("=", 1)[1].strip().rstrip("/")
        elif line.startswith("SUPABASE_SERVICE_KEY="):
            key = line.split("=", 1)[1].strip()
    if not url or not key:
        sys.exit(f"no Supabase credentials in {ENV}")
    if EXPECT_REF not in url:
        sys.exit(f"refusing to write: expected project {EXPECT_REF}, got {url}")
    return url, key


def rest(url: str, key: str, path: str, method: str = "GET", body=None, prefer: str = ""):
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{url}/rest/v1/{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        sys.exit(f"supabase {method} {path} -> {e.code}: {e.read().decode()[:400]}")


def to_row(c: dict, batch: str, generated_by: str) -> dict:
    """Card JSON -> table row. Only known columns, and nothing invented for the ones a card omits."""
    src = c["source"]
    row = {
        "source": src,
        "filename": src.split("/", 1)[-1],
        "origin": src.split("/", 1)[0],
        "batch": batch,
        "generated_by": generated_by,
    }
    for k, v in c.items():
        if k in COLUMNS and k not in row:
            row[k] = v
    # PostgREST rejects a batch whose objects have different key sets ("All object keys must match"),
    # and cards legitimately differ - only one has expiry_date, only some have superseded_by. So fill
    # every column explicitly rather than letting the column list vary row by row.
    for col in COLUMNS - {"carded_at"}:
        row.setdefault(col, DEFAULTS.get(col, ""))
    # expiry_date is a real date column: '' would be 22007, and a card with no expiry must store
    # NULL rather than a placeholder that sorts as a date.
    if not row.get("expiry_date"):
        row["expiry_date"] = None
    if not row.get("publish_year"):
        row["publish_year"] = None
    return row


def stem(filename: str) -> str:
    """dedupeKey() in web/lib/cards.ts and the stem in sam_carding_queue - keep all three in step."""
    return re.sub(r"[^a-z0-9]", "", re.sub(r"\.(pdf|docx|pptx|doc|ppt|xlsx)$", "", filename.lower()))


def bind(card: dict, prior_item_id: str | None, live: list[dict]) -> str | None:
    """The registry item_id this card describes, or None when that is not knowable for certain.

    A previous binding wins while its row is alive. That is the point: after a rename the filename no
    longer resolves, but the item_id - which applyChange keeps across a rename via list_item_id -
    still does. Otherwise the card's filename must match exactly ONE live row (case-insensitive),
    falling back to a unique PDF/PPTX twin by stem. The same name in two folders is ambiguous, so
    None, and the app keeps merging that card by filename exactly as before. Never guess."""
    if prior_item_id and any(r["item_id"] == prior_item_id for r in live):
        return prior_item_id
    name = card["filename"].lower()
    exact = [r for r in live if r["filename"].lower() == name]
    if len(exact) == 1:
        return exact[0]["item_id"]
    if exact:
        return None
    twins = [r for r in live if stem(r["filename"]) == stem(card["filename"])]
    return twins[0]["item_id"] if len(twins) == 1 else None


def content_hash(row: dict) -> str:
    body = {k: v for k, v in row.items() if k not in DERIVED}
    return hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]


def bind_and_stamp(rows: list[dict], prior: dict[str, dict], live: list[dict], now: str) -> None:
    """Fill item_id, card_hash and carded_at on every row, in place.

    carded_at is when the card CONTENT last changed - what sam_carding_queue compares a file's
    modified_at against. A reload that changes nothing must not move it, or re-running this script
    would silently clear every 'changed_since_card' entry. A card that sets carded_at itself (a
    reviewer confirming the card still fits a re-saved file) overrides."""
    for r in rows:
        p = prior.get(r["source"]) or {}
        r["item_id"] = bind(r, p.get("item_id"), live)
        r["card_hash"] = content_hash(r)
        if r.get("carded_at"):
            continue
        # A NULL prior hash is a row loaded before hashing existed. Its carded_at was backfilled from
        # created_at, which is the right answer, so keep it rather than stamping today.
        same = bool(p) and p.get("card_hash") in (None, r["card_hash"])
        r["carded_at"] = p["carded_at"] if same else now


def check_binding() -> None:
    """python load_cards.py --self-check : the rename and twin cases, no network."""
    live = [{"item_id": "A", "filename": "Deck v2 (renamed).pptx"},
            {"item_id": "B", "filename": "Brochure.pdf"}, {"item_id": "C", "filename": "Brochure.pptx"},
            {"item_id": "D", "filename": "Twin only.pptx"},
            {"item_id": "E", "filename": "Dup.pdf"}, {"item_id": "F", "filename": "Dup.pdf"}]
    assert bind({"filename": "Deck v1.pptx"}, "A", live) == "A", "rename: prior binding must survive"
    assert bind({"filename": "Deck v1.pptx"}, None, live) is None, "unresolvable: no guess"
    assert bind({"filename": "brochure.PDF"}, None, live) == "B", "exact, case-insensitive"
    assert bind({"filename": "Twin only.pdf"}, None, live) == "D", "unique twin by stem"
    assert bind({"filename": "Dup.pdf"}, None, live) is None, "same name in two folders: ambiguous"
    assert bind({"filename": "Brochure.pdf"}, "gone", live) == "B", "dead binding re-resolves"
    base = {"source": "s/x.pdf", "filename": "x.pdf", "title": "t", "batch": "b1"}
    rows = [dict(base)]; bind_and_stamp(rows, {}, live, "NOW"); h = rows[0]["card_hash"]
    assert rows[0]["carded_at"] == "NOW", "new card stamped now"
    old = {"s/x.pdf": {"item_id": None, "card_hash": h, "carded_at": "THEN"}}
    rows = [dict(base, batch="b2")]; bind_and_stamp(rows, old, live, "NOW")
    assert rows[0]["carded_at"] == "THEN", "unchanged content (batch is not content) keeps carded_at"
    rows = [dict(base, title="t2")]; bind_and_stamp(rows, old, live, "NOW")
    assert rows[0]["carded_at"] == "NOW", "changed content moves carded_at"
    rows = [dict(base)]; bind_and_stamp(rows, {"s/x.pdf": {"card_hash": None, "carded_at": "THEN"}}, live, "NOW")
    assert rows[0]["carded_at"] == "THEN", "pre-hash rows keep their backfilled carded_at"
    rows = [dict(base, carded_at="2026-09-25")]; bind_and_stamp(rows, old, live, "NOW")
    assert rows[0]["carded_at"] == "2026-09-25", "explicit carded_at wins"
    print("load_cards self-check: ok")


def load() -> list[dict]:
    rows = []
    for f in sorted(CARDS.glob("batch-*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        for c in d["cards"]:
            rows.append(to_row(c, f.stem, d.get("generated_by", "")))
    seen = {}
    for r in rows:
        if r["source"] in seen:
            sys.exit(f"duplicate source across batches: {r['source']}")
        seen[r["source"]] = True
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args()
    if a.self_check:
        return check_binding()
    url, key = env()
    rows = load()
    print(f"{len(rows)} cards in {CARDS}")
    print(f"  internal: {sum(1 for r in rows if r.get('visibility') == 'internal')}"
          f" | sendable: {sum(1 for r in rows if r.get('visibility') == 'both')}"
          f" | expired: {sum(1 for r in rows if r.get('expired'))}"
          f" | with a year: {sum(1 for r in rows if r.get('publish_year'))}")

    if a.check:
        got = rest(url, key, f"{TABLE}?select=source,title,publish_year,expired,visibility&limit=2000") or []
        bysrc = {g["source"]: g for g in got}
        print(f"\n{len(got)} rows in Supabase")
        missing = [r["source"] for r in rows if r["source"] not in bysrc]
        extra = [g for g in bysrc if g not in {r["source"] for r in rows}]
        drift = [r["source"] for r in rows if r["source"] in bysrc
                 and bysrc[r["source"]]["title"] != r["title"]]
        for label, items in (("missing from Supabase", missing), ("in Supabase but not in files", extra),
                             ("title differs", drift)):
            print(f"  {label}: {len(items)}")
            for i in items[:5]:
                print(f"     - {i}")
        sys.exit(1 if (missing or drift) else 0)

    live = rest(url, key, "sam_sharepoint_files?deleted=is.false&select=item_id,filename&limit=5000") or []
    prior = {p["source"]: p for p in
             rest(url, key, f"{TABLE}?select=source,item_id,card_hash,carded_at&limit=2000") or []}
    bind_and_stamp(rows, prior, live, datetime.now(timezone.utc).isoformat())
    bound = sum(1 for r in rows if r["item_id"])
    moved = sum(1 for r in rows if prior.get(r["source"], {}).get("carded_at") != r["carded_at"])
    print(f"  bound to a registry row: {bound} | unbound, merge by filename: {len(rows) - bound}"
          f" | new or re-carded (carded_at moves): {moved}")
    for r in rows:
        if not r["item_id"]:
            print(f"     unbound: {r['source']}")

    if a.dry_run:
        for r in rows[:5]:
            print(f"  {r['source']}\n      {r['title'][:70]}  [{r.get('publish_year')}] {r.get('visibility')}")
        print(f"  ... {len(rows)} total. Nothing written.")
        return

    # merge-duplicates so a re-run corrects a card rather than failing on the primary key.
    rest(url, key, f"{TABLE}?on_conflict=source", "POST", rows,
         prefer="resolution=merge-duplicates,return=minimal")
    print(f"\nupserted {len(rows)} cards")
    got = rest(url, key, f"{TABLE}?select=source&limit=2000") or []
    print(f"table now holds {len(got)} rows")


if __name__ == "__main__":
    main()
