# SAM build log: how the Accops Sales Brain was built

**4 September – 1 October 2026.** 12 working days, 277 commits. Live at https://sam-accops.vercel.app.

This is the timeline in one place. For the current state and the next task, read [HANDOVER.md](HANDOVER.md) ("NEXT SESSION - start here"). For every commit, run `git log --reverse --format='%ad %s' --date=short`.

---

## What SAM is, in one paragraph

SAM is a RAG tool for sales and marketing collateral. The documents live in SharePoint Sales Collateral (about 876 files). Power Automate keeps a registry of them in Supabase. Claude reads each document once and writes a "card": a summary with type, year, visibility and outcomes, but never credentials or personal data. A model (OpenAI gpt-6-luna, falling back to Groq) reads only the cards, never the files. It picks the best matches for a rep's question, and SAM writes every document line itself from the card. The same brain answers on web chat, WhatsApp, a REST API and MCP. Since 30 Sep it is also a platform other tools can build on (the "Sales Brain v1" contract).

---

## The numbers over time

| Date | Cards | Answerable assets | Eval hit@3 (30 qs) | Salesperson test (35 qs, happy) |
|---|---|---|---|---|
| 4 Sep | 77 hand cards (frozen JSON) | 66 | none | none |
| 6 Sep | 77 | 696 (registry joined) | none | none |
| 7 Sep | 3 from real docs | 696 | 82% → 86% | none |
| 8 Sep | 46 | 678 | 89% | none |
| 25 Sep | 128 → 270 | 511 | 64% → 89% | 11 |
| 26 Sep | 311 (library fully carded) | ~475 | none | 11 |
| 27–28 Sep | 317 | ~475 | 79% (after the rewrite) | 16 → 21 → 19, 0 false gaps |
| 30 Sep | 317 | 254–283 (families + pre-2024 rule) | **28/28** (Groq 120b) | none |
| 1 Oct | 317 | 283 | **27/28** (gpt-6-luna) | none |

The answerable count went *down* on 30 Sep on purpose. Older versions and pre-2024 documents stopped answering, so a rep gets one current copy instead of five.

---

## Timeline

### 4 Sep: design, prototype, and every channel in one day
- Design proposal v0.2 → v0.8, query-flow simulation, and a "Steve Jobs protocol" design review.
- Prototype 0: Streamlit + agent + local RAG over 77 hand-written asset cards. The Google ADK/Gemini path was dropped and Claude was used for the prototype.
- **Web app v1** (Next.js 16 on Vercel): chat bot, faceted catalogue, "Not available" gaps, admin page.
- **REST API** (`/api/v1/search, ask, assets, gaps, public-link, context`) and a **streamable-HTTP MCP server** (`/api/mcp`), both with bearer tokens.
- **WhatsApp** on Meta's Cloud API: signed webhook, mapping from phone number to login, dry-run mode. A real message was answered the same day.
- Runtime model: **Groq gpt-oss-120b**, with provider failures shown in the trace rather than hidden. The `/api/v1/provider` diagnostics were added.
- AES-256 encrypted secrets store in the repo, with RECOVERY.md.
- First fixes from real use: a false gap on "something to send externally", and 71 constructed SharePoint URLs that returned 404, so links were suppressed. Dedupe: 74 cards turned out to be 66 documents.

