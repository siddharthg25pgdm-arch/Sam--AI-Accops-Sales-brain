# Approval needed: website chatbot database (3 migrations)

**For:** Siddharth. **Written:** 26 Oct 2026. **Status:** nothing applied. Say "yes", "no" or what to change.
Build plan: [2026-10-26-website-chatbot-stage1.md](2026-10-26-website-chatbot-stage1.md), section 5.

## What it is, in one paragraph

The website chatbot needs its own small corner of the shared Supabase project: the public page cards and Q&A bank
it answers from, a log of what visitors asked, counters that stop abuse and cap model spend, and a 24-hour answer
cache. Everything is new and named `sam_web_*`. Nothing that exists today is changed, renamed or dropped, and no
trigger is added to an existing table. The website reaches the database only as the existing role `sam_web_reader`,
which can read three filtered views and call a fixed list of functions. It cannot read any table, including its own.

## What each migration creates

**1. `docs/supabase-sam-web-01-knowledge.sql`** (the knowledge)
- `sam_web_qa`: the Q&A bank. Loaded as drafts; only a pair a person marks approved can ever reach a visitor.
- `sam_web_pages`: one card per public page (accops.com and the Citrix LP), with verbatim quotes.
- `sam_web_page_rules`: which URL belongs to which page group (`citrix-lp`; everything else `general`).
- `sam_web_blocked_patterns`: claims that must never be shown until signed off (seeded: the 10x / 4x / 40% tiles, all TCO figures, the LP's $220 / $132 placeholder rates, "illustrative" / "placeholder" copy, the four licensing commitments, anything "pending sign-off", and all Gartner / Magic Quadrant wording).
- `sam_web_settings`: on/off switches, the 300-a-day model ceiling, the 40-a-day Groq cap, repeat limits, the CTA link and label.
- Triggers on these new tables only: set a page's group and strip blocked claims when it is written; bump the cache's "knowledge version" whenever the bank, pages, rules, blocked list or CTA change.
- `create extension if not exists pg_trgm`: already installed on the project, so a no-op.

**2. `docs/supabase-sam-web-02-public.sql`** (the only things the website can read)
- `sam_web_qa_public`: approved, sourced, not past review, no blocked claim.
- `sam_web_pages_public`: accops.com and the LP only, pages flagged for re-carding left out, blocked facts removed.
- `sam_web_assets_public`: the public PDF list (`sam_v1_public_assets`) minus regulator and third-party documents and any title with a blocked claim. Today that is 20 titles.
- `sam_web_settings()`: returns only on/off, model on/off, CTA link and label.
- `sam_web_page_group(url)`, `sam_web_roots(page_url)`, `sam_web_children(qa_id)`: the starting questions and follow-ups.
- `sam_web_search(q, page_group, k)`: up to 12 public candidates for a typed question.

**3. `docs/supabase-sam-web-03-log.sql`** (log, limits, spend cap, cache)
- `sam_web_conversations`, `sam_web_messages`, `sam_web_events`: what visitors did. Messages are the only place question text is kept; events take no free text.
- `sam_web_usage_daily`: model answers per India day. `sam_web_take_model_slot` reserves one before every model call, so the ceiling cannot be passed.
- `sam_web_rate` + `sam_web_admit`: 6 typed questions a minute and 20 a day per visitor, 60 a day per IP, and "talk to sales" on the 3rd repeat of a question.
- `sam_web_answer_cache` + `cache_get` / `cache_put`: shared answers, valid 24 hours and only until the knowledge changes.
- `sam_web_log_message`, `sam_web_log_event`: the website's only way to write.
- `sam_web_dashboard`, `sam_web_purge`: for the admin Website tab and retention. Service key only; the website cannot call them.

## Why it is safe

- **Additive.** New `sam_web_*` objects only. The single existing thing referenced is `sam_v1_public_assets`, read, never changed.
- **Closed by default.** Every table has row security on and no policies, and every grant to the public, anon and logged-in roles is revoked (Supabase grants new objects to them automatically; each file takes that back).
- **Nothing internal is readable by the website role.** `sam_web_reader` gets SELECT on the three views above (plus the `sam_v1_public_assets` grant it already has) and EXECUTE on 14 functions. The views never expose `client_actual`, `key_problem`, `use_for`, review status, approver or any SharePoint path. The functions run with fixed search paths.
- **The website cannot read its own log.** It can append messages and events and burn its own rate counters; it can read back only a cached answer by its exact 64-character hash.
- **Proof before launch.** `docs/supabase-sam-web-proof.sql` is read-only (rolled back) and must return every row `ok`. It checks anon against every `sam_*` relation and function, the website role against every relation in `public` and `core` and every owner-rights function, the sensitive columns, every function grant, the blocked claims, the 20 asset titles and search speed.

## Apply order (after your yes)

1. `sam_web_01_knowledge` (file 01)
2. `sam_web_02_public` (file 02)
3. `sam_web_03_log` (file 03)
4. Run `docs/supabase-sam-web-proof.sql`: every row `ok`.
5. `python prototype/load_web_knowledge.py --dry-run`, then without `--dry-run`: 234 page cards and 28 draft Q&A pairs.
6. You approve pairs in the Website tab (or by SQL). Nothing reaches a visitor before that.

Then your human steps from the plan: mint the `sam_web_reader` JWT and add the Vercel env vars.

## Rollback (removes everything the three files created; nothing else is touched)

```sql
-- 03
drop function if exists sam_web_admit(text, text, text, text), sam_web_take_model_slot(text), sam_web_cache_get(text),
  sam_web_cache_put(text, text, jsonb, text), sam_web_log_message(jsonb), sam_web_log_event(jsonb), sam_web_text_array(jsonb, int),
  sam_web_dashboard(int, boolean, numeric), sam_web_purge(int);
drop table if exists sam_web_messages, sam_web_conversations, sam_web_events, sam_web_usage_daily, sam_web_rate, sam_web_answer_cache;
-- 02
drop view if exists sam_web_qa_public, sam_web_pages_public, sam_web_assets_public;
drop function if exists sam_web_search(text, text, int), sam_web_roots(text), sam_web_children(text), sam_web_settings(),
  sam_web_qa_rows(), sam_web_page_rows(), sam_web_asset_rows();
-- 01 (tables first: their triggers go with them)
drop table if exists sam_web_qa, sam_web_pages, sam_web_page_rules, sam_web_blocked_patterns, sam_web_settings;
drop function if exists sam_web_page_group(text), sam_web_bump_knowledge(), sam_web_qa_touch(), sam_web_pages_stamp(),
  sam_web_restamp_pages(), sam_web_blocked_rx();
-- pg_trgm stays: it was installed before these migrations.
```

## Decisions for you (small)

1. **The asset list is 20, not the PRD's 11.** Case studies were published after the PRD count. One more is left out because its title carries a TCO figure ("Food Processing Firm ... (50% Lower TCO)"). "Deutsche Bank Fortifies Vendor Access..." dropped out of `sam_v1_public_assets` itself today (between two reads on 26 Oct), so it is not in the list.
2. **The blocked list is broad on purpose:** all TCO figures and all Gartner wording, including published case-study TCO numbers. Delete a row in `sam_web_blocked_patterns` to release a claim. No deploy needed.
3. **Bank pairs needing a fix before loading** (the loader rejects them; the web-knowledge agent can fix them): lp-02 and lp-12 have table row labels over 40 characters, lp-17's stat "ISO 27001:2022" is over the 12-character stat limit, and lp-27's "2025 & 2026" is not on its source page. lp-27 is Gartner wording and would be hidden anyway. lp-22 (savings figures) loads but stays hidden because it quotes TCO.
