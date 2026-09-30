"""Prepare tonight's carding work: pull the carding queue, copy each file from the OneDrive-synced
Sales Collateral folder into corpus/sharepoint/, and extract its text into corpus/text/.

The deterministic half of the nightly carding job. The other half - reading each document and
writing its card - needs Claude (the carding boundary: no document body goes to another model), and
is done by the `/sam-nightly-carding` skill, which runs this first and then works from the JSON it
writes. Kept separate so the copy/extract step can be run and checked on its own:

  python prototype/carding_prep.py            # prep up to 15 files, write corpus/queue-tonight.json
  python prototype/carding_prep.py --limit 5
  python prototype/carding_prep.py --dry-run  # show the queue, copy nothing
  python prototype/carding_prep.py --self-check
  python prototype/carding_prep.py --log-run carding ok "carded 3 new, 1 updated, commit abc123"

Every run records itself in sam_ops_runs (docs/supabase-sam-ops.sql) as job "carding_prep"; the skill's
last step records the night's outcome as job "carding" with --log-run, so the System tab and the morning
digest can tell "nothing to card" from "did not run".

Families (docs/supabase-sam-asset-families.sql): an older copy of an already-carded document is
skipped and logged; the newest copy of a family carded from another file is carded first.

Why OneDrive: Microsoft Graph is blocked by a Conditional Access policy, but the OneDrive client
syncs the whole library to this laptop (Siddharth set it to "Always keep on this device").
"""
import datetime, json, os, shutil, subprocess, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).parent.parent
ONEDRIVE = Path(os.environ["USERPROFILE"]) / "OneDrive - Accops Systems Private Limited" / "Company - Sales Collateral"
TEXTABLE = {".pdf", ".docx", ".pptx", ".xlsx"}


def env() -> dict:
    out = {}
    for line in (ROOT / "web" / ".env.local").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"')
    return out


def queue() -> list[dict]:
    e = env()
    url, key = e["SUPABASE_URL"].rstrip("/"), e["SUPABASE_SERVICE_KEY"]
    req = urllib.request.Request(f"{url}/rest/v1/sam_carding_queue?select=item_id,folder,filename,reason,modified_at,family_role,canonical_filename"
                                 f"&order=modified_at.desc.nullslast,item_id&limit=1000",
                                 headers={"apikey": key, "Authorization": f"Bearer {key}"})
    return json.load(urllib.request.urlopen(req, timeout=60))


def log_run(job: str, status: str, summary: str, details: dict | None = None, started_at: str | None = None) -> None:
    """One row in sam_ops_runs. Never raises: the job must not fail because its log did."""
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    try:
        e = env()
        url, key = e["SUPABASE_URL"].rstrip("/"), e["SUPABASE_SERVICE_KEY"]
        body = json.dumps({"job": job, "status": status, "summary": summary[:500], "details": details or {},
                           "started_at": started_at or now, "finished_at": now}).encode("utf-8")
        req = urllib.request.Request(f"{url}/rest/v1/sam_ops_runs", data=body, method="POST",
                                     headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "return=minimal"})
        urllib.request.urlopen(req, timeout=30).close()
    except Exception as ex:  # noqa: BLE001 - logging only
        print(f"(could not record the run in sam_ops_runs: {ex})")


