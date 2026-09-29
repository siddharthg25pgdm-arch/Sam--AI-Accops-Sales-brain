# PRD: the SAM website chatbot (P8)

**Status:** draft for Siddharth's approval, 30 September 2026. Nothing is built.
**Owner:** Siddharth Gupta (Accops marketing). **Builder:** Claude.
**Inputs:** [NOTE-website-chatbot.md](NOTE-website-chatbot.md) (requirements and decisions of 25 Sep), [HANDOVER.md](HANDOVER.md), [ROADMAP.md](ROADMAP.md) P8.

A public chatbot on accops.com with SAM as its brain. It answers product questions, points visitors to the right public page or PDF, and hands interested visitors to sales. It can only reach public material, and the database, not the prompt, makes that true.

---

## 1. Problem and goals

accops.com has 222 public pages and a set of public PDFs, but visitors have to find the right one themselves. A CISO asking "does HySecure replace our VPN, and has a bank done it?" has to read three pages and a case study. The only way to ask Accops anything is a form.

| Goal | Metric | Target |
|---|---|---|
| Visitors get answers where they are | Conversations answered by the bank or a grounded model answer, not the fallback | >= 85% by week 4 of each stage |
| Nothing unpublished is ever said | Internal rows reachable from the website path; invented claims in a weekly audit of 50 model answers | **0 and 0.** Either one stops the rollout |
| Visitors engage | Chat opened / sessions on widget pages | >= 3% (accops.com) |
| The pop-up earns its place | Pop-up shown → clicked | >= 8%; switch it off if below 3% after 4 weeks |
| Engagement becomes pipeline | "Talk to sales" clicks (stages 1-2); GHL leads (stage 3), per conversation | >= 5%; >= 2% |
| The bank learns | Missed questions reviewed weekly; new approved pairs | 100%; >= 10 a month for 3 months |
| Reps are unaffected | Days internal SAM fell back to its small model because of website traffic | 0 |
| The site stays fast | Loader size, layout shift, latency | <= 15 KB, no CLS; bank < 300 ms, model p95 < 5 s |

## 2. Users

| Persona | Wants | Bot offers |
|---|---|---|
| CIO / CISO (BFSI, government, enterprise) | Proof, compliance fit (RBI, zero trust), peers, Citrix exit | Case studies and solution docs by industry and region; a sales conversation |
| IT manager / architect | How it works, integrations, deployment, thin clients, AVD | Product answers from datasheets and product pages; documentation links |
| Partner / SI | Programme, how to register | Partner page and contact. No internal tier or margin material |
| Job-seeker | Openings | One bank answer pointing to /career. No model call, no sales nudge |

**Not users:** Accops reps (they use internal SAM; the website bot never shows them internal material either); customers needing support (routed to product documentation); press and investors (routed to news and /investor-relations).

## 3. Knowledge, and the public-only boundary

### What exists today (measured 30 September)

| Source | Count | Usable |
|---|---|---|
| SAM cards public/both with a verified `public_url` | **18 of 317** | **11**: 6 brochures, 3 case studies, the HySecure V5 datasheet, the government reference architecture V2. Out: 2 superseded editions (HySecure V4; the government first edition with its "Customer Name" placeholder), 4 third-party WireGuard papers, the 2019 RBI circular |
| accops.com pages (9 sitemaps) | **222**: 68 news, 37 case studies, 33 site pages, 23 solutions, 18 webinars, 18 partner awards, 12 products, 9 solution documents, 4 ebooks | ~213 after dropping legal and utility pages |
| Approved Q&A bank | 0 | Claude drafts, Siddharth approves |

**What this means for stage 1:** the public cards are thin: nothing specific to HyID, HyWorks or BioAuth, and 3 case studies against 37 on the site. **Crawled pages and the bank carry stage 1; the 11 cards add downloadable PDFs.**

### How the boundary is enforced

