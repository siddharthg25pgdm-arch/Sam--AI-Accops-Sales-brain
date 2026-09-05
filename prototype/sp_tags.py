"""Tag vocabulary for SharePoint files, derived from folder path and filename.

Tags come from what the tenant already writes down - the folder a file sits in and the words in
its name - not from reading the document. That keeps tagging honest before any content is carded:
a tag here means "the library says so", and the LLM can add or correct tags later from the text.

Five facets, each independent, because a rep asks across them: "BFSI case study", "Citrix
battlecard", "HySecure deck". Folder wins over filename where they disagree, since the folder is
a deliberate filing decision and a filename is often a leftover.
"""
from __future__ import annotations
import re

# asset type: folder first (a deliberate filing decision), then filename words
TYPE_FOLDER = [
    ("zCase Studies", "Case Study"), ("Paid Media_Case Studies", "Case Study"),
    ("Presentations", "Deck"), ("Videos", "Video"), ("Whitepapers", "Whitepaper"),
    ("Brochures & Datasheets", "Brochure"), ("eBooks", "eBook"), ("Competition", "Competitive"),
    ("Gartner Reading material", "Analyst Report"), ("3rd Party Reports", "Analyst Report"),
    ("Accops Featured in Reports", "Analyst Report"), ("Company Certifications", "Certification"),
    ("Accops Brand Files", "Brand"), ("Roadshows", "Event"), ("Event", "Event"),
    ("Tech Solution Documents", "Solution Brief"), ("Product Editions", "Product Info"),
]
TYPE_NAME = [
    (r"case stud|casestudy|success story", "Case Study"),
    (r"battlecard|battle card|\bvs\b|comparison|compete", "Competitive"),
    (r"white ?paper", "Whitepaper"), (r"brochure|datasheet|data sheet", "Brochure"),
    (r"\bdeck\b|presentation|\bppt\b", "Deck"), (r"ebook", "eBook"),
    (r"webinar", "Webinar"), (r"roadshow|event|summit|conference|expo", "Event"),
    (r"pricing|price list|quotation", "Pricing"), (r"proposal|\brfp\b|\brfi\b", "Proposal"),
    (r"solution brief|solution overview", "Solution Brief"),
    (r"report|survey|magic quadrant|forrester|gartner", "Analyst Report"),
    (r"certificate|certification|iso\b|soc ?2", "Certification"),
    (r"roadmap", "Roadmap"), (r"faq", "FAQ"), (r"\bdemo\b", "Demo"),
]
INDUSTRY = [
    (r"bfsi|bank|nbfc|financial|insurance|capital|co-?operative", "BFSI"),
    (r"pharma|healthcare|hospital|life science|medical", "Pharma / Healthcare"),
    (r"government|govt|psu|defence|defense|atomic|municipal|police", "Government"),
    (r"manufactur|industry 4|textile|cable|automotive|plant|factory", "Manufacturing"),
    (r"it/ites|ites|bpo|it services|system integrator|\bgcc\b", "IT / ITeS"),
    (r"education|university|college|school|campus|\biit\b", "Education"),
    (r"retail|e-?commerce|d2c|logistics", "E-commerce / Retail"),
    (r"media|entertainment|broadcast|\bdth\b|news", "Media"),
    (r"telecom|telco", "Telecom"),
]
PRODUCT = [
    (r"hysecure", "HySecure"), (r"hyid", "HyID"), (r"hyworks", "HyWorks"),
    (r"hylabs", "HyLabs"), (r"hydesk", "HyDesk"), (r"\bztna\b", "ZTNA"),
    (r"\bmfa\b|multi-?factor|2fa", "MFA"), (r"\bvdi\b|virtual desktop", "VDI"),
    (r"\bdaas\b|desktop as a service", "DaaS"), (r"bioauth|biometric", "BioAuth"),
    (r"nutanix", "Nutanix"), (r"thin ?client", "Thin Client"),
    (r"browser isolation|\brbi\b", "Browser Isolation"),
]
COMPETITOR = [
    (r"citrix", "Citrix"), (r"vmware|horizon", "VMware"), (r"omnissa", "Omnissa"),
    (r"forcepoint", "Forcepoint"), (r"sonicwall", "SonicWall"), (r"fortinet", "Fortinet"),
    (r"\bawtg?\b|amazon workspace|\bwsp\b", "AWS WorkSpaces"),
    (r"azure virtual desktop|\bavd\b", "Azure Virtual Desktop"),
    (r"array networks", "Array Networks"), (r"\bthinprint\b", "ThinPrint"),
]
# z-prefixed folders are this tenant's "sorted to the bottom, do not use" convention
DEAD = re.compile(r"(z*archive|do ?not ?use|donotuse|obsolete|deprecated|backup"
                  r"|(^|[ _/(-])(old|wip|draft|drafts|temp|tmp|raw)([ _/)-]|$))", re.I)


