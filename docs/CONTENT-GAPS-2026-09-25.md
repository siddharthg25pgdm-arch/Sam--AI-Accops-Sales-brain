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

---

## Update, 26 September: what carding the library found

On 26 September SAM read another 128 documents in full (174 are now carded, up from 46). Reading
the documents themselves turned up things the file names never would. None of this needs SAM to
change. It needs the file owners to act.

### Fix before these documents reach a customer

- **Personal and sensitive data inside documents.** The NanoOS tech doc prints the default
  installer username and password. The HyID biometric proposal template has Accops' bank account
  details and the CEO's mobile number. The UCB industry document lists individual sales staff phone
  numbers. Three HMIL sample reports contain real Accops employees' usernames and working hours.
  Remove or replace with dummy data.
- **Third-party product name in an Accops deck.** HyMobile V2 2026, slide 23, reads "Connect
  Scalefusion OneIdP". Customers will read that as HyMobile being someone else's product.
- **An expired certification claim.** The Europe value proposition says "ISO 27001". The only
  certificate on file expired on 20 September 2024. The same applies to every deck that cites it.
- **An unverified competitor claim.** The Aug 2023 product presentation says "Citrix exited India &
  APAC". Check it before anyone repeats it to a customer.

### Answers to open questions

- **`Company Certifications/SOC-Accops.pdf` is not a SOC 2 report.** It is a January 2022 letter
  from Mirox (a CERT-In empanelled auditor) saying SOC 1 and SOC 2 apply only to services Accops
  runs for customers, such as DaaS, and that PCI-DSS does not apply. So the honest answer to "do we
  have a SOC 2 report?" is no. Rename the file so nobody mistakes it for one, and decide whether
  Accops DaaS needs a SOC 2 Type 2 report.
- **The HySecure penetration-test certificate covers version 5.3.6.0, May 2020** (Indusface). It
  has no expiry date, but it describes a release customers no longer run. A test of the current
  version is needed.

### Licensing

- **The 2024 Gartner Magic Quadrant for DaaS in SharePoint is watermarked for a Gartner employee's
  personal use**, not for an Accops subscriber. Do not send it to anyone. The 2023 MQ and both
  Voice of the Customer reports are licensed to Accops staff.
- The Global CIO Forum's "Book of Titans" and the Economic Times clipping are third-party
  copyright with personal profiles: internal use only.

### The same number, told differently

Reps quoting these to the same customer will contradict each other. Pick one figure for each:

| Claim | Figures found |
|---|---|
| Private bank MFA users | 60,000 and 90,000 |
| Remote browser isolation users | 350,000 and 600,000 |
| TCS users | 150,000 and 350,000 |
| Kyoto University | "2nd largest", "5th largest" and "2nd oldest"; 20,000 / 25,000 / 30,000 / 35,000 students |
| DSCI award year | 2024 and 2025 |
| Gartner MQ mentions | HyMobile and HyLabs 2026 decks say "2023 & 2024" on one slide and "2025 and 2026" on the next |

### Duplicates and old versions that can go

- Identical copies: "Why VDI for WFH" and "VDI for WFH"; About Accops V1 and V2; Product Editions
  Oct 2025 and 2026 (only the copyright year differs); `2026-06-11-Accops vs other VDI providers`
  and the 2022 file it copies (keep the 2022 name, it is honest about the date).
- Superseded: WFH Solutions v8 (by v9), Nutanix AHV integration v1 (by v2), Graphics Workstation v2
  (by v3), Turbo Architecture v1 (by v2).
- Many files carry a `2021-01-01-` prefix from a bulk rename; several are really from 2017-18
  (the Workspace Virtualization comparison, the VMware brochure). The WVD one-pager predates the
  rename to Azure Virtual Desktop, the "Why VDI" deck still has a Cisco HyperFlex slide (the product
  is discontinued), and the O365 note still says Propalms.

### Content that exists but reps could not find

