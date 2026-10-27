# Website chatbot benchmark: Sophos Scout, Pathlock Gracie, Ask Accops

27 October 2026. I tested each bot as an anonymous visitor in one Playwright Chrome window (Windows, India IP) at 1280x800, then at 390x844. I gave no email, name or phone, booked no meetings and submitted no forms. Each bot got the same 7 questions plus a return visit. I ran guardrail probes on our bot only. Screenshots are in [shots-2026-10-27/](shots-2026-10-27/).

## Summary for Siddharth

- **Sophos and Pathlock both run Qualified's AI SDR (the "Piper" style agent).** The two bots behave almost the same way. Each opens by itself a few seconds after the page loads and greets you with a question about the page you're on. Every answer ends with a qualifying question. After 3-4 turns they start asking for your email: on pricing, on trials, on "talk to someone", and in Pathlock's case on almost every later reply. Neither shows a calendar until you give an email.
- **Ours is much faster.** Approved answers come back in about 1 second and model answers in 3-6 seconds. Theirs take 4-13 seconds (median 7-8 s), with "Thinking…" and "Finding relevant content…" shown while you wait. Ours also never asks for personal data, shows a source under every answer, refused both guardrail probes, and gave the most useful pricing answer of the three.
- **Our weak spot is the hand-off and the conversation.** "Talk to an engineer" sends visitors to accops.com in a new tab, even though the landing page already has the Bookings calendar and our widget has an in-panel calendar that isn't switched on. Our bot also never asks the visitor anything back, so it learns nothing about them (size, timeline, customer or not). Both rivals do this on every turn.
- **The three changes worth copying:**
  1. Switch on the in-chat calendar with no email gate.
  2. End answers with one tap-to-answer qualifying question.
  3. Answer vague "we have problems" messages with triage chips, including a route to support for existing customers.

## Comparison

Ratings: **Strong / OK / Weak**, judged from a B2B buyer's point of view.