def _match(pairs: list[tuple[str, str]], text: str) -> list[str]:
    out: list[str] = []
    for pattern, tag in pairs:
        if re.search(pattern, text, re.I) and tag not in out:
            out.append(tag)
    return out


def tags_for(folder: str, filename: str, scope: str = "sales") -> dict[str, list[str] | str]:
    """Facets for one file. `folder` is relative to the scope root."""
    hay = f"{folder} {filename}"
    top = folder.split("/")[0] if folder else ""

    asset_type = next((t for prefix, t in TYPE_FOLDER if top.lower().startswith(prefix.lower())), None)
    from_name = _match(TYPE_NAME, filename)
    # Folder decides, except a Presentations folder full of case-study decks should still say so.
    types = [asset_type] if asset_type else []
    for t in from_name:
        if t not in types:
            types.append(t)
    if not types:
        types = ["Other"]

    status = "archived" if DEAD.search(f"/{folder}/{filename}") else "active"
    return {
        "asset_types": types,
        "industries": _match(INDUSTRY, hay),
        "products": _match(PRODUCT, hay),
        "competitors": _match(COMPETITOR, hay),
        "team": "Sales" if scope == "sales" else "Marketing",
        "status": status,
    }


def flat(t: dict[str, list[str] | str]) -> str:
    """One semicolon-joined string for the CSV column, so a sheet stays filterable."""
    parts: list[str] = []
    for key in ("asset_types", "industries", "products", "competitors"):
        parts += [str(x) for x in t[key]]  # type: ignore[index]
    parts.append(str(t["team"]))
    if t["status"] == "archived":
        parts.append("Archived")
    return "; ".join(dict.fromkeys(parts))


def demo() -> None:
    cases = [
        ("zCase Studies (Archive_DONOTUSE)", "Accops - Leading Pvt. Sector Bank - Case Study.pdf"),
        ("Competition", "Accops vs Citrix comparison.pptx"),
        ("Presentations/BFSI", "HySecure ZTNA for Banking Deck.pptx"),
        ("Whitepapers", "Accops Whitepaper - Secure Internet Browsing v7.pdf"),
        ("Brochures & Datasheets", "Accops HyDesk Brochure V6 - Indonesian.pdf"),
    ]
    for folder, name in cases:
        t = tags_for(folder, name)
        print(f"{name[:52]:54s} -> {flat(t)}")

    t = tags_for("zCase Studies (Archive_DONOTUSE)", "Bank Case Study.pdf")
    assert t["status"] == "archived", "DONOTUSE folder must be archived"
    assert "Case Study" in t["asset_types"], "case-study folder must tag as Case Study"
    assert "BFSI" in t["industries"], "bank must map to BFSI"

    t = tags_for("Competition", "Accops vs Citrix comparison.pptx")
    assert "Citrix" in t["competitors"] and "Competitive" in t["asset_types"]

    t = tags_for("Presentations/BFSI", "HySecure ZTNA for Banking Deck.pptx")
    assert "Deck" in t["asset_types"] and "HySecure" in t["products"] and "ZTNA" in t["products"]
    assert t["status"] == "active"
    print("\nall assertions passed")


if __name__ == "__main__":
    demo()
