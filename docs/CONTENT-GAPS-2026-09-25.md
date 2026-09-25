# Content gaps: what reps will ask SAM for that the library cannot give them

**For the marketing team. Written 25 September 2026.**

**How this was produced.** On 25 Sep (06:09-06:40 UTC) we played four kinds of Accops seller against
SAM in production and asked 35 questions the way reps really type: a BFSI account executive replacing
Citrix at a private bank, an SDR doing cold outreach, a presales engineer answering an RFP, and a
regional seller for South-East Asia, the Middle East and Australia. Every time SAM said "we don't have
that", we checked the SharePoint registry (876 files) and SAM's own catalogue (511 answerable assets)
to see whether it was really missing.

**This is a simulation, not real demand.** The questions are our best guess at what reps ask. The
new content-request button in SAM will measure what reps actually ask for; use that to confirm the
ranking below before commissioning anything large.

Some "gaps" reps would hit on 25 Sep were SAM failing to find content we do have. Those are listed
at the end under "Exists but reps can't find it". They are being fixed in SAM itself. Marketing only
needs to act on some of them.

---

## Missing content, ranked by likely sales impact

### 1. A current ISO 27001 certificate (RFP blocker)

- **Asked:** "need ISO 27001 certificate for an RFP"
- **What exists:** one certificate, `Company Certifications/ISO Certificate- Accops Systems.pdf`. It
  covers ISO 27001:**2013**, was first registered 20 Sep 2021 and says it is **valid to 20 September
  2024**. It has expired, and the 2013 edition has itself been withdrawn in favour of ISO 27001:2022.
  SAM currently hands it to reps as "the official certificate needed for RFP compliance".
- **Needed:** the current certificate (ISO 27001:2022, if Accops has been recertified). Please replace
  the file in the same folder so the old one stops being served.
- **Also:** `Company Certifications/SOC-Accops.pdf` (2022) has no description anyone can check. Reps
  will ask "do we have a SOC 2 Type 2 report?". Please confirm what that file is. If Accops has a
  SOC 2 report, add the current one. If it doesn't, say so in the file name or a note, so SAM gives
  a clear no. The HySecure penetration-test certificate is from 2021 (HySecure 5.3).

### 2. Sendable (public) versions of core product documents

Only **18 of 511** assets have a public link a rep can paste into an email. The 2026 public editions
on downloads.accops.com cover HySecure (datasheet V5), DaaS (brochure V4), HyDesk (V6) and Nano (V5),
plus 14 case studies. Reps asking for the following get either nothing sendable or an internal file:

| Rep asks for | What exists today | Missing |
|---|---|---|
| "one pager on HyID I can email" | HyID Datasheet V5 2026, internal only | A public HyID datasheet (the other four products already have one) |
| "hyworks brochure bhejo customer ko" | Digital Workspace Brochure 2025 and DaaS Brochure 2025 (internal); DaaS V4 2026 is public | A public HyWorks / Digital Workspace brochure, 2026 edition |
| "remote browser isolation brochure" | See item 5 | A public Virtual Browser brochure |
| HyLabs for a university | HyLabs deck (MCTE V3, Sep 2026) and HyLabs Jan 2025 deck, internal; the HyLabs brochure is 2023 and sits in "Old" | A current HyLabs brochure |

### 3. Pharma and healthcare customer proof

- **Asked:** "pharma customer proof", "pharma case study I can send a customer", and a paragraph
  about an 800-user hospital chain in Kerala evaluating Citrix and Azure Virtual Desktop.
- **What exists (public):** City Pharmacy (a pharmacy retail chain) and Zulekha Hospital (UAE).
  Wockhardt Pharma, Wockhardt Hospital and Sathya Sai Hospitals are in `zCase Studies
  (Archive_DONOTUSE)`. There are good pharma **whitepapers** (ZTNA for Life Sciences, Authentication
  for Pharma, VDI for Pharma Breakthroughs), but they have no SharePoint link (see item 4).
- **Missing:** a current case study from an **Indian pharma manufacturer** and an **Indian hospital**
  that reps can send. The healthcare and pharma industry decks are dated 2021. The healthcare
  whitepaper (2022) opens with a Ukraine war / Putin health-records hook that reads badly today.

