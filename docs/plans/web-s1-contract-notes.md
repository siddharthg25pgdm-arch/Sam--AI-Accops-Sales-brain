# Website chatbot stage 1: contract notes from Stream B (26 Oct 2026)

Stream B (branch `claude/web-s1-b`) is built against these. Later streams must match them.

- **Export names** B imports: `classify` (bot.ts), `admit` (limits.ts), `preGuard` (guard.ts), `cacheGet` / `cachePut` (cache.ts), `intentMatch` (intent.ts), all from `@/lib/web/*`. B's commit 902416a holds fail-safe stubs for these; on merge, F's and G's files win (drop the stubs).
- **IP hash:** B computes `ctx.ip_hash` (`ipHash` in answer.ts). F uses `ctx.ip_hash`, never recomputes.
- **Eval runs:** E's eval sends a valid `x-sam-eval` token (no Origin, no BotID). B skips same-origin and `admit` for it but still takes the ceiling slot. F's `classify` must return `human` when `ctx.eval` is true.
- **Boundary grep (F):** `web/lib/redact.ts` reads `process.env.SUPABASE_SERVICE_KEY` only to scrub it from text; allow that one file.
- **B does not import `lib/agent*`** (plan 3.4); it imports `cleanKey` and `redact` from redact.ts and copies agent-openai.ts's fetch/timeout pattern.
- **CTA timing (D):** the CTA appears after the 2nd answer when `recent_ms.length >= 2`, so the widget includes the current send's timestamp in `recent_ms`.
- **Database RPCs (A):** `sam_web_settings()`, `sam_web_page_group(url)`, `sam_web_roots(page_url)`, `sam_web_children(qa_id)`, `sam_web_search(q, page_group, k)`, `sam_web_take_model_slot(provider)`, `sam_web_log_message(m jsonb)` (incl. `guard_reason`), `sam_web_log_event(e jsonb)`, view `sam_web_qa_public`. Exact shapes: `web/lib/web/db.ts` on `claude/web-s1-b`. Q&A candidate refs are `qa:<id>`; chips use bare ids.
- **Env (human step, add to plan section 5):** `WEB_CHAT_ENABLED=1` plus `SUPABASE_URL`, `SAM_WEB_READER_JWT`, `SAM_WEB_SUPABASE_APIKEY`, `WEB_IP_SALT`. Without all of them every `/api/web/*` route returns 503, so production stays inert.
- **Known small gaps:** `PickBlocks` returns null both for "ceiling reached" and "both providers failed" (both logged `error='model'`).
- **Preview checks:** Vercel deployment protection is on for previews; verify with a signed-in browser or a protection-bypass token, never by disabling protection.