- *The Shield* (Sept 2022) has a full Zulekha Hospital story. It is the source for a proper
  Zulekha card and for any UAE healthcare reference.
- A Dataquest story on a global content-services firm (6,000 users in 7 countries, VPN replaced
  with ZTNA) is the closest thing to a South-East Asia customer reference.
- The Zero Trust Access Gateway deck compares Accops against Fortinet, Palo Alto, Cisco, OpenVPN
  and WireGuard. Dated, but the only material on Fortinet and Palo Alto.
- Four Dataquest magazine stories were published in print and a Nutanix solution brief is
  Nutanix-branded. If they are online, send SAM the links and they become sendable.

### Added after carding 50 more decks (26 September, later)

**Most urgent: the CEO's personal details are on a slide in customer-facing decks.** A "many
digital identities" slide shows his real internal usernames, a bank customer ID and a personal
email address. It appears in the Global Event Deck (45-min, Sep 2025), *both* editions of the Oct
2025 HDFC customer workshop, the June 2026 ZTNA webinar, the Japan "Sharable" bootcamp deck and
both GTRE workshop decks. Replace the values with dummy ones in every copy.

**The "Sharable" edition of the HDFC workshop deck is not safe to send.** Slide 1 still says
"Confidential - Internal Use Only". It keeps product roadmaps with launch dates, device pricing,
the bank's own Zscaler setup (slide 59) and the personal-details slide above. The Confidential
edition adds about 30 named case studies, some marked Draft, and the Vision 2030 revenue target.

**Other things to fix before a customer or partner sees them:**
- The Vision 2030 revenue target is on slide 10 of the Savex **partner** deck.
- The MFA commercial SoW pastes raw web-server logs with client IP addresses and internal
  hostnames.
- The Government Oct 2024 deck and several 2025-26 decks list HyDesk's country of origin as China,
  Thailand, Taiwan or the UK, next to Make-in-India claims.
