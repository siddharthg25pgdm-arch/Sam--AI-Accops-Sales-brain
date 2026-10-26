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

## Integration notes (26 Oct 2026, branch `claude/web-s1-int` = F (incl. B) + G + C)

- **CompareTable rows (C):** `rows[]` = `{ label (40), cells[] (80 each), group? (24), detail? (240), accent? }`; table-level `filters?` (up to 5 group names, 24 chars) and `footnote?`. `group` drives the filter chips, `detail` is the tap-to-expand text. `accent`: **0 = parity** (hidden by "Differences only"), **1 = Accops advantage**, **2 = worth checking**; unset = unmarked. Schema: `web/lib/blocks.ts`.
- **onAction events D must handle (C):** OpenUI `ActionEvent { type, params, humanFriendlyMessage }`:
  - `ask` `{ qa_id, source: "picker" | "chip" }`: send a tier-0 click turn for that pair; echo the label as the visitor bubble.
  - `cta` `{ action: "talk_to_sales" | "open_url", url }`: postMessage `{ t: "cta", url }` to the host page (the link's default is prevented).
  - `event` `{ name: "doc_opened" | "filter_used" | "step_viewed", ... }`: analytics only (`/api/web/event`).
- **CSS:** the host (D's `/embed` page) imports `@/components/blocks/blocks.css` exactly once; library.tsx does not (so node checks can load it).
- **Handshake (D):** `/embed` server-renders the token with `mintHs(conversation_id)` from `@/lib/web/bot`, so mint and verify share one secret and format. Never re-implement it.
- **Turn kind:** `Ctx.kind` is the turn kind (`"typed" | "click"`), set by answer.ts. Typed sends under 2 s after render are `suspect` (`too_fast`); clicks keep the 300 ms rule.
- **Pre-guard logging:** answer.ts logs `guard_reason` (the rule name, never the text) in `sam_web_log_message`; null when not guarded. A's `03-log.sql` already stores it.
- **Brand:** orange `#c8431c` for fills and orange text (white on it 4.9:1, AA). Not the LP orange `#f05b30` (3.4:1) or the plan's `#d94a20` (4.2:1). Tokens in `blocks.css` (`--sb-brand`).
- **`/embed/gallery`:** `notFound()` when `VERCEL_ENV=production` (previews and local only), proven in blocks.check. It shows proposed and blocked fixtures (e.g. the $132/$220 calculator).
- **`@openuidev/lang-core` 1.0.1** is now a direct exact dependency (library.tsx imports `jsonToOpenUI` from it).
- **Open item: labels are not sticky across turns.** `classify` labels one turn; a bot/suspect conversation's next clean-looking turn is `human` again. Needs a Stream A read RPC returning the conversation's highest label (TODO in `web/lib/web/bot.ts`). Not built.
- **Local checks:** `~/sam-accops/web/node_modules` has zod 4.5.4 and no `@openuidev/*` or `botid`; with it alone, blocks.check skips the OpenUI round trip and tsc fails on zod's version brand. Use the lockfile versions (4.6.7, react-lang/lang-core 1.0.1, botid 1.5.11).

### Bundle size (measured 26 Oct, esbuild 0.25 `--minify`, gzip -9; react / react-dom / Next runtime excluded; zod 4.6.7 with non-English locales stripped, as Next's tree-shaking would)

| Client path | min | gzip |
|---|---|---|
| OpenUI: `AnswerBlocks` (`<Renderer>` + library + all 8 blocks) | 306 KB | **92 KB** (zod ~54, lang-core + react-lang ~33, blocks ~5) |
| Direct `blocks.map` + zod schemas on the client | 207 KB | 59 KB |
| Direct `blocks.map`, types only (server already validated) | 12 KB | **4.5 KB** |

`@modelcontextprotocol/sdk` (lang-core's optional peer) tree-shakes out. With the Next runtime + React DOM (~85-90 KB gz, C's figure, not measured: no `next build` here) the OpenUI embed is ~180 KB gz against the 120 KB budget.

**Recommendation (5 lines):**
1. The OpenUI path is clearly over budget (~1.5x), and almost all of it is OpenUI plus the zod it needs in the browser (~87 KB gz); the blocks themselves are ~5 KB.
2. In locked mode OpenUI adds nothing a visitor sees: the server fills every field, no model writes OpenUI Lang, and the same components render either way.
3. So: render `answer.blocks.map` directly in D's widget (types only, ~4.5 KB gz, embed ~95 KB total, under budget), with no change to C's components.
4. Keep `library.tsx` + `toOpenUI` and blocks.check's round trip, so a later stage that lets a model compose UI can switch back with one import.
5. If Siddharth keeps `<Renderer>` anyway (the iframe only loads on first interaction), load it with `next/dynamic` so the widget shell paints first, and re-measure on the preview's real chunks before launch.
