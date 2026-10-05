## 6 October run #5: after the inventory re-carding and the answer fixes

Same 50 questions (`node prototype/persona.mjs`), on production after `10b6722`. All 50 answered by
gpt-6-luna: p50 2.7 s, max 6.6 s. (The run-#4 raw file was overwritten by this run; its grades are
below.)

| | Run #4 core 35 | **Run #5 core 35** | Run #4 new 15 | **Run #5 new 15** |
|---|---|---|---|---|
| Happy | 14 | **13** | 6 | **6** |
| Acceptable gap | 19 | **20** | 8 | **9** |
| Unsatisfying | 2 | **2** (#3, #35) | 1 | **0** |

- **Fixed and confirmed:** #43 "latest corporate deck" now leads with the *Corporate Presentation,
  25 Aug 2026* (U to H). #50 says "The library has matching documents, but only internal ones." #28
  now offers a ZTNA pitch deck instead of a bank case study (U to A).
- **Better documents from the re-carding:** #1 adds the public Deutsche Bank vendor-access study;
  #9 leads with the public textile thin-client study (properly titled); #39 a defence R&D case study;
  #40 the UAE university and Kyoto University HyLabs studies. Each now carries a year from its text.
- **#3 fell to U on a text bug:** the model wrote "1–2 pages" with an en dash and the denial clause
  was cut to "No exact 1.". **Fixed after the run** (an en dash between digits is a range, not a
  clause break; regression test added). It grades A with the fix.
- **#16 H to A:** the same three documents; the model added "no exact Omnissa migration pitch".
- **#49 H to A:** the pinned public Ecom Express study was available; the model chose the
  e-commerce major case study instead. A judgement call, not a defect.
- **Still U:** #35 Cisco AnyConnect (the only battlecard is 2021 and excluded; substitutes are VDI
  decks). Decided by the old-assets review.

## 6 October run #4: first run with unseen questions

**For Siddharth.** The same 35 questions, plus 15 new ones SAM was never tuned on. Run with
`node prototype/persona.mjs` (the questions now live in that file, so any future run is identical).
50 calls to production, 20 s apart, all `x-sam-test: 1`. **All 50 answered by gpt-6-luna**: p50 2.7 s,
max 7.3 s, no fallbacks. This was the first run after the 30 Sep pre-2024 rule and the 6 Oct
master-list tags. Every gap was checked against `sam_v1_assets`.

### Headline

| | 28 Sep #3 (35) | 6 Oct core 35 | 6 Oct new 15 |
|---|---|---|---|
| **Happy** | 19 | **14** | **6** |
| Acceptable gap (honest, request button) | 12 | **19** | **8** |
| Unsatisfying | 4 | **2** | **1** |
| False gaps (the right document was answerable) | 0 | **0** | **0** |

**Why "happy" fell from 19 to 14: almost entirely the pre-2024 rule.** Five answers lost a document
that is now excluded as published before 2024:
- #35 Cisco AnyConnect: *HySecure vs Cisco AnyConnect and Other VPNs* (2021).
- #28 Fortinet: the *HySecure ZTNA Gateway* decks (2021).
- #29 AWS WorkSpaces and #48 (new) AVD: *Accops Powered VDI vs the Field* (2022) and the AWS sheet (2017).
- #21 Nutanix AHV: the AHV integration guides (2018, 2020).
- #31 Kerala hospital: the AVD prep doc (*vs the Field*, 2022).
SAM handles these honestly (a gap with the request button). But #28 and #35 then offer irrelevant
substitutes, so they grade U. #2 ("anything newer?") is no longer H only because the 2021 deck it
used to compare against is now excluded.

**Better than 28 Sep:** #12 and #14 (no button before, now an honest gap with the button), #13 (the
ISO certificate cleanly), #34 (HySecure demo videos). The run had 0 invented claims.

**The new tags work.** Insurance and NBFC map to BFSI, BPO to IT / ITeS, defence to Government,
university to Education, and logistics and retail to E-commerce / Retail. Every alias landed on the
right industry filter (#36 to #40, #46, #49).

### The 15 unseen questions

| # | Question | Grade | Why |
|---|---|---|---|
| 36 | insurance MFA customer proof | A | Nothing insurance-specific is answerable (the 2022 life-insurer MFA proposal is excluded as pre-2024). Honest, with the button. |
| 37 | NBFC, RBI remote access | H | The NBFC vendor-access case study, the public two-banks case study, and the BFSI 2026 deck. |
| 38 | BPO, 3000 WFH agents, opening deck | A | Honest gap. The IT-services workshop deck is a fair substitute. |
| 39 | defence PSU VDI case study | H | Defence R&D, Atomic Research Centre, Govt compilation. |
| 40 | university virtual labs | H | IIT Bombay HyLabs, Education Japan. |
| 41 | position against Zscaler ZPA | H | *HySecure vs Zscaler Private Access*. The deck carries no date, so the pre-2024 rule falls back to the file's modified date and lets it through. |
| 42 | Okta vs HyID | A | No such comparison exists. Honest. |
| 43 | latest corporate deck for a CIO | **U** | Leads with the SEA compressed deck. The *Corporate Presentation, 25 Aug 2026* is answerable and is the right answer. |
| 44 | ok to send that after the meeting? | H | Correctly: not published, ask marketing first. |
| 45 | telecom zero trust reference | A | Honest gap. Public Govt zero-trust architecture as the substitute. |
| 46 | retail 200 stores thin clients | A | Public HyDesk brochure + VLCC. Good substitutes. |
| 47 | on-prem fingerprint MFA datasheet | A | Corrected on review: not a false gap. Every BioAuth document (deck, deployment guide, Finacle note) is internal and none is a datasheet, so "no sendable datasheet" is true. Weak spot: the substitutes are the HySecure and HyID datasheets, not the BioAuth fingerprint deck. |
| 48 | AVD vs Accops DaaS talking points | A | *vs the Field* (2022) is excluded by the pre-2024 rule. |
| 49 | logistics DaaS similar customer | H | Ecom Express (public). |
| 50 | training deck for a new SI partner | A | Corrected on review: the Partner Bootcamp 2026 is the right deck, and "ask marketing first" is right too: a new SI partner is external, and the card flags the deck as not cleared to share. Only the lead "No exact match in the library." was wrong. **Fixed in `eefc629`** (now: "The library has matching documents, but only internal ones."). It also shows *Selling Accops to Government (c. 2021)*: that card has no publish_year, so it slips past the pre-2024 rule. |

### What to fix, ranked
1. **Decision for you: the pre-2024 rule and battlecards.** Five of the six drops come from it. One
   option is to pin the few battlecards reps still need (Cisco AnyConnect 2021, *vs the Field* 2022,
   HySecure ZTNA Gateway 2021). They would come back with the existing "over two years old" warning.
   The other is to exempt Battlecards like certificates.
2. **Answer bugs (mine), fixed in `eefc629`:** #43 (a South-East Asia deck led a region-less ask;
   the region was missing from the region rule) and #44/#50 ("No exact match" over documents that
   match but are internal). Open: #47's substitutes should lead with the BioAuth deck.
3. **A third card source outside the brain:** the web app still loads 77 hand-inventory cards from
   `web/data/asset_cards.json` (IIT Bombay, Polycab, City Pharmacy, Ecom Express, VLCC...). Their
   industries are free text ("NBFC (Non-Banking Financial Company)", "Health & Wellness / Retail") and never
   pass through `core.terms`. They should be folded into `sam_asset_cards`.
4. **Data:** the *Selling Accops to Government (c. 2021)* card needs `publish_year: 2021`.

## 28 September re-run #3

**For Siddharth.** This is the fourth run of the same 35 questions, with the same follow-up history
and the same strict rubric. It went to production after commit `a61cef7`. That commit made these
changes:
- The verdict guard allows the rep's own words, and "comparing" or "covering" when a shown title
  backs them. It checks words against every result this turn.
- A partial denial keeps `missing` true.
- A "no exact" answer puts the named product and type first (`namedFirst`).
- A region, language or GCC counts only when it is in the title, file name, client or industry.
- A verdict cannot count more cards of a type than are shown.
- The trace says when a fallback model answered.
- The sendability line says "Both are public", and says "partner" when the rep did.

