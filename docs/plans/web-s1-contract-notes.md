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

## 27 Oct: text-first answers (Siddharth's decisions; they supersede "pick blocks only, no AI-written sentences")

**Why.** Siddharth's test on `/admin/website/test` (27 Oct): "How is Accops different from Citrix". No pairs were approved, so the question fell to tier 3. The locked model picked page candidates, which rendered as page DocCards with "Read" links. The answer took 8,006 ms (logged: gpt-6-luna, 1,559 tokens) and never answered the question in the chat. His rule now: answers are text and visuals **in** the chat, with key words highlighted, and the bot never sends people elsewhere.

**Tier 3 contract** (`lib/web/model.ts`, `contracts.ts` `Written`). The model gets strict `json_schema` and returns `{verdict, answer, cites[<=4], visual: {type, ref}, followups[<=3]}`.
- `cites` is an enum of this request's candidate refs, `visual.ref` an enum of its qa refs, and `followups` an enum of its qa ids.
- Strict mode needs every field, so "no visual" is `{"type":"none","ref":"none"}`, and an id list with nothing to name gets `["none"]` (an empty enum is invalid).
- The schema uses only `maxItems` and `enum`, which production already accepted. "At least one cite" is checked on the server.
- The fixed system prompt says:
  - answer in the FIRST sentence, in 2-4 sentences and at most 70 words
  - plain, specific B2B English: no hype, no superlatives
  - only facts from the cited records; names written as the records write them
  - Accops described positively, with no disparaging of competitors
  - no prices, no links, never "go elsewhere"
  - 2-4 key phrases wrapped in `**…**`, each at most 6 words
  - for a document ask, cite the asset record
- The eval's canary for this prompt is "using ONLY the approved Accops records".

**What the server does with the model's output** (`fill.ts` `compose`):
1. Collapses whitespace and keeps whole sentences up to 70 words.
2. Cleans the emphasis (`emClean`) and requires the text to be at most 600 characters.
3. Takes the source from the first cite that has a URL; a qa cite uses its pair's `sources[0]`.
4. Fact-checks the text against the cited candidates' `title + text`.
5. Any problem means the visitor sees **verified facts** instead.

The answer is one `Text {ai: true}` block, whose pill reads "**Based on** accops…" (verbatim text still reads "From"). After it come a qa candidate's own approved visual (if the model chose one and the pair has that type) and, on a document ask only, one asset DocCard.

**Fact check** (`lib/web/facts.ts` `factCheck`). It compares case-insensitively and ignores punctuation and spacing. Any item below that is not in the cited texts fails the answer:
- **Numbers**, normalised: `40%` (from %, percent or per cent), `10x` (from x, × or times), years and counts (thousands commas are dropped), and number words (two…ninety, hundred, thousand, million, billion; twice/double = 2x, triple = 3x, tenfold = 10x, half = 50%). "one", "zero" and "single" are left out, because "one platform" and "zero trust" are not claims. A bare number may match the same number with a unit; a number with a unit must match exactly.
- **Names**: every capitalised word or part of a hyphenated word ("Hyper-V", "NetScaler/ADC"). A sentence's first word is skipped only if it is a common opener ("Yes", "It", "Unlike"…); "Accops" and "I" are always allowed. This catches invented customers, organisations, brands and acronyms.
- **core.terms names** (products, partners, competitors and industries): taken from the committed intent index's `entities`, which `build_intent_index.py` builds from `docs/brain/01-core-reference-lists.sql`. They match at label level by any alias, so "banks" needs BFSI in the cited texts.
- **Certifications and standards**: ISO, SOC 1/2/3, GDPR, HIPAA, PCI DSS, FedRAMP, NIST, FIPS, Common Criteria, CERT-In, STQC, RBI, SEBI, IRDAI, DPDP, MeitY, CSA STAR, CMMC, CCPA, TISAX, HITRUST, Cyber Essentials, EAL n. These are also caught when written in lowercase.
- **Quoted claims** ("…", “…”, «…»).
- **Any link or domain**, which is always a fail: answers stay in the chat.

The log's `error` field reads `fact_check: <what failed>` (at most 200 characters).

**Verified facts** (`fill.ts` `facts`, lead `LEAD.facts` = "Here's what we've published on that:"). This is up to 3 verbatim `Text` blocks with "From" pills, plus the CTA:
- **Order:** the cited records first, then search rank.
- **Content:** an approved answer (with its own emphasis) or a page quote (asterisks removed: a quote carries no emphasis). Never a page summary, never a list of links.
- **When:** a failed fact check (source `model`, cached), or no model answer (the ceiling is reached or both providers failed: source `fallback`, `error='model'`, not cached).
- **Nothing quotable:** with only pages and assets, the visitor gets the honest fallback.