| Criterion | Sophos "Scout" (Qualified) | Pathlock "Gracie" (Qualified) | Accops "Ask Accops" (SAM) |
|---|---|---|---|
| Proactive greeting, timing | **Strong (but intrusive).** A greeting panel opens by itself about 3 s after load and covers part of the page | **Strong (but intrusive).** Same panel about 3 s after load | **OK.** Launcher only. A small teaser bubble appeared about 15-20 s after the first scroll, with 3 page questions. It never covers the page |
| Page awareness | **Strong.** On the ZTNA page the greeting was rewritten within about 10 s: "Sophos ZTNA secures your remote workers… How are you currently managing remote access security?" | **Strong.** The greeting changed when I scrolled ("…how are you currently addressing SoD conflicts…?") | **Strong.** Questions follow the page and the section (`sec=section-1`, `sec=talk`), under "Asked on this page" |
| Buttons and chips | Book a Meeting, Become a Sophos Partner, Technical Support, always visible above the input | Schedule a demo, Customer support, always visible | 4 starter questions, then 3 follow-up chips and an orange CTA after each answer. "Prefer a person? Talk to an expert" |
| Answer format | Markdown bold, italics, bullets, several inline links. 60-150 words | Same, about 110 words | 2-4 sentences with highlighted key phrases and one source pill. A visual table for the comparison answer |
| Grounding and citations | **OK.** Inline links to sophos.com. One link labelled "ZTNA FAQ" went to an old early-access news release | **OK.** Inline links, used well | **Strong.** Every answer has a source pill. Facts are checked on the server, and an answer that fails the check falls back to verbatim quotes |
| Accuracy (sampled) | Good. It said Yes to Entra ID, with links | Good. It said it had no verified BTP details "so I don't want to guess" | Good, with 2 problems: the fallback filled itself with irrelevant quotes, and the Linux answer was scoped to the managed-desktop service (see problems below) |
| Latency (7 questions) | 4.0-13.1 s (median about 7.4 s) | 6.7-12.0 s (median about 8 s) | **Strong.** 0.8-1.5 s from the bank, 3.3-5.6 s from the model, 1.0 s from the cache |
| Waiting feedback | "Thinking…" → "Finding relevant content…" → "Thinking…". The answer appears all at once | Same | Dots, then a skeleton, on slow replies only (most replies are fast) |
| Voice | "Speak now" orb. Sophos also loads a custom avatar video (`custom_replicas/team_2349/sophos-ai-sdr_idle.mp4`) | "Speak with Gracie" orb and a mic in the input | None |
| Lead capture | **Pushy.** Asks for email on pricing (message 4), trial and "talk to someone" | **Pushy.** Asks for email on pricing and then at the end of every later reply, even the vague one | **None by design.** No personal data in stages 1-2 |
| Meeting booking flow | Email first, no calendar seen before that | Email first | **Weak today.** The CTA opens accops.com/schedule-a-free-demo in a new tab. The LP's own Bookings calendar (#talk) and our in-panel calendar are not used |
| Memory and return visit | The thread carries over from page to page (links open in the same tab). No "welcome back" | Same | **Strong.** The thread survives a reload. A new tab gets "Welcome back! Last time you looked at… Want to pick up there?" with "Pick up where you left off" chips |
| Mobile (390x844) | Full-screen sheet with wrapped chips. OK | Full-screen sheet. OK | Full-screen sheet. OK. The privacy note takes 3 lines |
| Privacy text | "By chatting, you agree that Sophos and our providers may use AI technology to respond to, monitor, record and use this chat…" | "This conversation may be monitored and recorded. See our Privacy Policy." | "Please don't share personal details. Conversations are stored to improve answers, and the topics you view are remembered on this device for 90 days." **Clearest** |
| Pricing | "We tailor pricing… can't provide pricing details in chat… what's the best email?" | "Depends on users, apps, modules… what's the best email?" | **Strong.** Explains why there's no list price and offers a review of the visitor's Citrix renewal quote. Next-step chips: savings, licensing models, renewal protection |
| Competitor question | Avoids a comparison and pivots to "one connected system" | "I can't do a head-to-head comparison" but explains how it complements SAP GRC, with 2 links | **Strong.** Candid: "covers the same ground… if you rely heavily on HDX… evaluate carefully", plus a product-map table |
| Vague problem ("remote access problems") | **Strong.** "Are you looking for **sales assistance** or **technical support**?" with 2 chips | Reads it as buying intent and asks for email | **Weak.** A generic answer plus "I can connect you with someone". No clarifying question and no support route |
| Off-topic and guardrails | Not tested (third-party bot) | Not tested | **Strong.** The price-list and system-prompt probes were refused in 0.6 s. The 3rd identical question got "Looks like this one needs a person" |
| Platform evidence | `js.qualified.com/qualified.js`, `multimodal_v2` pack, `app.qualified.com/w/1/<site>/messenger` and `/visitor_events`, `assets.qualified.com/static-media/piperx-orb/…` | Same Qualified stack. It pushes a GA4 event `Qualified Chat / Conversation Started` | `sam-accops.vercel.app/embed.js` → iframe `/embed`, `/api/web/config`, `/api/web/ask`, `/api/web/event`. Served from Vercel `bom1` (Mumbai) |

## What they do better than us

1. **They ask back.** Every answer ends with a qualifying question ("Are you on S/4HANA Cloud Public or Private Edition, or RISE?", "stopping ransomware, securing remote access (ZTNA), or faster detection?"). That is how they qualify and route visitors. Our follow-up chips keep the visitor reading, but we learn nothing about them.
2. **Triage of vague messages.** Scout split "we have remote access problems" into sales vs technical support with two chips. Ours has no support route, so an existing customer with a problem ends up at "Talk to an expert".
3. **Routing buttons are always visible.** Book a Meeting, Technical Support and Become a Partner stay above the input at every turn. Partners and existing customers are a real share of B2B site traffic.
4. **The opener is a question about the page.** Both greet with a page-specific discovery question, and Pathlock's changes as you scroll. Our teaser offers questions *visitors* might ask, not a question *to* the visitor.
5. **The conversation follows the visitor.** In-chat links open in the same tab and the panel reopens with the full thread on the next page. This matters for stage 2 on accops.com, which has many pages. On the single LP it matters less.
6. **Voice and an avatar.** Both have "Speak now", and Sophos loads a custom video avatar. Impressive, but low value for our buyers right now (see "Not recommended").