### 5–6 Sep: the SharePoint registry
- The whole Sales Collateral library was walked through Microsoft Graph. **874 rows loaded into Supabase** (`sam_sharepoint_files`) and verified against Graph.
- **Two Power Automate flows** (file changed, file deleted), with no Entra app registration needed. The delete key was built so it cannot misfire.
- **P0: the registry was joined to the agent.** Answerable assets went from 66 to 696, 630 with real links, 552 decks, 37 competitive assets. "Accops vs Citrix" became answerable.
- Daily metrics rollup in Postgres, plus dashboard panels for channels, response times and the corpus.
- **The carding boundary was decided** (Siddharth's design): Claude reads documents and writes cards, and the runtime model reads only cards.
- `ROADMAP.md` was written, verified against the deployed app.

### 7 Sep: operations, links, eval
- The first real flow notification exposed two bugs that a green run had hidden.
- Dashboard additions: gap worklist ranked by distinct askers, per-user adoption, stale assets by owner, CSV export.
- WhatsApp session ids; `request_publish` (table, route, MCP tool, approver queue).
- **11 public links**, up from 0. A matcher scoring "31 confident matches at 1.00" turned out to be mostly wrong, and was fixed.
- **Eval harness**: 30 questions and `prototype/eval.mjs`, scoring 82% → 86%.
- Bug: a failed cache refresh made SAM report "fresh" while holding 74 cards instead of 696. Readers now check contents, not timestamps.
- The SharePoint delete trigger never fires: it needs site-collection admin. A reconcile script was written instead.
- First 3 cards from real documents, demo corpus of 32 picked.

### 8 Sep: real cards in the answer path
- **The 27-document demo corpus was carded** (34 cards, later 46). A quality gate (`compare_cards.py`) caught four dropped outcomes.
- `sam_asset_cards` table and loader; cards wired into every channel. Eval 86% → 89%.
- Trust notes (expired / superseded / old), with publication year read from the document body. One "2026" deck was dated 2022 on its own title slide.
- The Graph reconcile was also blocked by Conditional Access. Worse, it would have tombstoned all 874 rows. It was guarded to refuse to write.
- Nightly Vercel cron (reports only). **ISO warning removed** (Siddharth's decision).
- Siddharth's live UI test found 4 bugs the API never showed: a datasheet denied, broken title layout, a false gap banner, and 35 PDF/PPTX twins.

### 9–23 Sep: paused (no commits)

### 24–25 Sep: the long session
- System map (`sam-how-it-works.html`). The **website chatbot was noted as P8, the last phase**, with its analytics plan.
- Corpus integrity: carding queue view, cards bound to registry `item_id` (renames are safe), and a **deletion snapshot endpoint** fed by a Power Automate listing, with guards against truncated listings.
- Observability: test traffic flagged (`is_test`, `x-sam-test`), an error taxonomy, and the real runtime and answer text logged.
- **Admin dashboard rebuilt**: Overview, Usage, Quality, Content, System, Conversations, with aggregates in Postgres.
- Answer path hardened. A grounding guard (0 invented documents), a forced final answer, server-side audience, a retrieval floor (the rep's own words are always searched), and the 120b → 20b fallback. **Eval 64% → 89%.**
- **Content-request loop**: substitutes when something is missing, an "Ask marketing to create this" button, a Requests tab ranked by distinct reps, and WhatsApp `REQUEST`.
- First salesperson persona test: 11/35 happy. Gap report for marketing (`CONTENT-GAPS-2026-09-25.md`).
- **Corpus source switched to the OneDrive sync**, which bypasses the Graph block. Batches 07–11 carded (about 230 cards).
- Carding found sensitive content: the CEO's personal data in decks, "public" partner decks leaking ARR targets, and staff mobile numbers. Installer credentials were scrubbed from one card. Dead-folder rules now cover `_to_delete`, `to_be_deleted` and `_archieved`.

### 26 Sep: the whole library is carded
- Batch 12 done: **311 cards, queue 0.** Two cards for files holding customer production data were removed.
- Persona re-test: still 11 happy, but false gaps fell from 9 to 5.

### 27–28 Sep: the answer contract
- **The model only picks (`PICKS: n, n`). SAM writes every document line from the card**, plus a sendability line. Invented coverage claims became structurally impossible.
- Verdict guard, `ensurePublished`, `dropSending`, `namedFirst`, entity coverage, denials ("we have no…") get the request button. Batch 13 (public PDFs).
- Persona runs: **16 → 21 → 19 happy, 0 false gaps.** `DEMO-SCRIPT.md`: 7 beats verified in production.

### 29 Sep: the daily loop
- **Morning digest** `GET /api/v1/digest`: email-safe HTML with requests, gaps, library changes, usage and health.
- `carding_prep.py` plus the **nightly carding task** (Windows Task 07:00 → headless Claude → cards → gate → load → commit).
- The loop: change flow (continuous) → 02:00 deletion snapshot → 07:00 nightly carding → 08:30 digest email.

### 30 Sep: platform day
- Deletion snapshot switched to **write mode** (with Siddharth's go-ahead).
- WhatsApp token expiry warning in the digest (21 days ahead).
- **Feedback loop**: "doesn't exist" becomes a content-request vote; "wrong asset" from 2 or more reps demotes a document for that topic (60-day decay, clearable).
- **Eval 28/28** on Groq 120b.
- **P8 PRD** for the website chatbot (12 decisions with defaults).
- **OpenAI tier** added ahead of Groq (`OPENAI_API_KEY`, default gpt-6-luna).
- **Version families**: one answer slot per document. Older versions are hidden and editions become siblings. The TypeScript and SQL implementations agree on all 1,194 filenames.
- **Pre-2024 excluded, with exceptions**: certificates, analyst reports, regulations, third-party research, brand assets, plus pins.
- **Sales Brain v1**: canonical views (`sam_v1_assets/families/changes/public_assets`), a public-only role `sam_web_reader`, `/api/v1/brain/*` with OpenAPI 3.1, and `SALES-BRAIN-PLATFORM.md` as the contract for any tool.
- Ops run log (`sam_ops_runs`) for every scheduled job, and token use per model on the System tab.

### 1 Oct: OpenAI primary, and a security fix
- A key pasted three times made `/api/v1/provider` echo the full key in an error. **Fixed**: `redact.ts` scrubs every error, and `cleanKey` refuses malformed keys. Nothing reached the logs. **That key (ends …CQA) must still be revoked.**
- **gpt-6-luna is primary**: eval 27/28 (96%), p50 956 ms, about USD 0.0003 per question. Chain: luna → Groq 120b → 20b → retrieval.
- Test-only model pin (`--model` in eval.mjs) for a fair Groq vs OpenAI head-to-head.
- Siddharth's WhatsApp test: 4/4 questions answered by luna in 1.0–5.3 s, with correct documents and sendability.

---

## Decisions Siddharth made (and when)

| Date | Decision |
|---|---|
| 6 Sep | Carding boundary: only Claude reads document bodies; the runtime model sees cards only |
| 6 Sep | Public links: accops.com page first, PDF if one exists. Siddharth approves publish requests |
| 6 Sep | Freshness: 12 months, shown as a badge, never hidden. Platform first on a small sample, then ingest. Teams deferred |
| 8 Sep | No card column split (internal tool). ISO certificate shown with no warning (confirmed final 29 Sep) |
| 25 Sep | Scope is sales and marketing only, no other departments. Website chatbot is P8, the last phase |
| 29 Sep | Siddharth owns the content-request queue and gets the morning digest. Free Vercel AI Gateway models not used |
| 30 Sep | Snapshot to write mode. Pre-2024 excluded with exceptions. Brand assets exempt |
| 1 Oct | Never use gpt-6 Sol or Astra. Test the leaked key first, revoke it later |

---

## Lessons the build kept re-learning

1. **Check the data, not the status.** Ten green Power Automate runs had written nothing. "Fresh" caches held zero rows. Links were present but returned 404. A confidence of 1.00 was wrong. A reconcile would have deleted everything while looking clean.
2. **Test in the real UI.** The 8 Sep UI test found four bugs that curl never showed.
3. **The model picks, code writes.** Free-text answers invented coverage until SAM wrote every document line from the card.
4. **Grade against real questions.** 20 of the 30 eval questions are still modelled. Replace them from `sam_events` after the rep demo.
5. **This laptop (7.7 GB) crashes with several heavy agents.** Run one at a time and commit often.

---

## Where everything lives

| What | Where |
|---|---|
| Current state + next task | `docs/HANDOVER.md` (top: "NEXT SESSION - start here") |
| What's built vs left (P0–P8) | `docs/ROADMAP.md` |
| System map | `docs/sam-how-it-works.html` |
| Platform contract for new tools | `docs/SALES-BRAIN-PLATFORM.md`, `docs/sales-brain-openapi.json` |
| Database objects | `docs/supabase-*.sql` (Supabase project `iwqhayuoxnrhqzozznes`, `sam_` objects only) |
| Answer logic | `web/lib/agent.ts`, `agent-openai.ts`, `cards.ts`, `family.ts` |
| Cards | `corpus/cards/batch-*.json` → `sam_asset_cards` |
| Eval / persona tests | `docs/eval-set.md` + `prototype/eval.mjs`; `docs/PERSONA-RETEST-2026-09-26.md` |
| All checks | `node web/scripts/checks.mjs` |
| Marketing fixes found by carding | `docs/CONTENT-GAPS-2026-09-25.md` |
| Website chatbot (P8) | `docs/NOTE-website-chatbot.md`, `docs/PRD-website-chatbot.md` |