### 4. Content that exists but has no link, so reps see the title and can't open it

**52 assets** are known to SAM from the local asset library (`Downloads\Assets`) but are **not in
SharePoint**, so SAM shows a card with no link. They are some of the best material we have:

- **25 case studies**, including Private Bank MFA-ZTNA (2 pages), Private Bank VDI-ZTNA-MFA, IndiaFirst
  2024, Mirae Asset, South Indian Bank, Shriram Capital (spelt "Shrira" in its title), the four
  Accops-Nutanix V3 studies (Leading Bank, NBFC Vendor Access, Global Data Company, Defence R&D),
  Polycab, Tech Mahindra, Large SI, Govt Web ZTNA, Govt Virtual Browser, Atomic Research Centre,
  IIT Bombay, Education Japan V2, and **UAE Case Study V4 2026**.
- **About 27 "ready for use" whitepapers**, including DPDP Compliance and Access Control, ZTNA for
  Financial Services, Network Isolation for SWIFT and CBS, Biometric Authentication for Financial
  Services, the industry ZTNA and MFA series (ITeS, Industry 4.0, Life Sciences, Pharma), The
  Post-VMware VDI Landscape, and The CIO's Digital Trust V4 2026.

**Action:** upload these to the Sales Collateral SharePoint (and decide which are public). In this
test these files were recommended to reps 7 times and could not be opened.

### 5. Remote Browser Isolation / Virtual Browser brochure