## Where we're already better

1. **Speed.** About 1 s for approved answers and 3-6 s for written ones, against 4-13 s.
2. **No email wall.** We answer pricing, POC and "talk to someone" without asking for personal data. Qualified's bots ask for an email on those three and then keep asking.
3. **Pricing and competitor answers that actually help.** We explain why there's no list price and offer the renewal review. We're candid about HDX, and the comparison table is the only visual answer any of the three gave.
4. **Grounding you can see.** A source on every answer, server-side fact checks, quote fallback, and refusals for internal material and prompt injection. The repeat rule also worked.
5. **Real return-visit memory.** "Welcome back" with pick-up chips across sessions. Theirs only continue the open thread.
6. **Clearest privacy line, and not intrusive.** We tell visitors not to share personal details and say what we remember and for how long. We never auto-open over the page.

## Recommendations for Ask Accops (ranked)

| # | What | Why | Effort |
|---|---|---|---|
| 1 | **Switch on the in-panel booking calendar.** Apply SQL 05 or set `booking_url` in `sam_web_settings`; stage 3 code is already in `Widget.tsx` and `BookingView`. Stopgap: on the LP, set `cta_url` to `#talk`; the loader already closes the panel and scrolls to an on-page anchor | Today the main CTA throws visitors to accops.com in a new tab, off the page that has the calendar. One-click booking with no email gate beats both Qualified bots. Note: `web/lib/web/guard.ts` hard-codes the accops.com URL for refusal CTAs, so change it too | S |
| 2 | **End each answer with one tap-to-answer qualifying question**, e.g. "How many users are on Citrix today? <500 / 500-2,000 / 2,000+" or "When is your renewal due? <3 months / 3-12 months / later". Store the tap as anonymous intent and show it in the Website tab and in the booking notes | It's the core of what both rivals do and the one thing we lack. It gives sales context without asking for personal data | M |
| 3 | **Triage vague problem statements with chips:** slow sessions / VPN or remote access security / contractor or vendor access / Citrix cost, plus "I'm an existing Accops customer → support" | Ours gave a generic answer to "we have remote access problems". Sophos's triage is the best single move in this test. Existing customers should reach support, not sales | S-M |
| 4 | **Fix the verified-facts fallback padding.** Show only cited records or ones above a relevance floor, and never pad to 3 | The Entra ID question got an SSO quote plus quotes about support and the CEO and HQ (problem 1) | S |
| 5 | **Make the source pill human.** Show the page title or the accops.com path, never `accops-citrix-lp.vercel.app` | The header says "Answers from accops.com", but most LP answers show a vercel.app host, which looks like a test site to a CISO | S |
| 6 | **Persistent action row above the input:** Book a call · Support · Partner enquiry | Both rivals keep routing visible at every turn. Partners (200+) and customers visit too | S |
| 7 | **Make the teaser a discovery question tied to the section**, e.g. on the renewal section: "Is your Citrix renewal due this year? I can show what switching involves." Keep it as a bubble and don't auto-open | Gets the page-specific hook of Scout and Gracie without their intrusiveness | S |
| 8 | **Better welcome-back copy.** Quote the topic, and when the last topic was talking to someone, offer the calendar: "Welcome back. Last time you asked about talking to an engineer. Book a 30-minute call?" | Today's line reads "Last time you looked at How do I talk to an Accops engineer? Want to pick up there?" (problem 5) | S |

**Not recommended now:** voice and a video avatar (L effort, little value for India, GCC and SEA enterprise buyers who mostly browse at work) and an email gate (it would throw away our biggest difference).

## Problems found in our bot (with repro steps)

All on https://accops-citrix-lp.vercel.app/ in desktop Chrome, chat opened from the bottom-right launcher.