def plan(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    """Queue rows -> (to consider, skipped), using the file's family (docs/supabase-sam-asset-families.sql).

    An OLDER copy of a document that already has a card is skipped and logged: answers never show it,
    so a card would be wasted work. The NEWEST copy of a family carded from another file goes first:
    it becomes what answers show, and until it is carded SAM describes it from the old copy's card.
    Everything else keeps the queue's order (most recently modified first)."""
    skipped = [{**r, "why": f"older version of {r.get('canonical_filename') or 'a carded document'} - already carded, answers use the newer one"}
               for r in rows if r.get("family_role") == "older_version"]
    keep = [r for r in rows if r.get("family_role") != "older_version"]
    return sorted(keep, key=lambda r: r.get("family_role") != "new_version"), skipped


def self_check() -> None:
    """python carding_prep.py --self-check : the family rules, no network."""
    rows = [{"filename": "a.pdf", "family_role": "new"}, {"filename": "old v1.pdf", "family_role": "older_version", "canonical_filename": "v2.pdf"},
            {"filename": "v3.pdf", "family_role": "new_version"}, {"filename": "b.pdf"}]
    todo, skipped = plan(rows)
    assert [r["filename"] for r in todo] == ["v3.pdf", "a.pdf", "b.pdf"], todo
    assert [r["filename"] for r in skipped] == ["old v1.pdf"] and "v2.pdf" in skipped[0]["why"], skipped
    print("carding_prep self-check: ok")


def xlsx_text(p: Path) -> str:
    import re, zipfile
    with zipfile.ZipFile(p) as z:
        strings = re.findall(r"<t[^>]*>([^<]*)</t>", z.read("xl/sharedStrings.xml").decode("utf-8", "ignore")) if "xl/sharedStrings.xml" in z.namelist() else []
    return "\n".join(s for s in strings if s.strip())


def main() -> None:
    if "--self-check" in sys.argv:
        return self_check()
    if "--log-run" in sys.argv:
        job, status, summary = sys.argv[sys.argv.index("--log-run") + 1:][:3]
        assert status in {"ok", "warn", "failed", "refused"}, f"status must be ok|warn|failed|refused, not {status}"
        return log_run(job, status, summary)
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    dry = "--dry-run" in sys.argv
    try:
        prep(dry, started)
    except Exception as ex:
        if not dry:
            log_run("carding_prep", "failed", f"{type(ex).__name__}: {ex}", started_at=started)
        raise


def prep(dry: bool, started: str) -> None:
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else 15
    rows = queue()
    print(f"queue: {len(rows)} ({', '.join(f'{r} {sum(1 for x in rows if x['reason']==r)}' for r in sorted({x['reason'] for x in rows}))})" if rows else "queue: empty")
    ordered, skipped = plan(rows)
    todo = []
    names = [r["filename"].lower() for r in rows]
    for r in ordered:
        if len(todo) >= limit:
            break
        src = ONEDRIVE.joinpath(*[p for p in r["folder"].split("/") if p], r["filename"])
        if Path(r["filename"]).suffix.lower() not in TEXTABLE:
            skipped.append({**r, "why": "not a text document"}); continue
        if not src.exists():
            skipped.append({**r, "why": "not in the OneDrive folder yet (still syncing?)"}); continue
        dest = ROOT / "corpus" / "sharepoint" / r["filename"]
        if names.count(r["filename"].lower()) > 1 and dest.exists():
            skipped.append({**r, "why": "same filename in two folders - card by hand"}); continue
        if not dry:
            shutil.copy2(src, dest)
        todo.append({**r, "local": str(dest.relative_to(ROOT)), "text": f"corpus/text/{Path(r['filename']).stem}.txt"})
    if not dry and todo:
        subprocess.run([sys.executable, str(ROOT / "prototype" / "extract_text.py")], check=False)
        for t in todo:  # extract_text.py skips spreadsheets; do them here
            if t["filename"].lower().endswith(".xlsx"):
                txt = xlsx_text(ROOT / t["local"])
                if txt:
                    (ROOT / t["text"]).write_text(f"# source: sharepoint/{t['filename']}\n\n{txt}", encoding="utf-8")
        for t in todo:
            p = ROOT / t["text"]
            t["has_text"] = p.exists() and p.stat().st_size > 300
    out = {"todo": todo, "skipped": skipped, "queue_total": len(rows)}
    if not dry:
        (ROOT / "corpus" / "queue-tonight.json").write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"to card tonight: {len(todo)} | skipped: {len(skipped)}")
    for t in todo:
        print(f"  {t['reason']:<20} {t['filename']}" + ("  (new version of a carded document: carded first)" if t.get("family_role") == "new_version" else "") + ("" if dry or t.get("has_text") else "  (NO TEXT - card from title/folder, low confidence)"))
    for s in skipped:
        print(f"  skip  {s['filename']}: {s['why']}")
    if not dry:
        no_text = sum(1 for t in todo if not t.get("has_text"))
        log_run("carding_prep", "warn" if no_text else "ok",
                f"queue {len(rows)}: {len(todo)} to card tonight, {len(skipped)} skipped" + (f", {no_text} with no text" if no_text else ""),
                {"queue_total": len(rows), "todo": [t["filename"] for t in todo], "skipped": [{"filename": s["filename"], "why": s["why"]} for s in skipped][:50]},
                started_at=started)


if __name__ == "__main__":
    main()
