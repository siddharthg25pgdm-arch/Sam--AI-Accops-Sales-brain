# Handover: next session

**Written 7 September 2026.** Paste the prompt at the bottom into a fresh session.

---

## Where things stand

SAM is live at https://sam-accops.vercel.app. Every channel works: web chat, WhatsApp, REST, MCP.
Teams is the only unbuilt one and Siddharth has deferred it.

**Updated 8 September 2026.**

| | |
|---|---|
| Registry | 874 SharePoint rows, live |
| Answerable | 702 assets after merge and dedupe |
| With a working link | 650 |
| Cards from real documents | **34**, in Supabase and read by every channel |
| Assets with a publication date | 34, read from the document body not the filename |
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

- **The ISO 27001 certificate expired on 20 September 2024** and is exactly what a rep sends when
  procurement asks. Asking SAM for it now returns "EXPIRED on 2024-09-20 - do not send".
- **The 2025 Gartner MQ places Accops as a Niche Player** and records that Accops holds ISO 27001 and
  no other compliance certificates. That is the sourced answer to "do we have a SOC 2 report?" - no.
- **`2026-06-11-Accops vs other VDI providers.pptx` is dated 29 NOV 2022** on its own title slide.
  The filename is a SharePoint touch date. SAM now reports 2022 and marks it stale, which is why
  publication year had to be read from the document body rather than inferred.

The system prompt had also gone stale in a way that was actively suppressing correct answers: it
told the model Accops has **no decks or battlecards** (there are 552 decks and 8 competitive assets)
and that **nothing has a public link** (7 carded assets are sendable). Both fixed.

## What needs Siddharth, not Claude

1. **Replace the 20 `[modelled]` eval questions** in `docs/eval-set.md` with real asks. The honest way
   is to let `sam_events` fill up over a few weeks and take the ten most common, not to invent more.
2. **11 ambiguous public-link matches** - run `python prototype/sp_match_public.py`. They are
   anonymised on both sides ("3rd largest Public Bank" vs "India's Largest Private Bank"), so only
   someone who knows the customers can resolve them.
3. **The other 29 S3 filenames.** `downloads.accops.com` is publicly readable per object but listing
   is 403. Only 14 of 43 names are known. `aws s3 ls s3://downloads.accops.com/ --recursive` gets the
   rest, and every match becomes a direct-PDF public link.
4. **A current ISO 27001 certificate.** The one in the library expired 20 September 2024, and it is
   what procurement asks for. Gartner independently records that Accops holds ISO 27001, so it was
   almost certainly renewed - the current certificate is simply not in Sales Collateral. Drop the new
   file in and re-run `python prototype/extract_text.py` then the carding step.
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
