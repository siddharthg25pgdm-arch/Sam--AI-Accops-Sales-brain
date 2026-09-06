# SAM: what is built, and what is left

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

### P0 - Join the registry to the agent

Without this the 874 rows are inert and the three findings above stay true.

- [ ] **P0.1 Make the agent read `sam_sharepoint_files`.** Merge registry rows into the card set at
      query time, keyed by filename. A registry row with no card still answers "this exists, here is
      the link, here is the folder" - which is most of what a rep needs.

      **Scope, measured rather than guessed.** `cards.ts` line 1 is
      `import raw from "@/data/asset_cards.json"` and `allAssets()` is **synchronous** with a
      module-level cache; `searchAssets()`, `facetCounts()` and `coverageGaps()` are sync too.
      Supabase reads are async, so this is not a one-line swap - it needs a warm-cache pattern
      (load once on first request, refresh on a TTL) or those functions go async and **25 call sites
      across 5 files** follow: `page.tsx`, `agent.ts`, `agent-openai.ts`, `api.ts`, `cards.ts`.
      Warm cache is the smaller change and fits Vercel's model. *One session.*
- [ ] **P0.2 Prefer the verified `web_url` in `assetLink()`.** Section 8a of the SharePoint task
      requires this: store Graph's `webUrl` only when Graph returned it, never a guess. **Strip or
      rewrite `action=edit`** on Office links first - as loaded, a forwarded `.pptx` link opens an
      *editing* surface for the customer. *Small, but do not skip the edit-link part.*
- [ ] **P0.3 Retire the 71 dead constructed URLs** from `asset_cards.json` once P0.2 lands. They are
      suppressed today, not removed.

### P1 - Make answers trustworthy

- [ ] **P1.1 Publication dates.** 0 of 77 cards have one, so SAM cannot warn that a case study is
      three years old. `modified_at` is not the same thing - a file touched last week can hold 2022
      content. Needs the date read out of the document text. *This is the trust feature: one stale
      asset sent to a customer costs more than ten missing ones.*
- [ ] **P1.2 Freshness badges** in answers and catalogue, once P1.1 exists. 12-month threshold,
      badge rather than hide - settled, see section 4.
- [ ] **P1.3 The public/internal map.** **0 of 66 assets can be sent to a customer today.** Every
      `public_url` is empty, which is why `audience=external` produced a false gap on 4 Sep.
      **Unblocked 6 Sep:** match SAM's assets to accops.com pages by title from
      `case-studies-sitemap.xml` (37), `ebooks-sitemap.xml` (4), `solution-documents-sitemap.xml` (9)
      and `webinars-sitemap.xml` (18), and fill `public_url`. Page first, bucket PDF if one is ever
      confirmed. Approver is Siddharth.
- [ ] **P1.4 Consume the feedback thumbs.** They are collected and stored; nothing reads them. 0 rows
      so far, so this waits until there is traffic.

### P2 - Carding the real corpus

This is where the 413 ingestable files become answerable, not just findable.

- [ ] **P2.1 Card a pilot of 10 documents** from the registry and compare against the hand-written
      inventory where they overlap, exactly as `prototype/generate_cards.py` already does. **Do not
      skip the comparison** - build order step 2 exists because it is the gate on everything after.
- [ ] **P2.2 Bulk-card the 413.** Report cost and timing first. SAM never downloads file content:
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

- [ ] **P4.1 Finish the deletion flow test.** Two clicks: edit a throwaway file, confirm
      `list_item_id` fills and `folder` has no prefix; then delete it and confirm the row flips to
      `deleted = true`. Baseline recorded: **874 rows, 0 with `list_item_id`, 0 tombstoned.**
- [ ] **P4.2 Add `vercel.json` with a cron.** `/api/cron/sharepoint` works and returns real data
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
- [ ] **P6.2 Finish `request_publish`.** `apiPublicLink` returns `can_request_publish: true`, but no
      tool or route exists to file one. A rep is told they may ask and then given no way to ask - a
      dead end in the API surface. Needs a `sam_publish_requests` table, a REST route, an MCP tool and
      a queue on the admin page. Approver is Siddharth (settled). *One session.*
- [ ] **P6.3 Feedback loop closure.** Thumbs are collected and stored, and the admin page counts them,
      but nothing acts on them. Minimum useful version: surface "queries rated wrong_asset" as a list
      so the ranking can be corrected. 0 rows today, so this needs demo traffic first.
- [ ] **P6.4 An eval set.** Design phase 1 sets an exit criterion of **hit@3 >= 85%** on 30 real sales
      questions. No eval set exists. Without it "is SAM good?" is a matter of opinion, and every
      ranking change is unmeasurable. This is the honest way to show a manager it works. *Write the 30
      questions with Siddharth; scoring is mechanical after that.*
- [ ] **P6.5 Conversation memory on the web channel.** WhatsApp keeps six hours of per-number history;
      the web chat passes `history` through `apiAsk` but nothing persists it across a reload. Cheap,
      and follow-ups are most of how a demo actually gets used.

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

## 5. Suggested order

Revised 6 September: **platform first on a small sample, demo, then decide about the corpus.** Teams is
dropped for now by Siddharth's call - revisit after the MVP.

1. **P4.1** - two clicks, closes out the Power Automate work.
2. **P6.1 the trace panel** - backend already returns `trace`; the UI ignores it. Highest demo value
   per hour of work in the whole list.
3. **P0.1 + P0.2** - the registry starts answering, and links become real. This is what makes
   "which deck has the Citrix comparison?" answerable.
4. **P7.1 to P7.3** - card 20-50 documents in Claude Enterprise, load to Supabase.
5. **P6.4 the eval set** - 30 real questions, so "it works" is a number and not an opinion.
6. **P6.2 request_publish** + **P1.3 public links** - both now unblocked; approver is Siddharth.
7. **P7.4 demo**, then decide on the remaining 413 with evidence.

P4.2 (the cron) is ten minutes and fits anywhere. P1.1 publication dates ride along free during P7.2,
since Claude is already reading the documents.

**Deferred until after the MVP:** the full 874-document carding (P2.2), Teams (P3.1), embeddings, and
Marketing 2.0.