1. **The fallback pads with irrelevant quotes.** Type `Does Accops support SAML SSO with Microsoft Entra ID?`. After about 4.6 s you get "Here's what we've published on that:" and 3 quotes: (a) HyID SSO federates Microsoft 365… (relevant), (b) "Accops gives direct OEM support with named engineers… 200+ partner network" (irrelevant), (c) "Accops is led by Vijender Yadav… headquartered in Pune" (irrelevant). Cause: `facts()` in `web/lib/web/fill.ts` takes the cites, then fills up to 3 from search rank with no relevance floor. Screenshot: `accops-06-q-c.png`.
2. **"Talk to an engineer" leaves the page.** Type `I want to talk to someone` and click **Talk to an engineer**. accops.com/schedule-a-free-demo opens in a new tab, while the same page has the Bookings calendar at #talk. Live `booking_url` appears to be empty: the CTA renders as a plain `target=_blank` link. Also in `accops-09-q-f.png`.
3. **Console warning on every first open.** Open DevTools, load the LP and click the launcher. You get: `Failed to execute 'postMessage' on 'DOMWindow': The target origin provided ('https://sam-accops.vercel.app') does not match the recipient window's origin ('https://accops-citrix-lp.vercel.app')`. Cause: `web/scripts/embed.src.js` line 149 posts `{t:"focus"}` 230 ms after creating the iframe, before it has loaded. The message is dropped. The textarea still had focus in my test, so the impact is low, but posting after the frame's `ready` would remove the warning.
4. **BotID client logs "Error".** The console shows `[LOG] Error @ https://sam-accops.vercel.app/<uuid>/<uuid>/a-4-a/c.js…` about once per question. Answers still reached the model, so the server check didn't throw. Worth confirming that BotID isn't silently degrading inside the cross-site iframe (plan risk 11).
5. **The welcome-back sentence reads badly with question labels.** Ask `I want to talk to someone`, then open the LP in a new tab and open the chat. You get: "Welcome back! Last time you looked at How do I talk to an Accops engineer? Want to pick up there?" (`web/lib/web/recall.ts` line 38, which drops emphasis on labels over 6 words). Screenshot: `accops-17-newtab-open.png`.
6. **A vague problem gets no clarifying question.** Type `we have remote access problems`. The answer is a generic remote-access summary plus "I can connect you with someone", with no triage and no support route.
7. **The trial question is half answered.** Type `Can we do a free trial or a POC first?`. You get "Yes. In the pilot…" but nothing on whether it is free. One follow-up chip ("What device checks run before access?") is unrelated. A bank pair that says plainly whether the pilot costs anything would fix it.
8. **The Linux answer is scoped to the managed service.** Type `Does Accops support Linux desktops?`. You get "Yes. Accops Managed Desktops delivers managed virtual desktops across Windows, Windows Server and Linux, with Accops handling deployment and ongoing operations", sourced from accops.com/cloud-services/accops-daas. An on-prem HyWorks buyer could take this as the general answer. Add an approved pair for HyWorks Linux support.
9. **Not the bot, but on the same live page:** a striped box reading "PLACEHOLDER — add the Gartner Magic Quadrant for DaaS recognition here once Legal confirms the approved wording…" is visible under the stats band. Screenshot: `accops-14-lp-placeholder.png`.

What worked as designed: bank answers in about 1 s; the cached repeat in 1.0 s; the 3rd identical question → "Looks like this one needs a person"; both guardrail probes refused ("I can only share what's published on accops.com…"); the thread survives a reload; welcome back in a new tab; the full-screen mobile sheet.

## Method notes

- Timings are from sending the message to the answer settling, measured in the page. Network jitter applies, and the Qualified bots never stream: each answer appears whole.
- The first Sophos load hung the automated browser (timeout); a retry about an hour later loaded normally. Voice was not tried on any bot, since it needs a microphone permission.
- Because I never gave an email, the Qualified meeting flow after the email step was not seen. Qualified usually shows an inline calendar at that point.
- Rule for third-party bots: no jailbreaks, no personal data, 7 questions each.
