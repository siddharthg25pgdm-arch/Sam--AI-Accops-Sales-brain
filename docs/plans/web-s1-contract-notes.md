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

**The 27 Oct bank (78 pairs, lp-01..lp-78; 8 roots on citrix-lp, max depth 3).** What the next bank writer needs to know:
- **Visual props pass through:** the loader now keeps a bank visual's own `title`, table `filters`, step `need`, stat `context`, and CTA `action`/`sub` (before, the title was always the question and every CTA was `open_url`).
- **Aliases and the matcher:** if a pair's question names a product, vendor or industry (core.terms), the matcher only offers it to questions naming one of those, so an alias without the name ("ztna gateway" on "What is the HySecure ZTNA gateway?") can never match it. An alias that reduces to one word ("what does hysecure do" -> `hysecu`) matches every question that mentions that word. Write aliases with two or more content words, and the product name where the question has one.
- **Calibration:** `build_intent_index.py` measures the tune precision on the labelled eval rows only. With 78 pairs, the bank's own ~470 phrases (always right) let the old rule spend its 1% on real questions, and min_score slid from 0.54 to 0.39.
- **Eval relabels (27 Oct):** 8 rows in `web_intent_eval.json` now point at the new, more specific pairs (SQL Server -> lp-50, NetScaler -> lp-19, VPN -> lp-40, government -> lp-72, hospitals -> lp-73, zero trust -> lp-54, Japan -> lp-75, ISO on general -> lp-17).

## 27 Oct: page-aware suggestions (Siddharth: "the bot should be able to detect which page the user is on and suggest questions basis that")

