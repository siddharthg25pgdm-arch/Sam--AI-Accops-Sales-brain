# SAM: what is built, and what is left

> **Starting a new session?** Read [HANDOVER.md](HANDOVER.md) first - it has the current state,
> what is blocked, and a prompt to paste.

**Written:** 6 September 2026, after the SharePoint registry landed.
**Live:** https://sam-accops.vercel.app
**Purpose:** one place that answers "what is actually done?" without reading six documents. Verified
against the deployed app and the database on the date above, not copied from the design doc's plan.

---

## The one-line answer

**Every channel Siddharth asked about already exists and works.** Chatbot, WhatsApp, REST API and MCP
are live today. Teams is the only unbuilt one.

The real gap is not channels. It is that **the channels answer from the wrong corpus.** SAM has two
disconnected sets of knowledge, and the good one is not plugged in.

---

## 1. The corpus split, which is the thing that matters most

| | 77 asset cards | 874 registry rows |
|---|---|---|
| Where | `web/data/asset_cards.json` | Supabase `sam_sharepoint_files` |
| Source | Frozen copy of Siddharth's laptop, hand-carded | Live SharePoint, seeded 6 Sep, kept current by the flow |
| Content | Rich: `brief`, `key_problem`, `key_outcomes`, `use_for` | Filename, folder, tags, size, dates - **no document text** |
| Links | 71 constructed URLs, all 404 (suppressed since 4 Sep) | Real Graph `webUrl`, **12/12 verified to resolve** |
| Dates | **0 of 77** have a publication date | Created + modified, from Graph |
| Public URLs | **0 of 77** | n/a |
| Decks | **0** | **552** (308 ingestable) |
| Competitive assets | **0** | **37** (33 ingestable) |
| Who reads it | `web/lib/cards.ts` -> every channel | `registry()`, called by **one health-check cron only** |

`registry()` has exactly one caller: `web/app/api/cron/sharepoint/route.ts`. The agent never sees it.

**So when a rep asks "which deck has the Citrix comparison?", SAM still says it has no decks** - while
552 of them sit tagged and linkable in a table it does not read.

Joining these two is the highest-leverage work left. Everything else is smaller.

---

## 2. Built and verified working

Probed live on 6 September 2026.

| Thing | Status | Evidence |
|---|---|---|
| Web chat + faceted catalogue | Live | `/` returns 307 to login, as designed |
| Admin dashboard | Live | reads `sam_events` |
| REST API `/api/v1/*` | Live, auth enforced | search, assets, gaps, ask, context, public-link all 401 without a token |
| MCP server `/api/mcp` | Live, auth enforced | 401 without a token; read-only tools |
| WhatsApp channel | Live, tested with a real message | 403 on unsigned request; signature check working |
| Analytics | **Persisting** | 26 rows in `sam_events`, 21 queries, 2 users, 2 channels |
| SharePoint registry | **874 rows, verified** | 0 null/wrong-host URLs, 12/12 resolve through Graph |
| SharePoint change webhook | Live, secret enforced | 401 unsigned, 202 signed |
| Power Automate "changed" flow | **Started** | `75e43d49-a5ba-4acd-878c-f710617dfdae` |
| Power Automate "deleted" flow | Created, stopped | `a93e1937-1ac9-46c7-9145-a706fc79e840` |
| Deduplication | Working | 74 entries collapse to 66 real documents |
| Honest gap handling | Working | fixed 4 Sep after the false-gap defect |

---

## 3. What is left

Ordered by what unblocks the most. Effort is rough and assumes one working session unless stated.

### P0 - Join the registry to the agent - DONE 6 September 2026

**Live in production.** `/api/cron/sharepoint` now reports it:

```
tracked            : 874     rows in the registry
answerable         : 696     what SAM can actually talk about
answerable_with_link: 630     was 0
decks              : 552     was 0
competitive        :  37     was 0
```

"Accops vs Citrix" returns three competitive assets, all with working links - the question this
project's task document opens with, and one the 77-card corpus could not answer at all.

How it was done, and the trade-off taken. `allAssets()`, `searchAssets()`, `facetCounts()` and
`coverageGaps()` are synchronous and 25 call sites across four channels depend on that; Supabase is
async. `web/lib/registry-cache.ts` holds the projected rows and refreshes on a 5-minute TTL, so the
read path stays synchronous and no caller changed. The cost is that a cold start sees cards only for
one request - invisible for a search tool, and `/api/ask` awaits `ready()` so the first real question
never hits it. A failed refresh keeps the previous contents rather than emptying the catalogue.

Merging beat picking a winner. `richness()` already prefers the hand-card, which is correct, but the
card's `sharepoint_url` is one of the 71 constructed links that 404. So when a card and a registry row
are the same document the card wins **and the registry's verified link and dates are grafted onto it**.
`verified()` tests for the real tenant, so a constructed URL can never overwrite a real one.

