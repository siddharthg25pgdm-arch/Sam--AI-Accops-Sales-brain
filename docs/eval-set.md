# SAM eval set

**Purpose.** Design phase 1 sets an exit criterion of **hit@3 >= 85%**. Without a fixed question set,
"is SAM good?" is an opinion and every ranking change is unmeasurable. This is the number to show a
manager instead of a demo that happened to go well.

**Status: usable now, better later.** 10 questions are **real** - pulled from `sam_events`, actually
asked of the deployed system. 20 are **modelled**: written from how a rep uses a search tool mid-deal
and checked against what the corpus holds, so each is answerable in principle rather than arbitrary.

That is good enough to catch regressions and to show a manager a number today. It is not a substitute
for real questions, and the honest way to get those is to let `sam_events` fill up rather than to
invent more - see "Trusting this number" below.

Run it with `node prototype/eval.mjs`.

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

`expect` is a substring that should appear in the title of at least one returned asset.

**How these were written.** Not from a list of topics - from what a rep is *doing* when they open
SAM. Nobody browses a collateral library for pleasure; they are mid-deal under one of five
pressures: a customer just objected, a meeting is in an hour, a prospect wants proof, something has
to go outside the company, or they are checking whether the thing exists at all.

They are also deliberately **scruffy**. A rep types "citrix comparison" from a phone between
meetings, not "Which competitive deck compares Accops to Citrix?". Grading against polished queries
flatters the tool, because polished queries are the easy ones. Roughly a third are lowercase
fragments on purpose.

Source column: **real** = pulled from `sam_events`, something actually asked of the deployed system.
**modelled** = written from the rep-pressure frame above and checked against what the corpus
contains, so the question is answerable in principle. Modelled is not the same as real - see the
note under "Trusting this number".

| # | Question | Type | Expect | Source |
|---|---|---|---|---|
| 1 | A bank is replacing Citrix and wants a proof point on RBI compliance. What should I send? | find | | real, asked 4x |
| 2 | BFSI case study I can send to a customer | external | | real, asked 3x |
| 3 | do we have a pharma ZTNA case study? | find | ZTNA | real, asked 2x |
| 4 | I need the competitor battlecard against Citrix for a deck | find | Citrix | real, asked 4x |
| 5 | public sector bank case study | find | Bank | real, asked 2x |
| 6 | Bank Case Study | find | Bank | real, WhatsApp |
| 7 | do we have a media industry ZTNA whitepaper? | gap | | real |
| 8 | something I can send to a government CIO about VDI | external | | real |
| 9 | ZTNA whitepaper for pharma | find | ZTNA | real |
| 10 | pharma ZTNA whitepaper | find | ZTNA | real |
| 11 | citrix comparison | find | Citrix | modelled: objection, typed short |
| 12 | customer is on vmware horizon, what do we have | find | VMware | modelled: objection |
| 13 | omnissa | find | Omnissa | modelled: one-word, mid-call |
| 14 | forcepoint competitive | find | Forcepoint | modelled: objection |
| 15 | nutanix deck | find | Nutanix | modelled: partner deal |
| 16 | hysecure datasheet | find | HySecure | modelled: prospect asked for specs |
| 17 | latest hyid datasheet | find | HyID | modelled: "latest" is the real ask |
| 18 | daas brochure | find | DaaS | modelled: pre-meeting |
| 19 | defence brochure | find | Defence | modelled: vertical deal |
| 20 | govt solutions deck | find | Govt | modelled: vertical deal |
| 21 | gartner | find | Gartner | modelled: credibility proof |
| 22 | iso certificate for a security questionnaire | find | ISO | modelled: procurement asked |
| 23 | proxmox | find | Proxmox | modelled: newer product, one word |
| 24 | virtual browser | find | Browser | modelled: product by description |
| 25 | deck for a CISO event next week | find | | modelled: meeting in an hour |
| 26 | what does hyworks cost | gap | | modelled: pricing is not in the library |
| 27 | telecom case study | gap | | modelled: vertical we have nothing in |
| 28 | do we have a SOC 2 report | gap | | modelled: procurement asks, we lack it |
| 29 | case study I can email a prospect today | external | | modelled: the send-it case |
| 30 | healthcare case study for a customer | external | | modelled: the send-it case |

**Questions 11-15 matter most for the demo.** Those are the competitive assets that did not exist in
SAM's answers before the registry join on 6 September - the gap named at the top of the SharePoint
task document. As of 7 September all five pass.

**Questions 26-28 are the honest ones.** SAM currently returns three assets for each instead of
admitting it has nothing. Pricing genuinely is not in the library, and there is no SOC 2 report. A
tool that answers everything confidently is worse than one that says no, because a rep only has to
forward the wrong thing once.

### Trusting this number

**Modelled questions are a floor, not a substitute.** They were written by reasoning about how reps
work and checked against what the corpus holds - so they are answerable and not arbitrary - but they
still encode an assumption about what gets asked. A real question set would include the awkward
things nobody predicts: half-remembered filenames, a customer's name instead of a vertical, "the one
Sandip showed last quarter". Those are where a search tool actually fails.

The practical fix is not to rewrite this list from imagination. It is to **let the log fill up**.
Every question a rep types is recorded in `sam_events`, and the gap worklist on the dashboard ranks
what went unanswered. After a few weeks of real use, replace the modelled rows with the ten most
common real ones and the number means something without anybody having to invent it.

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
