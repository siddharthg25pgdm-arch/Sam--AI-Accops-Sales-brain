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
      the link, here is the folder" - which is most of what a rep needs. *Half a session.*
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

1. **P4.1** - two clicks, and it closes out today's work.
2. **P0.1 + P0.2** - the registry starts answering questions. Biggest single jump in usefulness.
3. **P2.1** - pilot cards, with the inventory comparison.
4. **P3.1** - Teams, if sales is the priority audience.
5. **P1.1 + P1.2** - dates and freshness.
6. **P1.3** - public links, once decisions 2 and 6 land.

P4.2 can be slotted in anywhere; it is ten minutes.