Because every channel converges on `cards.ts`, web chat, WhatsApp, REST and MCP all gained this at
once. No channel code was touched.

- [x] **P0.1 Make the agent read `sam_sharepoint_files`.** Merge registry rows into the card set at
      query time, keyed by filename. A registry row with no card still answers "this exists, here is
      the link, here is the folder" - which is most of what a rep needs.

      **Scope, measured rather than guessed.** `cards.ts` line 1 is
      `import raw from "@/data/asset_cards.json"` and `allAssets()` is **synchronous** with a
      module-level cache; `searchAssets()`, `facetCounts()` and `coverageGaps()` are sync too.
      Supabase reads are async, so this is not a one-line swap - it needs a warm-cache pattern
      (load once on first request, refresh on a TTL) or those functions go async and **25 call sites
      across 5 files** follow: `page.tsx`, `agent.ts`, `agent-openai.ts`, `api.ts`, `cards.ts`.
      Warm cache is the smaller change and fits Vercel's model. *One session.*
- [x] **P0.2 Prefer the verified `web_url` in `assetLink()`.** Done - and `safeLink()` rewrites
      `action=edit` to `action=default`, so a forwarded `.pptx` no longer opens an editing surface for
      the customer. 0 edit-links remain.
      This is what section 8a asked for: a SharePoint URL is handed out only when Graph produced it,
      never when it was constructed. Provenance is the test - the registry writes the real tenant, so
      `propalmsnetwork.sharepoint.com` proves the link is a fact rather than a guess.
- [ ] **P0.3 Retire the 71 dead constructed URLs** from `asset_cards.json`. Now cosmetic rather than
      urgent: `verified()` means they can never be handed out, and where a registry row exists for the
      same document the real link already wins. Worth doing so the field stops holding a lie.

### P1 - Make answers trustworthy

- [~] **P1.1 Publication dates - done for the 34 carded assets, 8 September 2026.** Every card
      carries `publish_year` read from the DOCUMENT BODY, which is the distinction this item was
      always about and which the corpus immediately vindicated: `2026-06-11-Accops vs other VDI
      providers.pptx` is dated 29 NOV 2022 on its own title slide. Still open for the ~840 uncarded
      files, which have only `created_at` / `modified_at`. Original scope: **P1.1 Publication dates.** 0 of 77 cards have one, so SAM cannot warn that a case study is
      three years old. `modified_at` is not the same thing - a file touched last week can hold 2022
      content. Needs the date read out of the document text. *This is the trust feature: one stale
      asset sent to a customer costs more than ten missing ones.*
- [x] **P1.2 Freshness - DONE 8 September 2026, and it became a trust note rather than a badge.**
      `trustNote()` in `cards.ts` returns the single most important reason to hesitate, because age
      turned out to be the *least* useful of the three things carding found:
      1. **Expired** beats everything, where a card sets it. The ISO 27001 certificate was the
         original case; the warning on that one specific card was removed on 8 September at
         Siddharth's instruction, but the mechanism stands for anything else that expires.
      2. **A newer edition exists** - five of the nine brochures are superseded by public 2026
         versions, so "the latest HySecure datasheet" has a right answer and a wrong one.
      3. Otherwise the age note, and only where a year was read from the document.

      It reaches every channel *and the model*: `stale: true` could not distinguish an old but usable
      whitepaper from an expired certificate, and only one of those must never reach procurement.
- [x] **P1.3 Public links - 11 done 7 Sep, 11 need a human.** Was 0 of 66 sendable; now 11 assets
      carry a live accops.com URL and `visibility: both`. "BFSI case study I can send to a
      customer" - the exact query that logged a false gap on 4 Sep - returns three real answers.
      `prototype/sp_match_public.py` does the matching and is re-runnable as more pages publish.

      **The near-miss worth remembering.** The first run reported 31 confident matches and most
      were wrong: seven different whitepapers all matched a page whose slug is just `ztna`, each
      scoring a perfect 1.00. Overlap-over-`min()` gives full marks whenever a one-token slug
      shares its only word, so category landing pages outscored every real document. Fixed by
      excluding one-and-two-word generic slugs and requiring two shared tokens. **A confidence
      score is not evidence** - the wrong matches were the most confident ones.

      **Still needs Siddharth:** 11 ambiguous matches, all anonymised bank case studies against
      anonymised page titles ("3rd largest Public Bank" vs "India's Largest Private Bank").
      Run `python prototype/sp_match_public.py` to see them. Deliberately not guessed - a wrong
      public link sends a customer to another company's case study. Original scope: **0 of 66 assets can be sent to a customer today.** Every
      `public_url` is empty, which is why `audience=external` produced a false gap on 4 Sep.
      **Unblocked 6 Sep:** match SAM's assets to accops.com pages by title from
      `case-studies-sitemap.xml` (37), `ebooks-sitemap.xml` (4), `solution-documents-sitemap.xml` (9)
      and `webinars-sitemap.xml` (18), and fill `public_url`. Page first, bucket PDF if one is ever
      confirmed. Approver is Siddharth.