- **Tested:** 26 Sep 2026, 21:00:48 to 21:25:41 UTC (27 Sep, 02:30 to 02:55 IST). That is 1 build
  probe, 35 `/ask` calls about 30 s apart, and 7 more for the demo script (below). Every call had
  `x-sam-test: 1`. Follow-ups carried the earlier turns as `history`, as before. SAM event ids 1419
  to 1496.
- **Build check:** the first probe, "any malaysia or indonesia customer reference i can share with a
  partner?" (21:00:48, event 1419), came back with `missing` true and "1 of 2 can be sent to a
  partner". So `a61cef7` was live.
- **Models: most answers came from the smaller model.** Groq's tokens-per-day limit for
  `openai/gpt-oss-120b` (200,000) was spent by question 3. The new trace step shows it on every
  answer: `model provider failed, answered by fallback :: openai/gpt-oss-120b returned 429 ... tokens
  per day (TPD): Limit 200000, Used 199518`.
  - `openai/gpt-oss-120b` answered 3 questions: #1, #2 and #33.
  - `openai/gpt-oss-20b` answered 31.
  - #32 got no model at all. 120b returned 429, 20b timed out at 40 s, and SAM answered from
    retrieval alone. That answer was still right.

  So this run tests the 20b model far more than run #2 did (20 of 35 on 20b). Treat the changes in
  model voice below with that in mind.
- **Checked:** every gap, "nothing to send" answer and denial, against free `/search` calls (21:20
  to 21:21 UTC).

### Headline

