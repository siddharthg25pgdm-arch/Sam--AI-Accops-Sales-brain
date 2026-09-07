"""Download the demo-corpus documents from SharePoint into corpus/sharepoint/.

Build-time only. Siddharth authorised this on 7 September 2026 for the MVP; the runtime rule is
unchanged - SAM never serves a private file body to a user, and nothing under web/ reads this
folder. See corpus/README.md.

Runs on the delegated Azure CLI login, so no app registration. Resolves each file by
(folder, filename) against the registry, which is unique across all 874 rows, then pulls the bytes
through Graph.

  python sp_fetch.py             # list what it would download
  python sp_fetch.py --write     # download
"""
from __future__ import annotations
import json, subprocess, sys, urllib.error, urllib.parse, urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from sp_seed_registry import env, from_pat, EXPECT_REF

HERE = Path(__file__).parent
OUT = HERE.parent / "corpus" / "sharepoint"
DRIVE = json.loads((HERE / "data" / "sharepoint_inventory.json").read_text(encoding="utf-8"))["sales"]["drive_id"]

# The demo corpus, from docs/demo-corpus.md. Filenames only - the registry resolves the folder,
# so this list stays readable and does not rot when something moves.
WANTED = [
    # A. Competitive
    "Accops vs Citrix-VMware_ Updated April 2024.pptx",
    "Accops vs Citrix.pdf",
    "2026-06-11-Accops vs other VDI providers.pptx",
    "0424-AccopsDeck-VMWareReplacement.pptx",
    "Omnissa Horizon VVF Analysis.docx",
    "Accops HySecure vs Zscaler Private Access v 3.3.pptx",
    "Accops - HySecure vs Other VPNs.pptx",
    "Accops_Forcepoint_Webinar_v04.pptx",
    # B. Brochures and datasheets
    "Accops HyID Datasheet.V5 2026.pdf",
    "Accops HySecure Datasheet.V3.pdf",
    "Accops DaaS Brochure 2025.pdf",
    "Accops Digital Workspace Brochure 2025.pdf",
    "Accops HyDesk Brochure.V5.pdf",
    "Accops Nano Brochure.V4.pdf",
    "Accops + Proxmox Brochure.V2 Oct 2025.pdf",
    "Accops Virtual Browser Solution for Internet Access.pdf",
    "Accops Huddle Brochure.V3.pdf",
    # C. Vertical
    "Accops Solutions for Govt. V1 '26.pdf",
    "Accops Defence Brochure Nov 25 V4.pdf",
    # D. Proof
    "Accops recognized by Gartner_ Oct 2024.pdf",
    "MQ for DaaS 2025.pdf",
    "ISO Certificate- Accops Systems.pdf",
    # E. Technical
    "Accops_ZTNA_Vajra_BPM_SolutionBrief.pdf",
    "Accops_Spectra_HySecure_BYOD_Solution_Brief.pdf",
    "Accops AirBridge Technical Datasheet.pdf",
    "Accops Whitepaper - Secure Internet Browsing v7.pdf",
    # F. Whitepaper
    "India's Network Security Whitepaper v3.docx",
]

# Anything past this downloads slowly and adds nothing a card needs; the text is what matters.
MAX_MB = 60


def graph_token() -> str:
    out = subprocess.run("az account get-access-token --resource https://graph.microsoft.com "
                         "--query accessToken -o tsv", shell=True, capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"az failed: {out.stderr[:200]}")
    return out.stdout.strip()


def main() -> None:
    write = "--write" in sys.argv
    url, key = env("SUPABASE_URL").rstrip("/"), env("SUPABASE_SERVICE_KEY")
    if not key:
        url2, key = from_pat()
        url = url or url2
    if EXPECT_REF not in (url or ""):
        sys.exit(f"expected project {EXPECT_REF}")

    rows = json.loads(urllib.request.urlopen(urllib.request.Request(
        f"{url}/rest/v1/sam_sharepoint_files?scope=eq.sales&deleted=is.false"
        f"&select=item_id,filename,folder,size_bytes&limit=5000",
        headers={"apikey": key, "Authorization": f"Bearer {key}"}), timeout=60).read())
    by_name: dict[str, list[dict]] = {}
    for r in rows:
        by_name.setdefault(r["filename"], []).append(r)

    tok = graph_token() if write else ""
    OUT.mkdir(parents=True, exist_ok=True)
    got = missing = skipped = big = 0

    for name in WANTED:
        hits = by_name.get(name, [])
        if not hits:
            print(f"  MISSING  {name[:56]}")
            missing += 1
            continue
        # Prefer the smallest copy when a file is filed in two folders: same content, less to pull.
        r = min(hits, key=lambda x: x.get("size_bytes") or 0)
        mb = (r.get("size_bytes") or 0) / 1048576
        dest = OUT / name
        if dest.exists():
            skipped += 1
            continue
        if mb > MAX_MB:
            print(f"  TOO BIG  {mb:>6.0f} MB  {name[:48]}")
            big += 1
            continue
        if not write:
            print(f"  would get {mb:>6.1f} MB  {name[:48]}")
            continue
        try:
            data = urllib.request.urlopen(urllib.request.Request(
                f"https://graph.microsoft.com/v1.0/drives/{DRIVE}/items/{r['item_id']}/content",
                headers={"Authorization": f"Bearer {tok}"}), timeout=300).read()
            dest.write_bytes(data)
            print(f"  {len(data)/1048576:>6.1f} MB  {name[:52]}")
            got += 1
        except urllib.error.HTTPError as e:
            print(f"  HTTP {e.code}  {name[:52]}")
            missing += 1

    print(f"\nwanted {len(WANTED)} | downloaded {got} | already had {skipped} | "
          f"too big {big} | not found {missing}")
    if not write:
        print("dry run - pass --write")


if __name__ == "__main__":
    main()