- [ ] **P1.4 Consume the feedback thumbs.** They are collected and stored; nothing reads them. 0 rows
      so far, so this waits until there is traffic.

### P2 - Carding the real corpus

This is where the 413 ingestable files become answerable, not just findable.

- [x] **P2.1 Card a pilot - DONE 8 September 2026, and it was 27 documents rather than 10.**
      All of `docs/demo-corpus.md` is carded: 34 cards across `corpus/cards/batch-01..05.json`, up
      from 7. Both section 4 refinements were applied while carding rather than retrofitted -
      `client_actual` is a separate field from the descriptive `client`, and `model_visible` names
      the lean projection Groq sees.

      **The comparison ran and caught the generated cards, not the hand ones.** Four outcomes the
      documents plainly support had been dropped: automated vendor onboarding/offboarding and RBI
      mandate compliance from the BFSI card, the 40,000 work-from-home total and the Accops L2/L3
      managed service from the private bank card. Fixed, and the gate is now re-runnable as
      `prototype/compare_cards.py`. It checks `asset_type` as well as similarity, because
      overlap-over-`min()` scores a brochure 1.00 against a case study for the same product - the
      identical trap `sp_match_public.py` fell into with 31 confident wrong matches.

      **Three findings from reading the documents, each of which changes an answer:**
      - The **ISO 27001 certificate on file states validity to 20 September 2024.** Warned on
        initially; warning **removed 8 September on Siddharth's instruction** - not sales-critical in
        his view. The dates stay in the card's outcomes and brief. Fixing this also exposed that
        the age rule was being applied to a certificate ("check it still reflects the product",
        which is meaningless for a dated record) - certifications, awards and analyst reports are
        now exempt from it, and those three cards had been mis-typed as "Other".
      - The **2025 Gartner MQ** places Accops as a **Niche Player** and names a Caution that Accops
        holds ISO 27001 and no other compliance certificates. That is the sourced answer to eval Q28,
        "do we have a SOC 2 report?" - the answer is no, and it is now citable.
      - `2026-06-11-Accops vs other VDI providers.pptx` is **dated 29 NOV 2022 on its own title
        slide**. The filename date is a SharePoint touch, not a content date. This is P1.1's argument
        in one file, and `docs/demo-corpus.md` had picked it as "most recent" on the filename alone.

      Five of the nine brochures are superseded by newer public editions, so each card carries
      `superseded_by`. Every such claim is checked against `corpus/public/` rather than asserted; the
      check caught one that was wrong.
- [x] **P2.1a Load the cards into SAM - DONE 8 September 2026. Eval 86% -> 89%.**
      `sam_asset_cards` (schema in `docs/supabase-sam-asset-cards.sql`), loaded by
      `prototype/load_cards.py`, read through `web/lib/cards-cache.ts` and merged in `allAssets()`.
      Live in production with all 34 cards; `/api/cron/sharepoint` reports `cards_cache` so an empty
      one is visible rather than silently degrading every answer.

      **Two provenance bugs the merge exposed**, both the same shape as the constructed-URL problem
      `verified()` already solved:
      - `winner.year ?? other.year` let a **guess beat a fact**. A registry year is inferred from the
        filename and is *always* set, so it won whenever the registry row won on richness - reporting
        2026 for a deck dated 29 NOV 2022 on its own title slide. The carded year now wins outright.
      - The provenance test itself sniffed the path prefix, but the merge deliberately **rewrites**
        `file.path` to the registry's real folder (so a rep is told "Competition/VDI and DaaS" rather
        than "in sharepoint"). A test reading that string stops being true the moment it is rewritten.
        Explicit `carded` flag instead, set once at projection.

      **The column split was dropped**, superseding section 4's refinement 1: Siddharth's call, on the
      grounds that SAM is an internal tool and `key_problem` / `key_outcomes` / `client` are not
      confidential in that context. `client_actual` is still never selected into `CardRow` at all -
      not selecting a column is a stronger guarantee than remembering to strip it.
- [ ] **P2.1b Verify the production model honours `trust`.** The retrieval side is verified end to end
      locally (a supersession warning reaches the answer payload), but the local
      runtime has no model key and falls back to retrieval-only, so **the system-prompt changes have
      not been exercised against a real model**. Needs a production `SAM_API_TOKENS` value to test.
      Ask SAM for the ISO certificate and check the answer says it has expired instead of offering it.
