# Task: ingest Accops SharePoint into SAM

**Status:** open, not started. Next session's work.
**Owner:** Siddharth Gupta (access, approvals) + Claude (build).
**Written:** 4 September 2026.
**Why this matters most:** SAM's 66 documents are a frozen snapshot copied from Siddharth's laptop. They decay from today. It also explains a gap he named at the very start of the project — there are **no battlecards, decks or competitor analyses** in SAM at all, only case studies and whitepapers, because those live in SharePoint and were never on the laptop. "Which deck has the Citrix comparison?" is unanswerable until this is built.

---

## 1. What Siddharth asked for

Three things, in his words:

1. There are already a lot of documents in SharePoint. Map them, ingest them, create a detailed set of answers for each, and save that somewhere.
2. A workflow triggered when a file is created or modified in a specific SharePoint folder.
3. When a person queries the agent, send a webhook to SharePoint to fetch results, check which is the latest document, and map it to the data already ingested.

He noted the workflow is not final and asked for the best mechanism for a RAG agent like this.

## 2. Recommended mechanism, and where it differs

**Points 1 and 2 are right and should be built as described.** Bulk ingest to establish the corpus, then a change trigger to keep it current.

**Point 3 should not be built as described.** Querying SharePoint on every user question is the wrong shape for three reasons:

- **Latency.** The rep waits on Microsoft Graph before seeing an answer. SAM currently replies in 1–3 seconds; a Graph search adds 1–2 seconds and sometimes much more under throttling. On WhatsApp that is the difference between useful and abandoned.
- **Fragility.** A Graph outage, an expired token, or throttling (Graph returns 429 aggressively on search) would take SAM down for every question, including the 95% that the index answers perfectly.
- **It does not achieve the goal.** A document indexed a minute ago is already in the index. One that changed since is caught by the change trigger within seconds. There is no window where a per-query lookup helps that the trigger does not already cover.

**The freshness Siddharth wants comes from the index being current, not from checking at question time.** That is what points 1 and 2 deliver.

**One narrow exception worth keeping.** When a search returns nothing, and only then, fall back to a live Graph search before declaring a gap. This is the "did we just add something SAM hasn't seen?" safety net, it costs nothing on the 95% of queries that succeed, and it prevents SAM confidently reporting a gap for a file uploaded during a trigger outage. Cap it at 3 seconds and degrade silently on failure.

### The shape

```
BULK (once, then on demand)
  Graph: list both document libraries recursively
    -> for each file: download, extract text with page/slide numbers
    -> LLM writes an asset card (see section 5)
    -> store card + chunks + Graph metadata in Supabase
    -> record deltaLink for the incremental sync

TRIGGER (continuous)
  Graph change notification (webhook) on the two drives
    -> POST /api/channels/sharepoint
    -> validate, acknowledge in <10s (Graph requirement), process after response
    -> re-ingest changed files, delete removed ones

RECONCILE (nightly, cron)
  Graph delta query using the stored deltaLink
    -> catch anything the webhook missed: renames, moves, permission changes,
       deletions, and everything that happened during any downtime
    -> webhook subscriptions expire in <=3 days, so renew them here too

QUERY (unchanged, plus one fallback)
  index search -> if zero results, live Graph search (3s cap) -> answer
```

## 3. Why webhook plus nightly delta, rather than either alone

Microsoft Graph change notifications are **not guaranteed delivery**. Microsoft's own documentation says notifications can be missed and that applications should reconcile. They also carry no file content, only "something changed in this drive", so a delta query is required anyway to learn *what* changed. And subscriptions expire in at most three days for drive resources, so something must renew them on a schedule regardless.

The nightly delta is therefore not redundancy for its own sake. It is the mechanism that makes deletion correct, which matters more than it sounds: **SAM citing a document that no longer exists is worse than SAM missing one.** A salesperson who forwards a dead SharePoint link to a customer looks careless, and that is the failure that destroys trust in the tool.

## 4. What Siddharth needs to provide

| Item | Why | Who |
|---|---|---|
| The two SharePoint site URLs (Sales, Marketing) | To resolve site and drive IDs | Siddharth |
| Which folders are in scope | Avoid ingesting drafts, archives, personal folders | Siddharth |
| Entra ID app registration with `Sites.Selected` | Graph access, scoped to only these two sites | Accops IT / Siddharth |
| Client secret or certificate | Authentication | Whoever creates the registration |
| Confirmation that everyone in sales and marketing can read both sites | Determines whether per-user permission trimming is needed in v1 | Siddharth |

**Ask for `Sites.Selected`, not `Sites.Read.All`.** `Sites.Read.All` grants read access to every SharePoint site in the tenant, which is a much harder approval to get and far more than SAM needs. `Sites.Selected` is granted per-site by an administrator and is the correct least-privilege choice. Expect this to be the slowest step; it is an IT approval, not a technical one.

## 5. The asset card, extended for SharePoint

The existing card schema already works and is proven against Siddharth's hand-written inventory. SharePoint adds provenance and the fields that make freshness real.

Existing: `title, asset_type, industry, client, products, key_problem, key_outcomes, brief, use_for, visibility, public_url, sharepoint_url`

Add:

