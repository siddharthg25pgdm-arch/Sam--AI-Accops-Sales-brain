"""The custom Python RAG tool. Mirrors the codelab's get_menu(), but searches instead of dumping.

Why not return the whole JSON like the codelab does? 8 coffee items fit in a prompt; 71 asset
cards with text excerpts are ~150 KB and would cost money on every turn and drown the model.
So the tool takes filters + a query and returns the top matches with a one-line reason each.
"""
from __future__ import annotations
import json, re
from pathlib import Path
from rapidfuzz import fuzz

DATA = Path(__file__).parent / "data" / "asset_cards.json"
_CACHE: dict | None = None

def load_cards() -> list[dict]:
    global _CACHE
    if _CACHE is None:
        _CACHE = json.loads(DATA.read_text(encoding="utf-8"))
    return _CACHE["assets"]

# Vocabulary the router can rely on. Keep in sync with the inventory's own words.
ASSET_TYPES = ["Case Study", "Whitepaper", "Compiled Case Study Collection", "Data File"]
PRODUCTS = ["HySecure", "HyID", "HyWorks", "HyLabs", "HyDesk", "ZTNA", "MFA", "VDI", "DaaS", "BioAuth", "Browser Isolation", "Nutanix"]
VERTICAL_SYNONYMS = {
    "bfsi": ["bfsi", "bank", "banking", "nbfc", "insurance", "financial", "capital", "asset management", "co-operative"],
    "it": ["it/ites", "ites", "it services", "bpo", "si", "system integrator", "software"],
    "manufacturing": ["manufacturing", "industry 4.0", "textile", "cable", "food processing", "plant"],
    "ecommerce": ["e-commerce", "ecommerce", "retail", "logistics", "d2c"],
    "government": ["government", "govt", "defence", "defense", "research", "psu", "egovernance", "atomic"],
    "pharma": ["pharma", "healthcare", "hospital", "pharmacy", "life sciences", "health"],
    "media": ["media", "entertainment", "dth", "broadcast", "news"],
    "education": ["education", "university", "iit", "school", "campus", "student"],
}

def _blob(c: dict) -> str:
    f = c.get("file") or {}
    return " ".join([
        c.get("title", ""), c.get("asset_type", ""), c.get("industry", ""), c.get("client", ""),
        " ".join(c.get("products", [])), c.get("key_problem", ""), " ".join(c.get("key_outcomes", [])),
        c.get("brief", ""), c.get("use_for", ""), c.get("section", ""), f.get("path", ""), f.get("text_excerpt", ""),
    ]).lower()

def _vertical_hit(c: dict, vertical: str) -> bool:
    words = VERTICAL_SYNONYMS.get(vertical.lower(), [vertical.lower()])
    hay = f"{c.get('industry','')} {c.get('section','')} {(c.get('file') or {}).get('path','')}".lower()
    return any(w in hay for w in words)

def search_assets(query: str, asset_type: str = "", vertical: str = "", product: str = "",
                  audience: str = "internal", limit: int = 5) -> str:
    """Search Accops sales and marketing collateral (case studies, whitepapers) and return the best matches.

    Args:
        query: What the salesperson is looking for, in plain words. Include competitor names, use cases, regulators.
        asset_type: Optional filter: "Case Study" or "Whitepaper". Leave empty to search all types.
        vertical: Optional industry filter: bfsi, it, manufacturing, ecommerce, government, pharma, media, education.
        product: Optional product filter, e.g. HySecure, HyID, HyWorks, ZTNA, MFA, VDI, Nutanix.
        audience: "internal" (default) or "external". External returns only assets with a public URL.
        limit: Maximum number of results, default 5.
    Returns:
        JSON string with "results" (ranked asset cards incl. file path, visibility, why_match) and "total_considered".
    """
    cards = load_cards()
    q = (query or "").lower().strip()
    q_tokens = [t for t in re.findall(r"[a-z0-9][a-z0-9.+-]*", q) if len(t) > 2]
    scored = []
    for c in cards:
        if asset_type and asset_type.lower() not in c.get("asset_type", "").lower():
            continue
        if vertical and not _vertical_hit(c, vertical):
            continue
        if product and not any(product.lower() in p.lower() for p in c.get("products", [])) \
                and product.lower() not in _blob(c):
            continue
        if audience == "external" and not c.get("public_url"):
            continue
        blob = _blob(c)
        # score = token overlap (strong) + fuzzy partial ratio (soft) + freshness nudge
        overlap = sum(1 for t in q_tokens if t in blob)
        fuzzy = fuzz.partial_token_set_ratio(q, blob[:4000]) / 100 if q else 0
        fresh = 0.3 if re.search(r"202[5-6]", (c.get("file") or {}).get("path", "")) else 0
        score = overlap * 2 + fuzzy + fresh
        if q and overlap == 0 and fuzzy < 0.6:
            continue
        hits = [t for t in q_tokens if t in blob][:6]
        scored.append((score, c, hits))
    scored.sort(key=lambda x: -x[0])
    results = []
    for score, c, hits in scored[:limit]:
        f = c.get("file") or {}
        results.append({
            "title": c["title"], "asset_type": c["asset_type"], "industry": c["industry"], "client": c["client"],
            "products": c["products"], "use_for": c["use_for"], "brief": (c.get("brief") or c.get("key_problem") or "")[:300],
            "key_outcomes": c.get("key_outcomes", [])[:4],
            "file_path": f.get("path"), "pages": f.get("pages"), "ext": f.get("ext"),
            "visibility": c.get("visibility"), "public_url": c.get("public_url"), "sharepoint_url": c.get("sharepoint_url"),
            "why_match": ("matched on " + ", ".join(hits)) if hits else "matched on filters",
            "score": round(score, 2),
        })
    return json.dumps({"results": results, "total_considered": len(cards), "filters": {
        "asset_type": asset_type, "vertical": vertical, "product": product, "audience": audience}}, ensure_ascii=False)

def list_catalog_summary() -> str:
    """Return counts of collateral by asset type and industry, so the agent knows what exists before searching.

    Returns:
        JSON string with "by_type" and "by_industry" counts and the total number of assets.
    """
    cards = load_cards()
    by_type: dict[str, int] = {}
    by_ind: dict[str, int] = {}
    for c in cards:
        by_type[c.get("asset_type") or "Unknown"] = by_type.get(c.get("asset_type") or "Unknown", 0) + 1
        by_ind[c.get("industry") or c.get("section") or "Unknown"] = by_ind.get(c.get("industry") or c.get("section") or "Unknown", 0) + 1
    return json.dumps({"total": len(cards), "by_type": by_type, "by_industry": by_ind}, ensure_ascii=False)

if __name__ == "__main__":
    print(search_assets("citrix replacement bank", vertical="bfsi", limit=3))