- [ ] **P2.2 Bulk-card the remaining ~386.** Report cost and timing first. SAM never downloads file content:
      Siddharth downloads, Claude Enterprise cards, only the card reaches Supabase. See "the carding
      boundary" in section 4 - including the two refinements (split the card by audience; write
      `client_actual` separately) that should be applied **while** carding, not retrofitted.
- [ ] **P2.3 Flag scanned PDFs** that extract nothing rather than indexing an empty document.

### P3 - Channels

- [ ] **P3.1 Teams bot.** The only channel from the design that does not exist. Azure Bot Service +
      Bot Framework, Entra auth is inherent, Adaptive Cards for follow-ups. Section 6 calls Teams
      "sales' home", so this is likely the highest-value channel left. **Needs an Azure Bot
      registration - the one item here that may involve IT.** *One to two sessions.*
- [ ] **P3.2 OAuth for the MCP server** if SAM should appear in claude.ai's connector UI. Claude Code,
      the Dwight extension and scripts already work with the bearer token; this is only for
      claude.ai. *Skip unless wanted.*

### P4 - Operational safety

- [ ] **P4.1 Confirm the flows fire.** *Blocked 6 September: Siddharth has **view-only** access to
      Sales Collateral and cannot create, edit or delete a file there.*

      **This does not break the flows.** They run on his connection and only need **read** to watch
      the library - which is exactly what a tracker should need, and it is a point in favour of the
      design rather than against it. What it blocks is only his ability to *trigger* a test himself.

      **The flows will most likely validate themselves.** The trigger fires on anyone's change, and
      the registry shows the library is actively edited by others - SANDIP MALLIK and Samhita TV
      account for most recent modifications. So a real change should arrive on its own within days.
      That makes a **monitoring check more useful than a manual test**, and it is built: see P4.1a.

      Baseline for whenever it fires: **874 rows, 0 with `list_item_id`, 0 tombstoned.** The first
      real notification moves `list_item_id` off zero, which is the unambiguous signal.

      Two ways to unblock a deliberate test, in order of preference: ask whoever owns the library for
      edit rights on **one** throwaway subfolder, or have a colleague who already has edit rights
      re-save any file while Siddharth watches the run history.
- [x] **P4.1a Flow-health check - DONE, then corrected.** `flow_proven` on `list_item_id` broke the
      moment the backfill populated all 874 - it reported the backfill, not a notification. Replaced
      with `flow_last_write`, which reads `last_synced`; only `applyChange` sets that to now(). A
      signal that turns true for the wrong reason is worse than no signal. Original scope: Report whether the flows have ever fired, and how recently, so a
      silent failure is visible without anyone remembering to look. Folded into
      `/api/cron/sharepoint`.
- [x] **P4.2 Cron added 8 September 2026 - `web/vercel.json`, 02:30 UTC daily.**
      Placed in `web/` because that is Vercel's root directory here (there is no root
      `package.json`). Daily, so it is within the Hobby one-per-day limit.

      **Be exact about what it buys.** This endpoint REPORTS. It surfaces a flow that has stopped
      writing and a reconcile that has not run. It does **not** catch deletions - that needs
      `sp_reconcile.py`, which is blocked by Conditional Access. A green cron here does not mean
      deletions are handled, and reading it that way is the false comfort this project has been
      caught by four times. Said so at the route, since `vercel.json` takes no comments.

      **Needs Siddharth:** add `CRON_SECRET` to the Vercel project (value in the session notes).
      Vercel then sends it as `Authorization: Bearer <value>` automatically. Until it is set the
      endpoint stays publicly readable - aggregate counts only, no filenames or customer data, but
      still open. Original scope: **P4.2 Add `vercel.json` with a cron.** `/api/cron/sharepoint` works and returns real data
      (`tracked: 874, untagged: 0`) but **nothing calls it**. An unscheduled health check catches
      nothing.
- [ ] **P4.3 Periodic re-seed** as the reconcile backstop: `sp_discover.py` +
      `sp_seed_registry.py --write`. Both run on the delegated Azure CLI login, so no IT approval.
- [ ] **P4.4 Two WhatsApp expiries, both silent failures.** Access token **3 November 2026**, test
      number **early December 2026**. See `TASK-whatsapp-meta-setup.md`.

### P6 - Platform completeness, independent of corpus size

Added 6 September 2026 after Siddharth reframed the priority: **build the platform fully on a small
sample, demo it, then ingest.** Everything here is worth doing with 20 files and is not made easier by
having 874. Corpus work (P2) is explicitly deferred behind this.

The architecture makes this cheap. `web/lib/api.ts` is 87 lines and every channel converges there -
web chat, WhatsApp, REST and MCP all call `apiSearch` / `apiAsk`. Fix something below and all four
inherit it at once.

