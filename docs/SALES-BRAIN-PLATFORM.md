# The Accops Sales Brain: platform contract (v1)

**Written 30 September 2026.** For anyone building a tool on top of SAM's data: SAM chat, the website
chatbot (`PRD-website-chatbot.md`), the Dwight Chrome extension, a rep email, a content engine. Read this
instead of the tables. The SQL is `docs/supabase-sam-v1-brain.sql`; the API is `web/lib/brain.ts`; the
OpenAPI 3.1 document is `docs/sales-brain-openapi.json` (served at `/api/v1/brain/openapi.json`).

## 1. What the brain is

```
SharePoint "Sales Collateral"
   │  Power Automate "SAM - Sales Collateral changed"      (every add / edit, minutes)
   │  Power Automate "SAM - daily SharePoint snapshot"      (02:00 IST, tombstones deletions)
   ▼
sam_sharepoint_files  (the registry: where every file is, its verified link, dates, folder tags)
   │  nightly carding 07:00 IST: Claude reads new/changed files on the laptop, writes cards
   ▼
sam_asset_cards       (what a document SAYS: title, type, year from the body, visibility, trust notes)
   │  families + eligibility (sam_asset_families): one current copy per document, pre-2024 rule
   ▼
v1 read model         sam_v1_assets · sam_v1_families · sam_v1_changes · sam_v1_public_assets
   ▼
/api/v1/brain/*       (bearer token)            and, for the website only, role sam_web_reader
```

Around it: **content requests** (`sam_content_requests` + votes: reps asking marketing to create
something), **feedback** (ratings under answers in `sam_events`, learned "wrong asset" demotions),
**events** (every question, answer, open and rating in `sam_events`), **ops runs** (every scheduled job,
`sam_ops_runs`).

| Concept | Rule (one place each) |
|---|---|
| Asset | A live Sales Collateral file (active, not deleted, not temp/shortcut/CSV), or a card with no live file. `asset_id` = `id:<SharePoint item id>` (survives rename and move) or `path:<card source>` |
| Family | Every version, re-save and edition of one document (`web/lib/family.ts` = `sam_family_parts` in SQL; `web/scripts/family-parity.mjs` proves them equal). `is_current` = newest in its edition; `is_family_lead` = the one shown by default. Editions (sharable, Japanese, MEA) are siblings, not versions |
| Eligible | May answer: published 2024 or later (card year from the body, else the year SharePoint last modified it), or a certificate / analyst report / regulation / third-party research / **brand asset**, or pinned by an admin. Never when a human excluded it (`sam_asset_family_overrides.exclude`) or its card says the file is empty. Testimonial videos have no exception |
| Answerable | `is_current and eligible`: the only assets SAM's answers, substitutes and facets use |
| Visibility | `public` = the card says published (`both`) and has a public URL; everything else is `internal`: never send outside Accops. `public_url_verified` = the URL is on accops.com |
| Trust | `expired`, `expiry_date`, `stale_risk`, `superseded_by` come from carding and are why a rep should hesitate |

## 2. Boundaries (non-negotiable)

1. **The carding boundary.** Only Claude (Enterprise, on the laptop) reads document bodies. Supabase holds
   cards, never file contents. No tool may fetch a private file's bytes, and nothing under `web/` reads
   `corpus/`. A tool that needs "what the document says" reads the card (`brief`, `key_outcomes`, ...).
2. **Real customer names never leave Postgres.** `client_actual` is not in any v1 view or API response.
   `client` is the anonymised description and is safe anywhere.
3. **The public surface is a view, not a prompt.** Anything customer-facing (the website bot) reads
   `sam_v1_public_assets` and nothing else: published, accops.com URL, current, eligible, not expired,
   no newer edition, and only title / type / industry / products / client / brief / outcomes / year / URL.
   Changing what is public means changing that view (a reviewed migration), never a prompt.
4. **No service key in a tool.** The Supabase service key lives only in the SAM web app's server
   environment. Internal tools call `/api/v1/brain/*` with a SAM API token; the website bot reads
   Postgres as `sam_web_reader`. Nobody reads v1 through the anon/publishable key (revoked).
