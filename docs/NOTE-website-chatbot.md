# Note: the SAM website chatbot

**Status:** requirements captured 25 September 2026, to be structured in the SAM PRD. Nothing built.
**Position:** the last phase of the SAM project (roadmap P8).

SAM is the chatbot's database and brain. The chatbot is a new public channel on the Accops website,
with **restricted access**: it can only reach public material, never SAM's internal items.

---

## 1. What Siddharth wants (his requirements, lightly edited)

1. **Page-aware questions.** The bot shows questions relevant to the page the visitor is on. On the
   HySecure product page, it shows HySecure questions.
2. **Click-through question tree.** A visitor clicks a question and gets a predefined answer, plus
   follow-up sub-questions under it.
3. **Every question is mapped to pages:** HySecure, HyID, products, solutions, case studies and the
   home page. Only relevant questions appear on each page. A visitor can still explore freely, but the
   bot nudges them along paths that suit Accops.
4. **A question-and-answer bank is the first layer.** For anything the bank doesn't cover, a small
   LLM answers, drawing on SAM.
5. **Personalisation.** The bot identifies something personal about the visitor. Location is one
   example.
6. **An engagement pop-up.** If the visitor stays on a page for more than about 15-20 seconds, the bot
   pops up an interesting question to draw them into clicking and asking.
7. **A conversion nudge.** After engaging, the bot nudges the visitor to sign up, or offers a
   personalised approach: "We'll have an account manager connect with you directly."
8. **An analytics dashboard, a major part of the chatbot** (added 25 September). A backend view of how
   many people use the bot, who came in and used it, and how many times. It connects to Microsoft
   Clarity, Google Analytics and PostHog to see more.

## 2. Already decided (25 September 2026)

| Decision | Choice |
|---|---|
| Purpose | Answer product questions, help visitors find content, and capture leads, built in stages |
| Stage 1 | Answers and content, ending with a "Talk to sales" link. Lead capture comes after |
| What the bot may know | Public accops.com pages (read and carded automatically from the 9 sitemaps), SAM items already marked public, and an approved Q&A bank (the "predefined answers" in requirement 4) |
| First placement | The Citrix LP (accops-citrix-lp.vercel.app), then accops.com via Google Tag Manager |
| Restriction | Enforced by the database, not by the bot's instructions. The website route gets a low-privilege key that can only read public rows |

**Proposed, not yet approved:** build it as a new channel inside SAM's existing app (approach A),
rather than as a separate app or an off-the-shelf bot. The widget loads as an iframe from SAM's
domain.

Facts gathered along the way:
- accops.com is a custom Nuxt site with Google Tag Manager installed (container GTM-WHL9Z33F).
- It publishes 9 sitemaps: pages, news, case studies, webinars, ebooks, products, solutions, solution
  documents and partner awards. The case-studies sitemap alone lists 30+ pages.
- The Citrix LP's own 3-option comparison is public, so the bot can answer "how do you compare to
  Citrix?" from it without touching the internal battlecards.

## 3. How the requirements could fit together (Claude's proposal, for the PRD to confirm)

**Answer order, cheapest and safest first:**
1. **The Q&A bank.** An exact click, or a close match on typed text, returns the approved answer. No
   model is called, so it costs nothing and says exactly what marketing signed off.
2. **SAM's public search plus a small model** for anything the bank misses, grounded only in public
   material. Groq's `gpt-oss-20b` is a likely fit.
3. **The honest fallback:** "I don't have that, and here's how to reach the team."

**What the Q&A bank would hold:**

| Field | Purpose |
|---|---|
| question, answer | The approved pair |
| pages | Which pages it appears on (HySecure, HyID, products, solutions, case studies, home) |
| parent | The question it sits under. This is what makes the tree of sub-questions (requirement 2) |
| nudge_weight | How strongly the bot steers toward it (requirement 3) |
| cta | What follows the answer: a related asset, "Talk to sales", or the account-manager offer |
| sources | The public URLs the answer is based on, so every claim can be traced |
| approved_by, approved_at | Who signed it off, and when |

It would live in Supabase next to SAM's other tables. Claude can draft a first bank from the public
pages for Siddharth to edit and approve.

**Personalisation without storing anything personal.** Vercel gives every request the visitor's
approximate country, region and city for free, with no lookup and no stored IP. That is enough to
lead with regionally relevant proof: Indian BFSI case studies for India, and the matching material for
the Middle East, South-East Asia and Australia (where the KSA, SEA and AU campaigns already run).

