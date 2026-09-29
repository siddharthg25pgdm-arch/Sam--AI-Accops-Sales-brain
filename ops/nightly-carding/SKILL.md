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

- **The carding boundary.** Only you (Claude) read document bodies. Only the card goes to Supabase,
  via `prototype/load_cards.py`. Never send document text anywhere else.
- **No sensitive values in cards**: passwords/credentials, phone numbers, bank details, personal
  emails, customer IDs, employee usernames/hours, IP/MAC addresses. Describe their presence instead
  ("contains staff phone numbers").
- Never invent. Card only what the document says; if the text is empty, card from title/folder with
  `confidence` ≤ 0.5 and say so in `needs_human`.
- Commits are authored as siddharth.g25pgdm@gmail.com (check `git config user.email`). Messages end
  with the Co-Authored-By line from your session's attribution instructions. Only commit
  `corpus/cards/*.json`. Never commit anything else under `corpus/`.

## Steps

1. `git pull --ff-only` (stop and log if it fails).
2. Run `prototype/carding_prep.py` (default limit 15). It reads the carding queue, copies each file
   from OneDrive into `corpus/sharepoint/`, extracts text, and writes `corpus/queue-tonight.json`
   (`todo`, `skipped`). If `todo` is empty, log "nothing to card" and stop.
3. Read `corpus/cards/batch-13.json` and two cards from `batch-12.json` for the exact schema and
   conventions (`source: "sharepoint/<filename>"`, `client` anonymised vs `client_actual`,
   `publish_year` from the body never the filename, `superseded_by` as
   `sharepoint/<file.ext> - why` only when verified, `visibility` internal unless a verified public
   URL, `stale_risk`, `needs_human`).
4. For each `todo` item, one at a time, read its text file:
   - `uncarded`: write a new card into `corpus/cards/batch-auto-<YYYY-MM-DD>.json` (a JSON list;
     `batch: "auto-<YYYY-MM-DD>"`). Save the file after every card.
   - `changed_since_card`: find the existing card with the same `source` in its batch file and
     update it from the new text in place (so `carded_at` moves). Note what changed in
     `needs_human` only if a rep should know (e.g. figures changed, now superseded).
   - `renamed`: do not edit; list it in the log for a human.
5. Gate: `prototype/compare_cards.py` (fix real problems in tonight's cards), validate every changed
   batch file is valid JSON, scan tonight's cards for the sensitive patterns above, then
   `load_cards.py --dry-run`, `load_cards.py`, `load_cards.py --check` (must show 0 missing, 0 extra,
   0 title differences).
6. `git add corpus/cards/*.json && git commit -m "carding (nightly): N new, M updated - <short list>"`
   then `git push`.
7. Append one line to `C:/Users/Siddharth.gupta/.claude/logs/sam-nightly-carding.log`:
   `<ISO time> carded N new, M updated, K skipped (<reasons>), commit <hash>` - or the failure.

If anything fails midway, commit what is valid, do not load a card file that fails the gate, and log
the failure plainly. The morning digest will show whatever is still in the queue.
