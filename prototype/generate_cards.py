"""Generate asset cards with Claude for files the hand inventory does not describe, and check Claude's cards
against the hand-written ones on the files that have both. This is the ingestion path SharePoint will use.

  python generate_cards.py --dry-run      # count files, estimate tokens and cost, no API calls
  python generate_cards.py --check 10     # generate cards for 10 inventoried files and compare with the inventory
  python generate_cards.py                # generate cards for every uninventoried / thin file, write data/asset_cards.generated.json

Needs ANTHROPIC_API_KEY (reads prototype/.env). Model via CLAUDE_MODEL, default claude-sonnet-5.
"""
from __future__ import annotations
import argparse, json, os, re, sys, time
from pathlib import Path
from dotenv import load_dotenv
from pypdf import PdfReader

load_dotenv(Path(__file__).parent / ".env")
HERE = Path(__file__).parent
CARDS = HERE / "data" / "asset_cards.json"
OUT = HERE / "data" / "asset_cards.generated.json"
ASSETS = Path.home() / "Downloads" / "Assets"
MAX_CHARS = 24_000        # ~6k tokens of document text per call; enough for a whitepaper's argument
MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-5")

SCHEMA_HINT = """Return ONLY a JSON object with exactly these keys:
{
 "title": string,                                  // clean human title, no underscores or file suffixes
 "asset_type": "Case Study" | "Whitepaper" | "Brochure" | "Datasheet" | "Deck" | "Battlecard" | "Other",
 "industry": string,                               // e.g. "Banking (Private Sector)", "Pharma", "Government"
 "client": string,                                 // descriptor, e.g. "a large private-sector bank"; use the name only if the document names it
 "client_named": boolean,                          // true if the customer is named in the document
 "products": string[],                             // from: HySecure, HyID, HyWorks, HyLabs, HyDesk, Browser Isolation, BioAuth, Nutanix, Thin Clients, ZTNA, MFA, VDI, DaaS
 "competitors": string[],                          // vendors named or clearly implied (Citrix, VMware, Fortinet, ...), else []
 "personas": string[],                             // who this is written for: CIO, CISO, IT head, procurement, ...
 "regulations": string[],                          // RBI, SEBI, IRDAI, RMiT, GDPR, HIPAA, ... named in the text, else []
 "key_problem": string,                            // <= 40 words
 "key_outcomes": string[],                         // up to 5, each <= 15 words, keep the numbers
 "brief": string,                                  // <= 80 words, what the document says
 "use_for": string,                                // <= 30 words, when a salesperson should send this
 "publish_year": string | null,                    // from the document if stated
 "confidence": number                              // 0-1, how sure you are the card is faithful
}"""

SYSTEM = ("You catalogue sales and marketing collateral for Accops, an Indian cybersecurity and digital workspace company. "
          "Read the document text and fill the card faithfully. Never invent numbers, clients or outcomes that are not in the text. "
          "If the text is thin, say so in brief and lower confidence.")

def load_cards() -> dict:
    return json.loads(CARDS.read_text(encoding="utf-8"))

def doc_text(rel_path: str) -> str:
    p = ASSETS / rel_path
    if p.suffix.lower() == ".docx":
        try:
            import docx  # python-docx, optional
            return "\n".join(par.text for par in docx.Document(str(p)).paragraphs)[:MAX_CHARS]
        except Exception:
            return ""
    try:
        r = PdfReader(str(p)); out = []
        for pg in r.pages:
            out.append(pg.extract_text() or "")
            if sum(len(x) for x in out) > MAX_CHARS: break
        return re.sub(r"[ \t]+", " ", "\n".join(out))[:MAX_CHARS]
    except Exception as e:
        return f"[extract failed: {e}]"

def targets(cards: list[dict], mode: str, n: int) -> list[dict]:
    if mode == "check":
        pool = [c for c in cards if c.get("inventory_id") and c.get("file") and c["file"].get("ext") == "pdf" and c.get("brief")]
        return pool[:n]
    thin = [c for c in cards if c.get("file") and (not c.get("inventory_id") or not (c.get("brief") or c.get("key_problem")))]
    return thin