- **HyMobile is built on Scalefusion.** The 2022 deck says so on slide 21, which explains
  "Connect Scalefusion OneIdP" in the 2026 deck. Its customer stories (HAVI, AgVa, BYJU'S) may be
  Scalefusion's customers, not Accops'. Confirm before reps cite them.
- Several 2026 decks carry time-bound offers (FY27 50% discount, free VDI licences, a 100%
  money-back guarantee) and new product names (GlassFence, Photon, Spectra). Get these signed off
  before reps quote them.
- Most 2026 decks say "2023 & 2024 Gartner MQ" on the About slide next to a 2025/2026 MQ slide.

**More figures told differently:** government IT users 250,000 vs 350,000 vs 500,000; JioPC users
1.6 million vs 18 million; private-bank VDI/ZTNA users 10,000 vs 30,000; DaaS price $21.1 vs
Rs 1,333 per user per month; 2,000-PC TCO saving 13% vs 16%; HyLabs saving 34% vs about 60%; CRM
speed-up 70x vs 100x.

**Mislabelled or duplicated:** the Sri Lanka CIO deck is the Mumbai CIO Association deck, and its
title slide says Ahmedabad. Goa v2 and "Into the Wild" are the same deck. Kotak Securities is
described as a Middle East retailer. The Retail deck mentions "hospital networks". "Corporate Deck
2026" is really a keynote; the actual current corporate deck is "Accops Corporate Deck - 25 Aug
2026". The GovSec files say "April 206".

**Stale but still the only material on its topic:** the RBI-compliant banking deck (2020) is the
only RBI clause mapping. The Healthcare deck (2021) cites DISHA and the PDP Bill, both obsolete.

**Helps close earlier gaps:** the "Single-Slider Case Studies" deck names 9 pharma customers (gap
3). The Nigeria deck is the only Africa material. The GATES Bali deck has the ASEAN channel plan.

### Added after carding the partner, event and Nutanix decks

**The "public" and "sharable" partner decks are not safe to share.** This is the most important
finding of the whole exercise, because partners forward these decks.
- The CEO personal-identifiers slide (see above) is in *every* sharable partner bootcamp edition:
  both Oct 2025 Japan "Sharable" decks, the May 2026 PUBLIC-SHARABLE bootcamp, the June 30
  Public-Shareable bootcamp, the MEA "Public Version" bootcamp, and Forcepoint webinar v03.
- The May 2026 PUBLIC-SHARABLE Partner CXO deck and the MEA "Public Version" still show the Vision
  2030 **USD 500M ARR target**, general-availability dates for unreleased products (IRIS on
  15 Dec 2026), and licensed Gartner market-sizing data.
- The MEA "Public Version" also keeps the partner tier revenue thresholds (USD 15K-500K by country
  group) and the money-back offer. Only the discount table was removed.
- The Japan "Sharable" edition anonymised its case-study headings but still names Flipkart, Kotak,
  TCS and NI in the text, and keeps TCS, Sharda Hospital and Kerzner in the headings.

**Staff mobile numbers in event decks.** Every 2026 Sovereign CIO Conclave city deck ends with 8 to
20 "Meet" slides giving named staff their mobile numbers. The Chennai deck also has the wrong email
on one person's card.

**More data to scrub:** the NIC deck (slide 32) shows a real employee username and a password-style
string. Both "MFA for Legacy Apps" decks paste raw web-server logs with a client IP and a bank's
application paths; the "external" edition also carries part codes and commercials, so it is not
safe to send either.

**Launch dates contradict between editions:** Forcepoint SSE is 15 May in the internal edition and
15 July in the public one; NComputing is 15 May vs 15 June. Decide which is right before partners
announce either.

**More figures told differently:** Customer Workshop Mar 2025 contradicts itself between slides 11
and 137 (VDI 10k vs 30k users, MFA 90k vs 60k, government 500k vs 250k). The free legacy-SSO offer
is 3 months and 6 months within the same Bangalore deck. TCO saving is "up to 40%" in the Nutanix
intro vs 13% or 16% elsewhere. The RDS CAL price is Rs 12,000 and Rs 9,000 in the same deck. The
350k-user customer is both the "world's largest" and the "2nd largest" service provider. Two case
slides in the ETCISO and IBA decks carry "Source: Gartner" on Accops' own customer stories.

**Claims to verify before anyone repeats them:** "Citrix & VMware exited India & APAC" (Nutanix mini
deck, 2024); "80% of Indian insurers / 90% of central government employees use Accops"; Nutanix
Frame "discontinued" and the NetScaler CVE claims (Customer Deck SEA 1.0); the Nayara/Microsoft,
Unit 8200 and Hikvision slides; the March 2026 AWS UAE/Bahrain strike slides.

**Mislabelled and duplicated:** the only deck in the "GCP" folder has no GCP content. A
find-and-replace turned "SSL VPN" into "SSL PaloAlto" in the Palo Alto guide. Japan bootcamp slide
8 still has "X customers, Y partners" placeholders and another slide says DRAFT. Exact duplicates:
the two .NEXT 2024 SUBMITTED copies, the VMware Alternative stack and its 0424 copy, and the two
"Why VDI" Nutanix decks (only the titles differ). The General Presentations archive folder is
spelled "_archieved", which is why SAM treated 48 archived decks as live until 26 September.

**Personal data in a spreadsheet:** "Customers' detals for MFA webinar" (sic) holds customer
details. SAM no longer offers it; consider moving it out of Sales Collateral.

**Help for earlier gaps:**
- *Customer Deck SEA 1.0* has no SEA customer story (gap 6 stands), but it has the most current VDI
  competitive section: 2026 landscape vs Citrix, Omnissa, AVD and AWS (gap 7).
- *DaaS DIY/AMD v2* has the only Accops vs AWS WorkSpaces pricing.
- The *.NEXT 2024* backup slides list Fortinet, Zscaler, F5 and Cisco VPN displacements.
- *Forcepoint webinar v03* has the Palo Alto GlobalProtect CVE handling story.
- The Hyderabad CIO deck (slide 32) maps each product to DPDP principles; with the 2019 Data
  Compliance deck it could seed a DPDP pitch (gaps 4 and 9).
- *.Next 2026 "When VDI Is Not Enough"* is the current answer to the Nutanix integration gap (gap 8).

### Added after carding the last 38 files (all 876 SharePoint files are now accounted for)

**Customer production data is sitting in Sales Collateral. Move it out.**
- `HySecure Logs Mapping & Device ID Details.xlsx` contains a bank's live logs: hostnames, MAC
  and IP addresses, usernames and AD groups.
- `Impossible Travel Events.xlsx` contains about 6,400 rows of real user IDs, public IP addresses
  and locations.
- `Customers' detals for MFA webinar` (sic) contains customer details.
SAM no longer offers any of these three, but anyone with access to the folder can still open them.
- The Cisco joint deck ends with Cisco and Accops staff contact tables, including a mobile-number
  column. The DaaS scoping questionnaire still has one prospect's answers in it; keep a blank master
  instead.

**Another company's slides in an Accops deck.** Both MEA partner bootcamp editions, including the
"Public Version", end with four Haltdos slides (its awards, leadership and products).

**More in the "public" bootcamp decks:** the 16 May PUBLIC-SHARABLE edition has the India partner
tier revenue targets, the discount and rebate structure (with letters in place of percentages)
and the distributor list. Its slide 3 identifies Flipkart ("subsidiary of the world's largest
retailer"). The CIOKlub July 2025 deck (slide 29) also has the CEO identifiers slide. The 2026
Japan bootcamp decks have dropped it.

**Garbled or wrong case slides:** MEA Confidential describes NIC as an HIV/AIDS drug maker and
Kotak Securities as a Middle East retailer. Japanese V4.0 puts the Diligenta case under a "Network
International" heading and gives 3,500 users where the English edition says 5,000. The Japanese
decks are machine-translated in places (the About slide's USD 110B figure is garbled) and need a
native reviewer. Japan English slide 129 still has working notes ("Make videos", "IKEA ???").

**Slides to review for tone:** Savex 20-minute deck slide 5 reproduces a political "7-point call"
(gold buying, cooking oil, fertiliser, foreign travel). The Defence deck slide 50 has geopolitical
remarks.

**Still more figures told differently:** Kyoto University is also "Japan's 3rd largest national
university" and "Japan's second-largest university". The IRIS launch is "2026 Q2" and "15 Dec
2026" in the same Japan deck. Shared desktops are "75% cheaper" in the 2023 webinar and "50%" in
CIOKlub. DaaS is USD 17.99 (MEA), on top of Rs 1,333 and USD 21.1 elsewhere.

**Misleading or empty files:** "Nutanix .Next Tokyo 2026 - English v4" is a single blank slide, so
there is no English Tokyo deck. "VDI Deck 08-19" is August 2026, not 2019. "VDI-Benefits-DRAFT" is
really a 104-slide product catalogue. "Calculatore in sales tools.txt" is empty.

**Good news for earlier gaps:**
- The 2026 Japan bootcamp decks have four new named VDI displacement cases: Graviton (HFT), Airtel
  (Horizon replacement), Dr. Reddy's (SAP on GCP) and Diligenta (Citrix, licence cost up 4x).
- The VDI Deck (Aug 2026) has Indovance, the only GPU DaaS / CAD case.
- Nutanix .Next Tokyo v4 has Japanese municipal cases, naming Haebaru Town.
- The Gartner Japan summit deck is the only sustainability / ESG material.
- The VDI-Benefits-2 draft has a five-lens VDI business-case framework worth finishing.
- A 24]7.ai hybrid-cloud BPO proposal could become a case study.