- [ ] **P6.1 The trace panel.** Design section 6 promises "rich cards, citations, trace panel
      (Perplexity/Grok style)". `apiAsk` already **returns** `trace`, and `web/app/page.tsx` never
      renders it - zero references. This is the single most demo-visible gap: a manager watching SAM
      answer cannot see *why* it picked those three assets. Backend already done; this is UI only.
      *Half a session, high demo value.*
- [x] **P6.2 `request_publish` - DONE 7 Sep.** `sam_publish_requests` table, `POST
      /api/v1/request-publish` (405 on GET, since a write route triggerable by a link preview is
      not a route), an MCP tool, and an approver panel that shows first on the admin page when
      non-empty. The MCP tool is the only one with `readOnlyHint: false` - clients use that to
      decide what needs confirming, and a write marked read-only would let an agent file requests
      on someone's behalf. A unique partial index on `lower(asset_title) where status='open'`
      merges repeat asks onto one row; the 409 is reported to the rep as success, because the
      request does exist. Original scope: `apiPublicLink` returns `can_request_publish: true`, but no
      tool or route exists to file one. A rep is told they may ask and then given no way to ask - a
      dead end in the API surface. Needs a `sam_publish_requests` table, a REST route, an MCP tool and
      a queue on the admin page. Approver is Siddharth (settled). *One session.*
- [ ] **P6.3 Feedback loop closure.** Thumbs are collected and stored, and the admin page counts them,
      but nothing acts on them. Minimum useful version: surface "queries rated wrong_asset" as a list
      so the ranking can be corrected. 0 rows today, so this needs demo traffic first.
- [~] **P6.4 Eval set - DRAFTED 7 Sep, needs Siddharth.** `docs/eval-set.md` has 30 questions and
      `prototype/eval.mjs` scores them against the live API, exiting non-zero below 85% so it can
      gate a deploy later. **10 are real, pulled from `sam_events`; 20 are marked `[invented]` and
      must be replaced with what sales genuinely asks** - otherwise the 85% grades SAM against a
      fiction. Questions 11-15 are the ones to watch: they cover the competitive assets that did not
      exist in SAM's answers before the registry join. Original scope: Design phase 1 sets an exit criterion of **hit@3 >= 85%** on 30 real sales
      questions. No eval set exists. Without it "is SAM good?" is a matter of opinion, and every
      ranking change is unmeasurable. This is the honest way to show a manager it works. *Write the 30
      questions with Siddharth; scoring is mechanical after that.*
- [ ] **P6.5 Conversation memory on the web channel.** WhatsApp keeps six hours of per-number history;
      the web chat passes `history` through `apiAsk` but nothing persists it across a reload. Cheap,
      and follow-ups are most of how a demo actually gets used.

### P6a - The operator dashboard, SaaS-grade

Added 6 September 2026 at Siddharth's request: "think of this like a SaaS product". Treated as a first
class surface, not an admin afterthought - this is how SAM's value gets shown to a manager, and later
how a customer would be shown their own usage.

**What exists.** `web/app/admin/page.tsx`, 108 lines: people, questions, exact-match rate, helpful
ratings, catalogue opens, gaps logged, top queries, top assets, and a 14-day bar chart.

**The structural problem, worth fixing before there is traffic.** The page calls
`recentEvents(2000)`, pulls the rows into Node, and computes every metric with `.filter()` in
JavaScript. That is fine at 26 events and degrades every day it is used - eventually a Vercel function
timeout. The fix is not a nicer chart library, it is **moving aggregation into Postgres**: a daily
rollup table or materialised view turns "last 14 days" from fetch-2000-and-filter into one indexed
read that stays constant-time. Far cheaper to do now, at 26 rows, than after real traffic.

**Already captured but never shown.** `latency_ms`, `channel`, `runtime` and `intent` are all written
to `sam_events` today. Live data confirms it: 25 API events and 1 WhatsApp, **average 1402 ms, max
2867 ms**. So several metrics below need only a query and a tile, no instrumentation.

- [x] **P6a.1 Rollup table - DONE 6 Sep.** `sam_metrics_daily` + `sam_rollup_metrics()`, schema in
      `docs/supabase-sam-metrics.sql`. Backfilled and reconciled exactly against raw events (21
      queries, 5 gaps). Recomputes rather than increments, so a late event cannot corrupt it. Still
      to do: call it from a cron rather than on page render. Original scope: `sam_metrics_daily` keyed by (day, channel): queries,
      users, sessions, gaps, zero-result rate, p50/p95 latency, feedback split. Backfill from
      `sam_events`. Everything after this reads the rollup, not raw events.
