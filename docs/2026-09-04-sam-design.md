# SAM: Sales & Marketing Brain for Accops

Design proposal, v0.7. 4 September 2026. Author: Claude, at Siddharth Gupta's request.
Status: Siddharth decided (4 Sep): OpenWA is acceptable for production because SAM is internal; build the codelab-shaped prototype first. Prototype 0 exists in `../prototype/` (see section 11). Remaining decisions in section 10.

Companion artifact: `sam-query-simulation.html` in this folder. Open it in a browser and press Play.

---

## 1. What SAM is

SAM is an internal assistant that answers two kinds of question for Accops sales and marketing:

1. **"Where is the X?"** Find a collateral asset by type, product, vertical, competitor, persona, or freshness, and hand back a link that is safe for the intended audience.
2. **"What do we say?"** Assemble a grounded answer or talking points from that collateral, with citations to file, page, or slide.

It is reached through Microsoft Teams, a web app, WhatsApp, and an API/MCP surface that the Dwight Chrome extension calls. All four channels hit the same engine.

Non-goals for v1: generating new collateral from scratch, CRM writes, per-user SharePoint permission trimming, multi-tenant SaaS.

## 2. Corpus and the private/public split

| Source | Contents | Visibility | Ingest trigger |
|---|---|---|---|
| SharePoint "Sales" site | Battlecards, competitor analyses, decks, case studies, whitepapers, pricing | Private | Power Automate on create/modify, plus nightly delta |
| SharePoint "Marketing" site | Brochures, case studies, campaign assets, brand | Private | Same |
| Public object-storage bucket (Siddharth called it the "A2layers bucket"; treated here as an S3-compatible bucket with public URLs) | Published PDFs, brochures, approved case studies | Public | Manifest sync, T3 |
| accops.com blogs and pages | Blog posts, product pages | Public | Weekly sitemap/RSS crawl, T4 |

**Visibility is a property of the asset, not the source.** One logical asset (say, the Bank X case study) may exist as a private SharePoint item and a public bucket object. The `asset_visibility` table joins them:

```
asset_id · sharepoint_item_id · sharepoint_url · public_url · public_checksum · private_checksum
· visibility ∈ {private, public, both} · drift ∈ {none, public_stale, private_stale} · approved_by · approved_at
```

Matching private to public is done by content checksum first, then normalised filename, then a human confirmation queue for the leftovers. Drift is flagged when the two checksums differ, so SAM can warn "the public PDF is older than the internal one".

Rule that never bends: **a private asset's file body never leaves SharePoint.** SAM hands out SharePoint deep links (login required) or public bucket URLs. It never attaches a private PDF to a WhatsApp or email message. This one rule is what makes the WhatsApp channel acceptable to InfoSec.

## 3. Contextual analysis

Two distinct things, done at two different times.

### 3a. Document-level, at ingest (once per file)

Claude reads the full extracted text once and emits an **asset card**:

```
title, asset_type (battlecard | competitor_analysis | case_study | whitepaper | brochure | deck | datasheet | blog | pricing | other)
products[], verticals[], competitors[], personas[], geographies[], regulations[]
summary (≤ 80 words), best_used_for (≤ 40 words), key_claims[] (each with page/slide ref)
publish_date, language, owner, freshness_flag (>12 months), confidence
```

The schema is seeded from Siddharth's existing 68-document inventory, which already has product, industry and "use for" tags by hand. That inventory is also the gold set: SAM's generated cards are checked against it before we trust the pipeline on the rest of the corpus.

Chunks (400 to 800 tokens, page and slide boundaries respected) are embedded and stored alongside the card. The card carries the structured filters; the chunks carry the evidence.

### 3b. Query-level, at answer time (once per question)

Given the router's slots and the context card (thread history, asker profile, account context from CRM or the extension), Claude re-ranks the retrieved candidates and, for each, writes **why it fits and how to use it** ("slides 4 to 7 carry the TCO table; give the migration guide to their infra lead, not the CIO"). It also decides whether the result set is a **gap**: nothing strong enough, so say so honestly, offer the nearest substitutes, and log the gap.