| | 26 Sep | 27 Sep | 27 Sep #2 | 28 Sep #3 |
|---|---|---|---|---|
| **Happy** | 11 | 16 | 21 | **19** |
| Acceptable gap (honest, request button) | 7 | 7 | 9 | **12** |
| Unsatisfying | 17 | 12 | 5 | **4** |
| False or hidden gaps (the content existed) | 5 | 3 | 1 | **0** (1 more in the demo dry run) |
| Verdict guard replaced the model's verdict | n/a | 18 of 35 | 10 of 35 | **3 of 35** (1 wrongly) |
| Sending guard replaced, or stripped sending words from, the verdict | n/a | 7 | 1 | **3 strips** (#3, #12, #34) |
| Sendability line matches the cards' visibility | n/a | n/a | 35 of 35 | **35 of 35** |
| Request button (`missing`) shown when the exact thing is absent | n/a | n/a | not counted | **12 of 15** (missed #12, #14, #34) |
| Invented claims in document lines | 6 answers | 0 | 0 | **0** |
| Wrong or contradictory claims in a verdict that was shown | (in the 6) | 1 | 1 | **3** (#12, #14, #34) |
| Answered by the primary model (120b) | 35 | 35 | 15 | **3** |

**Unsatisfying went from 5 to 4 and acceptable gaps from 9 to 12. Happy fell from 21 to 19.**
- **Up (3):** the three risky answers of run #2 are now honest gaps with the button. #10 names the
  GCC ambiguity, #23 shows the public HySecure datasheet first, and #25 no longer counts an audience
  line as a Malaysia reference.
- **Down (2):** #12 and #34, the HySecure videos. The 20b model now writes "The library has no exact
  HySecure demo video; closest are two demo videos." SAM neither catches this as a contradiction nor
  treats it as a denial, so the rep reads a "no" with no request button. The same shape breaks #14
  (SOC 2). This is the top failure below.

The verdict guard now replaces 3 verdicts, down from 10. The model's own verdict reaches the rep in
most answers again: all six of run #2's wrong replacements (#2, 8, 14, 16, 21, 29) now pass. The
sendability line is right in 35 of 35, and "Both are public" and "partner" both appear where they
should.

### Every question

H = happy, A = acceptable gap, U = unsatisfying. "VG" = the verdict guard replaced the verdict.
"120b" marks the three answers from the primary model; all the others came from `gpt-oss-20b`,
except #32 (retrieval only).

| # | Question | Run #2 | Now | Why (now) |
|---|---|---|---|---|
| 1 | AE: pvt bank moving off citrix, bfsi case study i can send | H | H | The internal 2021 BFSI Citrix proposal deck ("do not send outside Accops"), then both public 2026 private-bank case studies. "2 of 3 can be sent" is right. The model's verdict is shown now ("moving" is the rep's own word). 120b. **On 20b this question gave a false gap:** see failure 2. |
| 2 | AE: anything newer? | H | H | "The library has two 2026 BFSI case studies that are newer than the 2021 deck." "Both are public, so they can be sent to a customer." The history-word fix works. 120b. |
| 3 | AE: shorter one? 1-2 pages | H | H | The 2-page *Private Bank MFA-ZTNA* case study comes first again ("length: short match added"). Weaker verdict: the model wrote "two 2026 BFSI case studies that are short enough for a quick send". `dropSending` cut the whole "that ..." clause, so the verdict no longer says which card is short. The claim that the 2026 ones are short was unsupported anyway. |
| 4 | AE: citrix battlecard for my own prep | H | H | Both 2024 Citrix battlecards, "All internal". The model's verdict is shown. |
| 5 | AE: RBI framework, what can i send the CISO | H | H | The public *Two Leading Indian Private Banks* case study (RBI-mandated MFA for vendors) and the internal IBA CISO keynote. "1 of 2 can be sent" is right. The regulator's co-op bank circular dropped out, which is no loss. **VG wrongly** replaced a fair verdict because of "supporting". |
| 6 | AE: pricing for 2000 users hyworks vs citrix quote | A | A | Unchanged: NO_PRICING, "for your own reference only, not a quote", the 2021 calculator and the 2022 DaaS battlecard. `missing` is true. |
| 7 | SDR: one pager on HyID i can email | A | A | **Better substitute:** the *HyID Datasheet V5 2026* now comes first, then the Editions matrix. "None of these is published ... ask marketing first." `missing` is true ("verdict: nothing sendable"). |
| 8 | SDR: pharma customer proof | H | H | City Pharmacy (public) and the single-slide library. The model's verdict is shown. |
| 9 | SDR: manufacturing plant VDI case study | H | H | Textile manufacturer (public), then Polycab. The model's verdict is shown. |
| 10 | SDR: ZTNA pitch for a GCC | U | **A** | "No exact match for GCC (a Gulf customer or a global capability centre): none of the closest documents mentions it." `missing` is true and the button shows. The substitutes are two 2026 CIO event decks, which are weak but labelled. The false "two ZTNA pitch decks for GCC contexts" is gone. |
| 11 | SDR: customer logo pack | H | H | The Delighted Customers' Catalogue (Jul 2025). It still says "All internal" over a single card. |
| 12 | SDR: product video hysecure | H | **U** | The same two demo videos (Geofencing, Device posture). But the verdict is "The library has no exact HySecure product video; closest are two demo videos", with `missing` false and no button. The videos are filed as HySecure demos and are the top `/search` hits for "hysecure video". The answer denies what it shows. See failure 1. |
| 13 | SE: ISO 27001 certificate for an RFP | U | U | Only the 2013-edition certificate is shown now; the off-topic slots 2 and 3 are gone. There is still no expiry warning (your decision). VG replaced "the ISO 27001 certificate needed for the RFP", which was harmless and arguably right. |
| 14 | SE: SOC 2 type 2 report | U | U | "The library has no SOC 2 Type 2 report; closest are an auditor letter and a corporate brochure." It shows one card (the Mirox letter), because the relevance floor dropped the brochure. `missing` is false, so there is still no button. The verdict also names the brochure that was dropped. See failure 1. |
| 15 | SE: remote browser isolation brochure | A | A | "No exact Browser Isolation brochure in the library." The substitutes are the Virtual Browser whitepaper (2025) and the June 2026 ZTNA and Isolation webinar. The button shows. |
| 16 | SE: vmware horizon, broadcom price hike, omnissa pitch | H | H | Migration Strategy, the Omnissa VVF Analysis, then the 2022 Broadcom battlecard with "A newer edition exists: Omnissa Horizon VVF Analysis - prefer that one". The model's verdict is shown now; the rep's own words pass. |
| 17 | REG: bahasa indonesia daas brochure | A | A | Honest gap and button. The public 2026 DaaS brochure is above the internal 2025 one, which is marked "A newer edition exists". |
| 18 | SE: omnissa migration deck | H | H | Proxmox V2.0, then Migration Strategy. **VG rightly** replaced a backwards verdict ("migrating from Omnissa to Horizon"). Migration Strategy would be the better lead. |
| 19 | SE: data residency, DaaS hosted in india, RFP | A | A | "No exact match for Data residency", with the button. The substitutes are still weak: the 2021 Nutanix joint brief and a distributor partner talk. The public 2026 India/Sovereign brochure (the 27 Sep substitute) is not shown. Do not demo this one. |
| 20 | SE: hysecure architecture / deployment guide | H | H | The HySecure for ZTNA Reference Architectures deck, alone. The floor dropped the HyID architecture deck. |
| 21 | SE: hyworks on nutanix AHV and proxmox | H | H | The Nutanix AHV guide (2020) and Proxmox V2.0. "No single document covering both ...; closest are ..." is shown; "covering" passes now. |
| 22 | SE: hyworks sizing for 500 users | A | A | "No exact HyWorks sizing deck for 500 concurrent users." with the button. The Graphics Workstation deck and DaaS v2 2023 are the substitutes. |
| 23 | SE: hysecure datasheet max concurrent users per appliance | U | **A** | **The hidden result is fixed.** The public *HySecure Gateway: Zero Trust Remote Access Datasheet* (2026) comes first, then the V3 datasheet ("newer edition exists"), then Ecom Express. `missing` is true. The wording is awkward: "No exact match for HySecure concurrent users: none of the closest documents is about it." |
| 24 | REG: arabic brochure for a saudi bank | A | A | "No exact match for Saudi or Arabic", with the button. The substitutes are the two public Indian private-bank case studies and BFSI 2026. |
| 25 | REG: malaysia / indonesia customer reference | U | **A** | "No exact match for Malaysia or Indonesia", `missing` true, and "It is public, so it can be sent to a partner." The SEA deck with no SEA story is gone. The one substitute is an Indian DTH case study (public), which is weak. |
| 26 | REG: APRA CPS 234 / Australian gov | A | A | "No exact match for APRA or Australia", with the button. **Better substitute:** the public HySecure datasheet comes first ("named product first"), then the partner bootcamp. |
| 27 | REG: middle east event deck, gitex | A | A | "No exact match for GITEX", with the button. The MEA Dubai bootcamp and keynote are shown internal. `/search "gitex"` returns nothing. |
| 28 | REG: fortinet vpn replacement pitch | H | H | The ZTNA Gateway deck naming Fortinet (2022, age noted), then the Nutanix .NEXT 2024 deck. The model's verdict is shown. |
| 29 | SE: aws workspaces vs hyworks | H | H | Why DaaS 2022 and "vs the Field" 2022. "Two battlecards comparing AWS WorkSpaces and HyWorks" is shown now; the title backs "comparing". |
| 30 | AE: bhai urgent hyworks brocher bhejo customer ko | H | H | The public Digital Workspace Brochure V2 2026 and the public India/Sovereign brochure. "Both are public, so they can be sent to a customer." |
| 31 | AE: Kerala hospital, Citrix vs AVD, send CIO + my prep | H | H | The public Zulekha Hospital case study first, then the VDI deck (Aug 2026) and "vs the Field" (with AVD), both "do not send outside Accops". "1 of 3 can be sent" is right. |
| 32 | SDR: pharma case study I can send | H | H | **Retrieval only** (120b 429, 20b timed out at 40 s): City Pharmacy and Zulekha, both public, "Both are public". The canned verdict is plain but correct. |
| 33 | SDR: what about hospitals? | H | H | Zulekha (public) first, then City Pharmacy. The follow-up kept its context. 120b. |
| 34 | SE: hysecure demo video | H | **U** | Same as #12: "The library has no exact HySecure demo video; closest are two demo videos", over the two HySecure demo videos, with no button. In run #2 the guard caught this contradiction. |
| 35 | SE: cisco anyconnect replacement | H | H | The HySecure vs Cisco AnyConnect PDF first, then the ZTNA Gateway deck. The verdict says "battlecards", but both are decks (a minor slip). |

**Moved up (3):** #10, 23 and 25 went from U to A. **Moved down (2):** #12 and #34 went from H to U.
Every other answer kept its grade. #7 and #26 got better substitutes, and #2, 16, 21 and 29 now show
the model's verdict.

**Demo dry run (7 more calls, 21:21 to 21:25 UTC, all 20b).** These were the demo questions in demo
order, with the web chat's history (the last 6 turns).
- The Citrix battlecard, the Kerala mixed ask, the Broadcom/Omnissa pitch and browser isolation all
  came back as above.
- The Citrix battlecard verdict was replaced (VG, on "can be used").
- The Kerala verdict read "an VDI battlecard" (failure 5).
- "anything newer?" after browser isolation put the June 2026 webinar first. VG rightly replaced a
  false "India edition brochure that includes Remote Browser Isolation".
- The bank question (#1) gave a **false gap**: "No exact match for Citrix", `missing` true (failure
  2). "BFSI case study I can send to a private bank customer" (event 1496) was clean: two public
  2026 case studies, "Both are public".

### What still fails, ranked by how often a rep would hit it

**1. "The library has no X" is neither a denial nor a partial denial, so the rep reads a "no" with
no request button (#12, #14, #34; about 1 in 12, and more often on 20b).**
- **Repro:** "hysecure demo video".
  - **What came back:** "The library has no exact HySecure demo video; closest are two demo videos."
    It showed the Geofencing and Device posture demo videos, with `missing` false.
  - The same shape appeared on "do we have SOC 2 type 2 report": "The library has no SOC 2 Type 2
    report; closest are an auditor letter and a corporate brochure."
- **Cause 1, in `finish()` in `web/lib/agent.ts`:**
  - `DENIAL` only matches a verdict that opens with "no", "none", "there is no" or "the library
    does not have". It misses "The library has no".
  - `PARTIAL_DENIAL` needs a `;`, `,` or "but" before the "no".
  - So neither the denial branch nor `partial` fires, and `missing` stays false.
- **Cause 2, in `verdictProblem()`:** the guard now checks words across all results this turn
  (`seen = hits`). So "a corporate brochure" passes on #14 even though the relevance floor dropped
  that card. In run #2 the contradiction in #34 was caught; it no longer is.
- **Fix:**
  - Treat `^the library (has|holds|contains) no\b` (and "sam has no" / "we have no") as `DENIAL`.
    The denial branch then keeps the substitutes and sets `missing`.
  - Check document nouns in the verdict against the shown cards only; keep `seen` for plain words.
  - For #12 and #34 the right answer is arguably "yes, two HySecure demo videos". A denial whose
    named product matches the shown cards' `path` or folder could go to the guard instead.

**2. A competitor named as context becomes a required entity, so a good answer gets a false gap
(demo dry run: #1 on 20b).**
- **Repro:** "pvt bank in mumbai moving off citrix, need a bfsi case study i can send them".
  - On 20b (event 1488), the model picked only the two public case studies. The answer became "No
    exact match for Citrix: none of the closest documents mentions it.", with `missing` true and the
    button.
  - On 120b (event 1421), the model also picked the Citrix-titled BFSI deck and the answer was clean.
  - The rep asked for a BFSI case study. Citrix is the situation, not the ask.
- **Suspect:** `coverEntities()` / `asksAbout()` in `agent.ts`. Every named competitor must appear on
  a shown card, and no *case study* names Citrix.
- **Fix direction:** a competitor after "moving off / replacing / leaving / evaluating" is context.
  - It should reorder (put a card that names it first, if one clears the floor), not set `missing`.
  - Or require the entity only when it is the object of the asked type ("citrix battlecard").

**3. Groq's daily limit, not code: the primary model was gone by question 3.** This is operational.
- Today's first two runs used up `gpt-oss-120b`'s 200,000 tokens per day. 31 of 35 answers came
  from 20b, and one (#32) from retrieval alone after 20b timed out at 40 s.
- 20b writes the "The library has no X; closest are Y" verdicts in failure 1 more often.
- On a demo day, run nothing heavy beforehand. The new trace step makes this visible: "model
  provider failed, answered by fallback ... tokens per day (TPD)".
- On the retrieval-only path, `ask()` `unshift`s the failures, so the trace lists 20b before 120b
  (cosmetic).

**4. The verdict guard still throws away some fair verdicts (1 of 3 in the 35, plus 1 in the dry
run).**
- **Wrongly replaced:**
  - #5, "supporting" ("a relevant case study and a supporting deck").
  - The dry-run Citrix battlecard, "can be used": "two 2024 Citrix battlecards that can be used for
    prep". `COVERAGE` includes `can be (framed|adapted|...|used)`.
- **Rightly replaced:**
  - #18 (backwards: "from Omnissa to Horizon").
  - The dry-run "anything newer?" (a false "brochure that includes Remote Browser Isolation").
- **Harmless:** #13 (the 2013 ISO certificate "needed for the RFP").
- **Suspect:** `verdictProblem()`. Descriptive adjectives count as unknown words, and "can be used"
  counts as coverage.
- **Fix direction:**
  - Allow "can be used for <the rep's word>" when that word is in the question.
  - Allow a small set of role adjectives (supporting, related, relevant).

**5. `dropSending()` over-strips (#3 and the dry-run Kerala answer).**
- **#3:** the model wrote "... that are short enough for a quick send." The split on " that " drops
  the whole clause, so the answer to "shorter one?" loses the word "short".
- **The dry-run Kerala answer:** `VIS_ADJ` turns "an internal VDI battlecard" into "an VDI
  battlecard".
- **Fix:**
  - Drop only the sending phrase ("for a quick send"), not the relative clause.
  - Re-pick "a" or "an" after removing a visibility adjective.

**6. Weak substitutes on some honest gaps (#19, #10, #25).**
- **#19 data residency:** the 2021 Nutanix brief and a partner talk. On 27 Sep the substitutes were
  the public 2026 India/Sovereign brochure and DaaS V4 2026, which was better. The entity-missing
  return (`verdict: named entity missing`) shows the model's picks as they are. `namedFirst`
  didn't help, because data residency is not a product.
- **#10:** two CIO event decks.
- **#25:** one Indian DTH case study.
- These answers are honest, but a rep gets little from the substitutes.

**7. The ISO 27001 certificate (#13): unchanged, your decision.**

**8. Cosmetic.**
- "All internal: don't send outside Accops." over a single card (#11, 13, 14, 20).
- "1 of 2 can be sent ...; the rest are internal only" when the rest is one card.
- #23's label "HySecure concurrent users ... none is about it".
- #35's "battlecards" over two decks.

---

## 27 September re-run #2

**For Siddharth.** This is the third run of the same 35 questions, with the same follow-up history
and the same strict rubric. It went to production after the sendability merge. SAM now writes the
"can this be sent" line itself from the cards, sending words are stripped from the model's verdict,
named products get their own gaps, and there is a relevance floor and an edition order.

- **Tested:** 26 Sep 2026, 20:15:46 to 20:32:34 UTC (27 Sep, 01:45 to 02:02 IST). 35 `/ask` calls,
  about 29 s apart, all with `x-sam-test: 1`. Follow-ups carried the earlier turns as `history`, as
  before. SAM event ids 1342 to 1415, plus the build probe 1341 at 20:15:05 UTC.
- **Build check:** "citrix battlecard for my own prep before the call tmrw" answered "All internal:
  don't send outside Accops." on the first try. So the new build (local main `be0d202`) was live.
- **Models:** #1 to #14 and #25 were answered by `openai/gpt-oss-120b`. The other 20 answers (#15 to
  #24 and #26 to #35) came from the fallback, `openai/gpt-oss-20b`. On 27 Sep every answer came from
  120b. The trace does not say why 120b failed (probably Groq's per-minute limit). This half-and-half
  split is a confound, but the 20b half scored as well as the 120b half.
- **Checked:** every gap, every "nothing to send" and every hidden result, against free `/search`
  calls (20:18 to 20:40 UTC).

### Headline

| | 26 Sep | 27 Sep | 27 Sep #2 |
|---|---|---|---|
| **Happy** | 11 | 16 | **21** |
| Acceptable gap (honest, request button) | 7 | 7 | **9** |
| Unsatisfying | 17 | 12 | **5** |
| False or hidden gaps (the content existed) | 5 | 3 | **1** (#23) |
| Verdict guard replaced the model's verdict | n/a | 18 of 35 | **10 of 35** |
| Sending guard replaced, or stripped sending words from, the verdict | n/a | 7 of 35 | **1** (#32, a strip only) |
| Sendability line matches the cards' visibility | n/a | n/a | **35 of 35** |
| Invented claims in document lines | 6 answers | 0 | **0** |
| Invented or contradictory claims in a verdict that was shown | (in the 6 above) | 1 (#12) | **1** (#10) |

**Happy went from 16 to 21. Eight questions moved up and one moved down.** The sendability line
works: it matched the cards' visibility in all 35 answers, and no verdict talks about sending any
more. The model's own verdict now reaches the rep in 20 of 35 answers, up from 4. SAM writes 5
more (pricing, type-missing and entity-missing gaps). "Best matches in the library." is down to 10.

**All three of the 27 Sep false gaps are fixed:**
- #3: the 2-page Private Bank MFA-ZTNA case study now comes first.
- #5: the public RBI circular is now shown.
- #31: the public Zulekha Hospital case study now comes first.

The one new hidden result is #23: the public HySecure datasheet sits behind a "no exact datasheet"
gap.

### Every question

H = happy, A = acceptable gap, U = unsatisfying. "VG" = the verdict guard replaced the verdict.
"20b" = answered by the fallback model.

| # | Question | 27 Sep | Now | Why (now) |
|---|---|---|---|---|
| 1 | AE: pvt bank moving off citrix, bfsi case study i can send | H | H | The internal 2021 BFSI Citrix proposal deck ("do not send outside Accops") comes first, then both public 2026 private-bank case studies. The line "2 of 3 can be sent" is right. VG, on the rep's own word "moving". |
| 2 | AE: anything newer? | U | **H** | The false Citrix gap is gone and `missing` is false. It shows the two 2026 public case studies, which are the newest. VG threw away a true verdict ("two 2026 BFSI case studies, newer than the 2021 deck") because 2021 is on the previous turn's card, not a shown one. |
| 3 | AE: shorter one? 1-2 pages | U | **H** | *Accops Private Bank MFAZTNA Case Study* (2 pages, internal) comes first, with the South India Bank study (short) and the public Top-5 bank study. The model's verdict is shown: "a short 1-2-page private-bank case study and another brief bank case study". |
| 4 | AE: citrix battlecard for my own prep | H | H | Both 2024 Citrix battlecards, then "vs the Field" 2022. The model's verdict is shown, with "All internal". |
| 5 | AE: RBI framework, what can i send the CISO | U | **H** | The public *RBI Circular (31 Dec 2019)* is now shown, and "1 of 3 can be sent" is right. The UCB 2020 document and the IBA CISO Summit keynote are labelled "do not send outside Accops". Caveat: the only sendable item is the regulator's own circular, and it is the co-operative-bank one. VG caught a false claim ("a case study on RBI-mandated MFA", when no case study was shown). |
| 6 | AE: pricing for 2000 users hyworks vs citrix quote | A | A | Unchanged: the NO_PRICING text, "for your own reference only, not a quote", the 2021 calculator and the 2022 DaaS battlecard. `missing` is true. |
| 7 | SDR: one pager on HyID i can email | U | **A** | "No exact one-pager on HyID." "None of these is published ... ask marketing first." `missing` is true, so the button is back. The substitutes are weak: an all-products workshop deck with offers, and the Editions matrix. The *HyID Datasheet V5 2026* (internal) exists and is the better stand-in. |
| 8 | SDR: pharma customer proof | H | H | The single-slide library, City Pharmacy (public) and the ZTNA for Pharma whitepaper. The private-bank bootcamp is gone. VG ("focused"). |
| 9 | SDR: manufacturing plant VDI case study | H | H | Textile manufacturer (public), then Polycab. The model's verdict is shown. |
| 10 | SDR: ZTNA pitch for a GCC | U | U | **The verdict passed the guard and is wrong:** "two relevant ZTNA pitch decks for GCC contexts", over three documents: a 2020 outsourcing note, a Zscaler PQC note for banks, and a CIO conclave deck. None is a GCC pitch. The acronym isn't named, and the Dataquest "6,000 users in 7 countries" case study isn't shown. |
| 11 | SDR: customer logo pack | H | H | The Delighted Customers' Catalogue (Jul 2025). The model's verdict is shown. |
| 12 | SDR: product video hysecure | U | **H** | The Geofencing and Device posture demo videos, each "SAM has not read this one". The decks are gone and the sendability line is right. The verdict calls them HySecure videos, which is what they are filed as. |
| 13 | SE: ISO 27001 certificate for an RFP | U | U | Unchanged: the 2013-edition certificate, still with no expiry warning (your decision). Slots 2 and 3 are off-topic: a Government deck and a BioAuth architecture deck. |
| 14 | SE: SOC 2 type 2 report | U | U | **The right answer was lost again.** The model wrote "a SOC-1/2 auditor letter (not a full SOC 2 report) ...; no actual SOC 2 Type 2 report". VG replaced it because of "corporate" (a brochure the relevance floor had dropped). The partial-denial check runs on the replacement text, so `missing` is false and there is no button. |
| 15 | SE: remote browser isolation brochure | U | **A** | "No exact Browser Isolation brochure in the library.", `missing` true, the button. The substitutes are right: the *Virtual Browser* whitepaper (2025) and the June 2026 ZTNA and Isolation webinar. The corporate brochures were dropped by the floor. 20b. |
| 16 | SE: vmware horizon, broadcom price hike, omnissa pitch | H | H | Migration Strategy, then the Omnissa VVF Analysis, then the 2022 Broadcom battlecard (newer edition first). VG, on the rep's own words "moving" and "hike". |
| 17 | REG: bahasa indonesia daas brochure | A | A | Honest gap and button. **Edition order fixed:** the public 2026 DaaS brochure is now above the internal 2025 one. The VMware filler is gone. |
| 18 | SE: omnissa migration deck | H | H | Migration Strategy, then Proxmox V2.0. The verdict is shown but muddled: "VMware Horizon customers leaving Omnissa". |
| 19 | SE: data residency, DaaS hosted in india, RFP | A | A | "No exact match for Data residency", with the button. **The substitutes got worse:** a 2021 Nutanix joint brief and a distributor partner talk. On 27 Sep they were the public 2026 India/Sovereign brochure and DaaS V4 2026. |
| 20 | SE: hysecure architecture / deployment guide | H | H | The *HySecure for ZTNA ... Reference Architectures* deck, now alone and first. The floor dropped the HyID architecture deck and the BioAuth decks are gone. |
| 21 | SE: hyworks on nutanix AHV and proxmox | H | H | The Nutanix AHV guide (2020) and Proxmox V2.0. VG ("a deck covering Proxmox support" was true). |
| 22 | SE: hyworks sizing for 500 users | U | **A** | "No exact HyWorks sizing guide for 500 concurrent users.", `missing` true, the button. The substitutes are the Graphics Workstation deck (Infra Sizing) and DaaS v2 2023 (Azure Sizing). The Japanese deck is gone. |
| 23 | SE: hysecure datasheet max concurrent users per appliance | U | U | **Hidden result:** "No exact datasheet with max concurrent users per appliance." is true. But the substitutes are the Ecom Express "2,300 concurrent users" case study and the Editions matrix. The public *HySecure Gateway: Zero Trust Remote Access Datasheet* (2026) and the public V4 (Aug 2025) are 3rd and 5th on `/search` for this exact question, and neither is shown. |
| 24 | REG: arabic brochure for a saudi bank | A | A | "No exact match for Saudi or Arabic", with the button. The substitutes are the two public Indian private-bank case studies and the BFSI 2026 deck. |
| 25 | REG: malaysia / indonesia customer reference | A | **U** | **The gap and the button are gone.** VG replaced a false verdict ("a South-East Asia customer deck that includes Malaysia/Indonesia references"). The deck shown, SEA Customer Deck Compressed V2.0, says on its own card "this compressed edition has no SEA customer story". Its `use_for` names Malaysia and Indonesia as the audience, and that satisfied the entity check. 120b. |
| 26 | REG: APRA CPS 234 / Australian gov | A | A | "No Australian gov/APRA CPS 234 angle.", with the button. The only substitute is the 218-slide confidential partner bootcamp, which is weak. |
| 27 | REG: middle east event deck, gitex | A | A | "No exact Gitex Dubai deck.", with the button. The MEA Dubai bootcamp and keynote are shown internal. The Japanese deck is gone. |
| 28 | REG: fortinet vpn replacement pitch | H | H | The ZTNA Gateway deck naming Fortinet (2022, age noted). The model's verdict is shown. |
| 29 | SE: aws workspaces vs hyworks | H | H | The Why DaaS battlecard 2022 and "vs the Field" 2022. VG ("comparing", which was true). |
| 30 | AE: bhai urgent hyworks brocher bhejo customer ko | H | H | The public Digital Workspace Brochure V2 2026 and the public India/Sovereign corporate brochure. "All 2 are public" is right, but reads awkwardly. The model's verdict is shown. |
| 31 | AE: Kerala hospital, Citrix vs AVD, send CIO + my prep | U | **H** | **The hidden gap is fixed:** the public *Zulekha Hospital* case study comes first ("sendable: published match added"). The VDI deck of Aug 2026 and "vs the Field" (with AVD) follow for prep, labelled "do not send". "1 of 3 can be sent" is right. |
| 32 | SDR: pharma case study I can send | H | H | City Pharmacy (public) first. The sending clause was stripped ("that can be sent"). The Japan decks are gone from slots 2 and 3. |
| 33 | SDR: what about hospitals? | H | H | Zulekha (public), the UAE multi-hospital story and City Pharmacy. The model's verdict is shown. |
| 34 | SE: hysecure demo video | H | H | The same two demo videos. VG caught a contradictory verdict ("no HySecure demo video, but it contains two relevant demo videos"). The Japanese deck is gone. |
| 35 | SE: cisco anyconnect replacement | H | H | **The HySecure vs Cisco AnyConnect battlecard is now first** (it was third), then the ZTNA Gateway deck. The verdict says "two battlecards", but the second is a deck. |

**Moved up (8):** #2, 3, 5, 12 and 31 went from U to H; #7, 15 and 22 went from U to A. **Moved
down (1):** #25 (A to U). All 16 of the 27 Sep happy answers stayed happy.

### What improved, and why

- **SAM writes the sendability line** (`sendLine()` / `answerText()` in `web/lib/agent.ts`). It was
  right in 35 of 35 answers. `dropSending()` removes sending talk from the verdict, so the #12 "two
  can be shared" kind of line cannot come back (#32 is the one strip). The sending guard no longer
  replaces whole verdicts: it did 7 times on 27 Sep and 0 times now.
- **The verdict guard accepts "the library has / includes" verdicts** (`LIBRARY_HAS` in
  `verdictProblem`). Replacements fell from 18 to 10, and the model's verdict now reaches the rep in
  20 answers: #3, 4, 9, 10, 11, 12, 13, 18, 20, 28, 30, 31, 32, 33 and 35, and the denials #7, 22, 23, 26 and 27. One of the 20 is wrong (#10).
- **Named product or spec with no matching document → gap + button** (`coverEntities` / `hasEntity`
  with `isAbout` and `SPECS`, and the type check with `ofProduct`). This covers #15 (browser
  isolation, with the Virtual Browser whitepaper as substitute), #22 (HyWorks sizing) and #23 (the
  per-appliance maximum).
- **A sending ask with nothing public → `missing`** (`unsendable` in `finish()`): #7 has the button
  again.
- **Mixed and "him/her" asks get the best public document** (`ensurePublished()` gated on
  `sending()`, and `him|her` added to `EXTERNAL`): Zulekha for the Kerala CIO (#31) and the RBI
  circular for the CISO (#5).
- **Follow-ups check entities on this turn only** (the `turn` argument to `finish()`): #2 and #3 no
  longer say "No exact match for Citrix". `shortFirst()` puts the 2-page case study first (#3).
- **Relevance floor** (`relevant()`): no more Japanese decks (#22, 27, 32, 34), private-bank
  bootcamps (#8), BioAuth decks (#20) or corporate brochures posing as a browser isolation brochure
  (#15).
- **Newer edition first** (`withSuccessors()`): the public 2026 DaaS brochure is above the 2025 one
  (#17).

### What still fails, ranked by how often a rep would hit it

**1. The verdict guard still throws away good verdicts (6 of the 10 replacements; about 1 in 6
answers).**
- **Wrongly replaced:**
  - #2: "states 2021". The number is on the previous turn's card.
  - #8: "focused".
  - #14: "corporate". It names a brochure the relevance floor removed.
  - #16: "moving", "hike". These are the rep's own words.
  - #21: "covering".
  - #29: "comparing". The title says "vs AWS WorkSpaces".
- **Rightly replaced:** #5 (a case study that wasn't shown), #25 (a false "includes Malaysia
  references"), #34 (a self-contradiction), and arguably #1.
- **Repro:** "aws workspaces vs hyworks comparison".
  - The model wrote: "The library has two battlecards comparing AWS WorkSpaces and HyWorks."
  - Trace: `verdict guard: replaced :: says what a document covers ("comparing")`.
- **Suspect:** `verdictProblem()` in `web/lib/agent.ts`.
  - The rep's words count only in a negated clause: `on` adds `question` only when `neg`. So
    "moving" and "hike" fail the unknown-word check.
  - `COVERAGE` rejects "covering" and "comparing" even when the word is in the shown card's title.
  - The check sees only the final `shown` cards, not the ones picked before the floor dropped them,
    and not the history.
- **Fix direction:**
  - Allow the question's own non-entity words in every clause (the entity and number checks still
    stop "moved off Citrix").
  - Let a coverage verb pass when its object is in a shown card's title.
  - Or stop asking the model for a verdict and write it from `missing`, the count and the types.

**2. A correct partial denial loses its request button when the verdict is replaced (#14).**
- **Repro:** "do we have SOC 2 type 2 report".
  - The model wrote: "... a SOC-1/2 auditor letter (not a full SOC 2 report) and a corporate
    brochure; no actual SOC 2 Type 2 report."
  - The rep sees "Best matches in the library.", with `missing` false and no button.
- **Cause:** `finish()` in `agent.ts` does
  `const partial = !problem && PARTIAL_DENIAL.test(final)`, and `final` is already the fallback text.
- **Fix:**
  - Test the model's own verdict (`g`), not `final`.
  - When it is a partial denial, keep its denial clause as the verdict (as `denialClause()` does),
    even if the rest fails the guard.

**3. On the denial path, the substitutes ignore the product and type the rep named (#23, #7, #19;
about 1 in 12).**
- **Repro:** "hysecure datasheet specs - max concurrent users per appliance".
  - **What came back:** "No exact datasheet with max concurrent users per appliance.", then the Ecom
    Express case study and the Editions matrix.
  - **What exists:** the public *HySecure Gateway: Zero Trust Remote Access Datasheet* (2026) and the
    public V4 (Aug 2025). They are 3rd and 5th on `/search` for this exact question, and neither is
    shown. A rep reads the gap as "we have no HySecure datasheet".
- **Cause:** the denial branch of `finish()` (`if (denial || reply.none)`) takes the model's picks
  that clear `relevant()`. The `ofProduct` / `primaryFirst` preference for the named product and type
  only runs on the non-denial path.
- **Fix:** in the denial branch, when the rep named a type and a product, put the best hit that
  `isType` and `isAbout` first.
- **#7 (same family):** the HyID Datasheet V5 2026 was never in the pool.
  - `seedSearch` ran `audience: external` with `asset_type: Brochure`, and the unfiltered search on
    "one pager on HyID i can email" found decks.
  - **Fix:** when a sending ask finds nothing public, also search the product and type without the
    audience filter.
- **#19:** the substitutes regressed to a 2021 Nutanix brief and a partner talk. The entity-missing
  return (`verdict: named entity missing`) shows the model's picks as they are.

**4. A region counts as covered when the card only names it as the audience (#25).**
- **Repro:** "any malaysia or indonesia customer reference i can share with a partner?"
- **What came back:** "Best matches", with `missing` false and no button. The first card is *SEA
  Customer Deck Compressed V2.0*, whose card says "this compressed edition has no SEA customer
  story".
- **Cause:** `hasEntity()` in `agent.ts` uses `mentions(cardText(h.asset), e)` for regions, so the
  `use_for` "for SEA prospects (Indonesia, Malaysia, ...)" satisfies the check, and `coverEntities`
  returns nothing uncovered.
- **Fix:** for regions, check the title, file name and industry only. That is the rule the `about`
  candidates in `coverEntities` already use.

**5. A shown verdict can still be wrong (#10, and minor slips in #18 and #35).**
- **Repro:** "whats our ZTNA pitch for a GCC".
  - **What came back:** "The library has two relevant ZTNA pitch decks for GCC contexts.", over
    three documents, none of which is a deck for a GCC.
- **Cause:** `verdictProblem()` is lexical. "GCC" is in the question, "ZTNA" is a product and
  "decks" is an answer word, so the verdict passes. Nothing forces the prompt's "assuming GCC means
  ..." reading.
- **Minor slips:**
  - #35 says "two battlecards" over a battlecard and a deck.
  - #18 says "Horizon customers leaving Omnissa".
- **Fix direction:**
  - Check the count and type in the verdict against the shown cards.
  - Keep a short list of ambiguous acronyms (GCC) that requires the ASSUMED clause, or write it in
    SAM's text.

**6. The ISO 27001 certificate (#13): unchanged, your decision.** Slots 2 and 3 (the Government deck
and the BioAuth architecture deck) are also off-topic. They pass `substituteFits` on shared words.

**7. The fallback model is invisible.**
- 20 of 35 answers came from `gpt-oss-20b`. The API response shows only `model`, with no trace step
  for the 120b failure. `ask()` records the failure in `error` (`withFailures`), not in the trace.
- **Fix:** push a "primary model failed, answered by fallback" trace step. The dashboard can then
  tell 429s from a model change.

**8. Cosmetic.**
- `sendLine()` says "All 2 are public"; it should say "Both are public".
- It says "can be sent to a customer" when the rep said a partner (#25).
- It says "All internal" over a single card (#11).

---

## 27 September re-run

**For Siddharth.** The same 35 questions, the same follow-up history and the same strict rubric as
the 26 Sep run below, sent to production after the answer-contract merge (the model returns a
verdict sentence + `PICKS`; SAM writes every document line from the card).

- **Tested:** 26 Sep 2026, 19:15:09 to 19:31:24 UTC (27 Sep, 00:45 to 01:01 IST). 35 `/ask` calls,
  about 28 s apart, all with `x-sam-test: 1`, plus one build probe at 19:14:20 UTC. Follow-ups carried
  the earlier turns as `history`, as before. All 35 answered on `openai/gpt-oss-120b`, no fallbacks.
  SAM event ids 1283 (probe) and 1284 to 1327.
- **Build check:** the probe "healthcare case study for a customer" put the public Zulekha Hospital
  case study first on the first try, so the newest build (local main `96bec72`, "a rep asking for
  something to send gets a sendable document") was already live.
- **Checked:** every gap and every "nothing to send" against free `/search` calls (19:33 to 19:36
  UTC).

### Headline

| | 26 Sep | 27 Sep |
|---|---|---|
| **Happy** | 11 | **16** |
| Acceptable gap (honest, request button) | 7 | **7** |
| Unsatisfying | 17 | **12** |
| False or hidden gaps (the content existed) | 5 | **3** (#3, #5, #31) |
| Verdict guard replaced the model's verdict ("Best matches in the library:") | n/a | **18 of 35** |
| Sending guard replaced the verdict with code text | n/a | 7 of 35 |
| Invented claims in document lines | 6 answers | **0** |
| Invented or contradictory claims in a verdict that was shown | (in the 6 above) | **1** (#12) |

**Happy went from 11 to 16: seven questions moved up and two moved down.** The answer contract did
what it was built for. No document line now says anything that isn't on the card, and the Citrix,
"max concurrent users" and video-description inventions of 26 Sep are gone.

**The new cost is a flat voice.** The model's verdict reached the rep in only 4 of 35 answers (#12,
and the three denials #24, 25, 26). Of the rest, 18 opened with "Best matches in the library:", 7
with the sending guard's text, and 6 with SAM's own gap or pricing text. So the verdict guard is
catching almost every verdict the model writes, not just the bad ones, and it threw away two good
ones: the SOC 2 denial (#14) and the GCC assumption the prompt asks for (#10). The reason is a
mismatch between the prompt and the guard (failure 1 below). The model is not getting more creative.

### Every question

H = happy, A = acceptable gap, U = unsatisfying. "VG" = verdict guard replaced the verdict; "SG" =
sending guard replaced it.

| # | Question | 26 Sep | 27 Sep | Why (27 Sep) |
|---|---|---|---|---|
| 1 | AE: pvt bank moving off citrix, bfsi case study i can send | U | **H** | Both public 2026 private-bank case studies, no Citrix claim. SG: "Only the public documents below can be sent". The 2021 internal BFSI Citrix proposal deck is listed first, labelled "do not send", which is useful prep. |
| 2 | AE: anything newer? | U | U | The topic is kept (walk-back works) and it re-lists the two 2026 case studies, which are already the newest. But the verdict is "No exact match for Citrix", with `missing` true and the request button, which answers a question the rep didn't ask. The turn before had shown a Citrix-titled deck. |
| 3 | AE: shorter one? 1-2 pages | U | U | Same "No exact match for Citrix" verdict. The two cards have no known page count, so nothing says whether they are short. The seed search put two results of 2 pages or fewer first (trace), but neither was shown. The 2-page *Accops Private Bank MFAZTNA Case Study* exists (internal). |
| 4 | AE: citrix battlecard for my own prep | U | **H** | The two 2024 *Accops Powered VDI vs Citrix* battlecards are 1 and 2 (filler stopwords fixed). VG. |
| 5 | AE: RBI framework, what can i send the CISO | U | U | UCB RBI 2020 (co-op banks) and BFSI 2026, both internal, with no "do not send" warning, because "send him" doesn't read as external. The public *RBI Circular (31 Dec 2019)* exists and isn't shown. VG. |
| 6 | AE: pricing for 2000 users hyworks vs citrix quote | U | **A** | "Pricing is not in the collateral library ... check with your sales manager". The 2021 calculator and the 2022 DaaS battlecard appear under "For your own reference only, not a quote", both with age warnings. `missing` is true. |
| 7 | SDR: one pager on HyID i can email | A | **U** | SG: "None of these is published ... ask marketing first", which is honest. But `missing` is false, so there is no request button and no "no public HyID one-pager". Two filler decks sit under the datasheet, one carrying time-bound discount offers. |
| 8 | SDR: pharma customer proof | H | H | City Pharmacy (public) and the single-slide library. The top slot is a private-bank bootcamp deck, which is off-topic. VG. |
| 9 | SDR: manufacturing plant VDI case study | H | H | Textile manufacturer (public) first. VG. |
| 10 | SDR: ZTNA pitch for a GCC | U | U | A 2020 outsourcing note, a Zscaler PQC note and a CIO conclave deck. The GCC ambiguity isn't named: the model's verdict was replaced (VG). The Dataquest "6,000 users in 7 countries" case study exists. |
| 11 | SDR: customer logo pack | H | H | Delighted Customers' Catalogue (Jul 2025) with "logos may be former customers". SG. |
| 12 | SDR: product video hysecure | U | U | **The only model verdict shown, and it is wrong:** "The library has internal product videos for HySecure; two can be shared". Two of the three cards are decks, all three are internal only, and the sending guard missed "shared". The Geofencing video is third; the Device posture video isn't shown. |
| 13 | SE: ISO 27001 certificate for an RFP | U | U | Unchanged: the 2013-edition certificate, no expiry warning (your 8 Sep decision). VG. |
| 14 | SE: SOC 2 type 2 report | A | **U** | The model's verdict was accurate ("a related internal auditor letter but not a full SOC 2 Type 2 report"), but VG replaced it because of the words "has a". `missing` is false, so there is no request button. The Mirox letter's title still says "Not a SOC 2 Report". An irrelevant corporate brochure is second. |
| 15 | SE: remote browser isolation brochure | U | U | Worse framing: two corporate brochures (public) under "Best matches in the library:" (VG), with no note that neither is about browser isolation. The *Virtual Browser* whitepaper (2025), the RBI eBook and the Internet Isolation one-pager exist and aren't shown. |
| 16 | SE: vmware horizon, broadcom price hike, omnissa pitch | H | H | Migration Strategy deck, then the Omnissa VVF Analysis pulled in as the newer edition, then the 2022 Broadcom battlecard. VG. |
| 17 | REG: bahasa indonesia daas brochure | A | A | "No exact match for Indonesia or Bahasa", with the button. The internal 2025 DaaS brochure is listed *above* its public 2026 successor, and a VMware migration deck fills slot 3. |
| 18 | SE: omnissa migration deck | H | H | Migration Strategy from VMware EUC first. VG. |
| 19 | SE: data residency, DaaS hosted in india, RFP | A | A | "No exact match for Data residency", with the button. The substitutes are now the *public 2026* India/Sovereign corporate brochure and DaaS V4 2026 (the successor fix). |
| 20 | SE: hysecure architecture / deployment guide | H | H | The *HySecure for ZTNA ... Reference Architectures* deck, but only third, behind two BioAuth deployment decks (wrong product). VG. |
| 21 | SE: hyworks on nutanix AHV and proxmox | U | **H** | Both entities covered: the Nutanix AHV guide (2020, age noted) and the Proxmox V2.0 deck (trust note points to the newer Oct 2025 brochure). The false gap is fixed. VG. |
| 22 | SE: hyworks sizing for 500 users | U | U | Graphics Workstation deck (2020), a Japanese Nutanix Tokyo deck and DaaS v2 2023. It never says there is no HyWorks sizing guide, and gives no button. VG. |
| 23 | SE: hysecure datasheet max concurrent users per appliance | U | U | The invented spec claim is gone. But it shows the Editions matrix, an Ecom Express "2,300 concurrent users" case study and the public HySecure Gateway datasheet, and never says that no document states a per-appliance maximum. No button. VG. |
| 24 | REG: arabic brochure for a saudi bank | A | A | "No exact Arabic brochure for a Saudi bank prospect." Substitutes are the two public Indian private-bank case studies. |
| 25 | REG: malaysia / indonesia customer reference | A | A | Honest gap and button. The substitutes are the SEA Customer Deck V2.0 (Sep 2026, internal) and an Indian DTH case study. |
| 26 | REG: APRA CPS 234 / Australian gov | U | **A** | "No exact APRA CPS 234 HySecure collateral.", `missing` true, button. The substitutes (two partner bootcamp decks) are weak but labelled. |
| 27 | REG: middle east event deck, gitex | A | A | "No exact match for GITEX", with the button. The MEA Dubai Partner Summit bootcamp and keynote are shown internal, and trust notes flag the time-bound offers and discount table. A Japanese Nutanix Tokyo deck took slot 2. |
| 28 | REG: fortinet vpn replacement pitch | H | H | The *Secure Access with Zero Trust ... Fortinet* deck first (2022, age noted). VG. |
| 29 | SE: aws workspaces vs hyworks | H | H | Why DaaS battlecard 2022 and DaaS v2 2023 (AWS pricing), both dated. SG added "ask marketing first", which is harmless. |
| 30 | AE: bhai urgent hyworks brocher bhejo customer ko | U | **H** | The public *Digital Workspace ... Brochure with Full Datasheet (V2, 2026)* first (newly carded), and the public DaaS 2026 second. SG. |
| 31 | AE: Kerala hospital, Citrix vs AVD, send CIO + my prep | U | U | **Hidden gap:** "None of these is published, so none can be sent" (SG), yet the public *Zulekha Hospital* case study exists and was in the pool. The prep side is fine: Healthcare deck 2021, and VDI vs the Field 2022 with AVD. |
| 32 | SDR: pharma case study I can send | H | H | City Pharmacy (public) first. Two Japan bootcamp decks fill slots 2 and 3. |
| 33 | SDR: what about hospitals? | H | H | Zulekha Hospital (public) first; the follow-up kept its context. VG. |
| 34 | SE: hysecure demo video | U | **H** | The Geofencing and Device posture demo videos, each "Filed under Videos/Demo Videos/Revised; SAM has not read this one". This is honest and they are the right files. A Japanese deck is third. VG. |
| 35 | SE: cisco anyconnect replacement | H | H | The HySecure vs Cisco AnyConnect battlecard (2021) is third, behind the ZTNA Gateway deck (names Cisco) and the ZPA comparison. VG. |

**Moved up (7):** #1, 4, 6, 21, 26, 30, 34. **Moved down (2):** #7 and #14. Both went from A to U
because an honest "we don't have it" lost its request button. All eleven 26 Sep happy answers stayed
happy. Two answers kept their grade but got better: #19 (the public 2026 substitutes) and #23 (no
invented spec any more).

### What improved, and why

- **The answer contract** (`finish()` / `answerText()` / `assetLine()` in `web/lib/agent.ts`): no
  invented coverage in any document line (#1, 2, 3, 12, 23, 31 were the 26 Sep cases). Uncarded
  videos say "SAM has not read this one" (#34, #12).
- **Filler and Hinglish stopwords** (`cards.ts`): "citrix battlecard for my own prep before the call
  tmrw" returns the 2024 battlecards (#4).
- **Entity coverage** (`coverEntities`): Proxmox gets its own result next to Nutanix (#21).
- **`missing` for named entities:** APRA (#26), GITEX (#27), Bahasa (#17) and data residency (#19)
  are honest gaps with the button.
- **Pricing guard** (`isPriceList`, `priceReferences`, `NO_PRICING`): the calculator is "for your own
  reference only, not a quote", with the sales-manager line (#6).
- **Newly carded public documents:** the Digital Workspace Brochure V2 2026 answers the Hinglish ask
  (#30), and the 2026 corporate brochures are the data-residency substitutes (#19).
- **Newer editions pulled in** (`withSuccessors`): the Omnissa VVF Analysis (#16) and DaaS V4 2026
  (#19, 30).
- **Walk-back follow-ups** (`searchText`): the second follow-up (#3) now searches with the bank
  question. The verdict still fails there (item 5 below).

### What still fails, ranked by how often a rep would hit it

**1. The prompt and the verdict guard contradict each other, so 25 of 35 verdicts are thrown away
(every answer).**
- **Repro:** any find ask, e.g. "manufacturing plant VDI case study".
  - The model writes "The library includes relevant manufacturing VDI case studies and they can be
    sent."
  - Trace: `verdict guard: replaced :: says what a document covers ("includes")`.
  - The rep sees "Best matches in the library:".
- **Cause:** `SYSTEM` in `web/lib/agent.ts` (lines 42-43) asks for a verdict on "does the library
  have what was asked for, how many picks, and can they be sent". The model answers with "The
  library includes / contains / has a ...", and those words are in the `COVERAGE` regex
  (`verdictProblem`, line 348). "sent" is not in `ANSWER_WORDS` (line 371), so "can be sent"
  fails as an unknown word too (#4, 5, 15, 23, 28).
- **Cost:**
  - Most answers read flat.
  - Good verdicts are lost: the SOC 2 denial (#14) and the GCC assumption the prompt itself asks for
    (#10).
- **Fix direction, either of:**
  - Give the model a closed template ("Yes, N close matches." / "No exact <X>."), add "sent" to
    `ANSWER_WORDS`, and drop the sendability question from the prompt. SAM already writes
    visibility on every line.
  - Or have SAM write the verdict itself from `missing`, the count and visibility.

**2. The model says "can be sent / shared" regardless of visibility, and the guard misses
"shared" and "sent" (at least 26 of the 35 model verdicts say it; one got through).**
- **Repro:** "product video hysecure".
  - **What came back:** "The library has internal product videos for HySecure; two can be shared."
  - All three cards are internal only, and two are decks, not videos.
- **Cause:** `SEND_WORDS` in `agent.ts` (line 656) is
  `send(ing)?|shar(e|ing)|...`. It matches neither "shared" nor "sent", so `guardVerdict` doesn't
  fire. `verdictProblem` passes the sentence because every word is in `ANSWER_WORDS` ("shared",
  "internal", "videos", "product").
- **Fix:** `send|sent|sending|shar(e|ed|es|ing)`. With that change, #12 gets the sending guard's
  text.

**3. A named product or topic that no shown card is about still gets no gap and no button (#15, 22,
23, 7; about 1 in 7 asks).**
- **Repro:** "remote browser isolation brochure".
  - **What came back:** two corporate brochures, `missing` false. Neither is about browser
    isolation, and the Virtual Browser whitepaper (2025) is never shown.
- **Other repros:**
  - "hyworks sizing for 500 concurrent users, server specs?": the Graphics Workstation deck passes
    the `SPECS` "Sizing" check because it is about VDI.
  - "hysecure datasheet specs - max concurrent users per appliance": the Ecom Express case study
    satisfies "Concurrent users".
- **Cause:** `asksAbout()` in `agent.ts` drops `OWN_PRODUCTS`, so a named Accops product (Browser
  Isolation) is never checked with `isAbout()`. `typeMissing()` is satisfied because the brochures
  are brochures. `hasEntity()` accepts any card that mentions a spec word.
- **Fix direction:**
  - When the rep names a product, and no shown card `isAbout` it while a result that is about it
    exists, swap that result in.
  - If none exists, set `missing`.
- **#7:** when the ask is external and no shown card is public, `finish()` returns
  `done(final, notes, shown, false)`. `missing` should be true there, so the request button shows.

**4. A sendable public document is in the pool but isn't shown, and the answer says nothing can be
sent (#31, #5).**
- **Repro:** the Kerala hospital paragraph (#31).
  - **What came back:** "None of these is published, so none can be sent outside Accops".
  - **What exists:** the public *Zulekha Hospital* case study, returned by `/search "hospital case
    study"` and pulled into the pool by `seedSearch`'s `pub` slot.
  - **Cause:** `ensurePublished()` (agent.ts line 642) gates on
    `heuristicFilters(question).audience === "external"`. That is "internal" because the ask
    also says "my own", even though `EXTERNAL` matches "send the CIO". Gate it on
    `EXTERNAL.test(question.toLowerCase())`, as `seedSearch` does.
- **Repro:** "CISO at the bank asked ... what can i send him" (#5).
  - **Cause:** `EXTERNAL` (line 101) lists them / customer / cio but not him or her, so the ask
    reads as internal. The public RBI circular is never promoted, and the lines carry no "do not
    send".
  - **Fix:** add `him|her` to the object list.

**5. On a follow-up, the named-entity check fires on the walked-back question (#2, #3).**
- **Repro:** the bank question, then "anything newer?", then "shorter one? something 1-2 pages".
  - **What came back:** both follow-ups get "No exact match for Citrix", with `missing` true and the
    request button.
  - **What should happen:** "these two (2026) are the newest" for the first, and the 2-page Private
    Bank MFA-ZTNA case study (internal) or "no public 1-2 page one" for the second.
- **Cause:** `finish()` gets `searchText()`'s joined question, so `coverEntities()` /
  `asksAbout()` re-check Citrix, restricted to the Case Study type. On the first turn the model had
  covered Citrix with the internal BFSI deck.
- **Also:** the short results `seedSearch` puts first are not favoured when the model picks.
- **Fix:** run the entity and type checks on the rep's current question. Use the joined text for
  search only.

**6. Off-topic filler in slots 2-3 (#8, 17, 20, 22, 27, 32, 34; about 1 in 5).**
- **Examples:**
  - A private-bank bootcamp for "pharma customer proof".
  - BioAuth deployment decks above the HySecure architecture deck.
  - The Japanese Nutanix .NEXT Tokyo deck in sizing, GITEX and demo-video answers.
- **Cause:** on the non-denial path the model's picks are accepted with no relevance floor.
  `substituteFits` is only used for denials. `withSuccessors()` can also swap a weak pick for its
  successor, which is just as off-topic: for #17, the 2018 VMware brochure became the Migration
  Strategy deck.
- **Fix:** apply `substituteFits` (or `isAbout` for a named product) to the non-denial picks, and
  back-fill from `hits`.

**7. When an old edition and its successor are both shown, the old one can come first (#17).**
- **What came back:** *DaaS Brochure (2025)*, internal, with "a newer edition exists - prefer that
  one", is listed above the public *DaaS ... ZTNA and MFA Built In* (2026).
- **Cause:** `withSuccessors()` (agent.ts line 394) only reorders when it adds the successor itself.
  When both were already picked, the old one keeps its place.
- **Fix:** move the successor ahead, or drop the superseded one.

**8. The ISO 27001 certificate (#13): unchanged, your decision (see "Decision for you" below).**

---

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
