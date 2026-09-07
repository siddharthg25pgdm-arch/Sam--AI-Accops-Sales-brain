# Demo corpus: 32 documents to card first

**Written 7 September 2026.** Selected from the 413 ingestable registry rows, not from the whole 874.
The goal is not coverage - it is a demo where every question a manager is likely to ask lands, and
where the answer visibly could not have come from the old 66-document snapshot.

**Download these from SharePoint, hand them to Claude Enterprise, and the cards come back for
Supabase.** SAM never downloads file content itself, so this list is the handover.

---

## How these were chosen

Four rules, in order:

1. **Every eval question must be answerable.** The eval set is the demo script whether or not anyone
   reads it aloud - if question 14 misses on stage, the tool looks broken. So each of the 30 has at
   least one document here that answers it.
2. **Prefer documents that prove the registry join.** 552 decks and 37 competitive assets became
   reachable on 6 September. Cards for those are the difference between "SAM searches our library"
   and "SAM can answer the thing it could not answer last week."
3. **Prefer recent.** 506 of 697 active assets are over two years old. Carding a 2021 deck first
   teaches the demo audience that SAM surfaces stale material.
4. **Prefer PDF over PPTX where both exist.** A 111 MB deck extracts slowly and adds nothing a rep
   needs; the PDF twin carries the same content.

---

## The list

### A. Competitive - 8 documents

The gap named at the very top of `TASK-sharepoint-ingestion.md`: SAM had **zero** battlecards,
decks or competitor analyses. This is the section that closes it, and the one to demo first.

| # | File | Folder | Why |
|---|---|---|---|
| 1 | `Accops vs Citrix-VMware_ Updated April 2024.pptx` | Competition/VDI and DaaS | **The headline.** "Which deck has the Citrix comparison?" - the question the task doc opens with |
| 2 | `Accops vs Citrix.pdf` | Competition/VDI and DaaS | PDF twin, sendable; eval Q4, Q11 |
| 3 | `2026-06-11-Accops vs other VDI providers.pptx` | Competition/VDI and DaaS | Most recent competitive asset in the library |
| 4 | `0424-AccopsDeck-VMWareReplacement.pptx` | Competition/Omnissa | Eval Q12 - the VMware-to-Accops migration story |
| 5 | `Omnissa Horizon VVF Analysis.docx` | Competition/Omnissa | Eval Q13; small file, quick to card |
| 6 | `Accops HySecure vs Zscaler Private Access v 3.3.pptx` | Competition/ZTNA and VPN | ZTNA competitive, which the whitepapers do not cover |
| 7 | `Accops - HySecure vs Other VPNs.pptx` | Presentations/Product Presentations/HySecure | The "why not just a VPN" objection |
| 8 | `Accops_Forcepoint_Webinar_v04.pptx` | Presentations/Event Presentations/Forcepoint | Eval Q14. **81 MB** - card last, or skip if extraction is slow |

### B. Current brochures and datasheets - 9 documents

What a rep sends when a prospect asks "what does it actually do". All 2025-26, all PDF.

| # | File | Why |
|---|---|---|
| 9 | `Accops HyID Datasheet.V5 2026.pdf` | Eval Q17 - "latest" is the real ask, and this is the latest |
| 10 | `Accops HySecure Datasheet.V3.pdf` | Eval Q16 |
| 11 | `Accops DaaS Brochure 2025.pdf` | Eval Q18 |
| 12 | `Accops Digital Workspace Brochure 2025.pdf` | The umbrella pitch |
| 13 | `Accops HyDesk Brochure.V5.pdf` | Thin-client / endpoint story |
| 14 | `Accops Nano Brochure.V4.pdf` | |
| 15 | `Accops + Proxmox Brochure.V2 Oct 2025.pdf` | Eval Q23. Newer product, likely unknown to the audience |
| 16 | `Accops Virtual Browser Solution for Internet Access.pdf` | Eval Q24 |
| 17 | `Accops Huddle Brochure.V3.pdf` | |