This is the step that turns a search box into a brain. It is also the most expensive LLM call, so it runs at high effort while the router and composer run at low effort.

## 4. The synchronous query path: nine touchpoints

Every channel produces the same Query Event and flows through the same nine touchpoints. The simulation file animates all of them for five scenarios.

| # | Touchpoint | Owner | What happens | LLM? |
|---|---|---|---|---|
| 1 | Channel adapter | Edge | Normalise inbound into `{tenant, user_handle, channel, thread_id, text, attachments, channel_context}`. WhatsApp sends an immediate "On it." | No |
| 2 | Gateway & identity | Edge | Resolve to an Accops identity: Entra ID for Teams/web, verified phone-to-user map for WhatsApp, per-user token for MCP. Set scope internal/external. Rate limit. | No |
| 3 | Context assembler | Data | Load thread history (for follow-ups), asker profile (region, vertical focus), and channel context (LinkedIn page open in Dwight, CRM account hints). Produce a context card. | No |
| 4 | Intent router | Claude, low effort | Classify intent: `find_asset`, `answer_question`, `draft_content`, `share_externally`, `followup`, `other`. Extract slots. Resolve referents in follow-ups ("the Citrix one"). | Yes |
| 5 | Retrieval fan-out | Data, parallel | (a) structured filter on asset cards, (b) hybrid keyword + vector search on chunks, (c) public-registry lookup, (d) live Microsoft Graph search of SharePoint as a safety net for files not yet indexed. Merge and dedupe. | No |
| 6 | Visibility resolver | Data | Stamp every candidate private/public/both from `asset_visibility`. If the ask is external and only private exists, prepare a publish-request option. | No |
| 7 | Contextual analysis | Claude, high effort | Re-rank against context, write why-it-fits, detect gaps, choose what is safe for the audience. | Yes |
| 8 | Response composer | Claude, low effort (skipped for MCP) | Render per channel: rich cards with citations (web), Adaptive Card (Teams), plain text with at most three links (WhatsApp), structured JSON (MCP/REST). | Yes |
| 9 | Follow-up & learning | Edge | Persist the turn, log intent/slots/hits/clicks, schedule the 24-hour nudge, write gap or publish records. | No |

**Counts per query:** three LLM calls (two for MCP callers), three to six data calls, one to three async triggers. Target latency under 8 seconds on web with streaming; WhatsApp users see the acknowledgement within a second and the answer within ten.

**Follow-ups** work because touchpoint 3 reloads the thread and touchpoint 4 resolves referents against the previous turn's result set. "Is there a public version?" becomes `share_externally` on a known asset id, not a fresh search. Threads expire after 7 days of silence.

## 5. The asynchronous workflows: eight triggers

| Id | Trigger | What it does |
|---|---|---|
| T1 | SharePoint file created/modified (Power Automate → HTTPS webhook with drive and item id) | Fetch via Graph, extract text with page/slide numbers, chunk, embed, generate asset card, run visibility match, upsert. Idempotent on item id + version. |
| T2 | Nightly | Graph delta query on both drives. Handles renames, moves, deletes that Power Automate misses. Deleted items lose card and chunks the same night. |
| T3 | Every 6 hours | Read public bucket manifest, match to SharePoint items, update `asset_visibility`, flag drift. |
| T4 | Weekly | Crawl accops.com sitemap and blog RSS. Always public. |
| T5 | User clicks "Request public version" | Create publish request → marketing approver in Teams → on approval copy to bucket, update map, notify the requester in their original thread. |
| T6 | 24 hours after an answer | "Did this help?" with thumbs. Feeds ranking weights and the gap report. |
| T7 | Weekly, Monday | Content-gap report to marketing: unanswered asks ranked by frequency and by deal value where CRM context exists. |
| T8 | Nightly | Assets older than 12 months without an update: nudge the owner, show a stale badge in answers. |

