# SAM eval set

**Purpose.** Design phase 1 sets an exit criterion of **hit@3 >= 85%**. Without a fixed question set,
"is SAM good?" is an opinion and every ranking change is unmeasurable. This is the number to show a
manager instead of a demo that happened to go well.

**Status: DRAFT, needs Siddharth.** 14 of these are real queries pulled from `sam_events` - things
actually asked of the deployed system. The rest are written to cover content the registry made
reachable on 6 September (552 decks, 37 competitive assets) that nobody has had the chance to ask
for yet. **Every question marked `[invented]` needs replacing with something sales genuinely asks**,
or SAM gets graded against a fiction and the 85% means nothing.

How to use it: replace the invented ones, fill in `expect`, then run
`node prototype/eval.mjs` (see below).

---

## What "hit@3" means here

SAM returns at most three assets. A question is a **hit** if at least one of the three is an asset a
rep would actually have sent. Not "the single best one ranked first" - a rep reads three cards and
picks. Ranking beyond that is a refinement, and measuring it now would over-fit to 66 documents.

Three question types, scored differently:

| Type | Hit means |
|---|---|
| `find` | one of the three results is a genuinely useful asset |
| `gap` | SAM says it does not have this, **without inventing something** |
| `external` | every returned asset has a public link, or SAM says none can be sent |

`gap` questions matter as much as `find`. A tool that answers everything confidently is worse than
one that admits a hole, because a rep only has to be embarrassed once.

---

## The questions

`expect` is a substring that should appear in the title of at least one returned asset. Leave it
empty and the scorer will report the question as unscored rather than guessing.

| # | Question | Type | Expect | Source |
|---|---|---|---|---|
| 1 | A bank is replacing Citrix and wants a proof point on RBI compliance. What should I send? | find | | **real** (asked 4x) |
| 2 | BFSI case study I can send to a customer | external | | **real** (asked 3x) |
| 3 | do we have a pharma ZTNA case study? | find | | **real** (asked 2x) |
| 4 | I need the competitor battlecard against Citrix for a deck | find | Citrix | **real** (asked 4x) |
| 5 | public sector bank case study | find | | **real** (asked 2x) |
| 6 | Bank Case Study | find | | **real** (WhatsApp) |
| 7 | do we have a media industry ZTNA whitepaper? | gap | | **real** |
| 8 | something I can send to a government CIO about VDI | external | | **real** |
| 9 | ZTNA whitepaper for pharma | find | ZTNA | **real** |
| 10 | pharma ZTNA whitepaper | find | ZTNA | **real** |
| 11 | Which deck compares us to Omnissa? | find | Omnissa | [invented] |
| 12 | VMware Horizon migration deck | find | VMware | [invented] |
| 13 | Do we have anything on Forcepoint? | find | Forcepoint | [invented] |
| 14 | Accops vs Citrix comparison | find | Citrix | [invented] |
| 15 | Nutanix joint solution material | find | Nutanix | [invented] |
| 16 | manufacturing case study | find | | [invented] |
| 17 | government defence brochure | find | | [invented] |
| 18 | MFA case study for a bank | find | | [invented] |
| 19 | HySecure datasheet | find | HySecure | [invented] |
| 20 | HyID datasheet latest version | find | HyID | [invented] |
| 21 | DaaS brochure | find | DaaS | [invented] |
| 22 | Gartner report mentioning Accops | find | Gartner | [invented] |
| 23 | ISO certificate | find | ISO | [invented] |
| 24 | partner bootcamp deck | find | bootcamp | [invented] |
| 25 | something for a CISO event | find | | [invented] |
| 26 | pricing for HyWorks | gap | | [invented] |
| 27 | telecom case study | gap | | [invented] |
| 28 | do we have a SOC 2 report? | gap | | [invented] |
| 29 | case study I can email a prospect today | external | | [invented] |
| 30 | healthcare case study for a customer | external | | [invented] |

**Questions 11 to 15 matter most for the demo.** Those are the competitive assets that did not exist
in SAM's answers before 6 September - the gap named at the very top of the SharePoint task document.
If any of them miss, the registry join is not delivering what it promised.

---

## Running it

```
node prototype/eval.mjs                    # against production, needs SAM_API_TOKEN
node prototype/eval.mjs --base http://localhost:3000
```

It prints per-question pass/fail and the hit@3 rate, and exits non-zero below 85% so it can gate a
deploy later.

## What it does not measure

- **Answer quality.** Whether the prose around the three assets is any good. That needs a human.
- **Ranking order** within the three, deliberately - see above.
- **Freshness.** A hit on a 2021 case study still counts. P1.1 publication dates change that.
- **Whether the asset is actually right for the customer.** A rep still has to read it.