**Staging the eight requirements (proposal):**

| Stage | Includes |
|---|---|
| 1 | Q&A bank, page-aware questions, the question tree, the small-model fallback, a "Talk to sales" link, and the **Website tab on the SAM dashboard** plus GA4 and Clarity events, so there's data from day one. Launched on the Citrix LP |
| 2 | The timed pop-up, location personalisation, and a move to accops.com via GTM |
| 3 | Lead capture and the account-manager handoff, most likely into GHL, since Accops' sales pipeline already lives there. Named-visitor analytics become possible here |

## 3b. The analytics dashboard (requirement 8, Claude's proposal)

**Each tool answers a different question.** Using all four for everything would give four
disagreeing numbers.

| Tool | Answers | Holds |
|---|---|---|
| **SAM admin dashboard**, a new "Website" tab | What did visitors ask, and did the bot answer? | Conversations, question clicks, bank hit vs model vs fallback, missed questions, leads. The only place question *text* is kept |
| **Google Analytics 4** (property 330722232) | Where do chatbot users come from, and do they convert? | Event names only: `chat_opened`, `popup_shown`, `question_clicked`, `lead_submitted`, with page and campaign |
| **Microsoft Clarity** | What did chatbot users do on the page? | The same events, attached to session recordings, so "sessions where someone opened the bot" can be replayed |
| **PostHog** | Funnels and cohorts across visits | Optional. It overlaps with GA4 (funnels) and Clarity (replay), so pick it only if it replaces one of them |

**What "who came in" can honestly mean:**
- **An anonymous visitor ID** in the browser gives unique visitors, repeat visits and "used it 4 times
  this month". It is not a name.
- **Company level:** Midbound, already used by the Visitor Route Engine, can say "someone from Bank X".
- **A named person** only once they hand over details at the lead step (stage 3).

Anything more specific than that for an anonymous visitor isn't possible, and the dashboard should
say so rather than imply it.

**Three technical points to design in from the start:**
1. **The iframe hides the bot from page analytics.** The widget runs in an iframe on SAM's domain, so
   the GA4, Clarity and PostHog scripts on the parent page can't see inside it. The widget has to pass
   each event out to the page's loader script, which forwards it to all three.
2. **No question text goes to third parties.** GA4, Clarity and PostHog receive an event name, the
   page, and a question-bank ID at most. What people actually typed stays in SAM's own database.
   Visitors type company names, problems and sometimes contact details.
3. **Consent applies here too** (see item 4 below). Analytics cookies for EU visitors need consent
   before they're set.

**Dashboard tiles, first version:** visitors, conversations, messages per conversation, repeat visitors,
pop-up shown → clicked rate, top clicked questions per page, questions the bank missed, leads, and
visitors by country. These are a website version of tiles the internal dashboard already has.

## 4. Things the PRD must settle

1. **What does "sign up" mean?** Accops has no self-serve product, so it could be a demo booking, a
   callback request, a newsletter or a content download. Each needs a different form and destination.
2. **Who owns the Q&A bank** after the first draft: who writes new pairs, and who approves them?
3. **How far should personalisation go?** Location is low-risk. Identifying the visitor's *company*
   is possible (the Visitor Route Engine already de-anonymises visits with Midbound), but reading a
   company name back to a visitor can feel intrusive. The CIO200 invite site found that "researched"
   copy came across as creepy. Suggest: use company identity to pick what to show, never to say it
   back to them.
4. **Consent and privacy.** Time-on-page and location used only in the moment need no storage. If
   either is logged, or tied to a lead, the widget needs a consent line: India's DPDP Act, and GDPR
   for EU visitors.
5. **Pop-up manners.** Show it at most once per visit, never again after a dismiss, and don't cover
   content on mobile. An annoying pop-up costs more trust than it earns clicks.
6. **Abuse and cost.** A bot with no login can be hammered. It needs per-visitor rate limits and a
   daily ceiling on model calls, so a bot attack can't exhaust Groq's free tier for the internal SAM.
7. **Measurement.** Pop-up shown → clicked, which questions get clicked per page, which typed
   questions the bank missed (these become the next bank entries), and leads. All reported as a
   "website" channel on the existing admin dashboard.
8. **Language.** English only, or other languages for the SEA and Middle East markets?
9. **PostHog: in or out?** Is it already in use at Accops, and would it replace GA4 or Clarity, or sit
   alongside both? Running three analytics tools on one page slows it down, and three sets of numbers
   will never agree.
