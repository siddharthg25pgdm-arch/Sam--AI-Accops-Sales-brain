# Handover: next session

**Written 7 September 2026, updated 25 September 2026.** Paste the prompt at the bottom into a fresh session.
The 25 September section below supersedes anything older it contradicts.

---

## 30 September 2026: the Sales Brain platform layer (v1 contract) + tracking everything

| | |
|---|---|
| Contract | `docs/SALES-BRAIN-PLATFORM.md` is what any tool builds on: boundaries, data dictionary, API, auth, freshness, add-a-tool checklist |
| Read model (Supabase) | `docs/supabase-sam-v1-brain.sql` (migrations `sam_v1_brain`, `sam_v1_public_rows`): `sam_v1_assets` (452 rows, 233 answerable), `sam_v1_families` (340), `sam_v1_changes` (change log fed by triggers on files, cards and requests, backfilled from existing timestamps, plus ratings), `sam_v1_public_assets` (11: published, accops.com URL, current, eligible, not expired or superseded). `sam_test_users` mirrors `SAM_TEST_USERS` for SQL |
| Public surface | Role `sam_web_reader` (NOLOGIN, granted to authenticator): SELECT on the public view only. The rows come from a security-definer function because security_invoker views check the session role even behind a definer view (the first proof run failed exactly so). `docs/supabase-sam-v1-public-proof.sql`: 15 objects denied, 9 sensitive columns absent, anon denied everywhere. **Needs Siddharth: issue a JWT for the role (platform doc section 8)** |
| API | `/api/v1/brain/{assets, assets/:id, families/:key, changes, public-assets, openapi.json}` (`web/lib/brain.ts`, bearer token). OpenAPI 3.1 generated from the served column lists → `docs/sales-brain-openapi.json` (`node web/scripts/brain-openapi.mjs`; `--md` prints the dictionary). Smoke with timings: `node web/scripts/brain-smoke.mjs [base]`. Check: `node web/lib/brain.check.mjs` (35) |
| Ops log | `sam_ops_runs` (`docs/supabase-sam-ops.sql`): snapshot, carding_prep, carding (the skill's last step, `carding_prep.py --log-run`; live skill copy updated identically), cron, rollup (now nightly with the cron), digest. System tab: Scheduled jobs (last run, status, age, next expected); digest: a line when a daily job has not run in 30 h. `web/lib/ops.ts`, check `ops.check.mjs` (17) |
| Tokens | `sam_events.tokens` from the answer trace; System tab: per day and model vs Groq 200k/day, OpenAI estimate from the price table in `ops.ts` (empty until production answers again) |
| Metrics CSV | `sam_rollup_metrics` now uses the dashboard's definitions (IST days, test identities passed in, publish/unregistered and catalogue searches out). `docs/supabase-sam-metrics-parity.sql`: 30/30 days equal, 0 mismatches |
| Dashboard | Errors = real errors; recovered fallbacks (provider_error answered by another model) shown apart (30 days incl. test: 5 real vs 95 recovered). 390 px tab bar wraps, CSV row visible. One "Content gaps" label everywhere; registry counts say what they count; zero states |
| Owner decisions applied | Brand assets exempt from pre-2024 (cards.ts + SQL; family-parity 0 differences). The Tokyo "English v4" empty deck excluded via `sam_asset_family_overrides.exclude` (the Japanese deck leads); cards with confidence <= 0.5 and "empty"/"blank" in needs_human are ineligible. Note: the Tokyo card itself has confidence 0.95, so the general rule would not have caught it, the override does |
| All checks | `node web/scripts/checks.mjs` runs every `lib/*.check.mjs` |

---

## 30 September 2026: one document, one answer slot (families) + pre-2024 excluded

| | |
|---|---|
| Families | `web/lib/family.ts` (`parseName`, `families`, `isNewer`) and the SQL mirror `docs/supabase-sam-asset-families.sql` (applied) group every version, re-save and edition of a document: version tokens, dates / date prefixes, Final/Draft/Copy/Big/Small/compressed/(1), edition and language tags stripped; product, customer, city, length kept. Canonical: card publish_year, then version (only when both files have one), then modified; hand-set `superseded_by` joins the successor's family and loses. Editions (sharable, Japanese, Japan, MEA) are siblings: one slot, the edition the ask needs. TS and SQL agree on all 1,194 filenames and 409/409 shared assets |
| Pre-2024 (owner, 30 Sep) | Eligible = card publish_year >= 2024 (uncarded: modified year), or a certificate / analyst report / regulation / third-party research, or pinned (`sam_asset_pins`, Content tab Pin / Unpin). Excluded documents never answer and never substitute. Real library: 254 of 475 assets answerable, 159 excluded, 62 older versions hidden |
| DB | `sam_asset_families` view (family_key, edition, version_rank, is_head, is_canonical, eligible, excluded_reason, older_versions, canonical_filename), stored `stem` / `fam_*` columns (recompute after changing a function: `update ... set filename = filename`), `sam_asset_family_overrides` (6 seeded false merges), `sam_carding_queue` rebuilt (hash joins, `family_role`) |
| Where it shows | Answers: `answerable()` is the search / substitute / facet pool; lines say "N older versions not shown". Content tab: honest "Carded N of M", Versions and editions, Excluded from answers. Catalogue: admins see excluded greyed. Digest: "New version of an existing document", "New, pre-2024: excluded". Nightly carding skips older copies, cards new versions first. Export CSV has the family columns |
| Checks | `node web/lib/family.check.mjs` (63), cards.check pages 2,345 rows through a 1,000-row cap |
| Needs Siddharth | Logos, icons, email signatures and 2022 testimonial videos are excluded (modified 2021-22, no document year): pin them or make "Brand" an exception. The Nutanix .NEXT Tokyo "English v4" file is an empty deck and leads its family |

---

## 30 September 2026: the rating buttons act

| | |
|---|---|
| Admin, Quality tab | **What reps told us**: every rating (latest per rep per answer, own questions only), filter Wrong asset / Doesn't exist / Helpful, with the question, verdict, documents shown, who/when/channel and a link to that one conversation (`/admin?tab=conversations&ev=<id>`). **Documents rated wrong asset** by distinct reps. **Learned demotions** with a Clear button |
| "Doesn't exist" | Votes on the content request for that question's topic key, source/channel `feedback` ("from a rating" in the queue). Pressing it twice, or after an explicit request for that answer, adds nothing; an explicit request later replaces the rating's vote; changing the rating to Yes/Wrong asset takes the vote back (and a request only it created). All in SQL: `sam_file_content_request` + `sam_retract_feedback_vote` (`docs/supabase-sam-feedback.sql`). Test traffic lands in is_test requests only |
| "Wrong asset" | `web/lib/feedback.ts` `learnDemotions`: >= 2 distinct reps, rating answers showing the document, questions sharing topic tokens (`topicOf` in cards.ts) → the document scores **-3** in `searchAssets` for queries containing that topic. Ratings older than 60 days stop counting; any Helpful rating for the topic blocks it; a human Clear (`sam_rank_feedback`) holds until two NEW reps agree. Real traffic only; warm cache, 10 min TTL. Check: `node web/lib/feedback.check.mjs` |
| Digest | "What reps told us" section (counts + up to 3 wrong-asset / doesn't-exist examples), `N ratings` in the subject. `?test=1` includes test ratings, for checking from local dev |

---

## 29 September 2026: morning digest

`GET /api/v1/digest` returns the queue owner's morning email: the last 24 h, IST dates, email-safe HTML (tables, inline styles, 600 px, no external anything). `?format=json` returns the same data. The subject is in the `X-SAM-Subject` response header and in JSON `subject`, ASCII on purpose (safe in a header): e.g. `SAM: 2 new requests, 1 worth creating, 4 files changed, 12 questions`, or `SAM: nothing new`.

| | |
|---|---|
| Auth | `Authorization: Bearer <SP_WEBHOOK_SECRET>` (the secret the SharePoint flows already carry, constant-time compare), or any SAM API token / session. 401 otherwise |
| Sections, in order, each left out when empty | Content requests (open queue by distinct reps, New, +N since yesterday, **Worth creating at 3+ reps**, links to `/admin?tab=requests#r<id>`) · Asked for, never requested (top 5 unrequested gaps, 7 days) · Library (added / modified / renamed / deleted in 24 h, cards with `carded_at` in 24 h, the carding queue) · Usage (real traffic, vs the 7 x 24 h before) · Needs a look (change flow silent > 48 h, deletions not applied > 36 h, provider failures >= 3 and >= 20%, card cache empty, any failed read) |
| Code | `web/lib/digest.ts` (assembly + HTML, pure), `web/app/api/v1/digest/route.ts` (reads), `web/lib/digest.check.mjs`, `web/scripts/digest-shots.mjs`. Usage comes from the new `sam_usage_window` RPC (`docs/supabase-sam-digest.sql`), the dashboard's definitions over a rolling window |
| The flow (to build) | Recurrence 08:30 India Standard Time → HTTP GET `https://sam-accops.vercel.app/api/v1/digest` with header `Authorization: Bearer <SP_WEBHOOK_SECRET>` → Outlook "Send an email (V2)": To Siddharth, Subject `@{outputs('HTTP')?['headers']?['x-sam-subject']}`, Body `@{body('HTTP')}`, Is HTML Yes. A non-200 should fail the run, not send an empty email |

---

## 1 October 2026: OpenAI gpt-6-luna is the primary model

Chain: **gpt-6-luna (OpenAI) → Groq gpt-oss-120b → gpt-oss-20b → retrieval**. Paced production eval on luna:
**27/28 = 96%** hit@3 (the one miss: "do we have a pharma ZTNA case study?" led with the Single-Slide Case Studies
library, which names 9 pharma customers), 0 ungrounded names, ~2,120 tokens/question, p50 956 ms / p95 3.2 s
(Groq 120b on 30 Sep: 28/28, p50 627 ms / p95 2.2 s). Cost estimate ~USD 0.0003/question; the whole 30-question
run ~USD 0.01. No daily cap (Groq's 200k/day was the bottleneck). Owner: never use gpt-6 Sol or Astra.
**Security:** the key was pasted three times; `/api/v1/provider` echoed it in an error (fixed: `web/lib/redact.ts`,
`cleanKey`, `redact.check.mjs`; nothing reached `sam_events`). That key (ends …CQA) must be revoked and replaced
with a fresh one pasted once.

---

## 30 September 2026: eval 28/28

Paced production eval (`prototype/eval.mjs`, 30 questions, all answered by gpt-oss-120b): **hit@3 28/28 = 100%**
(was 64% on 25 Sep, 89% on 26 Sep, 79% after the answer-contract rewrite). 0 ungrounded names, ~2,100 tokens per
question. Caveat: 20 of the 30 questions are still modelled, not real asks - replace them from `sam_events` after the
rep demo. Also merged 30 Sep: context competitors ("moving off X" is not a required entity), precise `dropSending`,
fairer verdict guard, `nearFirst` substitutes for missing topics, video asks; WhatsApp token expiry warning in the
morning digest (Meta debug_token, 21 days ahead) + click-by-click guide in `TASK-whatsapp-meta-setup.md`.

---

## 29 September 2026: the daily loop runs itself

| Time (IST) | What | Where |
|---|---|---|
| continuous | SharePoint add/edit → registry (Power Automate "SAM - Sales Collateral changed") | findable with a link within minutes |
| 02:00 | Deletion snapshot (Power Automate "SAM - daily SharePoint snapshot", id `7fe4a4f0…`) | **`"mode": "write"` since 30 Sep 00:44 IST** (switched by Claude on Siddharth's explicit go-ahead) - deleted files are tombstoned nightly |
| 07:00 | **Nightly carding**: Windows Task `SamNightlyCarding` → `~/.claude/scripts/sam-nightly-carding.ps1` → headless `claude -p /sam-nightly-carding` (no MCP; `--allowedTools Bash,Read,Write,Edit,Glob,Grep`) → `prototype/carding_prep.py` (queue → copy from OneDrive → extract) → Claude writes cards into `corpus/cards/batch-auto-<date>.json` → gate → `load_cards.py` → commit + push. Log: `~/.claude/logs/sam-nightly-carding.log`. Tested by hand 29 Sep: exit 0 in 170 s on an empty queue. Needs the laptop on and signed in | skill `~/.claude/skills/sam-nightly-carding/SKILL.md` |
| 08:30 | **Morning digest email** to Siddharth: Power Automate "SAM - morning digest" (id `c501a37d-4811-462e-9ba1-4b502eeb82fd`, created **Stopped**) → `GET /api/v1/digest` (auth: `Bearer <SP_WEBHOOK_SECRET>`) → Outlook "Send an email (V2)" from siddharth@newsletter.accops.com (his main Outlook connection has been broken since the 23 Jul password reset). Subject from the `X-SAM-Subject` header. **Waiting for Siddharth to paste the secret over `PASTE_SP_WEBHOOK_SECRET_HERE` and switch the flow on** | `web/app/api/v1/digest/route.ts`, `web/lib/digest.ts` |

Siddharth decisions, 29 Sep: the ISO certificate stays without a warning (final); he owns the content-request queue; free Vercel AI Gateway models are not used (no ZDR / may train on inputs).

---

## 28 September 2026: answer quality, and ready for the rep demo

| | |
|---|---|
| Salesperson test (35 realistic questions, strict rubric) | 25 Sep 11 happy → 26 Sep 11 → 27 Sep 16 → 27 Sep #2 21 → **28 Sep #3: 19 happy / 12 honest gaps / 4 unsatisfying / 0 false gaps** (31 of #3's answers came from the 20b fallback because 120b's daily limit ran out). Full history: `docs/PERSONA-RETEST-2026-09-26.md` |
| Answer contract | The model returns one verdict sentence + `PICKS: n, n`. SAM writes every document line from the card (title, year, visibility, card text, trust note) and a sendability line from visibility (`sendLine`). `verdictProblem()` replaces a risky verdict with "Best matches in the library." (3 of 35 in run #3). Invented coverage claims in document lines: structurally impossible |
| Guards | `ensurePublished` (sending asks get a relevant public doc first), `dropSending` (model never claims sendability), `namedFirst` (no-exact substitutes lead with the named product/type), entity coverage by title/filename/client/industry, newer edition first, pricing only from a current price list |
| Demo | `docs/DEMO-SCRIPT.md` rewritten 28 Sep: 7 beats, every question verified in production, a pre-demo checklist, questions to avoid, follow-up questions for reps |
| Known remaining | A competitor mentioned as background ("moving off citrix") can become a required entity on the 20b model; `dropSending` sometimes cuts a useful clause; weak substitutes on some honest gaps (data residency, GCC, SEA); Groq 120b daily token limit (200k) is exhausted by a full test run |
| Checks | `node web/lib/{agent,cards,metrics,snapshot,requests}.check.mjs` — agent 183 assertions. Offline replay harness: `research/replay.mjs` (gitignored) reproduces production answers from dumped cards + traces |

---

## 26 September 2026: the whole library is carded

| | |
|---|---|
| Cards | **311** in `sam_asset_cards` (batches 01-12 in `corpus/cards/`). Uncarded queue: **0**. All 876 SharePoint files are carded, archived, or deliberately excluded |
| Corpus source | SharePoint Sales Collateral synced by OneDrive to `%USERPROFILE%\OneDrive - Accops Systems Private Limited\Company - Sales Collateral` (876 files, 13.9 GB). This bypasses the Graph Conditional Access block. Queue files are copied into `corpus/sharepoint/` and extracted with `prototype/extract_text.py`; the >50 MB decks extract fine (the size is images) |
| Content requests | Live: substitutes when the exact thing is missing (`missing` separate from `zero`), an "Ask marketing to create this" button, `/requests` for reps, a Requests tab in `/admin` ranked by distinct reps, WhatsApp `REQUEST`, delivery notifications. Tables `sam_content_requests` + `sam_content_request_votes`. Nobody owns the queue in marketing yet |
| New guards | "Internal only: do not send outside Accops" appended in code when an internal asset is recommended in sending language (`guardSending`). superseded_by filenames containing " - " no longer truncate (`supersedingFile`) |
| Registry cleanup | Dead-folder rule now also catches `to_be_deleted` and the misspelled `_archieved` (48 rows). Gartner "Past Symposium Presentations" excluded from carding. Three files holding customer personal/production data archived and their cards removed |
| Marketing report | `docs/CONTENT-GAPS-2026-09-25.md`: the missing content, plus everything carding found. **Urgent:** the CEO's personal identifiers are on a slide in customer and "sharable" partner decks; "public" partner editions contain the USD 500M ARR target, launch dates and partner tier thresholds; staff mobile numbers in event decks; customer production data in Sales Collateral |
| Carding rule | Cards must never contain credentials, phone numbers, bank details, personal emails, customer IDs, usernames or IPs. One leak (NanoOS installer credentials) was found and scrubbed |
| Sessions | This laptop crashed the Claude session several times while several agents ran. Run one heavy agent at a time and have agents commit every few cards |

**Still needs Siddharth:** the ISO warning decision (SAM calls the expired 2013 certificate "suitable for RFP compliance"); `"mode": "report"` → `"write"` in the Power Automate flow "SAM - daily SharePoint snapshot" (the classifier blocks Claude from editing shared flows); a marketing owner for the content-request queue; the rep demo.

---

## 25 September 2026: state after one long session

Scope is fixed: SAM is Accops' sales & marketing brain. Siddharth said explicitly not to widen it to
other departments. The website chatbot is P8, the last phase: see `NOTE-website-chatbot.md`.

| | |
|---|---|
| Answer quality, real model | **89% hit@3** in the paced production eval (was 64% this morning). The two remaining non-content misses were fixed after that run and verified individually; a full re-run would project 27/28. The one remaining miss (Q8) is a genuine gap: no public government VDI asset |
| Invented documents | **0**: a code-enforced grounding guard (`finish()` in `web/lib/agent.ts`). `prototype/eval.mjs` also fails the run on any ungrounded name |
| How answers work now | The rep's own words are always searched first (`seedSearch`, the "retrieval floor"), handed to the model as a tool result; the model can add up to 2 searches; the last round is forced to answer. Audience (internal/external) is decided server-side. A denial that names no document is a gap with no cards |
| Tokens per question | ~1,260 (was ~5-6k) |
| Groq capacity | **Real ceiling.** `gpt-oss-120b` hits a tokens-per-DAY limit; 25 Sep testing exhausted it and `gpt-oss-20b` (the automatic fallback, `OPENAI_COMPAT_FALLBACK_MODEL`) answered most of the final eval, scoring 89% itself. Expect ~150 questions/day on 120b before the fallback takes over |
| Dashboard | `/admin` rebuilt: Overview, Usage, Quality, Content, System, Conversations. Aggregates come from Postgres (`sam_dashboard` RPC, `docs/supabase-sam-observability.sql`). Test traffic excluded by default: `is_test` column, `x-sam-test: 1` header, `SAM_TEST_USERS` (default `dwight-test,dwight-siddharth`), and anything from `next dev` |
| Error logging | Every question records `error_kind` (provider_error, fallback_retrieval, timeout, empty_answer, step_exhausted, server_error), `model`, `answer`, `result_titles`. Rates count only `schema_version = 2` rows |
| Real usage | Still ~1 person. Nobody but Siddharth has used SAM; the demo to reps has not happened |
| Carding queue | `sam_carding_queue` view + `GET /api/v1/carding-queue`: 367 files need a card, including 2 new since 8 Sep |
| Renames | Cards are bound to the registry `item_id` by `load_cards.py`, so a SharePoint rename no longer splits a card from its link |
| Deletions | `POST /api/channels/sharepoint/snapshot` (guarded: refuses empty, truncated, capped or <90% listings). Power Automate flow "SAM - daily SharePoint snapshot" (`7fe4a4f0-301a-43b3-8c47-928752f4f822`) exists but is **STOPPED with a placeholder secret**: Siddharth must paste it (`TASK-snapshot-flow.md`), then run report mode, then switch to write |
| Registry cleanup | 209 rows under `_to_delete` folders archived; temp/shortcut/CSV files no longer answer. 511 answerable assets |

**Needs Siddharth:**
1. Paste the webhook secret into the snapshot flow (1 minute; `TASK-snapshot-flow.md`).
2. The production web password no longer matches `web/.env.deploy.local`, so no agent could test the chat UI as a logged-in user in production. Sign in once; update the file if Claude should run browser tests.
3. What is `Company Certifications/SOC-Accops.pdf`? One model run called it "SOC 2 compliance"; the Gartner card says ISO 27001 only.
4. Run the rep demo (`DEMO-SCRIPT.md`): real questions are what the eval, feedback and gap reports need. Space questions ~30 s apart and avoid heavy testing the same day (Groq's daily limit).
5. Optional: `NO_PRICING` in `web/lib/agent.ts` says "check with your sales manager"; replace with whoever owns pricing.

**For Claude:** the Vercel CLI token on this laptop has expired (`vercel login`); verify deploys by behaviour instead (the trace step "the rep's own words" proves the current build). Check scripts: `node web/lib/{agent,cards,metrics,snapshot}.check.mjs`. Paced eval: `SAM_API_TOKEN=... node prototype/eval.mjs` (~11 min).

---

## Where things stand

SAM is live at https://sam-accops.vercel.app. Every channel works: web chat, WhatsApp, REST, MCP.
Teams is the only unbuilt one and Siddharth has deferred it.

**Updated 8 September 2026.**

| | |
|---|---|
| Registry | 874 SharePoint rows, live |
| Answerable | 678 assets after merge and dedupe (was 702 before the PDF/PPTX twins collapsed) |
| With a working link | 626 |
| Cards from real documents | **46**, in Supabase and read by every channel |
| Assets with a publication date | 46, read from the document body not the filename |
| Eval | **89% hit@3** against an 85% threshold, up from 86% |
| Power Automate | create/modify flow proven writing; delete trigger never fires |
| Nightly cron | `web/vercel.json`, 02:30 UTC - **reports only, does not reconcile** |

Read `docs/ROADMAP.md` first - it is verified against the deployed app rather than restating a plan.

## The one thing to know before starting

**Siddharth is downloading the whole Sales Collateral folder** (12.6 GB, 874 files) to
`corpus/sharepoint/`. It may or may not be there yet. Do not assume; look.

Carding order, agreed and reasoned in `docs/download-list.md`:

1. **The 27 in `docs/demo-corpus.md`** - enough for the demo and the eval set
2. **The 138 PDFs (0.4 GB total)** - cleanest extraction, the types reps actually send
3. **Remaining Office files under 50 MB** (377 files, 3.0 GB) once card quality has held
4. **The 36 files over 50 MB** - 3.3 GB, half the volume, mostly image-heavy event decks. Probably never.

**Downloaded is not ingested.** Extraction and review scale with file count, not bytes. Every card
should be sanity-checked before a rep sees it; that check is the gate build-order step 2 exists for.
Do not bulk-card 413 documents and call it done.

## Two live constraints

**Microsoft Graph is blocked.** A Conditional Access policy the Azure CLI cannot satisfy - a fresh
interactive `az login` does not clear it, which rules out a stale token. Graph and SharePoint REST
both 401; the Power Automate Flow API still works, which is how we know it is scoped to document
access rather than a broken login. `prototype/sp_fetch.py` is correct and ready but will fail. Do not
spend time on it. Details in `corpus/README.md`.

**The SharePoint delete trigger never fires.** It needs a site-collection-admin connection. Verified:
the modify flow ran five times on a real test while the delete flow ran zero, with identical config.
Deletions are caught by `prototype/sp_reconcile.py` instead, which needs no admin. **Run it before
any demo** - it takes a minute and stops SAM showing a link to a deleted file. The dashboard shows a
banner when it has not run in 36 hours.

> **Corrected 8 September: the reconcile is also blocked by Conditional Access, and it used to fail
> dangerously.** It walks the folder through Graph, and Graph 401s on that folder for the same reason
> `sp_fetch.py` does - the `az` token is valid, the listing is refused. The walk swallowed the 401 and
> returned an empty set, so every registry row looked deleted: it reported **"to tombstone: 874"**,
> the entire catalogue. `--write` would have taken SAM offline and looked like a clean run doing it.
> Now guarded - it refuses to write on any failed listing or a zero-file result, verified against the
> live 401. **So deletions are currently not being caught at all.** Report-only still runs; it just
> cannot see anything. Closing this needs the same Graph access the whole Conditional Access block
> covers, which is a Siddharth/IT item, not a code one.

## What changed on 8 September

Carding, then wiring it in. All 27 documents in `docs/demo-corpus.md` are carded (34 cards with the
7 from the public bucket), loaded into `sam_asset_cards`, and merged into every channel's answers.

Three things worth knowing because they change what SAM says:

- **The ISO 27001 certificate on file states validity to 20 September 2024.** Carding surfaced this
  and SAM initially warned before a rep could send it. **Siddharth's call on 8 September was to
  remove the warning entirely**, so SAM now returns the certificate with no caveat. The dates remain
  visible in the card's outcomes and brief. Noted here because it is a deliberate decision, not a
  gap: a rep sending it is relying on their own judgement, not on SAM flagging it.
- **The 2025 Gartner MQ places Accops as a Niche Player** and records that Accops holds ISO 27001 and
  no other compliance certificates. That is the sourced answer to "do we have a SOC 2 report?" - no.
- **`2026-06-11-Accops vs other VDI providers.pptx` is dated 29 NOV 2022** on its own title slide.
  The filename is a SharePoint touch date. SAM now reports 2022 and marks it stale, which is why
  publication year had to be read from the document body rather than inferred.

The system prompt had also gone stale in a way that was actively suppressing correct answers: it
told the model Accops has **no decks or battlecards** (there are 552 decks and 8 competitive assets)
and that **nothing has a public link** (7 carded assets are sendable). Both fixed.

## What live UI testing found that API testing did not

Siddharth signed in on 8 September and ran six real queries. Four bugs, none of which curl showed:

1. **"We don't have a HySecure datasheet."** SAM holds two, both carded. An asset survived search
   on ANY single token, so everything mentioning HySecure ranked alongside the real datasheets and
   the model - handed three near-equal results - concluded there was no datasheet. Complete matches
   now score far higher. *This is the failure mode to watch for: SAM denying an asset it holds.*
2. **Titles rendered as a vertical column of single words** with the SharePoint path overlapping
   them. `.side` had no width cap and `.where` had no CSS rule at all.
3. **"Logged as a content gap" above three good assets.** The gap keyed off whether the model's
   FIRST search returned zero and was never revised, so a question answered on the second search
   still reported a gap - two signals contradicting each other on one screen.
4. **35 documents listed twice.** `dedupeKey` stripped `.pdf` and `.docx` but not `.pptx`, so a
   document saved in both formats never collapsed.

Two stale claims were also still live in code after the prompt fix: the exhausted-budget fallback
told reps the library holds "case studies and whitepapers only", and the local path appended "All of
these are internal only" even to assets with public links.

**The lesson, and it is the same one as always: test in the real UI.** Every one of these was
invisible from the API.

## What needs Siddharth, not Claude

1. **Replace the 20 `[modelled]` eval questions** in `docs/eval-set.md` with real asks. The honest way
   is to let `sam_events` fill up over a few weeks and take the ten most common, not to invent more.
2. **11 ambiguous public-link matches** - run `python prototype/sp_match_public.py`. They are
   anonymised on both sides ("3rd largest Public Bank" vs "India's Largest Private Bank"), so only
   someone who knows the customers can resolve them.
3. **The other 29 S3 filenames.** `downloads.accops.com` is publicly readable per object but listing
   is 403. Only 14 of 43 names are known. `aws s3 ls s3://downloads.accops.com/ --recursive` gets the
   rest, and every match becomes a direct-PDF public link.
4. **A current ISO 27001 certificate, if you want one in the library.** The copy on file states
   validity to 20 September 2024. Gartner's 2025 MQ independently records that Accops holds ISO
   27001, so it was almost certainly renewed and simply is not in Sales Collateral. **Deprioritised
   8 September** - Siddharth's view is this is not a sales-critical document. Drop a newer file in
   and re-run `python prototype/extract_text.py` plus the carding step if that changes.
5. **Add `CRON_SECRET` to the Vercel project.** Any random 16+ character string. Vercel then sends it
   as `Authorization: Bearer <value>` on every cron run, and `/api/cron/sharepoint` stops being
   publicly readable. It exposes aggregate counts only, so this is tidiness rather than urgency.
6. **A production API token, if the model side needs verifying.** The system-prompt changes have not
   been exercised against a real model - the local runtime has no model key and falls back to
   retrieval-only. Ask SAM in production for the ISO certificate: the answer should say it has
   expired rather than offer it.

## The carding boundary, which must not drift

Siddharth's design, and the reason the whole thing is defensible:

> Claude Enterprise reads the documents and writes the cards. The cards go to Supabase. Groq reads
> only the cards. No original file is ever ingested by SAM or sent to a free-tier model.

Downloading private documents for carding is a **build-time exception** granted on 7 September. The
runtime rule is unchanged: SAM never serves a private file body to a user, and nothing under `web/`
reads `corpus/`. If that ever changes, the InfoSec argument for the WhatsApp channel goes with it.

Two refinements to apply **while** carding, not after - they are cheap now and painful to retrofit:
split the card so the model sees a leaner projection than the browser, and write `client_actual`
separately from the descriptive `client`. See ROADMAP section 4.

## The lesson this project keeps re-learning

Four times now, something looked healthy from the outside and was not:

- Dry-run tests passed while only ever exercising the happy path
- Links were checked for being *present*, never for *resolving* - 71 of them 404'd
- Power Automate showed ten green runs while writing nothing at all
- A public-link matcher reported 31 confident matches at 1.00, and most were wrong
- A cache reported "fresh" while holding zero rows, silently serving 74 cards instead of 696

**Check the data, not the status.** A green run, a present link, a high confidence score and a warm
cache are all things that can be true while the system is broken.

---

## Prompt for the next session

> I'm continuing work on SAM, my sales and marketing collateral assistant - live at
> https://sam-accops.vercel.app, repo is this one (`~/sam-accops`).
>
> Read `docs/HANDOVER.md` first, then `docs/ROADMAP.md`. Between them they have the current state,
> what is blocked and why, and what needs me rather than you.
>
> I have downloaded the whole Sales Collateral folder to `corpus/sharepoint/`. Check what is actually
> there before planning anything.
>
> Today's job is carding. Start with the 27 documents in `docs/demo-corpus.md`, then the PDFs. Run
> `python prototype/extract_text.py` first, then write cards the way `corpus/cards/batch-01.json` and
> `batch-02.json` do - and **do the comparison against the existing hand-written cards** for anything
> that has one. That comparison is the quality gate, and it has already caught a card with zero key
> outcomes that the document clearly supported.
>
> Three things to know. Microsoft Graph is blocked by a Conditional Access policy, so do not attempt
> `sp_fetch.py` - I download files through the browser. The SharePoint delete trigger needs
> site-collection-admin and never fires, so `prototype/sp_reconcile.py` catches deletions instead and
> should be run before any demo. And SAM is a tracker: it never writes to SharePoint and nothing under
> `web/` reads `corpus/`.
>
> After carding, re-run the eval - `SAM_API_TOKEN=<local token> node prototype/eval.mjs --base
> http://localhost:3000` - and tell me whether it moved. It is at 86% now.
>
> Commit and push after each working step. Vercel deploys from `main`, and commits must be authored as
> siddharth.g25pgdm@gmail.com.