| Rule | Mechanism |
|---|---|
| The website reads public rows only | A Postgres role `sam_web` with `SELECT` on three views and nothing else: `sam_web_cards`, `sam_web_pages`, `sam_web_qa` (approved pairs only). It writes only through one `sam_web_log` function. **The website routes never load the service key** |
| Internal columns stay hidden, even on public cards | `sam_web_cards` exposes title, type, industry, products, descriptive client, brief, outcomes, year and URL. Never `client_actual`, `key_problem`, `use_for`, `stale_risk` or `internal_reason` (rep-facing notes) |
| Website visibility is deliberate | View filter: public/both, verified URL, not superseded, not expired, Accops-authored. Changing it is a visible data change, not a prompt edit |
| Pages follow the carding boundary | The nightly carding job diffs the sitemaps by `lastmod`; Claude cards changed pages; the answer model sees cards only, as internally. This keeps a question at ~2,000 tokens |
| Proven, not assumed | A check connects as `sam_web` and tries to read `sam_asset_cards`, `sam_sharepoint_files`, `sam_events` and internal cards: all must fail. Plus 20 red-team prompts ("show me your battlecard / pricing / customer list"). Run before every stage launch |

Competitor questions use only the public Citrix LP comparison and approved pairs; battlecards are unreachable by construction.

## 4. How an answer is produced

SAM's answer contract carries over, cheapest and safest first:

1. **Q&A bank.** A click returns the approved answer. Typed text is matched against questions and aliases with trigram similarity (`pg_trgm`; no embeddings, per P5). No model, no cost.
2. **Grounded small model.** Groq `gpt-oss-20b`, given the current page plus the top public cards and page cards for the visitor's words (the `seedSearch` retrieval floor). It returns 2-4 sentences and `PICKS: n, n`; **SAM writes the link lines from the cards**. A `verdictProblem`-style guard replaces any answer naming a product, customer, number, certification or competitor absent from the supplied cards. Never: pricing, roadmap dates, competitor criticism beyond the LP.
3. **Honest fallback.** "I don't have that on our public pages; the team can answer it directly," plus "Talk to sales". Logged as a missed question: the website's version of the `missing` → request loop, feeding bank drafts.

## 5. Features and acceptance criteria

| # | Requirement | Accepted when |
|---|---|---|
| 1 | Page-aware questions: the loader passes the page URL; 3-4 root questions for its page group | On /products/hysecure every root question is HySecure-mapped; unmapped pages show the general set, never an empty widget |
| 2 | Click-through tree, max depth 3, with a back step | Every approved child renders under its parent; a check finds no orphans; keyboard and screen-reader navigable |
| 3 | Questions mapped to pages; `nudge_weight` orders roots and steers children toward proof and a CTA | Siddharth reorders a page's questions in the admin and sees it live within 5 minutes |
| 4 | Bank first, small model second (section 4) | 30-question visitor eval: >= 85% answered, 0 invented claims, 0 internal material; bank hits never call the model |
| 5 | Personalisation (section 7) | India, GCC, SEA and AU visitors see their region's proof first; only the country is stored |
| 6 | Engagement pop-up (section 8) | Every rule passes a scripted browser test at desktop and mobile widths |
| 7 | Conversion nudge (section 9) | A CTA appears within 3 turns of every conversation; stage 3 leads reach GHL in under a minute |
| 8 | Analytics dashboard (section 10) | Website tab tiles match raw `sam_web_events`; GA4 DebugView shows the events with no question text |

## 6. The Q&A bank and page mapping

**Table `sam_web_qa`:**