T5 and T7 are the marketing-strategy payoff. They turn SAM's failures into a content roadmap with evidence.

## 6. Channels

| Channel | Transport | Auth | Rendering | Notes |
|---|---|---|---|---|
| Web app | Next.js on Vercel | Entra ID SSO | Rich cards, citations, trace panel (Perplexity/Grok style), library browser with card filters | Marketing's home: cards, freshness, gaps, analytics |
| Teams bot | Bot Framework / Azure Bot | Entra ID (inherent) | Adaptive Cards with buttons for follow-ups | Sales' home |
| WhatsApp | **Meta WhatsApp Business Cloud API** (Siddharth's decision, 4 Sep evening, revised from OpenWA once hosting became the constraint: no server to run) | Number-to-login map in `SAM_WHATSAPP_USERS`; unregistered numbers get a one-line refusal | Text, ≤3 links, public URLs first, SharePoint links marked internal | Webhook at `/api/channels/whatsapp`, signature-verified, answers after the 200 so Meta never times out; free within the 24-hour service window |
| API + MCP | REST (`/v1/...`) and an MCP server exposing the same tools | Per-user bearer token issued after Entra login | JSON only, no prose; the caller composes | Dwight extension is the first consumer |

**MCP tools (and REST twins):**

- `search_assets(query, filters, audience)` → ranked asset cards with visibility and why-it-fits
- `answer(question, context, audience)` → grounded answer with citations
- `get_asset(asset_id)` → card, chunks on request, links
- `public_link(asset_id)` → public URL or `{status:"private_only", can_request:true}`
- `request_publish(asset_id, reason)` → creates a T5 request
- `context_for_account(company, person_title, country, intent)` → talking points, shareable assets, internal-only assets, regulatory hook. This is the Dwight call.

## 7. Data model (Supabase Postgres)

- `assets` (card fields, owner, source_site, sharepoint_item_id, checksum, publish_date, freshness_flag)
- `asset_chunks` (asset_id, ordinal, page_or_slide, text, embedding vector, tsvector)
- `asset_visibility` (section 2)
- `conversations`, `turns` (channel, user, intent, slots, result asset_ids, response, latency, cost)
- `feedback` (turn_id, thumbs, comment)
- `gaps` (slots, count, first_seen, last_seen, example_turn_ids, status)
- `publish_requests` (asset_id, requested_by, reason, approver, status, public_url)
- `users` (entra_oid, email, phone_hash, role, territory, verticals)

Embeddings: Anthropic does not offer an embeddings API, so use Voyage (Anthropic's recommended partner) or an equivalent. Vector search via pgvector, keyword via Postgres full-text, fused with reciprocal rank fusion before the LLM re-rank.

## 8. What the three repos contribute

Cloned to `~/sam-accops/research/`. Verdicts from a read of each:

**archify (tt-a1i).** MIT. A dependency-free Node renderer that turns LLM-authored JSON into interactive HTML/SVG diagrams (architecture, workflow, sequence, dataflow, lifecycle). It has no ingestion, retrieval, embeddings or chat. It is not a RAG starting point. Use it two ways: as a downstream tool SAM calls to render architecture or comparison diagrams for decks, and as a pattern source. Its validate/deliver receipt contract (stable rule code, exact subject, evidence, only supported fixes, two correction rounds max) is exactly the shape SAM should use for "this answer failed the citation check". Its `SKILL.md` is a good template if SAM ships a Claude Code skill.

**agency-agents (msitarzewski).** MIT. About 350 markdown agent personas with YAML frontmatter, plus scripts that convert them to 15 tool formats. Not a framework. Directly useful pieces:
- Personas to seed SAM's own agents: `engineering/engineering-rag-pipeline-engineer.md`, `engineering/engineering-search-relevance-engineer.md`, `engineering/engineering-multi-agent-systems-architect.md`, `research/research-synthesist.md`, `sales/sales-engineer.md`, `sales/sales-account-strategist.md`, `specialized/business-strategist.md`, `marketing/marketing-content-creator.md`.
- `strategy/coordination/handoff-templates.md`: a From/To/Phase/Context/Deliverable/Acceptance/Evidence handoff schema. Adopt it as the message contract between SAM's router, analyst and composer so each step's output is inspectable.
- Author SAM's agents in the same format (`<division>-<slug>.md`, persona sections separate from operations sections) so the repo's lint and convert scripts work on them.

**OpenWA (rmyndharis).** MIT, NestJS, well engineered, active. It is an **unofficial** bridge over reverse-engineered WhatsApp Web clients (whatsapp-web.js or Baileys), needs a real phone linked by QR, and its own README says it is "not approved" where finance or regulatory compliance matters. Accops sells to banks. A ban would cut the sales team off with no appeal. Decision history: OpenWA was chosen on 4 Sep for an internal tool, then reversed the same evening when it turned out there is no VM or office server to host it. Final: Meta's WhatsApp Business Cloud API, built in section 14. OpenWA stays in `research/` as reference only.

## 9. Delivery plan

| Phase | Scope | Exit criteria |
|---|---|---|
| 0. Inventory (1 week) | Graph crawl of both sites, dedupe, file-type census, asset cards for everything, visibility match against the bucket, searchable card table in the web app | Cards for 100% of files; ≥90% agreement with the 68-doc inventory on type, product, vertical |
| 1. Find (3 weeks) | Touchpoints 1 to 9 for `find_asset` and `share_externally`; Teams bot; web app; T1, T2, T3, T5; 30-question eval set from real sales asks | hit@3 ≥ 85% on the eval set; zero private file bodies leave SharePoint |
| 2. Brain (3 weeks) | `answer_question`, `context_for_account`, MCP server, Dwight integration, T6, T7, T8, gap and freshness dashboards | Dwight produces an outreach draft from a live SAM call; first gap report delivered |
| 3. WhatsApp (2 weeks) | Cloud API onboarding, phone verification, text rendering | 10 reps onboarded, InfoSec sign-off on the links-only policy |
| 4. Productise (later, if wanted) | Tenant isolation, per-customer SharePoint consent, billing | Decision point, not a commitment |

Everything runs on Vercel and Supabase. Nothing runs on Siddharth's laptop.

## 10. Decisions Siddharth needs to make

1. **Internal tool or sellable product first?** Assumed internal, with tenancy addable. Changes auth and data isolation design if wrong.
2. **Is the public bucket S3-compatible with stable public URLs, and who owns it?** Assumed yes. Needed for T3.
3. **Uniform read access** to both SharePoint sites for everyone in sales and marketing? Assumed yes, so no per-user trimming in v1.
4. ~~WhatsApp via Meta Cloud API~~ Decided: OpenWA, internal tool, risk accepted.
5. **Claude API direct or via Bedrock**, pending InfoSec's view on where case-study text is processed.
6. **Who approves publish requests (T5)?** Assumed: Siddharth or a named marketing approver.
7. **Freshness threshold** of 12 months, and whether stale assets are hidden or only badged. Assumed badged.

Once these are confirmed, the next step is an implementation plan for Phase 0.

## 11. Prototype 0: the four-box shape on real collateral (built 4 Sep 2026)

Siddharth shared Google's serverless agentic diagram (web interface, agent runtime, custom Python tool, local JSON, model API) as an architecture reference only. SAM does not use Google or Gemini; it is an internal tool on our own stack. Prototype 0 in `../prototype/` keeps the four boxes and swaps the contents:

| Reference box | SAM prototype |
|---|---|
| Web interface | `app.py`: Streamlit chat with a per-answer "how SAM got there" trace |
| Agent runtime | `agent.py` (instruction + tools) and `runtime.py`: Claude Opus 5 via the Anthropic tool runner when a key is present, otherwise a retrieval-only local stand-in so the flow can be seen with no key |
| Custom Python tool | `sam_tools.py` `search_assets()` with filters over `data/asset_cards.json` |
| Local data file | 77 asset cards built by `build_cards.py` from the 68-doc inventory plus page counts and first-page text from the 69 PDFs/DOCX on disk. 62 inventory entries matched to files; 9 files were not in the inventory |
| Model API | Claude (Anthropic API direct for now; Bedrock remains an option pending InfoSec, see section 10) |

Deliberate choices: the tool searches with filters instead of returning the whole JSON (77 cards with text is ~150 KB and would cost money on every turn); deployment is internal only because the cards carry client names; the interface is Streamlit for speed and will fold into the Next.js app behind Entra ID.

What it proves: the four-box flow answers "find me X" on real Accops collateral with a visible trace. What it does not do yet: read SharePoint, know public URLs (every card is `private` until the bucket map exists), embeddings, Teams or WhatsApp.

No Anthropic API key exists on this machine, so only the local stand-in has run. Adding one to `prototype/.env` is the next step.

## 12. Web app v1: bot + catalogue + dashboard (built 4 Sep 2026)

Siddharth's direction after the PM/designer review: Teams is organisationally hard, so ship a Vercel web app with login ID + password that he tests himself first; Teams, WhatsApp and Slack become channels later. Two additions to the product: a browsable catalogue next to the bot (the WhatsApp Business + Shopify storefront pattern), and an admin dashboard.

Built in `../web/` (Next.js 16):

- `/login`: users from `SAM_USERS` (id:password[:admin]); signed cookie session.
- `/`: left pane asks SAM (Claude tool-use loop with `search_assets`, or retrieval-only without a key); right pane is the catalogue with facets (type, industry, product, year), a Latest view, and a "Not available" view listing industry × type × product combinations with zero assets, ranked by how often people have actually asked. Every answer carries three trust signals (year, internal/public, why matched), one-tap feedback, and an expandable trace. On mobile the two panes become tabs.
- `/admin`: people, questions, answer rate, feedback, catalogue opens, gaps, top questions, most surfaced assets, unanswered questions in the asker's words, recent questions. Events persist to Supabase `sam_events` (schema in `supabase-sam-events.sql`); in-memory until keys are set.
- Design: Plus Jakarta Sans only, cool paper background, navy primary, status colours carry meaning only, catalogue cards as spined documents grouped on shelves. No page-load motion.

Verified locally: auth guards, ask, gap logging, feedback, admin, non-admin redirect, 401 on unauthenticated API. Screenshots in `../shots/` (gitignored).

Still true: cards come from the files on disk, all assets show as internal until the bucket map exists, no embeddings, no SharePoint ingestion.

## 13. API and MCP surface (built 4 Sep 2026)

One engine, three transports. The REST routes under `/api/v1/` and the MCP server at `/api/mcp` call the same functions as the web chat, so the Dwight extension, an MCP client, and the browser get identical answers and all show up in the same dashboard.

| REST | MCP tool | Purpose |
|---|---|---|
| `GET /api/v1/search` | `search_assets` | Ranked cards, why-matched, visibility, links; `audience=external` filters to public |
| `POST /api/v1/ask` | `ask_sam` | Verdict + up to three assets, gap flag, trace |
| `GET /api/v1/assets` | `list_catalogue` | Browse with facet counts |
| `GET /api/v1/public-link` | `public_link` | Public URL or `private_only` + do-not-forward note |
| `GET /api/v1/gaps` | `content_gaps` | Missing combinations ranked by asks |
| `POST /api/v1/context` | `context_for_account` | Account brief for outreach (the Dwight call) |

Auth for machines: `Authorization: Bearer <token>` with tokens from `SAM_API_TOKENS` (label:token). The label is the user in analytics. Browser sessions also work on every REST route. All MCP tools are read-only and annotated as such. Claude.ai's own connector UI expects OAuth rather than a static bearer token, so adding SAM there later means adding an OAuth layer; Claude Code, the extension and scripts work today with the header.

**Model options.** Default Claude Sonnet 5 (`CLAUDE_MODEL`), Haiku 4.5 supported (effort flag is skipped for it). An optional OpenAI-compatible provider (`LLM_PROVIDER=openai-compatible`) exists for free-tier models such as Groq or Cerebras. Caveat recorded: free tiers often reserve the right to train on prompts, and SAM's prompts carry customer names from case studies, so InfoSec should approve before any free tier is used. Without any key SAM runs retrieval-only, which is free and already answers "find me X".

**WhatsApp hosting.** Siddharth has no VM or office server. Options: Oracle Cloud Always Free ARM instance (genuinely free, enough for OpenWA), Azure free-tier B1s (1 GB, too small for the Chromium engine), or a paid small VM at roughly the cost of a coffee a month. The alternative that needs no server at all is Meta's WhatsApp Business Cloud API, whose webhooks land directly on Vercel. Decision pending.

## 14. WhatsApp channel on Meta's Cloud API (built 4 Sep 2026)

`web/lib/whatsapp.ts` and `web/app/api/channels/whatsapp/route.ts`. Flow per inbound text: verify `X-Hub-Signature-256` with the app secret, extract text messages (statuses, media and reactions ignored), return 200 immediately, then in a post-response task: dedupe on message id, map the sender number to a SAM login, mark the message read with a typing indicator, run the same `apiAsk` as every other channel with a six-hour per-number history for follow-ups, render as verdict plus at most three links with public links first and internal ones labelled, send via the Graph API. Unregistered numbers get one refusal line and are logged as `unregistered`. Without an access token the route runs dry and logs the reply, which is how it was tested locally: handshake, wrong verify token, bad signature, signed message, unregistered sender, and replay of the same message id all behaved as specified, and the WhatsApp question appeared in the dashboard under the mapped login.

What Siddharth must do on the Meta side is in `web/README.md` (about 30 minutes, needs a Meta Business account and a number that is not already on WhatsApp).

## 15. WhatsApp live, and what the first real test exposed (4 September 2026, evening)

Siddharth completed the Meta setup on a second device and the channel works end to end: "Bank Case Study" from the registered mobile returned three Accops bank case studies. The configuration, and two expiry dates that will fail silently, are recorded in `TASK-whatsapp-meta-setup.md`.

Testing the live system against realistic questions then exposed three defects that the earlier dry-run tests could not, because they only ever exercised the happy path:

**Duplicate assets ate answer slots.** Three documents were filed under two verticals each (a bank case study in both BFSI and Govt folders, Polycab under manufacturing and nutanix, an e-commerce study twice) and four whitepapers existed as both PDF and DOCX. A search for "public sector bank case study" spent one of its three slots on the same document twice. Fixed by deduplicating on filename first, then content hash, keeping the richer card. 74 entries collapse to 66 real documents. Industry classification is unaffected because it comes from card metadata, not the folder.

**A missing asset type produced an error instead of an answer.** Asked for a Citrix battlecard, the model looped on near-identical searches, hit the iteration cap, and returned "SAM ran out of steps before answering". Fixed by telling the model it has a three-search budget and how to widen, telling it the library contains no battlecards or decks, and making budget exhaustion fall back to the best results found or an honest gap. It now answers in one search.

**Asking for something to send externally reported a false gap.** Because no asset has a public link yet, an `audience=external` search always returns nothing, so SAM said "nothing matches" when 18 BFSI case studies exist. Fixed: the model no longer filters externally, recommends the right internal assets, and adds a line about asking marketing to publish first.

The lesson worth keeping: every one of these was invisible until real questions were asked of the deployed system. The dry-run tests were necessary and insufficient.