- **Asked:** "remote browser isolation brochure"
- **Missing:** a short, current, customer-facing brochure.
- **Closest substitutes today (all internal):**
  - *Accops Virtual Browser Solution for Internet Access* (Nov 2025 PDF in Brochures & Datasheets;
    SAM's card describes it as an air-gapped / government whitepaper)
  - *Remote Browser Isolation* eBook (2022)
  - *Internet Isolation* 2-pager (2021)
  - *Secure Internet Browsing* whitepaper v7 (written 2019)
  - *Govt Virtual Browser* case study (no link)
  - the June 2026 ZTNA + Isolation customer webinar deck

### 6. Regional content: SEA, Middle East, Australia

| Asked | Status |
|---|---|
| Bahasa Indonesia DaaS brochure | **Not in the library.** Bahasa Indonesia and Bahasa Malaysia versions of the Corporate Deck, DaaS Brochure V4 and Digital Workspace Brochure V2 were made in July 2026 but only exist on Siddharth's laptop. Review them and upload to SharePoint |
| Arabic brochure for a Saudi bank | Nothing in Arabic |
| Malaysia / Indonesia customer reference | No SEA customer case study. The SEA Customer Deck (2026, internal) is the closest |
| Australia: APRA CPS 234, Essential Eight, government | **Nothing at all** about Australian regulation. SAM currently offers the generic HySecure datasheet |
| GITEX / Middle East event deck | No GITEX deck. The Dubai Partner Summit 2026 decks exist in "Confidential" and "Public Version" editions |
| UAE / MEA proof | Zulekha Hospital (public) and UAE Case Study V4 2026 (no link, see item 4) |

### 7. Competitive material: missing or old

| Competitor | Best we have | Age / problem |
|---|---|---|
| **Fortinet** (FortiClient / FortiGate VPN) | Nothing | Missing. Closest: *HySecure vs Cisco AnyConnect and Other VPNs* (2021) |
| **Palo Alto GlobalProtect** | Only a partner deck about adding MFA to Palo Alto (2021) | No competitive piece |
| **Forcepoint** | Only the joint Accops + Forcepoint webinar deck (2026), which is partner material | No competitive piece (if one is needed) |
| **Azure Virtual Desktop** | *Accops vs MS WVD* (written 2019) | Very old; AVD has changed a lot. Asked in the hospital scenario |
| **AWS WorkSpaces** | A 2022 spreadsheet plus the "vs the Field" deck | The deck's file name says 2026-06-11 but its content is from **Nov 2022** |
| **Citrix** | Accops vs Citrix (Jan 2024), vs Citrix-VMware (Apr 2024) | About 2.5 years old; Citrix pricing and packaging have changed since |
| **Zscaler** | HySecure vs ZPA v3.3 (2024) | Undated inside the deck; several rows say "upcoming feature" |
| **Omnissa / VMware** | Omnissa Horizon VVF analysis (Feb 2026), VMware replacement deck (2024) | Good. The VMware battlecard is 2022 |

### 8. Presales and RFP material

- **HySecure architecture / deployment guide for presales.** Missing. The closest is the Turbo
  architecture deck (2022). In testing SAM offered the Zscaler battlecard instead.
- **HyWorks sizing guide** ("500 concurrent users, server specs?"). Missing. There is only a 2021
  WVD sizing sheet and a 2023 BioAuth BOM.
- **Data residency / hosting statement for DaaS** ("is our DaaS hosted in India?"). Missing. The
  2025 DaaS brochure mentions Jio Azure regions, but no document answers the question for an RFP.
- **Pre-filled security questionnaire** (CAIQ / standard vendor security questionnaire). Missing.
  There is only a 2021 DaaS questionnaire.
- **Nutanix AHV integration.** The integration decks are from 2021. The Proxmox brochure (V2, Oct
  2025) is current.

### 9. Other asks with no dedicated asset

- **GCC (global capability centre) ZTNA pitch.** Nothing specific. Closest: the ITeS ZTNA whitepaper
  (no link) and the BPO case study.
- **Customer logo pack.** No logo slide or pack. The Reference Customers July 2025 deck is the
  closest.
- **Current HySecure product demo video.** The HySecure console walkthrough videos are in
  `Videos/Demo Videos/Old`. The revised set covers device posture, geofencing and MFA but has no
  HySecure overview. The customer testimonial videos (Bajaj Allianz, FiveS Digital, Maveric) are
  from 2022.
- **Pricing.** Not in the library by design. *Accops Product Editions 2026* (licence editions) exists
  and could be the approved answer to "what are the editions".
- **RBI guidance for a private-bank CISO.** The RBI-compliant banking deck is from 2021. The only
  RBI-specific document is the RBI's own 2019 framework for **urban co-operative** banks, which is a
  regulator circular, not Accops collateral. A 2026 one-pager mapping Accops to the current RBI
  directions would be used often. (The Banks & Financial Institutes industry deck, Apr 2026, is
  current.)

---

## Exists but reps can't find it (SAM fixes, plus some metadata for marketing)

These came back as "not available" in testing even though the content exists. SAM is being fixed.
The metadata items marked **(marketing)** are yours.

- **City Pharmacy case study** is tagged as *E-commerce / Retail*, so pharma searches skip it.
  **(marketing: tag it Pharma / Healthcare too)**
- **HySecure demo videos** carry no product tag, so a HySecure search excludes them. **(marketing:
  tag videos with their product)**
- **Private Bank MFA-ZTNA case study** (2 pages): exists but has no link (item 4).
- **HyID Datasheet V5 2026:** exists, but SAM hid it because it is internal-only (item 2).
- **Customer Omnissa / VMware migration** material exists. It was hidden once only because the rep
  typed "Broadcom price hike" and SAM treated it as a pricing question.
- **Cards written from guesses.** The SAM cards for Zulekha Hospital and UAE Case Study V4 2026 say
  "likely covers..." rather than describing the document. **(marketing: a one-line summary of each
  would fix this)**

## Stale, superseded or misleading files worth tidying

- `zCase Studies (Archive_DONOTUSE)` holds 38 case studies, including Axis Bank, Bajaj Finserv, LIC,
  HPCL and Thermax. Some newer editions exist elsewhere, some don't. Decide which are retired and
  which should be refreshed.
- `2026-06-11-Accops vs other VDI providers.pptx`: the file name says 2026, but the content is Nov 2022.
- Decks named "Sharable" or "Public Version" (HDFC workshop, MEA Partner CXO, Partner Bootcamp) are
  not marked as sendable anywhere, so SAM treats them as internal.
- The old HySecure Datasheet V3 (2025) still sits next to V5 2026 in `Brochures & Datasheets/New`.
- The HyID "Outdated-...-Internal-Training" architecture deck is still answerable.
- The healthcare whitepaper's introduction (see item 3).