- [x] **P6a.2 Session ids - DONE 7 Sep.** Derived from the 6-hour history window WhatsApp already
      keeps: an empty window means a new conversation, a non-empty one means the same one
      continuing. No second piece of state to keep in step with the TTL, and the session resets
      exactly when context does, so "messages per session" means "messages in one back-and-forth".
      `apiAsk` now takes an optional session id; the web route already had its own. Original note: The column exists and is **always null** - 0 distinct sessions
      across all 26 events. Without it there is no "messages per session", no conversation depth, no
      returning-user metric. Small change in the web and WhatsApp entry points; do it before the demo
      so the numbers have history.
- [x] **P6a.3 Response-time panel - DONE 6 Sep.** p50/p95/max per channel, p95 as the headline tile.
      Original scope: p50 / p95 / max, split by channel and by `runtime`
      (claude vs local vs search). The data is already there. This is "time to message" - it is also
      the number that tells you when a model change made SAM slower.
- [x] **P6a.4 Channel breakdown - DONE 6 Sep.** Original scope: Queries, users and latency per channel - web, whatsapp, api, mcp.
      Currently invisible even though every event carries `channel`.
- [x] **P6a.5 Corpus panel - DONE 6 Sep.** Tracked / answerable / linked / carded, which are four
      different numbers with only the last being real coverage. Original scope: Files tracked, by type and industry, ingestable vs skipped, archived,
      tombstoned, total size, newest change, and **how many are carded vs registry-only**. That last
      one is the real coverage number and nothing reports it today. Reads
      `sam_sharepoint_files`, which already holds all of it.
- [x] **P6a.6 Freshness panel - DONE 7 Sep, with a caveat stated in the UI.** Was listed as blocked
      on P1.1, which was only half right: the registry already has `modified_at` from Graph for all
      874 rows. That is not a publication date - a file touched last week can hold 2022 numbers -
      so the panel says so and treats itself as a floor, not the full picture. It surfaced something
      nobody knew: **506 of 697 active assets have not been touched in over two years**, and three
      owners carry most of it (Vijender Yadav 103, BALABHARATHY 91, SANDIP MALLIK 91). Original scope: Assets over 12 months old, by owner, so a stale asset has a name
      attached. Needs P1.1 publication dates.
- [x] **P6a.7 Gap report - DONE 7 Sep.** Ranked by distinct askers, not ask count. External asks
      labelled "needs a public link, not new content" rather than counted as missing content -
      conflating those two is what produced the false gap on 4 Sep. Deliberately not `coverageGaps()`,
      which enumerates ~72 permutations nobody asked for. Original scope: Ranked missing combinations with example questions and first/last seen.
      `coverageGaps()` and the `gap` events exist; nothing presents them as a worklist.
- [x] **P6a.8 Per-user activity - DONE 7 Sep.** Original scope: Who is actually using SAM, how often, and their top questions.
      Matters for adoption reporting to a manager, and it is the metric that shows whether sales
      picked it up or only marketing did.
- [x] **P6a.9 Export - DONE 7 Sep.** `/api/v1/export?set=metrics|assets|gaps`, linked from the
      dashboard header. UTF-8 BOM so Excel does not mangle the curly apostrophes already in
      accops.com titles, and every cell quoted - a half-escaped CSV shifts columns silently rather
      than erroring, which reads as "the data is wrong". Original scope: CSV or a shareable snapshot, because the first thing anyone does with a
      number a manager likes is put it in a deck.

**Deliberately not in v1:** per-tenant isolation and billing. Design decision 1 says internal tool
first; the rollup schema should key on (day, channel) in a way that a `tenant_id` could be added
later without a rewrite, and no further.

### P7 - The MVP demo path

Siddharth's plan, 6 September: prove the platform on 10-50 files before ingesting anything.

- [ ] **P7.1 Pick 20 to 50 demo documents** spanning the facets that make SAM look real: a couple of
      BFSI and Government case studies, a Citrix or Omnissa competitive deck, a whitepaper, a brochure.
      **The competitive deck matters most** - "which deck has the Citrix comparison?" is the question
      the current 66-document corpus cannot answer at all, and the registry shows 37 such assets exist.
- [ ] **P7.2 Card them in Claude Enterprise**, applying the two refinements from section 4 while
      carding, not after: split the card by audience, and write `client_actual` separately.
- [ ] **P7.3 Load into Supabase** as the first real rows of the card table, so the demo runs on the
      same path production will use - not on a JSON file that gets thrown away.
- [ ] **P7.4 Demo.** Then decide whether the remaining 413 are worth carding, with evidence.

**What P7 does not need:** embeddings, the full 874, Teams, or Marketing 2.0.

### P5 - Deliberately not doing yet

- **Embeddings / pgvector.** Held until the usage log shows keyword search missing things. 21 queries
  is not enough evidence. Revisit at a few hundred.
- **Marketing 2.0.** 960 GB media library, excluded until specific folders are named.
- **Live Graph search on zero results.** Section 2's narrow exception, 3-second cap. Only worth it
  once the registry is in the answer path (P0.1) - until then it patches the wrong hole.