def call_claude(client, text: str, filename: str) -> dict:
    msg = client.messages.create(
        model=MODEL, max_tokens=1500, system=SYSTEM,
        messages=[{"role": "user", "content": f"File name: {filename}\n\n{SCHEMA_HINT}\n\nDocument text:\n<document>\n{text}\n</document>"}],
        output_config={"effort": "low"},
    )
    raw = "".join(b.text for b in msg.content if b.type == "text")
    m = re.search(r"\{.*\}", raw, flags=re.S)
    card = json.loads(m.group(0)) if m else {"error": "no json", "raw": raw[:300]}
    card["_usage"] = {"in": msg.usage.input_tokens, "out": msg.usage.output_tokens}
    return card

def compare(gen: dict, inv: dict) -> dict:
    same_type = gen.get("asset_type", "").lower().split()[0] == inv.get("asset_type", "").lower().split()[0] if inv.get("asset_type") else None
    inv_products = {p.lower().split()[0] for p in inv.get("products", [])}
    gen_products = {p.lower().split()[0] for p in gen.get("products", [])}
    overlap = len(inv_products & gen_products) / len(inv_products) if inv_products else None
    ind = inv.get("industry", "").lower().split(" ")[0]
    same_industry = bool(ind) and ind in gen.get("industry", "").lower()
    return {"type_match": same_type, "industry_match": same_industry, "product_recall": overlap}

def main() -> None:
    ap = argparse.ArgumentParser(); ap.add_argument("--dry-run", action="store_true"); ap.add_argument("--check", type=int, default=0)
    a = ap.parse_args()
    data = load_cards(); cards = data["assets"]
    mode = "check" if a.check else "generate"
    todo = targets(cards, mode, a.check)
    texts = {c["file"]["path"]: doc_text(c["file"]["path"]) for c in todo}
    chars = sum(len(t) for t in texts.values()); est_in = chars // 4 + 900 * len(todo); est_out = 400 * len(todo)
    price_in, price_out = (2, 10) if "sonnet" in MODEL else (1, 5) if "haiku" in MODEL else (5, 25)
    cost = est_in / 1e6 * price_in + est_out / 1e6 * price_out
    print(f"{mode}: {len(todo)} files, ~{est_in:,} input + ~{est_out:,} output tokens on {MODEL}, ~${cost:.2f}")
    for c in todo: print(f"  - {c['file']['path']}  ({len(texts[c['file']['path']]):,} chars)")
    if a.dry_run: return
    if not os.getenv("ANTHROPIC_API_KEY"): sys.exit("ANTHROPIC_API_KEY not set (prototype/.env). Use --dry-run to see the plan.")
    import anthropic
    client = anthropic.Anthropic()
    results, t0 = [], time.time()
    for c in todo:
        path = c["file"]["path"]; text = texts[path]
        if len(text) < 200: results.append({"file_path": path, "skipped": "too little extractable text (scanned PDF?)"}); print("skip", path); continue
        card = call_claude(client, text, Path(path).name)
        row = {"file_path": path, "generated": card}
        if mode == "check": row["inventory"] = {k: c.get(k) for k in ("title", "asset_type", "industry", "client", "products", "use_for")}; row["compare"] = compare(card, c)
        results.append(row); print("ok  ", path, "| conf", card.get("confidence"), "|", card.get("_usage"))
    out = {"model": MODEL, "mode": mode, "generated_at": time.strftime("%Y-%m-%d %H:%M"), "seconds": round(time.time() - t0), "results": results}
    dest = OUT if mode == "generate" else HERE / "data" / "asset_cards.check.json"
    dest.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8"); print("wrote", dest)
    if mode == "check":
        cmp = [r["compare"] for r in results if "compare" in r]
        if cmp:
            tm = sum(1 for x in cmp if x["type_match"]) / len(cmp); im = sum(1 for x in cmp if x["industry_match"]) / len(cmp)
            pr = [x["product_recall"] for x in cmp if x["product_recall"] is not None]
            print(f"type match {tm:.0%} · industry match {im:.0%} · product recall {sum(pr)/len(pr):.0%}" if pr else f"type match {tm:.0%} · industry match {im:.0%}")

if __name__ == "__main__":
    main()