### C. Vertical - 4 documents

Proves SAM answers "what do we have for *this* customer", not just "what products exist".

| # | File | Why |
|---|---|---|
| 18 | `Accops Solutions for Govt. V1 '26.pdf` | Eval Q20. Newest government asset |
| 19 | `Accops Defence Brochure Nov 25 V4.pdf` | Eval Q19 |
| 20 | `Accops - BFSI (Integrated) - Case Study V2.pdf` | **Also in the S3 bucket** - so it gets a real public link |
| 21 | `Accops - Leading Pvt. Sector Bank - Case Study 2026.pdf` | **Also in S3.** Resolves one of the 11 ambiguous matches |

### D. Proof and credibility - 4 documents

What a rep reaches for when a prospect asks "who else uses you" or procurement sends a questionnaire.

| # | File | Why |
|---|---|---|
| 22 | `Accops recognized by Gartner_ Oct 2024.pdf` | Eval Q21 |
| 23 | `MQ for DaaS 2025.pdf` | Gartner MQ, the strongest third-party proof available |
| 24 | `ISO Certificate- Accops Systems.pdf` | Eval Q22 - procurement questionnaires |
| 25 | `Accops - DTH - Case Study.pdf` | **Also in S3.** Media vertical, currently a logged gap |

### E. Technical and solution briefs - 4 documents

Short, recent, and the type most likely to answer a specific technical objection.

| # | File | Why |
|---|---|---|
| 26 | `Accops_ZTNA_Vajra_BPM_SolutionBrief.pdf` | Newest solution brief |
| 27 | `Accops_Spectra_HySecure_BYOD_Solution_Brief.pdf` | BYOD, a common banking objection |
| 28 | `Accops AirBridge Technical Datasheet.pdf` | |
| 29 | `Accops Whitepaper - Secure Internet Browsing v7.pdf` | Pairs with #16 |

### F. Whitepapers already in the 77 - 3 documents

These already have hand-written cards. **Re-card them from the real document** and compare: the
comparison is the quality gate build-order step 2 demands, and it costs three files.

| # | File | Why |
|---|---|---|
| 30 | `India's Network Security Whitepaper v3.docx` | Newest whitepaper |
| 31 | *ZTNA for Pharma and Healthcare* (existing card) | Eval Q3, Q9, Q10 all hit it - verify the card is faithful |
| 32 | *Beyond MFA* (existing card) | The MFA story |

---

## What this deliberately leaves out

- **The 111 MB Forcepoint v03 duplicate.** v04 is here; v03 differs only in size.
- **Anything over two years old**, unless it is the only asset for a competitor (#1, #4, #7).
- **Event and roadshow decks.** 61 of them, all one-off, none of which a rep sends to a customer.
- **Brand files, logos, wallpapers.** Tracked in the registry, never an answer.
- **Marketing 2.0 entirely.** Still excluded until specific folders are named.

---

## The S3 bucket changes one thing

`downloads.accops.com` is publicly readable per-object even though listing is blocked:
**10 of 10 filenames tested returned 200**. The URL is simply
`https://downloads.accops.com/` + the URL-encoded filename - no "copy link" button needed, and no
bulk export.

That makes the earlier public-link decision better than it was. It was "page first, PDF if
available", and PDFs turn out to be available: a direct PDF is what a rep actually wants to forward,
where an accops.com page is a landing page the customer then has to navigate.

**To use it, the 43 filenames are needed.** Only 14 are visible in the screenshot. Either paste the
rest, or run one command in a terminal with AWS credentials:

```
aws s3 ls s3://downloads.accops.com/ --recursive | awk '{$1="";$2="";$3="";print substr($0,4)}'
```

`prototype/sp_match_public.py` then matches them the same way it matched the website pages, and
`public_url` starts carrying direct PDFs.
