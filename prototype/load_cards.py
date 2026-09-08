"""Load corpus/cards/batch-*.json into Supabase sam_asset_cards.

The step that makes carding matter. Cards sit in git as the reviewable record; this puts them where
SAM can read them. Idempotent - upserts on `source`, so re-running after fixing a card is the normal
way to correct one.

  python load_cards.py --dry-run     # show what would be written, touch nothing
  python load_cards.py               # upsert every card
  python load_cards.py --check       # read back and compare against the files

Credentials come from web/.env.local, the same SUPABASE_URL / SUPABASE_SERVICE_KEY the app uses.
"""
from __future__ import annotations
import argparse, json, os, sys, urllib.request, urllib.error
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
    "batch", "generated_by",
}

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
    for col in COLUMNS:
        row.setdefault(col, DEFAULTS.get(col, ""))
    # expiry_date is a real date column: '' would be 22007, and a card with no expiry must store
    # NULL rather than a placeholder that sorts as a date.
    if not row.get("expiry_date"):
        row["expiry_date"] = None
    if not row.get("publish_year"):
        row["publish_year"] = None
    return row


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
    a = ap.parse_args()
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
