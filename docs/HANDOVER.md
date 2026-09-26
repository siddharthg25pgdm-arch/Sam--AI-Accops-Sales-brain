# Handover: next session

**Written 7 September 2026, updated 25 September 2026.** Paste the prompt at the bottom into a fresh session.
The 25 September section below supersedes anything older it contradicts.

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
