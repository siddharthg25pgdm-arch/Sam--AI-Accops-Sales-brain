---
name: sam-nightly-carding
description: Nightly SAM carding job - cards new and edited Sales Collateral files from the OneDrive-synced SharePoint folder, loads the cards into SAM, commits and pushes. Run by Windows Task Scheduler at 07:00 IST; invoke as /sam-nightly-carding.
---

# SAM nightly carding

Runs unattended before Siddharth's 08:30 morning digest. The digest reports what this job carded
(cards with `carded_at` in the last 24 h) and what it left for a human. Work in
`C:/Users/Siddharth.gupta/sam-accops`. Python: `prototype/.venv/Scripts/python.exe`; always set
`PYTHONIOENCODING=utf-8`. Keep memory use low: one document at a time.

## Rules (non-negotiable)

- **The carding boundary.** Only you (Claude) read document bodies to write cards. The card goes to
  Supabase via `prototype/load_cards.py`; since 17 Oct 2026 (Siddharth's decision) the document's
  passages go there too, via `prototype/build_passages.py` (scrubbed text, service role only; see
  corpus/README.md). Never send document text anywhere else.
- **No sensitive values in cards**: passwords/credentials, phone numbers, bank details, personal
  emails, customer IDs, employee usernames/hours, IP/MAC addresses. Describe their presence instead
  ("contains staff phone numbers").
- Never invent. Card only what the document says; if the text is empty, card from title/folder with
  `confidence` ≤ 0.5 and say so in `needs_human`. If the FILE itself is empty or blank (a deck with one
  blank slide, a placeholder), set `confidence` ≤ 0.5 and put the word "empty" or "blank" in
  `needs_human`: that takes it out of answers (sam_card_says_empty / cardSaysEmpty).
- **Tags come from the brain's master lists** (Supabase `core.terms`, readable as `public.core_terms`).
  `industry` and `asset_type` MUST be a listed label or alias - the database rejects anything else and
  the whole load fails. Leave `industry` empty when the document names no industry (it is stored as
  Cross-industry). Industries: BFSI, Government, Pharma / Healthcare, Manufacturing, IT / ITeS,
  Education, E-commerce / Retail, Media, Telecom, Cross-industry. A genuinely new product or competitor
  is fine (stored as written, listed in `public.core_unmapped` for review); a new industry or asset type
  needs a row in core.terms first - log it for a human instead of inventing one.
- Commits are authored as siddharth.g25pgdm@gmail.com (check `git config user.email`). Messages end
  with the Co-Authored-By line from your session's attribution instructions. Only commit
  `corpus/cards/*.json`. Never commit anything else under `corpus/`.

## Steps

1. `git pull --ff-only` (stop and log if it fails).
2. Run `prototype/carding_prep.py` (default limit 15). It reads the carding queue, copies each file
   from OneDrive into `corpus/sharepoint/`, extracts text, and writes `corpus/queue-tonight.json`
   (`todo`, `skipped`), and records its own run in `sam_ops_runs` (job `carding_prep`). If `todo` is
   empty, do step 7 with "nothing to card" and stop.
3. Read `corpus/cards/batch-13.json` and two cards from `batch-12.json` for the exact schema and
   conventions (`source: "sharepoint/<filename>"`, `client` anonymised vs `client_actual`,
   `publish_year` from the body never the filename, `superseded_by` as
   `sharepoint/<file.ext> - why` only when verified, `visibility` internal unless a verified public
   URL, `stale_risk`, `needs_human`).
4. For each `todo` item, one at a time, read its text file:
   - `uncarded`: write a new card into `corpus/cards/batch-auto-<YYYY-MM-DD>.json` (a JSON list;
     `batch: "auto-<YYYY-MM-DD>"`). Save the file after every card.
   - `changed_since_card`: find the existing card in its batch file - by `card_source` when the todo
     item has one (a renamed-and-edited file: keep that `source`, the card is bound to the file by
     item_id), else by the same `source` - and update it from the new text in place (so `carded_at`
     moves). Note what changed in `needs_human` only if a rep should know (e.g. figures changed, now
     superseded).
   - Pure renames never reach `todo` (carding_prep skips them: the bound card still fits).
   - Files from a root other than Sales Collateral (`root` on the todo item; 2025_Sales Enablement is
     sales tools): playbooks, cheat sheets, discovery and quick-reference docs are `asset_type` "Sales
     Tool"; templates are "Template"; spreadsheets (calculators, trackers) are "Sales Tool" and their
     card never quotes a figure from a cell. `publish_year` from the body only - the folder name
     ("2025_...") and that root's file dates (all 15 Jan 2026, a bulk copy) are not a year. Industries
     with no core.terms label (Critical Infra / Utilities) stay empty and go in the log for a human.
5. Gate: `prototype/compare_cards.py` (fix real problems in tonight's cards), validate every changed
   batch file is valid JSON, scan tonight's cards for the sensitive patterns above,
   `prototype/card_grounding.py --batch <each changed batch file>` (every figure on a card must be in
   that file's own text: fix a figure that is wrong or came from another document; if it was read from
   an image or is your own count, say so in the card's wording or `needs_human`), then
   `load_cards.py --dry-run`, `load_cards.py`, `load_cards.py --check` (must show 0 missing, 0 extra,
   0 title differences).
   Then passages (needs `docs/supabase-sam-passages.sql` applied; skip with a `warn` if it is not):
   `prototype/build_passages.py --dry-run`, then `prototype/build_passages.py` (uploads only documents
   whose text, audience or extractor changed; honours `SAM_PASSAGES_INTERNAL=0`).
6. `git add corpus/cards/*.json && git commit -m "carding (nightly): N new, M updated - <short list>"`
   then `git push`.
7. Record the outcome, both places, always (also for "nothing to card" and for a failure):
   - append one line to `C:/Users/Siddharth.gupta/.claude/logs/sam-nightly-carding.log`:
     `<ISO time> carded N new, M updated, K skipped (<reasons>), commit <hash>` - or the failure;
   - `grep -q -- --log-run prototype/carding_prep.py && prototype/.venv/Scripts/python.exe prototype/carding_prep.py --log-run carding <status> "<same line>"`
     (the grep guards a checkout that predates run logging: there, `--log-run` would start a real prep)
     where status is `ok` (carded and loaded, or nothing to card), `warn` (done, but something was left
     for a human: cards not loaded, a skipped gate, unbacked figures left on a card) or `failed`. This row is what the
     System tab's Scheduled jobs panel and the morning digest read; without it the night looks missed.

If anything fails midway, do not load a card file that fails the gate; commit only card files that
passed the gate (load_cards.py loads every batch file each night, so a committed-but-unloaded card is
loaded by the next good run), and log the failure plainly (step 7 with `failed`). The morning digest
shows whatever is still in the queue, and raises any file waiting more than 3 days.

A new root's first backlog (hundreds of files) is not a nightly job: run it in a supervised session
with `carding_prep.py --limit 40`, a few batches, committing after each.