```
graph_drive_id, graph_item_id      # stable identity across renames and moves
graph_etag, graph_ctag             # change detection without re-downloading
web_url                            # the real SharePoint link (today's are constructed and unverified)
created_at, last_modified_at       # from Graph, authoritative
last_modified_by                   # the owner to nudge when an asset goes stale
folder_path                        # for vertical inference and scope rules
publication_date                   # extracted from the document text by the LLM
competitors[], personas[], regulations[]   # already in generate_cards.py, unused so far
confidence                         # the LLM's own confidence in the card
```

`publication_date` deserves emphasis. Only 8 of 66 current documents have a known year, so SAM cannot warn that a case study is three years old. SharePoint's `last_modified_at` is not the same thing — a file touched last week can contain 2022 content. The publication date has to be read out of the document text, which the LLM can do while writing the card. **This is a trust feature: one stale asset sent to a customer costs more than ten missing ones.**

Store cards in Supabase rather than a JSON file. `data/asset_cards.json` was right for 66 documents on a laptop; it stops being right once ingestion is continuous and multiple processes write to it.

## 6. Build order

1. **Auth and discovery.** Resolve site and drive IDs, list both libraries, produce a report: file count, types, total size, folder structure. No ingestion. This alone answers "how big is this really?" and will likely surface duplicates and archive folders to exclude.
2. **Bulk ingest, dry run.** Extract and card 10 documents. Compare the cards against Siddharth's hand-written inventory for the ones that overlap, as `prototype/generate_cards.py` already does. Only proceed if the cards are faithful.
3. **Bulk ingest, full.** All in-scope files. Store in Supabase. Report cost and timing.
4. **Change trigger.** Subscription plus `/api/channels/sharepoint` webhook, acknowledging inside Graph's 10-second window and processing after the response, exactly as the WhatsApp channel already does.
5. **Nightly reconcile.** Vercel cron: delta query, handle deletions, renew subscriptions.
6. **Zero-result fallback.** Live Graph search only when the index finds nothing, 3-second cap.
7. **Freshness surfacing.** Show publication date and a stale badge in answers; nudge owners for assets older than 12 months.

Steps 1 and 2 are the ones that decide whether the rest is worth doing. Do not skip the comparison in step 2.

## 7. Traps, from experience on this project

- **Graph paginates everything.** Always follow `@odata.nextLink`. A first page of 200 files looks like the whole library and is not.
- **Acknowledge webhooks fast.** Graph requires a response within 10 seconds or it retries and eventually drops the subscription. The WhatsApp route in `web/app/api/channels/whatsapp/route.ts` shows the pattern: return 200, then work in `after()`.
- **Validate the webhook.** Graph sends a validation token on subscription creation that must be echoed back, and includes a `clientState` on every notification that must be checked. Same discipline as the WhatsApp signature check.
- **Deletions are the point.** Test them explicitly. A file deleted in SharePoint must lose its card and chunks the same night.
- **Do not trust filenames for dates.** The current index gets year from the filename, which is why 58 of 66 have no date.
- **The same document appears in multiple folders.** Already true on the laptop copy: three documents were filed under two verticals each, and four whitepapers existed as both PDF and DOCX. `dedupeKey()` in `web/lib/cards.ts` handles this by filename then content hash; SharePoint's `graph_item_id` makes it exact, but the filename fallback still matters for genuine copies in two libraries.
- **Scanned PDFs extract nothing.** `prototype/build_cards.py` already skips a 208 MB image-only government PDF. Flag these for manual carding rather than silently indexing an empty document.
- **Do not put a Graph call on the query path.** See section 2.

## 8. Prompt for the next session

Paste this to start:

> Build SharePoint ingestion for SAM, per `docs/TASK-sharepoint-ingestion.md` in this repo. Read that file first, then `docs/2026-09-04-sam-design.md` sections 2, 3 and 5 for the corpus and card design, and `web/lib/cards.ts` plus `prototype/build_cards.py` and `prototype/generate_cards.py` for the existing card schema and generation code.
>
> I have: [paste the two SharePoint site URLs, the in-scope folders, and confirm whether the Entra app registration with Sites.Selected exists yet].
>
> Start with step 1 only: authenticate, resolve the site and drive IDs, list both libraries recursively, and give me a report of what is actually there — file count by type, total size, folder structure, and anything that looks like an archive or draft folder we should exclude. Do not ingest anything yet. Then recommend the scope before we go further.
>
> Note that I originally wanted a SharePoint webhook on every user query; the task document explains why that is the wrong shape and what to do instead. If you disagree with that reasoning after reading it, say so.

## 9. Current state of everything else

Working and deployed at https://sam-accops.vercel.app: web app with chat and faceted catalogue, admin dashboard, REST API, MCP server, WhatsApp channel (live, tested 4 September), Supabase analytics, answers from `openai/gpt-oss-120b` on Groq's free tier, deduplication, honest gap handling.

Not built, in priority order after this task: publication-date extraction and freshness surfacing, the public/internal asset map (0 of 66 assets can be sent to a customer today), consuming the feedback thumbs that are already being collected, publish requests to marketing, a weekly gap digest. Deliberately not building embeddings until the usage log shows keyword search missing things.

Two WhatsApp expiries to handle eventually, both silent failures: access token 3 November 2026, test number early December 2026. See `TASK-whatsapp-meta-setup.md`.