**Doc intent** (`docIntent`). Words like brochure, datasheet, PDF, whitepaper, deck, case study, download, "send me", e-book, one-pager, solution brief, document(s), documentation or docs count as a document ask. Only then may one **asset** DocCard follow the text (cited assets first, then search rank), and a qa pair's own `doc_card` visual is also gated on it. Page candidates never become cards.

**Emphasis** (`lib/emphasis.ts`, no imports, shared by server and widget):
- **Syntax:** `**phrase**` with no space or `*` just inside the markers, on one line.
- **Limits:** at most 4 phrases, at most 6 words each, emphasised words at most 35% of the text's words. Siddharth's own example sentence alone is 9 of 25 words (36%), so 3 phrases need an answer of about 40 words or more.
- **Model text:** `emClean` keeps valid pairs in order while they fit and strips every other marker (excess, over-long, unbalanced and nested markers go; the words stay).
- **Bank answers:** `prototype/load_web_knowledge.py` `emphasis_errors` **rejects** the pair. It uses the same rules and messages; blocks.check runs both on 8 cases and compares them. The loader also rejects `**` in question, aliases, visual_data or cta, because emphasis only renders in a Text body.
- **Rendering** (`Text.tsx`): `<strong class="sb-em">`, navy `#0f1e3a`, weight 600, on a `--sb-hl #fbd9cc` band under the lower 40% of the glyphs. Contrast is 12.6:1 on the band and 16.6:1 on white, asserted in web-widget.check. The style is static; forced-colours mode underlines instead; screen readers read it as plain text.

**Follow-ups after every answer** (`answer.ts` `more`). The first chips are a pair's children, or the model's approved `followups` (never a cited pair). While there are fewer than 2, the server adds the intent matcher's next-best approved pairs for the page group (`intent.ts` `related`, kept only if live in `sam_web_qa_public`), then the page's roots. There are at most 3, and none only when nothing is approved. Bank answers get the same: children and the related pairs are read in parallel, so no latency is added.

**Latency** (target p95 5 s or less):
- 8 candidates (was 12).
- Output capped at 400 tokens: `max_completion_tokens` for OpenAI, `max_tokens` for Groq.
- Reasoning effort `none` for gpt-6-luna and `low` for gpt-oss-20b (the lowest each accepts; already proven in SAM chat and `provider.check`).
- Timeouts: OpenAI 6 s, then Groq 4 s, then verified facts.
- The pair read runs alongside the model call.

Measured 27 Oct from the laptop:

| Call | Time |
|---|---|
| `sam_web_search` (k = 12, cold) | 736 ms |
| `sam_web_search` (k = 8, warm) | 180 ms |
| `sam_web_settings` (warm) | 90 ms |

So the model call dominated the 8 s.

**Cache.** The key is now `sha256(q_hash|"text-first-1")` (`cache.ts` `ENGINE`), so the old engine's cached page-card answers (24 h) are never served. Bump `ENGINE` whenever tier 3 changes what it answers.

**Eval** (`web-eval.mjs`):
- An `ai` Text is "invented" unless it has a source and passes `factCheck` against **every** public text (approved Q&A, page titles, summaries and quotes, asset titles and briefs) and keeps the emphasis limits.
- The dry stubs are:
  - `top`: writes the first candidate's first sentence and cites it
  - `adversarial`: cites everything and writes a 10X figure, HDFC Bank, SOC 2 and a link, which the fact check must stop
  - `none`
- Live asset reads now include `brief`.

**For the bank-writing agent** (the next ~80 pairs, `corpus/web/qa-citrix-lp.json`, plan 7.7 shape):
- **Emphasis:** `**key phrase**` in `short_answer` / `answer` only. At most 4 phrases, at most 6 words each, at most 35% of the answer's words, no nesting, no stray `*`. Emphasise the Accops capability, product or outcome that answers the question, never filler. Any `**` in question, aliases, visual or cta is rejected. Run `python prototype/load_web_knowledge.py --dry-run` and fix every REJECT.
- **Follow-ups:** `parent_id` builds the tree, and a pair's children are its follow-up chips (ordered by `nudge_weight` descending, then id). Roots are pairs with no parent in that page group. Give every root and mid-level pair 2-3 children, so chips come from the tree. Leaf pairs get chips automatically (the matcher's next-best, then the roots). `aliases` feed the intent matcher and its next-best chips, so write 3-6 real visitor phrasings per pair.
- **Facts:** every number, name and certification in an answer must be on a source page (the eval and the model's fact check both depend on public text). `sources[0]` is the pill.
- **Documents:** a document is offered when a visitor asks for one. A pair whose answer is "here is the brochure" can carry `visual.type = doc_card` (one card), shown on click or intent; the model tier only shows it on a document ask.