- **Multi-tenancy / productisation.** Design decision 1; a decision point, not a commitment.

---

## 4. Open decisions that block specific items

From design section 10, still unanswered and now attached to the work they hold up:

| # | Decision | Status |
|---|---|---|
| 2 | Public link source | **Settled 6 Sep: page first, PDF if available.** accops.com already publishes 37 case studies, 4 ebooks, 9 solution documents and 18 webinars as live pages; SAM matches on title and fills `public_url` from the sitemaps. A bucket PDF, if one is ever confirmed, takes precedence over the page. No bucket hunt needed to unblock P1.3. |
| 5 | Where document text is processed | **Settled 6 Sep: it is not.** See "the carding boundary" below. |
| 6 | Who approves publish requests | **Settled 6 Sep: Siddharth.** |
| 7 | Freshness threshold | **Settled: 12 months, badge not hide.** Hiding creates the worse failure - a rep cannot find something they know exists. |

### The carding boundary (decided 6 September 2026)

Siddharth's design, and it is a better answer than "which model API do we trust":

> Claude Enterprise reads the documents and writes the cards. The cards go to Supabase. Groq reads only
> the cards. No original file is ever ingested by SAM or sent to a free-tier model.

This extends the rule that already makes WhatsApp acceptable to InfoSec - *a private asset's file body
never leaves SharePoint* - one layer outward: **the card is the boundary object.** Its real value is
that the boundary becomes inspectable. You can read all 874 cards and know exactly what a third-party
model can see, which is impossible once raw document text is flowing.

**The gap it does not close, stated plainly.** A card is not neutral. Of the 77 cards today, **40 name a
client**, and `key_problem` carries things like RBI mandates and exact user counts. That is
competitively sensitive whether or not the bank is named. Groq still sees customer-identifying content
at answer time - a paragraph instead of a PDF. Materially better, not zero.

**Two refinements that close most of the remainder:**

1. **Split the card by audience.** The model needs title, type, industry, products and folder to rank a
   match and explain it. It does not need `key_problem` verbatim. Keep the sensitive detail in Supabase,
   render it to the browser behind Entra login, and pass the model a leaner projection. Same UX, smaller
   exposure. Make this a real column split so "what does Groq see?" is a query, not a guess.
2. **Anonymise at carding time, inside Claude Enterprise.** Siddharth already does this by instinct -
   one existing card reads "India's largest private bank" rather than the name. Make it the rule: write
   both `client` (descriptive, model-visible) and `client_actual` (real name, Supabase only, never in a
   prompt). Cheap while carding anyway; painful to retrofit across 413 documents.

