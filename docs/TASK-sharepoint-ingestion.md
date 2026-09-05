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

## 4. Scope, confirmed 4 September 2026

Siddharth confirmed the exact sites and folders from the Power Automate trigger picker. **Note the tenant is `propalmsnetwork`, not `accops`** — every SharePoint URL currently in SAM's asset cards is constructed against `accops.sharepoint.com` and is therefore wrong. Fixing those links is part of this task.

| Scope | Site | Library | Folder |
|---|---|---|---|
| Sales | `https://propalmsnetwork.sharepoint.com/sites/Company` | Documents | `/Shared Documents/Sales/Sales Collateral` |
| Marketing | `https://propalmsnetwork.sharepoint.com/sites/MarketingTeam` | Documents | `/Shared Documents/Marketing 2.0` |

Other sites visible in the tenant, **out of scope**: `AccopsSystemsPrivateLimited`, the tenant root, and a personal `contentstorage` workspace.

The Power Automate connection runs as **Siddharth.Gupta@ACCOPS.COM**.

### Still needed

| Item | Why | Who |
|---|---|---|
| Entra ID app registration with `Sites.Selected` | So SAM can fetch file content back from Graph. Power Automate's trigger does not carry file bytes. | Accops IT / Siddharth |
| Client ID and secret | Authentication for that registration | Whoever creates it |
| Admin grant of `Sites.Selected` on the two sites above | `Sites.Selected` is granted per-site, so both need explicit grants | Accops IT |
| Confirmation that everyone in sales and marketing can read both sites | Decides whether per-user permission trimming is needed in v1 | Siddharth |

**Fallback if IT approval is slow:** build and test the whole pipeline using Power Automate for both the trigger *and* the file content. The "Get file content" action runs under Siddharth's own connection and needs no app registration. It is slower and less suitable for bulk ingest, but it proves the pipeline end to end and can be swapped for Graph later.

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

The Power Automate MCP is connected in the new session, so the flow can be created directly. Paste this:

> I'm continuing work on SAM, my sales and marketing collateral assistant. It is live at https://sam-accops.vercel.app and the repo is this one. Today's job is SharePoint ingestion.
>
> Read `docs/TASK-sharepoint-ingestion.md` first — it has the confirmed scope, the recommended mechanism and the traps. Then read `docs/2026-09-04-sam-design.md` sections 2, 3, 5 and 15, and `web/lib/cards.ts` plus `prototype/build_cards.py` and `prototype/generate_cards.py` for the existing asset-card schema and generation code.
>
> Scope is confirmed in section 4 of the task doc: the Company site's `/Shared Documents/Sales/Sales Collateral` folder and the MarketingTeam site's `/Shared Documents/Marketing 2.0` folder, both in the `propalmsnetwork` tenant.
>
> I have the Power Automate MCP connected, so you can create flows directly. The Entra app registration with `Sites.Selected` does **not** exist yet.
>
> Start with discovery only, no ingestion: use Power Automate to list what is actually in those two folders and give me a report — file count by type, total size, folder structure, anything that looks like an archive or draft we should exclude, and how many are scanned PDFs that will not extract. Then recommend the scope and the build order before we change anything.
>
> Two things to know. Every SharePoint URL in SAM's current asset cards was constructed against `accops.sharepoint.com` and is wrong, since the real tenant is `propalmsnetwork` — those links need fixing as part of this. And I originally wanted a SharePoint webhook on every user query; section 2 of the task doc explains why that is the wrong shape. If you disagree after reading it, say so.
>
> Commit and push after each working step. Vercel deploys from `main`, and commits must be authored as siddharth.g25pgdm@gmail.com or Vercel blocks the deployment.

## 8a. Session note, 4 September 2026 evening: tooling resolved, links fixed, discovery still to do

**The Power Automate MCP was installed but disabled.** Microsoft's official `power-automate` plugin
(v2.5.0, from the `microsoft/power-platform-skills` marketplace) was present on disk and carried a real
FlowAgent MCP server, but `~/.claude/settings.json` had `"power-automate@power-platform-skills": false`,
so the server was never spawned. A disabled plugin produces no "failed to connect" warning and does not
appear in `claude mcp list` at all, which makes it indistinguishable from not being installed — worth
remembering the next time a connected-looking tool is missing. The flag is now `true`, but **plugins load
at session start, so it takes effect only after a restart.** Discovery therefore did not happen this session.

Prerequisites are all confirmed good, so the next session should be able to go straight to discovery:

| Check | Result |
|---|---|
| Node.js | v24.13.1 |
| Azure CLI | 2.89.0 |
| `az account show` | signed in as `Siddharth.Gupta@ACCOPS.COM` — the account section 4 names |
| Flow service token | acquired against `https://service.flow.microsoft.com`, so the account is licensed |

FlowAgent exposes `invoke_operation` and `search_operations`, which call SharePoint connector operations
directly. Discovery may not need a flow built at all — a direct `Get files (properties only)` per library,
paginated, is likely enough. Try that before building anything.

