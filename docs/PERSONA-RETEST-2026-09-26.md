# SAM salesperson re-test, 26 September 2026

**For Siddharth.** The same 35 questions as the 25 Sep test, sent again to production
(https://sam-accops.vercel.app) and graded the same strict way.

- **Tested:** 26 Sep 2026, 17:56:00 to 18:12:24 UTC. 35 `/ask` calls, 27 s apart, all with
  `x-sam-test: 1`. Follow-ups were sent with the earlier turns as `history`: "anything newer?" and
  "shorter one?" after the BFSI question, and "what about hospitals?" after the pharma question. Every
  call answered on `openai/gpt-oss-120b`, with no fallbacks. SAM event ids 1133 to 1227.
- **Checked:** every "we don't have it" and every claim about what a document contains, against free
  `/search` calls (up to about 18:20 UTC), the `sam_asset_cards` table (read-only) and the extracted
  text in `corpus/text/`.

## Headline

| | 25 Sep | 26 Sep |
|---|---|---|
| **Happy** (a real rep gets what they need) | **11** | **11** |
| Acceptable gap (honest, nothing exists, request button offered) | 4 | **7** |
| Unsatisfying | 20 | **17** |
| False or hidden gaps (the content existed) | about 9 | **5** |

**The number of happy answers did not move: 11 then, 11 now.** Seven questions got better and five
got worse, so the net gain is all in honesty. Three failures became honest gaps with a request
button, and false gaps fell from about 9 to 5.

On a lenient reading the score is 14. That counts three answers as happy: BFSI (right cards, but an
invented "moved off Citrix" line), the HySecure datasheet (right card, but an invented spec claim),
and the ISO certificate (you removed its expiry warning on 8 Sep). The strict 11 is the fair
comparison with yesterday.

**What held the score down was new failures, not old ones staying broken.** The model now says what
a document covers using the rep's own words ("shows a Citrix-to-HySecure migration") when the
document says nothing of the kind. Two good results also dropped out of the top three when the
library grew from 46 to 311 cards, because the ranking counts filler words.

A note on the "25 Sep" column. Yesterday's totals (11 / 4 / 20) are the published ones, but the
per-question verdicts were never saved. The 25 Sep column below is my re-grading of the stored
25 Sep answers (`sam_events` 933-1035), fitted to those totals. Treat any single row in it as
approximate.

## Every question

H = happy, A = acceptable gap, U = unsatisfying. The persona tag shows who asks it: AE = BFSI account
executive, SDR = cold outreach, SE = presales / RFP, REG = SEA / Middle East / Australia seller.

| # | Question | 25 Sep | 26 Sep | Why (today) |
|---|---|---|---|---|
| 1 | AE: pvt bank moving off citrix, bfsi case study i can send | H | **U** | Right two public 2026 case studies on top, but the answer says they show banks that "replaced legacy access (including Citrix)" and "a Citrix migration path". Neither card mentions Citrix. |
| 2 | AE: anything newer? (follow-up) | U | U | The follow-up now keeps the topic (fixed). It re-lists the same two, which are already the newest, but calls them a "Citrix-to-HySecure/ZTNA migration" and a "Citrix-replacement rollout". Both claims are invented. |
| 3 | AE: shorter one? 1-2 pages (2nd follow-up) | U | U | Lost the topic: it searched "anything newer? shorter one?..." without the bank question. It returned the About Accops one-pager and claimed it covers "HySecure/ZTNA migration from Citrix". The 2-page *Private Bank MFA-ZTNA* case study exists. |
| 4 | AE: citrix battlecard for my own prep | H | **U** | The two 2024 Citrix battlecards (the best ones) are gone from the answer. It gives the 2022 "vs the Field" deck and a 2018 table whose note says "a newer 2024 edition exists, prefer that", then doesn't show that edition. |
| 5 | AE: RBI framework, what can i send the CISO | U | U | Better documents (UCB RBI clause mapping 2020, BFSI deck 2026, the RBI circular). But the first line says "**Send** the RBI-focused solution document (internal)", and the sending guard didn't catch it. The UCB document is for co-operative banks, not a private bank. |
| 6 | AE: pricing for 2000 users hyworks vs citrix quote | U | U | The pricing guard let through a **May 2021 Azure DaaS pricing calculator**: "can be adapted for a 2,000-user quote". It never says that pricing comes from the sales manager. |
| 7 | SDR: one pager on HyID i can email | U | **A** | "No exact public one-pager". It offers the HyID Datasheet V5 2026 with "Internal only: do not send outside Accops", and the request button. Right. |
| 8 | SDR: pharma customer proof | U | **H** | City Pharmacy (public), the UAE multi-hospital story, and the single-slide library's pharma section. |
| 9 | SDR: manufacturing plant VDI case study | H | H | Textile manufacturer (public) and Polycab. |
| 10 | SDR: ZTNA pitch for a GCC | U | U | Read GCC as government / Gulf and offered Indian NIC and government decks ("marked outdated") as a GCC pitch. For a global capability centre the closest are the Dataquest "6,000 users in 7 countries" story and the ITeS material. |
| 11 | SDR: customer logo pack | H | H | Reference Customers catalogue (Jul 2025) on top, with an honest note that logos may include former customers. |
| 12 | SDR: product video hysecure | U | U | Offers "Accops Intro Video: short overview of HySecure features" and the TrueSSO demo as "detailed walkthrough of HySecure". Videos are not carded (empty brief), so both descriptions are guesses. The HySecure feature demos (device posture, geofencing) are not shown. |
| 13 | SE: ISO 27001 certificate for an RFP | U | U | Unchanged: the 2013-edition certificate, "the official ISO 27001 certification document needed for RFP compliance", with no warning. The expiry warning was removed on your instruction on 8 Sep (commit 21b71f8). The document says valid to 20 Sep 2024. Graded U against yesterday's rubric; H if that decision stands. |
| 14 | SE: SOC 2 type 2 report | A | A | Now better: "No exact SOC 2 Type 2 report". The Mirox letter is correctly described as "not the actual SOC 2 audit report". |
| 15 | SE: remote browser isolation brochure | U | U | Honest "no public brochure", but the substitutes are the Defence brochure and the *superseded* HySecure V3 datasheet. The Virtual Browser whitepaper (2025), the RBI eBook and the Internet Isolation one-pager exist and aren't offered. |
| 16 | SE: vmware horizon, broadcom price hike, omnissa pitch | U | **H** | Pricing false-trigger fixed. It gives the Migration Strategy deck and the Broadcom battlecard, with its "newer edition: Omnissa VVF Analysis" note. That newer analysis isn't shown. |
| 17 | REG: bahasa indonesia daas brochure | A | A | Honest; offers the public English DaaS V4 2026 as a stand-in. |
| 18 | SE: omnissa migration deck | H | H | Migration Strategy from VMware EUC on top. |
| 19 | SE: data residency, DaaS hosted in india, doc for RFP | U | **A** | Honest "no document on Indian data residency", and the request button. Yesterday it falsely claimed the brochure covered it. It offers the 2025 brochure instead of its public 2026 successor. |
| 20 | SE: hysecure architecture / deployment guide | U | **H** | *HySecure for ZTNA: Key Features, Reference Architectures and Deployment Models (2025)*. Newly carded. |
| 21 | SE: hyworks on nutanix AHV and proxmox, integration doc | H | **U** | **False gap:** "No exact Proxmox integration document is available". The Proxmox brochure V2 (Oct 2025) and the Proxmox V2.0 deck exist. The Nutanix guides are 2018/2020 (age noted). |
| 22 | SE: hyworks sizing for 500 users | U | U | Offers the Graphics Workstation deck (2020), BioAuth sizing and a 2018 Dynamics CRM deck as "useful for HyWorks capacity planning". It never says there is no HyWorks sizing guide, and gives no request button. |
| 23 | SE: hysecure datasheet specs, max concurrent users per appliance | H | **U** | Right datasheet, but it claims it "includes ... maximum concurrent users per appliance". The V5 2026 text has no such figure. Yesterday's answer made the same claim; it wasn't checked then. |
| 24 | REG: arabic brochure for a saudi bank | A | A | Honest. Substitutes are the two Indian private-bank case studies (English, public). |
| 25 | REG: malaysia / indonesia customer reference | A | A | Honest gap and request button. No substitutes shown: the floor rejected the model's picks. The Dataquest multi-country story would have helped. |
| 26 | REG: APRA CPS 234 / Australian gov angle | U | U | Still suggests the HySecure datasheet "can be framed to meet APRA CPS 234". It never says we have nothing on Australian regulation, and gives no request button. |
| 27 | REG: middle east event deck, gitex | H | **A** | Honest "no GITEX deck" and the request button. It offers the Dubai Partner Summit decks, correctly labelled internal. Those decks carry discounts and partner tiers; a warning before showing them at a public event would help. |
| 28 | REG: fortinet vpn replacement pitch | U | **H** | The *Zero Trust Access Gateway* deck, whose comparison names Fortinet, with its 2022 age note. Newly carded. |
| 29 | SE: aws workspaces vs hyworks | H | H | Why DaaS battlecard 2022 and the AWS spreadsheet, with "do not send as-is". |
| 30 | AE: bhai urgent hyworks brocher bhejo customer ko | U | U | **False gap:** "No exact HyWorks brochure found". It offers two decks as "suitable to share with the customer", with "Internal only: do not send" appended, which reads as a contradiction. The Digital Workspace brochure (2025) is in the library, and a **public** *Digital Workspace Brochure V2 2026* sits in the public bucket, uncarded. |
| 31 | AE: Kerala hospital, 800 users, Citrix vs AVD, send CIO + my prep | U | U | **False gap:** "No exact public-facing asset", yet the public Zulekha Hospital case study exists. It says the Aug 2026 VDI deck is an "up-to-date VDI comparison (incl. Citrix, Azure Virtual Desktop)". Its card lists no competitors. The deck with the 2026 AVD comparison is *Customer Deck SEA 1.0*. |
| 32 | SDR: pharma case study I can send | U | **H** | City Pharmacy (public) on top. |
| 33 | SDR: what about hospitals? (follow-up) | H | H | Zulekha Hospital (public). The follow-up kept the context. |
| 34 | SE: hysecure demo video | U | U | Honest-ish "no public HySecure demo video", but the substitute is the TrueSSO video, "likely shows HySecure features" (a guess). The device-posture and geofencing demo videos exist. |
| 35 | SE: cisco anyconnect replacement | H | H | HySecure vs Cisco AnyConnect battlecard (2021, age noted). |

**Moved up (7):** #7, 8, 16, 19, 20, 28, 32. **Moved down (5):** #1, 4, 21, 23, 27. #23 moved only
because I checked the claim against the document this time. #27 went from happy to an honest gap,
which is arguably the better answer.

## What improved, and why

**From carding (the documents are now described from their content):**
- #20 HySecure architecture: the *HySecure for ZTNA ... Reference Architectures* deck was carded.
- #28 Fortinet: the Zero Trust Access Gateway deck's card title names its Fortinet comparison.
- #8 pharma proof: the new UAE multi-hospital and single-slide-library cards give substitutes.
- #14 SOC 2: the Mirox letter's card says "Not a SOC 2 Report", so the answer is now precise.
- Trust notes are much richer everywhere (#4, 6, 12, 21, 29, 31): age, contradictions and "do not
  send as-is" come through reliably.

**From code fixes:**
- Pricing false-trigger (`PRICE_ASK`): the Broadcom question (#16) now gets its migration material.
- The unfiltered seed search (`seedSearch`, for mis-tagged assets): City Pharmacy now appears for
  pharma (#8, #32).
- Substitutes, the `missing` flag and the request button: #7, 17, 19, 24, 25 and 27 are honest gaps
  with the button, where yesterday several were blank "not available" answers.
- The internal-sending guard (`guardSending`) fires on list lines (#7, #30).
- One-step follow-ups (`searchText`): #2 and #33 keep their topic.

## What still fails, ranked by how often a rep would hit it

### 1. The answer invents what a document covers (6 of 35: #1, 2, 3, 12, 23, 31)

This is the most common failure and the most damaging: a rep forwards the document on the strength
of the sentence.

- **Repro:** "pvt bank in mumbai moving off citrix, need a bfsi case study i can send them".
  - **What came back:** *Two Leading Indian Private Banks* "shows how private banks replaced legacy
    access (including Citrix)". The card (`sam_asset_cards`) has `competitors: []`, and neither the
    brief nor the outcomes mention Citrix.
  - **What should happen:** describe only what the card says. The rep's situation ("moving off
    Citrix") must not be attributed to the document.
- **Same fault elsewhere:**
  - "hysecure datasheet specs - max concurrent users per appliance": the datasheet does not state
    that figure (`corpus/text/Accops Hysecure Datasheet V5 2026.txt`).
  - "product video hysecure": the videos are uncarded (empty brief), so the model describes them
    from the title.
- **Suspect:** `web/lib/agent.ts`.
  - The `SYSTEM` prompt says "why it fits this ask", which invites fitting the document to the ask.
  - `finish()` guards titles only, never claims.
  - `toolPayload()` sends an uncarded asset with no brief, and no marker that says so.
- **Fix direction:**
  - Prompt: "say only what the result's brief or outcomes say".
  - Code: strip or flag a competitor, regulator or number in a line when it isn't on that asset's
    card.
  - Mark uncarded results "title only, contents unknown".

### 2. Better results lose to filler words, or to one entity crowding out another (#4, #21, #15)

- **Repro:** "citrix battlecard for my own prep before the call tmrw".
  - **What came back:** the top results matched "own" and "before" (`/search` `why_match`: "citrix,
    battlecard, own, before"). The two 2024 Citrix battlecards fell out of the answer. "citrix
    battlecard" on its own ranks them first and second.
  - **What should happen:** the 2024 *Accops Powered VDI vs Citrix* battlecards come first.
- **Repro:** "does hyworks support nutanix AHV and proxmox? need integration doc".
  - **What came back:** all top 5 results are Nutanix documents, so the model says no Proxmox
    document exists.
  - **What should happen:** every named entity (Nutanix, Proxmox) gets at least one result.
- **Suspect:** `web/lib/cards.ts`. The `STOP` list lacks conversational filler (own, prep, before,
  call, tmrw, whats, bhai, urgent, abhi, bhejo, customer, them). `searchAssets` gives no coverage
  bonus for matching each distinct named term.
- For #15, a named type narrows the pool before the topic is weighed. `seedSearch` in `agent.ts`
  passes `asset_type: Brochure`, and `runSearch` only drops a filter when it returns nothing, so the
  Virtual Browser whitepaper and eBook are never seen. When no filtered hit is about the topic, run
  the unfiltered search too, as `seedSearch` already does for vertical and product.

### 3. False "not available" where the content exists (5: #3, 21, 30, 31, 34)

- **#31 repro:** "Hospital chain in Kerala ... Need something I can send the CIO today plus something
  for my own prep against AVD".
  - **What came back:** "No exact public-facing asset".
  - **What exists:** *Accops Zulekha Hospital Case Study* (public, 3 pages) is returned by `/search`
    "hospital case study", and *Accops vs Microsoft WVD* is there for prep.
  - **Cause:** the long question dilutes the seed search, and the model rejects what it gets.
- **#30 repro:** "bhai urgent hyworks brocher bhejo customer ko abhi".
  - **What came back:** "No exact HyWorks brochure found".
  - **Cause:** "brocher" isn't in `TYPE_WORDS`, and "bhejo" (send) isn't in `EXTERNAL`, so neither the
    type nor the audience is picked up (`agent.ts`).
  - **What exists:** *Digital Workspace: The Integrated Platform Brochure (2025)*, and a public 2026
    edition that SAM cannot see (item 5 below).
- **#3 repro:** a second follow-up in a row loses the topic.
  - `searchText()` in `agent.ts` joins the question to the last user turn only, and that turn was
    itself the follow-up "anything newer?".
  - **What should happen:** walk back to the last user turn that has topic words of its own. With the
    bank question included, `/search` ranks *Accops Private Bank MFAZTNA Case Study* (2 pages)
    third.

### 4. "Nothing fits" answered as if it fits: no gap, no request button (#22, #26, and partly #6)

- **Repro:** "australian gov / APRA CPS 234 angle for hysecure - anything?"
  - **What came back:** the HySecure datasheet "can be framed to meet APRA CPS 234". `missing` is
    false, so there is no request button. `/search "APRA"` returns zero results.
  - **What should happen:** "Nothing on APRA or Australian regulation". The datasheet goes in as a
    substitute, `missing` is true and the button shows.
- **Same pattern:** "hyworks sizing for 500 concurrent users" gets three unrelated sizing documents.
- **Suspect:** `finish()` in `agent.ts`. `missing` is set only when the model's first line is a denial
  (`DENIAL`), or when a named document type is absent. Add a relevance check on the non-denial path:
  if the ask's distinctive terms (APRA, sizing) are on none of the shown cards, treat it as missing.

### 5. Seven public documents on downloads.accops.com are not in SAM at all (a data gap)

`prototype/data/s3_objects.json` lists 14 public files. Only 7 are carded. These are missing from
the catalogue (`/search` does not find them):
- *Accops Digital Workspace Brochure V2 2026*: the public HyWorks brochure that #30 needed. The 2025
  card even says "newer edition: ... Not yet carded".
- *Accops for Government 2026* and its V2
- *Accops MEA PPT Updated - for attendee*: possibly the public MEA event deck #27 needed
- *Accops Brochure 4*
- *Accops Brochure with logos*: relevant to #11
- *Accops Hysecure Datasheet V4 Aug 25*

"Carding complete, queue 0" covers SharePoint only. These are the most sendable documents Accops
has, so carding them is cheap and lifts #30, and probably #27 and #11.

### 6. A "newer edition" is named but never shown (#4, #16, #19)

- The trust note says "prefer that one", but the newer file isn't among the cards:
  - #4: 2018 table → *Accops vs Citrix-VMware Updated April 2024*
  - #16: Broadcom battlecard → *Omnissa Horizon VVF Analysis*
  - #19: DaaS 2025 → public *DaaS V4 2026*
- **Suspect:** `trustNote()` / `supersedingFile()` in `cards.ts` produce the text only. When a shown
  asset is superseded and its successor is in the catalogue, `finish()` or `best()` in `agent.ts`
  should pull the successor into the cards, above the old one.

### 7. The sending guard misses the verdict sentence (#5)

- **Repro:** "CISO at the bank asked how we help with RBI ... what can i send him".
  - **What came back:** "**Send** the RBI-focused solution document (internal) ... plus the latest
    BFSI industry deck (internal)".
  - **What should happen:** "these are internal; do not send. The only sendable item is the RBI
    circular."
- **Cause:** `guardSending()` in `agent.ts` finds documents through `namedTitles()`, which needs a
  bold, quoted, list-led or capitalised "... Deck" title. A generic "the solution document" in the
  first sentence slips through.
- **Fix:** when the rep's words are external, check every line with sending words, not just lines
  that name a title.
- Related (#30): the guard appends "Internal only: do not send" to a line that says "suitable to
  share with the customer", which leaves both. It should replace the sending phrase, not append.

### 8. The pricing guard is defeated by any document titled "pricing" (#6)

- **Repro:** "whats the pricing for 2000 users hyworks, customer comparing with citrix quote".
  - **What came back:** *Accops DaaS (AVO) Pricing Calculator v2.3 (May 2021)*, "can be adapted for a
    2,000-user quote".
  - **What should happen:** pricing comes from the sales manager. The calculator and the Product
    Editions 2026 matrix can be offered internally, with the age warning in the verdict.
- **Suspect:** `finish()` in `agent.ts`. `!hits.some(h => /\b(price|pricing)\b/i.test(h.asset.title))`
  lets any old price document override the guard. Limit the exception to current price lists, and
  keep the "pricing comes from your sales manager" line either way.

### 9. Acronym ambiguity (#10)

"GCC" was read as government / Gulf. When an ask hinges on an ambiguous acronym, the answer should
name both readings, or ask which one. This only needs a prompt change.

## Decision for you

**The ISO certificate (#13).** Since 8 Sep SAM hands out the 2013-edition certificate, valid to
20 Sep 2024, with no warning. That was your call (commit 21b71f8). The 25 Sep content-gap report
calls it an RFP blocker. If the certificate really has lapsed, restore the warning (`expired: true`
on the card). If it was renewed, upload the new one. This test grades it unsatisfying either way,
because a rep would put an expired certificate into an RFP.