5. **SAM never writes to SharePoint.** Everything here is read-only with respect to SharePoint.
6. **Additive only inside v1.** New columns and routes may appear; a column never changes name or
   meaning. A breaking change ships as `sam_v2_*` and `/api/v2` next to v1.

## 3. The API

Base `https://sam-accops.vercel.app/api/v1/brain`. Every route is `GET`, JSON, `Cache-Control: no-store`,
and answers with `X-Brain-Version: 1` and `Server-Timing: brain;dur=<ms>`.

| Route | Returns | Parameters |
|---|---|---|
| `/assets` | `{ data: Asset[], page }` | `q` (SAM's own ranking over answerable assets, best first), `type`, `industry` (case-insensitive exact), `product` (exact, e.g. HySecure), `family`, `visibility` (public/internal), `current`, `eligible`, `answerable`, `carded` (true/false), `since` (updated_at >= since, oldest first), `limit` (1-200, default 50), `offset` |
| `/assets/{id}` | `{ data: Asset & { family_members } }` | `id` = `asset_id`, URL-encoded (`id%3A01X5...`) |
| `/families/{key}` | `{ data: Family & { members } }` | |
| `/changes` | `{ data: Change[], page: { limit, returned, more }, next: { since, after } }` | `since` (exclusive), `after` (tie-break, from `next`), `entity` (file/card/request/answer), `limit` |
| `/public-assets` | `{ data: PublicAsset[], page }` | `since`, `limit`, `offset` |
| `/openapi.json` | the OpenAPI 3.1 document | none, no auth |

`page` = `{ limit, offset, returned, total, next_offset }`; `next_offset` is null at the end. Errors are
`{ error }` with 400 (a parameter is wrong, the message says which), 401 (no or unknown token), 404,
500 (the server log has the detail; nothing internal in the body).

**Polling for changes.** Keep `next` from each response and pass it back:
`/changes?since=<next.since>&after=<next.after>`. `since` is passed through verbatim (Postgres keeps
microseconds; do not round it). An empty page returns the same cursor. `more: true` means ask again now.
First sync: page through `/assets` (or `/assets?since=`) once, then follow `/changes`.

**Measured locally (30 Sep, dev server against production Supabase, warm):** `/assets` 160-180 ms,
`/assets?q=` 770 ms (loads SAM's search cache on first use), `/assets/{id}` 190 ms, `/families/{key}`
80-100 ms, `/changes` 50-115 ms, `/public-assets` 130 ms. `node web/scripts/brain-smoke.mjs [base]`
re-measures every route with a real token.

### Auth

- **Internal tools:** `Authorization: Bearer <token>`, where the server's `SAM_API_TOKENS` holds
  `label:token` pairs (comma-separated). The label identifies the tool (`dwight-rahul`, `content-engine`).
  Adding a tool = add a pair in Vercel's environment and redeploy. A signed-in browser session also works.
- **The website bot:** Postgres role `sam_web_reader` (NOLOGIN, reached through PostgREST with a JWT whose
  `role` claim is `sam_web_reader`). SELECT on `sam_v1_public_assets` and nothing else; proven by
  `docs/supabase-sam-v1-public-proof.sql` (15 objects denied, 9 sensitive columns absent, the public
  view readable; run it before every website stage launch). **Issuing its key is a human step** (section 7).

### Rate limits and cost

Nothing is enforced per token in code yet (ponytail: add a limit when a second tool actually polls). Fair
use: poll `/changes` at most once a minute, page `/assets` at 200 rows, never loop on `q` (it runs SAM's
search). Every brain read is a Supabase query, no model call, so it costs no model tokens. Vercel functions
time out at 30 s.

### Freshness

| Source | How fresh | What makes it late |
|---|---|---|
| A file added or edited in SharePoint | minutes (the change flow) | the flow switched off; the System tab's SharePoint flow row and the digest warn after 96 h of silence |
| A file deleted | next 02:00 IST (the snapshot, write mode) | the snapshot not running; the digest warns after 36 h |
| What a file says (its card) | next 07:00 IST (nightly carding) | the laptop off or asleep; job `carding` in the Scheduled jobs panel and the digest warn after 30 h |
| Metrics CSV rollup | next 08:00 IST (the cron), or on export | |
| v1 views | live: they are views, read at query time | |
| SAM chat's own caches | up to 5 min behind Postgres (in-memory TTL) | |

## 4. Data dictionary

Generated from the API's column lists (`node web/scripts/brain-openapi.mjs --md`); the API serves exactly
these columns. Internal columns (`needs_human`, `internal_reason`, `key_problem`, `use_for`, `modified_by`,
`sharepoint_url`) are for Accops staff and internal tools only: they never go to a customer.

`sam_v1_assets` counts differ from SAM chat's in-memory library on purpose: the view is Postgres only (one
row per file, PDF/PPTX twins apart), while SAM chat also merges twins and the 77 hand-written cards bundled
with the app. The family and eligibility rules are the same (`family-parity.mjs`: 0 differences on 409
shared assets).

#### sam_v1_assets

| Column | Type | Meaning |
|---|---|---|
| `asset_id` | string | Stable id: 'id:<SharePoint item id>' for a registry file (survives rename and move), 'path:<card source>' for a card with no live file. |
| `item_id` | string, nullable | SharePoint (Graph driveItem) id, null for a card with no live file. |
| `card_source` | string, nullable | The card's source path (corpus/...), null when the file is not carded. |
| `document_key` | string, nullable | Same value for a PDF and a PPTX of the same document (twins). |
| `family_key` | string | Every version, re-save and edition of one document shares it. |
| `edition` | string | '' default (internal/English/global), or 'sharable', 'japanese', 'japan', 'mea' and combinations. |
| `version` | string, nullable | Version parsed from the filename ('2.3'), null when none. |
| `version_rank` | integer, nullable | 1 = newest in its edition. |
| `is_current` | boolean | Newest in its edition (the only members answers may show). |
| `is_family_lead` | boolean | The member that represents the family by default. |
| `superseded` | boolean | A hand-set superseded_by points at a successor that is in the library. |
| `family_size` | integer, nullable | Documents in the family, this one included. |
| `family_older_versions` | integer, nullable | Documents in the family that are not current in any edition. |
| `eligible` | boolean | May answer: published 2024+, or a certificate / analyst report / regulation / third-party research / brand asset, or pinned; never when excluded by hand or the card says the file is empty. |
| `excluded_reason` | string, nullable | Why not eligible ('published 2021', 'year unknown, last modified 2022', 'empty file', ...), null when eligible. |
| `pinned` | boolean | An admin kept it in answers despite its age. |
| `answerable` | boolean | is_current AND eligible: what SAM's answers can use. |
| `visibility` | string | 'public' = published (card visibility both, with a public URL); 'internal' = never send outside Accops. |
| `public_url` | string, nullable | The public link, when published. |
| `public_url_verified` | boolean | public_url is on an accops.com host (third-party papers are public but not ours). |
| `sharepoint_url` | string, nullable | Verified SharePoint link (Graph web_url, viewer mode). Needs an Accops login; never forward outside Accops. |
| `title` | string | Card title, else the filename without extension. |
| `filename` | string | Current filename. |
| `folder` | string, nullable | Folder inside Sales Collateral, null for a card with no live file. |
| `ext` | string, nullable | File extension, lowercase. |
| `asset_type` | string | Card type (Case Study, Whitepaper, Deck, Battlecard, Brochure, Datasheet, Certification, ...), else the folder/filename tag. |
| `industry` | string | Card industry, else the folder/filename tag; '' when none. |
| `products` | string[] | Accops products the document covers. |
| `competitors` | string[] | Competitors it names. |
| `regulations` | string[] | Regulations it names (card only). |
| `personas` | string[] | Who it is for (card only). |
| `publish_year` | integer, nullable | Publication year read from the document body by carding, never from the filename. |
| `eligibility_year` | integer, nullable | The year the pre-2024 rule used: publish_year, else the year SharePoint last saw it modified. |
| `expired` | boolean | The document states an expiry that has passed. |
| `expiry_date` | date, nullable | That expiry. |
| `stale_risk` | string, nullable | Why it might mislead even though not expired (carding note). |
| `superseded_by` | string, nullable | 'sharepoint/<newer file> - why', when carding found a newer edition. |
| `carded` | boolean | SAM has read it (a card exists). |
| `client` | string, nullable | Descriptive, anonymised customer ('India's largest private bank'). Real names are never served. |
| `brief` | string, nullable | What the document is, from the card. |
| `key_problem` | string, nullable | The problem it addresses (internal). |
| `key_outcomes` | string[] | Outcomes it states. |
| `use_for` | string, nullable | When a rep should use it (internal). |
| `confidence` | number, nullable | The card writer's 0-1 estimate that the card is faithful. |
| `needs_human` | string, nullable | What carding flagged for a person (internal). |
| `internal_reason` | string, nullable | Why it is internal (internal). |
| `size_bytes` | integer, nullable | File size. |
| `file_created_at` | date-time, nullable | SharePoint created. |
| `modified_at` | date-time, nullable | SharePoint last modified. |
| `modified_by` | string, nullable | Who last modified it in SharePoint. |
| `first_seen` | date-time, nullable | When the registry first saw the file. |
| `last_synced` | date-time, nullable | When the change flow last wrote the row. |
| `carded_at` | date-time, nullable | When the card content last changed. |
| `updated_at` | date-time, nullable | Latest of modified_at, last_synced, carded_at: the since= filter. |

#### sam_v1_families

| Column | Type | Meaning |
|---|---|---|
| `family_key` | string | The family. |
| `lead_asset_id` | string | The member that represents it. |
| `lead_title` | string | Its title. |
| `lead_filename` | string | Its filename. |
| `assets` | integer, nullable | Asset rows (twins counted separately). |
| `documents` | integer, nullable | Documents (twins counted once). |
| `older_versions` | integer, nullable | Documents that are not current. |
| `answerable_assets` | integer, nullable | Members answers can use. |
| `answerable` | boolean | At least one member is answerable. |
| `editions` | string[] | Editions present ('' = default). |
| `carded_documents` | integer, nullable | Documents with a card. |
| `has_public_asset` | boolean | A current, eligible, published member on accops.com exists. |
| `updated_at` | date-time, nullable | Latest member update. |

#### sam_v1_changes

| Column | Type | Meaning |
|---|---|---|
| `change_id` | string | Stable, sortable id ('log:000000001234', 'event:000000005678'). Tie-break for the cursor. |
| `at` | date-time, nullable | When it happened. |
| `entity` | string | file / card / request / answer |
| `entity_id` | string | file/card: the asset_id; request: 'request:<id>'; answer: 'event:<question event id>'. |
| `change` | string | file: added / modified / renamed / moved / status / deleted / restored. card: card_created / card_updated. request: request_created / request_status. answer: feedback. |
| `detail` | object, nullable | filename/folder/scope; from/to for renames, moves and status; feedback kind; backfilled: true for history reconstructed on 30 Sep 2026. |

#### sam_v1_public_assets

| Column | Type | Meaning |
|---|---|---|
| `asset_id` | string | As sam_v1_assets. |
| `family_key` | string | As sam_v1_assets. |
| `edition` | string | As sam_v1_assets. |
| `title` | string | Title. |
| `asset_type` | string | Type. |
| `industry` | string | Industry, '' when none. |
| `products` | string[] | Products. |
| `client` | string, nullable | Descriptive, anonymised customer. |
| `brief` | string, nullable | What it is. |
| `key_outcomes` | string[] | Outcomes it states. |
| `publish_year` | integer, nullable | Year from the document body. |
| `public_url` | string | The public link (accops.com). |
| `updated_at` | date-time, nullable | Latest update. |

## 5. Operations: tracking everything

| Job | Expected (IST) | Writes `sam_ops_runs` as | Where |
|---|---|---|---|
| Deletion snapshot | 02:00 | `snapshot` (ok = write mode applied, warn = report mode, refused = a guard said no) | `/api/channels/sharepoint/snapshot` |
| Nightly carding, prep | 07:00 | `carding_prep` | `prototype/carding_prep.py` |
| Nightly carding, result | 07:00 | `carding` (ok / warn / failed, the log line as summary) | the skill's last step: `carding_prep.py --log-run` |
| Registry health cron | 08:00 | `cron` | `/api/cron/sharepoint` (Vercel cron 02:30 UTC) |
| Metrics rollup | 08:00 | `rollup` | the cron, and every metrics CSV export |
| Morning digest | 08:30 | `digest` (the subject as summary) | `/api/v1/digest` (not with `?test=1`) |

The System tab shows the last run, status, age and next expected time of each; a job silent for 30 h
shows as not run there and as a line in the morning digest (never on the log's first day). Tokens per
answer are in `sam_events.tokens`; the System tab shows tokens per day and model against Groq's free-tier
200k/day, and an estimated OpenAI spend from the price table in `web/lib/ops.ts`.

The metrics CSV (`sam_metrics_daily`) uses the dashboard's definitions exactly (IST days, the same test
identities, publish and unregistered messages excluded, catalogue searches out of latency). Proof:
`docs/supabase-sam-metrics-parity.sql`.

## 6. Adding a tool: checklist

1. **Pick the surface.** Customer-facing: `sam_v1_public_assets` only (role `sam_web_reader`). Internal:
   `/api/v1/brain/*` with a token. Needs to ask a question and get SAM's answer: `POST /api/v1/ask` or the
   MCP server (`/api/mcp`), not the brain API.
2. **Get a token:** a new `label:token` pair in `SAM_API_TOKENS` (Siddharth, Vercel). One label per tool,
   so the dashboard can tell tools apart.
3. **Read the contract, not the tables.** Use only v1 columns. If you need something missing, add it to
   the v1 view and to `ASSET_COLS` in `web/lib/brain.ts` (additive), regenerate the OpenAPI copy
   (`node web/scripts/brain-openapi.mjs`), and let `node web/lib/brain.check.mjs` pass.
4. **Respect the boundaries** (section 2): no document bodies, no `client_actual`, nothing internal to a
   customer, no service key, no SharePoint writes.
5. **Sync with `/changes`**, not by diffing `/assets`.
6. **Log what it does** if it answers people: through `askAndLog` (web/lib/api.ts) or its own channel
   value in `sam_events`, so it appears on the dashboard. A scheduled job writes `sam_ops_runs` via
   `logRun` (web/lib/ops.ts) and gets a row in `JOBS` there.
7. **Test traffic:** send `x-sam-test: 1` or use a test identity (`SAM_TEST_USERS`, and `sam_test_users` in
   SQL: keep both in step).

## 7. How the existing tools map onto it

| Tool | Reads | Writes |
|---|---|---|
| SAM web chat / REST `/api/v1/ask` | cards + registry through the in-memory caches (the same rules as v1) | `sam_events` (question, answer, model, tokens, errors), content requests, ratings |
| MCP `/api/mcp` | the same engine as REST (`web/lib/api.ts`) | `sam_events` channel `mcp` |
| WhatsApp | the same engine; `REQUEST` files content requests | `sam_events` channel `whatsapp` |
| Morning digest `/api/v1/digest` | registry changes, cards, the carding queue, families, usage, ratings, ops runs | `sam_ops_runs` job `digest` |
| Dwight extension | `/api/v1/context`, `/api/v1/search` today; the brain API for catalogue sync | `sam_events` channel `api` |
| Website chatbot (future, PRD stage 1) | `sam_v1_public_assets` as `sam_web_reader`, plus its own `sam_web_*` tables | its own `sam_web_events` |
| Content engine (future) | `/api/v1/brain/assets?answerable=true`, `/changes` | nothing in SAM |

## 8. What needs a human

- **Issue a key for `sam_web_reader`** (before the website bot's stage 1). With the project's JWT secret
  (Supabase dashboard, Project Settings, JWT), sign an HS256 JWT with payload
  `{"role":"sam_web_reader","iss":"supabase","iat":<now>,"exp":<now + 1 year>}`, store it only in the
  website's server environment, and check: `GET https://iwqhayuoxnrhqzozznes.supabase.co/rest/v1/sam_v1_public_assets`
  with headers `apikey: <publishable key>` and `Authorization: Bearer <the JWT>` returns rows, and the same
  call on `/rest/v1/sam_asset_cards` returns 401/403. If the project has moved to asymmetric signing keys,
  use the dashboard's equivalent; the role and grants do not change.
- **A token per new tool** in `SAM_API_TOKENS`.
- **Brand exemption, Tokyo exclusion:** applied 30 Sep (owner's decisions). Any further hand exclusion is
  a row in `sam_asset_family_overrides` with `exclude = true` and a reason.