**Discovery can start before the Entra app registration exists.** Section 4 lists `Sites.Selected` under
"still needed", and it is — but only for steps 3 to 5, where SAM runs unattended on Vercel with no user
present. That is an *application* permission. Discovery runs interactively as Siddharth, so it uses
*delegated* permission through his existing Power Automate connection and needs no registration and no IT
approval. Do not let the approval queue block step 1.

### The dead links are fixed, ahead of ingestion

Section 16 said the 71 constructed `accops.sharepoint.com` URLs should be fixed *by* ingestion. That is
still true for producing correct links, but it left SAM actively handing out 404s in the meantime,
including over WhatsApp. Siddharth chose to suppress them now.

`assetLink()` and `assetLocation()` in `web/lib/cards.ts` are now the only way a URL reaches a user.
`assetLink()` returns `public_url` or nothing — never the constructed SharePoint URL. `assetLocation()`
returns "filename, in folder/path" so a rep can find the document themselves. WhatsApp, the web catalogue,
the chat cards and the REST API all route through them.

A correction worth recording: an earlier reading of this codebase assumed `slim()` was the single chokepoint
where an asset becomes something a channel renders. It is not. Five separate call sites did
`public_url ?? sharepoint_url` — `cards.ts`, `agent.ts` and three places in `api.ts` — so fixing `slim()`
alone would have left chat, WhatsApp and the REST API still emitting dead links. Grep for the pattern, not
for the function.

**What ingestion must do here:** populate `sharepoint_url` with Graph's real `webUrl` per file, then have
`assetLink()` prefer it. Store it *only* when Graph actually returned it and leave it null otherwise, so the
field never again holds a guess in the slot a verified value occupies. That is the actual lesson of section
16 — not the wrong hostname, but a field that could hold either a fact or a guess with no way to tell.

---

## 9. Current state of everything else

Working and deployed at https://sam-accops.vercel.app: web app with chat and faceted catalogue, admin dashboard, REST API, MCP server, WhatsApp channel (live, tested 4 September), Supabase analytics, answers from `openai/gpt-oss-120b` on Groq's free tier, deduplication, honest gap handling.

Not built, in priority order after this task: publication-date extraction and freshness surfacing, the public/internal asset map (0 of 66 assets can be sent to a customer today), consuming the feedback thumbs that are already being collected, publish requests to marketing, a weekly gap digest. Deliberately not building embeddings until the usage log shows keyword search missing things.

Two WhatsApp expiries to handle eventually, both silent failures: access token 3 November 2026, test number early December 2026. See `TASK-whatsapp-meta-setup.md`.

## 8b. Session note, 6 September 2026: the registry is live in Supabase

**Tables created** in `accops-marketing-dashboard` (ref `iwqhayuoxnrhqzozznes`), applied as migration
`sam_sharepoint_registry` from `docs/supabase-sharepoint-files.sql` unchanged:
`sam_sharepoint_files` (7 indexes) and `sam_sharepoint_sync` (1). Both have RLS enabled with **zero
policies**, which is deliberate: RLS-on-no-policy is deny-all for `anon`, and the service role bypasses
RLS entirely, so the server writes freely while a leaked publishable key reads nothing. The dashboard's
own 65 tables were not touched.

**`sam_events` already existed and is already persisting.** It was not missing. 26 rows, 21 of them
`kind='query'`, across 2 users and 2 channels, first write 3 September 23:47 UTC and last 4 September
14:25 UTC — the WhatsApp test. So the live app's analytics are healthy and `docs/supabase-sam-events.sql`
needs no run. The reason this looked uncertain is worth recording: `web/lib/events.ts` falls back to an
**in-memory buffer** when `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` are absent, so a local run shows analytics
apparently working while nothing persists. Absence of errors proves nothing here; the row count in
Supabase is the only real evidence.

**The sync cursor is loaded.** One row in `sam_sharepoint_sync` for the sales drive, carrying the real
Graph `deltaLink` captured during discovery. Marketing 2.0 is correctly absent — `MARKETING_FOLDERS` in
`sp_map_urls.py` is still `[]`, so the seed emits no marketing sync row and no marketing files. That 960 GB
library stays out until specific folders are named.

### The one thing that blocked the file load

`prototype/sp_seed_registry.py --write` needs `SUPABASE_SERVICE_KEY`. It is **not** recoverable from this
machine: `web/.env.local` never had it, `web/.env.deploy.local` does not carry it, and `vercel env pull`
returns sensitive values **as empty strings** rather than plaintext. It exists only encrypted in Vercel and
in the Supabase dashboard. Copy it from
`https://supabase.com/dashboard/project/iwqhayuoxnrhqzozznes/settings/api-keys` into `web/.env.local`
(gitignored via `web/.gitignore:34`) and the seed runs in one command.

Loading 874 rows through the Supabase MCP instead was tried and rejected: the generated SQL is ~500 KB, and
relaying each batch through the model's context costs far more than it is worth for a load the seed script
already does correctly and idempotently.