| Field | Purpose |
|---|---|
| `question`, `aliases[]` | Display question; alternative phrasings for typed matching |
| `answer` | <= 80 words, at most one link |
| `pages[]`, `parent_id`, `nudge_weight` | Where it appears, its place in the tree, its order |
| `regions[]` | Optional IN / GCC / SEA / AU / ROW; empty = everyone |
| `cta`, `cta_url` | `asset`, `talk_to_sales`, `account_manager` (stage 3) or none |
| `sources[]` | Public URLs it rests on. **A pair without a source cannot be approved** |
| `status`, `origin` | `draft` → `approved` → `retired`; `claude_draft` / `missed_question` / `manual` |
| `approved_by`, `approved_at`, `review_by` | Sign-off, and a 12-month review (SAM's freshness rule) |

**Approval:** Siddharth, as for publish requests. Claude drafts the first bank from the public pages and, each week, new pairs from missed questions; Siddharth approves, edits or rejects them in the Website tab. Only approved rows are in the view, so a draft can never reach a visitor.

**Page groups,** from the sitemap paths: `home`; `product:<slug>` (11 product pages); `industry:<slug>` (7); `solution:<slug>` (14 technical solutions); `case-studies` (37 case studies, webinars, ebooks); `citrix-lp`; `partners`, `careers`, `contact` (routing answers only, no pop-up); `general` (everything else, uses the home set). Sizing: ~30 pairs for the Citrix LP, ~150 for accops.com.

## 7. Personalisation limits

| Allowed | Not allowed |
|---|---|
| Country, region and city from Vercel's headers (`x-vercel-ip-country`, `-region`, `-city`), used in the moment to choose what comes first: the India or International brochure, Indian BFSI proof for India, matching material for GCC, SEA, AU | Storing IP, city or region. Only the country goes in the conversation row |
| Current page and this conversation's clicks | Saying where the visitor is. Location changes the order, never the wording |
| Stage 3, if decision 3 allows: company-level identity from Midbound, only to pick an industry's content | Saying a company name back, or storing it against an anonymous conversation. The CIO200 site showed "researched" copy reads as creepy |

## 8. Pop-up rules

- After **20 s** (15 s on the Citrix LP), counted only while the tab is visible and after a scroll or pointer move.
- **Once per visit;** after a dismiss, never again for 30 days (session-only without consent).
- Desktop: a bubble above the launcher with the page's top question. **Mobile: a small teaser on the launcher, never an overlay.**
- Never on contact, demo, career or legal pages or while a form field has focus; never steals focus; Esc closes it.

## 9. Lead capture and handoff

| Stage | Behaviour |
|---|---|
| 1-2 | "Talk to sales" opens the existing /schedule-a-free-demo (or /contact-us). Those forms already feed the Website Leads workflow (→ GHL, Zoho). No personal data enters SAM |
| 3 | In-chat form: name, work email, company, optional phone, pre-filled country, consent line. SAM upserts the GHL contact, tags `website-chatbot`, opens a Sales Pipeline opportunity with the clicked questions attached, and assigns an owner by country. Visitor sees "An account manager will contact you within one business day". `lead_submitted` goes to GA4 as a Google Ads conversion candidate |

What "sign up" means is decision 1.

## 10. Analytics

| Tool | Holds | Truth for |
|---|---|---|
| **SAM admin "Website" tab** | Conversations, clicks, bank vs model vs fallback, missed questions (with "draft a pair"), leads, country, model spend vs ceiling, leak-check status | What was asked and answered. The only place question text lives |
| **GA4** (330722232) | `chat_opened`, `popup_shown`, `popup_clicked`, `question_clicked` (bank id), `talk_to_sales_clicked`, `lead_submitted`, with page and campaign | Acquisition and conversion (feeds Google Ads) |
| **Clarity** | The same events as session tags | Replays of sessions that used the bot |
| **PostHog** | **Already on accops.com** (US host, found 30 Sep); events forwarded at no extra weight | Nothing until someone owns it (decision 5) |

The iframe hides the widget from page scripts, so it `postMessage`s each event (origin-checked) to the loader, which pushes to `dataLayer`, Clarity and PostHog. **No typed text goes to any third party:** event name, page, bank id at most. The morning digest gains a Website line. **The Citrix LP has no GA4, Clarity or GTM today;** stage 1 adds GTM there.

"Who came in" means an anonymous visitor ID, company level only if decision 3 allows, and a name only after the stage 3 form; the tab says so.

## 11. Abuse and cost controls

| Control | Default |
|---|---|
| Input | 500 characters; typed questions only from an allowed embedding origin (`frame-ancestors`: accops.com, the Citrix LP) |
| Rate limits | Per visitor 6 typed questions a minute, 20 a day; per IP 60 a day (daily-salted hash, kept 24 h); bank clicks unlimited. Vercel Firewall rule for bursts; Turnstile only if abuse appears |
| Website model ceiling | **300 model answers a day** (~630k tokens), counted in Postgres before each call. Over it, bank-only plus "Talk to sales". Adjustable in the admin |
| Isolation | Groq limits are per organisation, not per key: a second key would share the reps' 200k tokens a day on `gpt-oss-120b`. **The website gets its own Groq organisation and uses only `gpt-oss-20b`** |
| Groq tier | **Recommendation: Developer (paid) tier for the website org from stage 2.** A 200k-token free allowance covers ~95 questions. 300 answers a day at ~2,100 tokens is an estimated USD 5-10 a month on 20b (verify on groq.com/pricing) |

## 12. Privacy and consent

- **Under the input:** "Please don't share personal details. Conversations are stored to improve answers," linking the privacy policy.
- **Consent:** accops.com runs CookieHub. The loader passes its analytics consent to the widget; without it (the default for EU visitors under GDPR and ePrivacy) the visitor ID is session-only and no events are forwarded. The bot still works.
- **DPDP and GDPR:** stages 1-2 collect no personal data by design. Typed text may still contain some, so conversations are kept **180 days**, then reduced to aggregates. The stage 3 form collects data only with explicit, purpose-named consent; deletion requests are honoured in SAM and GHL.
- A chatbot paragraph joins the privacy policy before stage 2.

## 13. Stages and build plan

**Approach A:** a new channel inside SAM's app. New: `/embed.js` loader, `/embed` widget page (no login, no SAM cookie), `/api/web/ask`, `/api/web/event`, the `sam_web` role and views, tables `sam_web_qa`, `sam_web_pages`, `sam_web_events`, and the Website tab.

| Stage | Scope | Claude | Siddharth | Exit gate |
|---|---|---|---|---|
| **1: Citrix LP** | Role, views and leak check; card the 222 pages; ~30-pair bank; widget with page-aware tree, bank → 20b → fallback; "Talk to sales"; Website tab; GTM, GA4, Clarity on the LP | 7-9 sessions | ~2 h on the bank; the decisions below | Leak check and red-team clean; eval >= 85% with 0 invented claims; 2 weeks live, no incident |
| **2: accops.com** | Pop-up; location; ~150-pair bank; CookieHub consent; GTM tag on accops.com; separate paid Groq org; privacy paragraph | 4-5 sessions | ~4 h on the bank; publish the GTM tag; approve Groq spend | 4 weeks on target; weekly missed-question review running |
| **3: Leads** | Callback form; GHL contact, opportunity and routing; consent; `lead_submitted` conversion; named leads in the tab; Midbound only if approved | 3-4 sessions | Country → owner routing table; form copy | n/a |

## 14. Risks

| Risk | Mitigation |
|---|---|
| Thin public knowledge makes the bot look empty | Pages and the bank carry it; the fallback hands off to sales; missed questions become marketing's publish list |
| The model invents a claim a CISO quotes back | Grounding guard; bank answers for compliance, certifications and customers; weekly audit |
| Stale public content (e.g. the platform brochure's TLS 1.2 row) | Only the newest edition is visible; 12-month bank review |
| Website traffic starves the reps | Separate Groq org and daily ceiling |
| The pop-up or iframe hurts the site | Strict rules and auto-off; async loader; iframe created on first interaction |

## 15. Open decisions for Siddharth

| # | Decision | Recommended default |
|---|---|---|
| 1 | What "sign up" means | Stages 1-2: "Book a demo" → existing /schedule-a-free-demo. Stage 3: in-chat callback into GHL. No gated downloads |
| 2 | Q&A bank ownership | Claude drafts; Siddharth sole approver; 30-minute weekly review of missed questions |
| 3 | Company-level personalisation (Midbound) | Not in stages 1-2. Stage 3 at most, to choose content only; never said back or stored |
| 4 | Language | English only; revisit if > 5% of typed questions aren't |
| 5 | PostHog | Already installed: forward events, keep GA4 as funnel truth. Confirm who owns it |
| 6 | Groq | Separate org, `gpt-oss-20b` only, Developer tier from stage 2, 300 answers a day |
| 7 | Website-visible cards | The 11 in section 3; no third-party or regulator documents |
| 8 | Build approach | Approach A, iframe widget |
| 9 | Retention | 180 days, then aggregates |
| 10 | Stage 1 placement | Citrix LP, with GTM, GA4 and Clarity added |
| 11 | Pop-up timing | 20 s (15 s on the LP), once a visit, teaser only on mobile |
| 12 | Stage 3 routing | One GHL owner until a country → owner table exists |