Decisions 1, 3 and 4 are settled: internal tool first, uniform read access assumed, WhatsApp on Meta's
Cloud API (the doc's decision 4 still reads "OpenWA" - superseded on 4 Sep evening, section 14).

---

## 4b. Session close, 7 September 2026

**Shipped today:** the registry join (P0), both Power Automate flows, the deletion key and backfill,
the whole operator dashboard (P6a.1-9), `request_publish`, 11 public links, and the eval harness.

**The eval found a production bug on its first real run.** `refresh()` stamped its timestamp even
when it failed, and both readers treated "recently stamped" as "loaded" - so one failed refresh
pinned the registry shut for a five-minute TTL while SAM quietly answered from 74 cards instead of
696 assets. Invisible in logs, because the failure path swallows errors by design so a bad refresh
cannot empty the catalogue. Two safeguards combining into a silent degradation. Fixed: both readers
check cache contents, not the timestamp.

**hit@3 is 82%** against a threshold of 85%, with 8 questions still unscored - so the real figure is
probably higher. Questions 11-15, the competitive decks that did not exist in SAM's answers before
the registry join, all pass. "Accops vs Citrix comparison" returns
"Accops vs Citrix-VMware_ Updated April 2024".

**The two remaining misses are honest and deliberately not fixed.** `pricing for HyWorks` and
`do we have a SOC 2 report?` return three assets instead of admitting a gap - SAM over-answers on
things it does not have. Tuning that against invented questions would fit the answer to a fiction.
It waits for real questions, which is the same reason the invented ones are still marked.

### Deletions: what is and is not possible without an admin

Settled by test on 7 September, and worth stating precisely because it is easy to misread.

**SAM cannot prevent, reject or approve a deletion.** It never writes to SharePoint at all - that is
the design rule that makes the WhatsApp channel acceptable to InfoSec. Nobody's ability to delete a
file is affected by anything here.

**What SAM cannot do is be *told* about a deletion in real time.** Power Automate's
"When a file is deleted" trigger needs a site-collection-admin connection to read a deleted file's
properties, so on a normal connection it never fires - zero runs against the modify flow's five,
with identical config, while the file was genuinely gone.

**Deletions are still caught, just on a schedule:**

| Change | Detected | Needs admin |
|---|---|---|
| File added or modified | ~1 minute, Power Automate | No - proven working |
| File deleted | next reconcile run | No - proven working |

`prototype/sp_reconcile.py` walks the folder through Graph, which reports what exists for any user,
and tombstones what has gone. It found the test deletion correctly.

**Why it is not on a Vercel cron.** The reconcile runs on the delegated Azure CLI login; Vercel has
no Python and no `az` session. Scheduling the health endpoint instead would produce a green cron that
is not doing the job - the exact false comfort this project has already been caught by three times.
So the reconcile stamps `sam_sharepoint_sync.last_run`, and **the dashboard shows a banner when it
is more than 36 hours old**, saying plainly that SAM may be citing files that have gone.

Making it truly automatic needs a Graph app credential - the Entra registration this design has
otherwise avoided entirely. That is a real trade to make later, not a bug to fix now.

### Three things only Siddharth can do


1. **Replace the 20 `[invented]` eval questions** with what sales genuinely asks. Grading against
   made-up questions measures whether SAM matches a guess about sales, not sales. ~30 min.
2. **Resolve 11 ambiguous public links.** Run `python prototype/sp_match_public.py`. They are
   anonymised on both sides - "3rd largest Public Bank" against "India's Largest Private Bank" -
   so nothing in either dataset says which is which. ~30 min.
3. **Trigger the flows once.** Upload a throwaway file to Sales Collateral and delete it. Both flows
   are Started; `flow_last_write` on `/api/cron/sharepoint` still reads 5 September, so no
   notification has landed since the fix deployed.

## 5. Suggested order

Revised 6 September: **platform first on a small sample, demo, then decide about the corpus.** Teams is
dropped for now by Siddharth's call - revisit after the MVP.

1. **P4.1** - two clicks, closes out the Power Automate work. Both flows are now Started.
2. ~~**P6.1 the trace panel**~~ - **already built and styled.** See the correction in P6. Open it
   during the demo; it is the Perplexity-style "how SAM got there".
3. **P0.1 + P0.2** - the registry starts answering, and links become real. This is what makes
   "which deck has the Citrix comparison?" answerable. **Now the top of the build list.**
4. ~~**P6a.2 WhatsApp session ids**~~ - done 7 Sep. Original note: small, and it must land *before* demo traffic or the session
   metrics have no history.
5. **P7.1 to P7.3** - card 20-50 documents in Claude Enterprise, load to Supabase.
6. **P6.4 the eval set** - 30 real questions, so "it works" is a number and not an opinion.
7. **P6a.1 + P6a.3 to P6a.5** - the rollup and the dashboard panels, once there is data worth showing.
8. ~~**P6.2 request_publish**~~ done 7 Sep. **P1.3 public links** - unblocked; approver is Siddharth.
9. **P7.4 demo**, then decide on the remaining 413 with evidence.

P4.2 (the cron) is ten minutes and fits anywhere. P1.1 publication dates ride along free during P7.2,
since Claude is already reading the documents.

**Deferred until after the MVP:** the full 874-document carding (P2.2), Teams (P3.1), embeddings, and
Marketing 2.0.

---

## 6. Who does what

Written 6 September 2026, because the honest answer to "can you build it yourself?" is *almost*.

### Claude builds, unattended

Everything that is code, schema, or a query against systems already connected: **P6.1** trace panel,
**P0.1/P0.2** registry join and link preference, **P6.2** request_publish end to end, **P6a.1 to
P6a.9** the whole dashboard, **P4.2** the cron, **P1.2** freshness badges, **P6.3/P6.5** feedback and
web memory. No input needed beyond a review of the result.

### Siddharth does, because Claude cannot

| Task | Why it cannot be automated | Effort |
|---|---|---|
| **P4.1** upload then delete a test file in Sales Collateral | SAM is read-only against SharePoint by design, and the flow's polling trigger only fires on a real change. Faking it would break the invariant the architecture rests on. | 2 minutes |
| **P7.1** choose the 20-50 demo documents | Judgement about what a manager should see. Claude can *suggest* a shortlist from the registry facets. | 20 minutes |
| **P7.2** download those files and card them | The rule that never bends: SAM never downloads file content. Claude Enterprise reads what Siddharth hands over. | An hour or two |
| **P6.4** supply the 30 eval questions | These must be *real* questions sales actually asks. Invented ones would grade SAM against a fiction. Scoring is mechanical once the list exists. | 30 minutes |
| **P1.3** confirm which accops.com page matches which asset | Title matching gets most of the way; the ambiguous ones need someone who knows the customers. | 30 minutes, after the automated pass |

### Needs a decision, not work

Nothing right now. All four open decisions were settled on 6 September - see section 4.