**Where the visitor is** (`scripts/embed.src.js`). One IntersectionObserver keeps the `main section, section[id], h2[id], h3[id]` elements in view. Only when the teaser is due and whenever the chat opens does the loader measure them: the one with the most pixels on screen names the section, by its id, or `section-N` for the N-th id-less `<main>` section (the page cards' own naming, `web_pages.py extract_lp`). Nothing runs per scroll, so it needs no debounce. A name must pass `SEC = /^[a-z0-9][a-z0-9-]{0,40}$/` (`app/embed/bridge.ts`, the same regex in the loader), or no section is sent. On SAM's test page, `data-page`'s `#anchor` stands in (`/admin/website/test?section=migration`), because that page has none of the LP's sections. The loader is 4,901 B gzip (budget 5,120).

**Where it goes:**
- Teaser due: `GET /api/web/config?page=…&section=…`. Its teaser and 2 chips replace the page's (from the load-time call). With no section, or a failed call, the page's teaser shows.
- First open: `/embed?…&sec=…`, so the starter questions are the section's (the first 4).
- Reopen on another section: `postMessage({t:"sec", sec}, base)` to the widget. The widget accepts it only from the parent origin it already trusts and re-reads config. With an empty thread the starters change. Mid-conversation, up to 3 chips appear above the input until the next question.

**Ranking** (`lib/web/suggest.ts`, TS only, no new SQL). It reads `sam_web_qa_public` (the light columns), the page card(s) from `sam_web_pages_public` (`<page>/#<section>` first, then the page, with and without a trailing slash) and `sam_web_roots`, all in parallel. APPROVED pairs of the page's group (else `general`) are ranked in four tiers:
0. A source is `page#section`.
1. A source is on the page (any anchor).
2. The pair names one of the card's products / industries.
3. The group's roots (filler).

Within a tier, pairs are ordered by:
1. The card's `questions_answered` order: each question maps to a confident `intentMatch`, else the best-ranked pair citing the section.
2. Then `sources[0]` matched.
3. Then `nudge_weight`, then id.

Tier 2 first orders by the card label matched: an industry page's industries come before its products, any other page's products first. Card labels and pairs meet as core.terms entities (`intent.ts analyse`), from the pair's question and its `product:` / `industry:` tags. So "Pharma / Healthcare" meets "hospitals" and `industry:healthcare`. Up to 8 come back. `[0]` is the teaser, and the config's `chips` are the other 7, so the browser (which holds the conversation) can drop already-asked ids and still show 4. The memo is per instance, 60 s per (page, section), cleared past 500 keys. The config response stays CDN-cached 300 s, and the CDN key is the full URL, `section` included.

**Never repeat a question:**
- `/api/web/ask` now returns `qa_id` for `bank` / `intent` answers.
- The widget keeps the conversation's asked ids (restored with the thread).
- It drops them from the follow-up chips of new answers and from the reopen chips. The starters show only while the thread is empty.

**Checks:**
- `web-suggest.check` runs on real data (the bank, page cards and committed index; PostgREST stubbed): the allowlist, LP `#comparison` / `#migration` / `#faq` / `#section-2` / `#talk`, the HySecure, healthcare, BFSI, government and About Us pages, the roots fallback, the teaser following the section (config route) and the memo.
- `web-widget.check` covers the observer, the measurement, `section-N`, junk ids, the reopen message and `data-page#anchor`.

## 27 Oct: welcome-back memory (Siddharth: "Welcome back! Since you were exploring ZTNA before…", as Sophos's Qualified bot)

**Siddharth's decisions:**
- Memory is per **device**, never per IP: a shared office or mobile IP would show one person's topics to a colleague.
- No "Forget me" link (he said don't build one). The privacy line under the input now reads "…Conversations are stored to improve answers, and the topics you view are remembered on this device for 90 days." (EU/EEA/UK/CH: "for this visit"), with the Privacy link kept.
- Lookback 90 days. Only APPROVED question labels or public page-card titles are ever echoed: never the visitor's typed text, never a model answer.

**The device id** (`scripts/embed.src.js`):
- A v4 UUID made with `getRandomValues` (older browsers lack `randomUUID`), kept first-party in the HOST page's storage as `acc_chat_v = "uuid.issued_ms"`. It is regenerated after 90 days, and a malformed or old-format value (`v_…`) is replaced.
- Nothing is stored until `/api/web/config` answers `enabled: true`. The config's `persist` says where: `true` puts it in localStorage, `false` puts it in sessionStorage and removes any localStorage copy.
- `persist` is decided server-side only (`lib/web/recall.ts persist`) from Vercel's `x-vercel-ip-country`: false for EU 27, IS, LI, NO, GB and CH, and for a missing or odd header (fail safe). Reason: the LP has no consent banner.
- `window.SAM_CONSENT` is retired: the country rule replaces it, so the widget's privacy line always matches what the loader did. The teaser dismissal now lasts 30 days wherever the id persists, otherwise the session.
- The id goes to `/embed` (`&vid=`) always, to the beacons and the `init` message (`init` no longer carries `consent`), and to the config call **only when it was already stored** (a device that may be returning). So a first visit's config response stays public and CDN-cached.
- One `page_viewed` beacon per page load (id + page URL, no text), so the bot knows which pages the device read. The event route drops a crawler UA's `page_viewed`.
- The loader is 5,015 B gzip (budget 5,120).

**The recall** (`docs/supabase-sam-web-07-recall.sql`, NOT APPLIED; apply order 05, 06, 07):
- `sam_web_recall(visitor_id text, not_page text default null)` is a SECURITY DEFINER function with a fixed search_path, granted to `sam_web_reader` ONLY (revoked from public, anon, authenticated and service_role). It returns jsonb `{last_qa: [{id, question}] (<= 3), last_page: {url, title} | null, last_seen}` or null.
- `last_qa`: distinct `sam_web_messages.qa_id` (clicks, plus typed questions the bank matched) from the device's non-bot conversations in the last 90 days, newest first, joined through `sam_web_qa_public`, so a retired, blocked or expired pair never comes back. `question` is the approved label. It never reads `sam_web_messages.question`.
- `last_page`: the newest page with any event of the device in 90 days, other than `not_page` (trailing slash ignored), and only if it has a card in `sam_web_pages_public`.
- It returns null for a malformed id, an unknown id, and a known id with nothing recallable alike, so a caller cannot tell whether an id was ever seen.
- The 07 SQL also extends `sam_web_events_name_check` with `page_viewed` (05's list plus one; running 05 AFTER 07 would drop it) and adds indexes on `sam_web_conversations (visitor_id)` and `sam_web_events (visitor_id, created_at desc)`.
- `web-guard.mjs` now allows `/rpc/sam_web_recall` for the reader.
- Until 07 is applied: the RPC 404s, `welcome()` fails, and the routes fall back to the normal greeting. `page_viewed` inserts fail on the check and are only warned about. Nothing visible breaks.

**The greeting** (`lib/web/recall.ts welcome(vid, page)`, memo 60 s per (device, page), cleared past 500 keys):
- **Asked before:** "Welcome back! Last time you looked at **<label>** Want to pick up there?"
  - The label comes from the LIVE `sam_web_qa_public` list (`db.pairs()`, re-checked in TS after the SQL's join), cut to 60 characters.
  - The teaser asks that pair.
  - The chips are its children, then the earlier recalled pairs, then the intent matcher's related approved pairs (3 at most).
- **Read pages only:** "Welcome back! Since you were reading about **<title>**, want to pick up there?"
  - The title is the page card's own public title, re-read with `pageCards` (never the recall's copy), the part before " | ", without an "Accops - " prefix.
  - The teaser asks that page's top suggestion, and the chips are that page's suggestions.
- The line goes through `emClean`, so the contract's emphasis limits hold: a label over 6 words keeps no emphasis.
- **Who gets it:** a human-looking request only (`bot.ts pageHuman`): a browser UA, plus `sec-fetch-dest: iframe` (/embed) or an Origin in the embed list (config). Bots, curl, direct fetches and other sites get the normal greeting. BotID is not used here (its headers ride only on the asks).

**Where it shows:**
- **Config** (`/api/web/config`):
  - Without `vid`: `public, s-maxage=300` + `Vary: X-Vercel-IP-Country` (`persist` differs by country).
  - With `vid`: `private, no-store`, whatever the outcome, so it is never CDN-cached across visitors. For a returning device the teaser is the welcome line as plain text (the loader sets textContent and the card is already bold), and its chips are the welcome's chips, then the page's (7, never the teaser's own pair).
- **/embed:** it passes `visitor`, `persist` and `welcome {line, chips}` to the widget. With an empty thread the widget shows:
  - the line, its `**emphasis**` drawn as `<strong class="sb-em">` (as in a Text block)
  - the eyebrow "Pick up where you left off"
  - the welcome chips, then the page's or section's starters (4, no repeats)
- The widget's ask and event calls use the same id (the URL's `vid`). Its own fallback id is now `crypto.randomUUID()`.

**Checks:**
- `web-recall.check` (new, real bank + cards, PostgREST stubbed incl. `sam_web_recall`) covers:
  - the id rule and the country rule
  - a typed question and a retired pair (lp-27) never echoed
  - the 7-word label with no emphasis
  - the page-title case, a non-public page, and asked-beats-read
  - unknown / malformed ids (no DB call), the memo, and `pageHuman`
  - config caching for both paths and the welcome teaser and chips
  - /embed props (bot, UK, junk id)
  - `page_viewed` in the event route (crawler dropped, no extra field)
  - the 07 SQL's shape and grants, and its event list equal to the route's
- `web-widget.check` adds:
  - in the loader: UUID + issue time, day 89 same id sent to config, day 91 fresh id, persist:false moving it to the session (and the next page of that visit), junk values replaced, and the kill switch storing and sending nothing
  - in the widget: the greeting's emphasis, chip order, the privacy line (90 days / this visit, Privacy link, no forget link)
- Run all of them with a botid stub on NODE_PATH: web/node_modules has no botid, so make a dir with `botid/package.json` (exports `./server`, `./client/core`) and stub `checkBotId` / `initBotId`, then run `NODE_PATH=<dir> node scripts/checks.mjs`.

**Not built (say if wanted):** page views in the Website tab's funnel; recall across the LP and accops.com. Each origin has its own storage, so they are separate devices to the bot. That is first-party by design.

## 27 Oct: benchmark fixes (docs/benchmarks/2026-10-27-chatbot-benchmark.md, "Problems in our bot")

- **Talk to sales opens the calendar everywhere.** In the widget every talk-to-sales path already went through `opensBooking` (answer CTAs, "Prefer a person?", the error CTA), so a handled click with `booking_url` set never navigates; the benchmark's new tab means its `/embed` had no `booking_url` (05's header still says NOT APPLIED; live `/embed` now carries it). What stayed wrong: every talk-to-sales link's `href` was `cta_url`, so any click the script missed (middle-click, before hydration) still opened accops.com, and `guard.ts` hard-coded that URL. Now `answer.ts finish()` points every `talk_to_sales` CTA (a pair's own visual, `cta()`, the pre-guard, a cached answer) at `bookingUrl(settings.booking_url)` when set; `preGuard(text, cta(settings))` puts the settings CTA in place of guard.ts's default; the widget's own links use `booking || cta_url`. `open_url` CTAs never change.
- **Verified facts never pad** (`fill.ts facts(q, group, …)`): a record must share a topic word or core.terms name with the question (generic stems such as support, offer, access, secure, compare are not topics; the page group's own subject, Citrix on the LP, is context), weighted as the intent matcher weighs words (unknown = rare, a name +2), and score at least 60% of the best record. 1-3 records; none means the honest `LEAD.none` + CTA. The benchmark's Entra ID question now shows the SSO answer only. `cache.ts ENGINE` is now `text-first-3`, so the padded answers cached under -2 are never served.
- **Pills name the page** (`fill.ts titled`, run in `finish()` on every answer, cached ones too): the public card's title for the source URL (before " | ", no "Accops - "), the page's card for an anchor without its own; a generated `#section-N` anchor never uses its card (its title is a carder's description); no card: "Citrix comparison page" for the LP host, else `accops.com/path`. One `sam_web_pages_public` read per URL per 10 min per instance; a failed read keeps the friendly names.
- **Loader:** `{t:"focus"}` only after the frame said `ready` (a first open focuses itself on `init`); posting at 230 ms hit about:blank and logged the origin error on every first open. Loader 5,021 B gzip.
- **BotID:** a `checkBotId()` failure no longer labels the turn suspect (it would have sent every real visitor to the no-model tiers during a Vercel-side failure); it is logged as the signal `botid_error` and warned, and the local signals decide. The per-question "Error" line comes from Vercel's own challenge script (`c.js`), not our code; answers still reached the model, so Basic validation passed.
- **Welcome back:** "Welcome back! Last time you asked “How do I talk to an Accops engineer?” Want to pick up there?" (`recall.ts askedLine`; a full stop after the quote only when the label has no end mark). When that pair's visual is a CTA (lp-32, lp-06, lp-07, lp-21, lp-24, lp-63), the first offer is "Book a time with an engineer" (the calendar in the panel; a new tab to `cta_url` without `booking_url`). `db.pairs()` now reads `visual`.
- **Triage** (`intent.ts vague`, `fill.ts TRIAGE`): an opener with a problem or help word, no core.terms name, at most 5 content words and no confident match ("we have remote access problems") gets "Happy to help. Which of these is closest to what you need?" + Moving off Citrix (lp-05), Remote access / VPN replacement (lp-40), Securing logins (MFA/SSO) (lp-36), approved ones only, + "I'm an existing Accops customer (support)" linking to https://support.accops.com/ (the ticket portal accops.com/contact-us publishes). It runs after the intent miss and before the cache, never after an earlier question, and is logged as source `fallback` with `guard_reason = "triage"`. No eval question that passes the pre-guard trips it. Chips may now number 4, and a chip may carry an https `url` (a new-tab link chip).
- **Not built:** a `support_opened` event (needs the events check constraint in SQL); a guard for BotID's own client failing (a blocked `c.js` makes the ask fail, a challenge that never resolves hangs it).

## 27 Oct: qualify + routing (benchmark recommendations 2 and 6, approved by Siddharth)

**The qualifying card** (`lib/web/qualify.ts`, pure: the server, the Website tab and the checks share one list). Anonymous: tap-only, allowlisted values, no text box, never an email.

| Key | Question (after "Quick one, so we point you to the right thing:" on the 1st card, "One more, if that's OK:" on the 2nd) | Values (labels) |
|---|---|---|
| `users` | how many users are on Citrix today? (known not on Citrix: "how many users would this cover?") | `under_250` Under 250, `250_1000` 250–1,000, `1000_5000` 1,000–5,000, `5000_plus` 5,000+ |
| `renewal` | when is your Citrix renewal due? | `within_3m` Within 3 months, `3_12m` 3–12 months, `later` Later, `not_citrix` Not on Citrix |
| `platform` | what are you running today? | `citrix` Citrix, `vmware_omnissa` VMware or Omnissa, `avd` Azure Virtual Desktop, `other` Something else |

- **When** (`answer.ts finish()` → `pick`): a 200 answer gets `qualify: {key, prompt, options}` only if the turn is labelled human, the send is the conversation's 1st or 3rd (`recent_ms.length`, as the CTA timing), the source is bank, intent, cache, model or fallback but not the triage (`guard_reason = "triage"`), and fewer than 2 cards were shown. Never guard, limited, repeat, bots or suspects. It is decided per request and never cached.
- **Never twice:** every ask carries `qualified` (≤ 3 entries: `"users"` = shown, `"users=5000_plus"` = answered; junk, unknown keys or values and `a=b=c` are dropped). A key in it is never asked again.
- **Which question:** renewal after a pricing or licensing word (in the question, the previous question or the answered pair's label); platform when no platform is named; otherwise users. When the visitor is known not to be on Citrix (platform answered other than Citrix, or renewal "Not on Citrix"), the renewal question is skipped and the users one is reworded.
- **The tap** is `turn: {kind: "qualify", key, value}` on `/api/web/ask`:
  - It is classified and admitted as a click. No message is logged, and there is no model call, search or cache.
  - A key or value outside the allowlist is a 400 before any read.
  - The reply is `{lead, chips, book?}`: the `NEXT` thank-you, its pairs (live ones only), then the page's roots. The widget shows 2, or the calendar plus 1 when `book`.
  - `sam_web_set_intent` stores it after the response, for a human turn only.
- **Thank-you lines and their pairs** (`qualify.ts NEXT`; Siddharth may edit them):
  - users: under_250 → lp-13, lp-23; 250_1000 → lp-23, lp-06; 1000_5000 → lp-06, lp-07; 5000_plus "For a large deployment…" → lp-69 (scale), lp-25 (replaced Citrix).
  - renewal: within_3m → **"Book a time with an engineer" first**, then lp-21; 3_12m → lp-06, lp-07; later → lp-01, lp-23; not_citrix → lp-33, lp-61.
  - platform: citrix → lp-02, lp-05; vmware_omnissa → lp-09, lp-12; avd → lp-14, lp-13; other → lp-33, lp-61.
- **Widget** (`QualifyCard`):
  - The card sits under the answer's chips: the question, then the options as chips.
  - After the tap, the chosen option is pressed (`aria-pressed`, so focus stays put) and the others are disabled. Then come the thank-you and the offers. The calendar offer goes through `cta()`, so it opens in the panel.
  - The widget also refuses a 3rd card or a repeated key, and restores cards (and what was tapped) with the thread.
  - A tap never joins `recent_ms`, so the 1st / 3rd rule counts questions only.
  - Each tap sends `qualify_answered` with ref `key:value`. The event route refuses any other ref, and GA4 gets the name only.

**SQL 08** (`docs/supabase-sam-web-08-intent.sql`, NOT APPLIED; apply order 05, 06, 07, 08):
- `sam_web_conversations.intent jsonb not null default '{}'` (an object, at most 256 bytes).
- `sam_web_set_intent(conversation_id, key, value) → boolean` is a security definer function with a fixed search_path. It merges one key, only for an allowlisted (key, value) pair (the same 12 as `qualify.ts`, proven in web-answer.check) and only on a conversation labelled human. It is granted to `sam_web_reader` ONLY.
- The event check is 07's list plus `qualify_answered`, `routing_book`, `routing_support` and `routing_partner`.
- `web-guard.mjs` now allows `/rpc/sam_web_set_intent` for the reader.
- Until 08 is applied: the RPC 404s and is only warned about, the new events fail the check and are only warned about, and the Website tab's conversations read retries without the `intent` column (`loadMessages`).
- Known gap: a tap that lands before the answer's own log has created the conversation row is dropped. A person never taps that fast.

**Booking notes:**
- Microsoft Bookings cannot be prefilled from its URL. Microsoft Q&A and the Bookings Tech Community threads say name, email, custom answers and notes cannot be passed as query parameters (they give "Bad request"). The only documented parameter is `RefID`, a traffic-source tag, not a notes field.
- So nothing is faked: the intent stays on the conversation and the Website tab shows it there.
- The Leads view does not join it: a lead carries `conversation_id` only when the flow sends one, and Bookings never does.

**The routing bar** (`RoutingBar`, in the footer above the privacy line and the input; always there, inert while the calendar is open):
- **Book a call** tracks `routing_book`, then goes through `onTalk` → `cta()`. It opens the calendar in the panel, or `cta_url` in a new tab without `booking_url`. Its href is `booking || cta_url`.
- **Existing customer support** → `https://support.accops.com/` (`bridge.ts SUPPORT_URL`, which the triage chip now uses too), `routing_support`.
- **Partner enquiry** → `https://www.accops.com/partners` (the partner page card), `routing_partner`.
- Both support and partner open in a new tab with "(opens in a new tab)" for screen readers.
- Size: 12.5 px pills with 32 px targets. They fit one row of the 400 px desktop panel: 366 px of pills against 372 px of room, measured from Barlow Medium's advance widths (13 px would need 378, so it would wrap). Not seen in a browser here.
- Under 400 px the three fold into one "Need a person?" pill (`aria-expanded`, `aria-controls`) that opens them.
- The loader forwards `qualify_answered` and `routing_*` to the dataLayer; it is 5,051 B gzip.

**Website tab:**
- Analytics has "Who they are: the qualifying question": per question, how many of the period's human conversations answered, and the split in the card's option order.
- Conversations shows pills on each conversation ("Users: 5,000+", "Renewal: Within 3 months").
- The funnel gains rows for the answered card and the three bar routes.

**Draft bank pairs** (loaded as drafts, review data rebuilt, intent index NOT rebuilt):
- **lp-80** "Is there a free trial or a free POC?", under lp-07. No page says a pilot is free, so it says what is published, with a "Book a time with an engineer" CTA. needs_approval: commercial terms.
- **lp-81** "Does Accops support Linux desktops?", under lp-34. HyWorks (you run it) and Accops Managed Desktops (DaaS) are named side by side.
- **lp-82** "Can users reach HyWorks from Linux devices?", under lp-81, at depth 4. It covers HyDesk Hy6000's embedded Linux, HyLite in a browser and Nano. The pages do not say a HyWorks client app installs on a Linux PC, so it doesn't claim that.
- **lp-83** "Does Accops SSO work with Azure AD or Entra ID?", under lp-36 (benchmark problem 1). The answer says Azure AD because the pages still do; "Entra ID" is only in the label and aliases.
- After approving lp-80: drop the aliases "free trial" and "trial" from lp-07 (approved, so the loader can't), then rebuild the index.

**Checks:**
- `web-answer.check` covers:
  - when the card shows and when it doesn't (answers 0-6), the 2-card limit, no repeats, junk `qualified`
  - which question, and the rewording
  - bot, suspect, guard, triage, limited and repeat: no card
  - every allowlisted pair has a thank-you, and anything else is refused
  - the tap's reply, store, no-message rule and 400s
  - the event allowlist and `qualify_answered`'s ref
  - SQL 08's column, function, allowlist = `qualify.ts`, grants, and the event list = the route's
- `web-widget.check` covers:
  - the card's markup before and after the tap, and the calendar first
  - the widget's no-3rd-card / no-repeat rule, and the tap kept out of `recent_ms`
  - the routing bar's three links, the booking fallback, the fold and its CSS
  - the new events through the bridge and the loader
- `web-admin.check` covers `intentPills`, `intentMix` (human only, option order) and both views rendering.
- `web-recall.check` now compares 07's list with the route's minus 08's names.

**Not built (say if wanted):**
- Intent next to a lead in the Leads view (needs a conversation id on the booking, which Bookings can't carry).
- A "shown" count for the card (only taps are logged).
- A per-section choice of question (the teaser's discovery question, recommendation 7).
