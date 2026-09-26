# SAM demo script: 10-12 minutes, 3-5 sales reps

**Rewritten 27 September 2026** for Siddharth's first demo to reps. Every question to type below
was asked in production (https://sam-accops.vercel.app) on 26 Sep, 21:00-21:26 UTC. Each one gave a
happy answer or a clean honest gap. The "what they should see" lines quote what SAM actually
returned. The full test is the "28 September re-run #3" section of
`PERSONA-RETEST-2026-09-26.md`.

Keep one thing in mind. Most of those answers came from Groq's smaller fallback model, because the
big one had run out of its daily allowance. On demo day the big model should answer (see the
checklist). The documents should be the same. The first sentence may be worded differently.

## 5 minutes before: checklist

1. **Don't run any heavy testing that day.** Groq gives the main model (`gpt-oss-120b`) 200,000
   tokens a day, which is about 100 questions. Once that is used up, a smaller model answers, and it
   words things worse. If it is slow too, SAM falls back to plain search with a canned sentence.
   Save the day's allowance for the room.
2. **Warm it up with one question**, e.g. `citrix battlecard for my own prep before the call tmrw`.
   A cold server loads the library on the first call. Open "How SAM got there" under the answer.
   - **Good:** it says `openai/gpt-oss-120b`.
   - **Warning:** it says "model provider failed, answered by fallback ... tokens per day". The big
     model is out for today, and answers will be plainer. Carry on anyway.
3. **Be signed in to SharePoint in the same browser.** Then the "Open" button on internal cards
   opens the file, rather than a Microsoft login in front of the room.
4. **Open three tabs:**
   - SAM chat, signed in.
   - `/requests` (your requests page).
   - `/admin`, on the **Requests** tab.

   Keep the chat in its own tab the whole time. **Refreshing or leaving the chat page clears the
   conversation**, and step 6 depends on it.
5. **You are the only typist.** Reps call out questions and you type them. Leave about 30 seconds
   between questions and talk over the gap. Several people typing at once burns the per-minute limit.

## The story (type exactly this, in this order)

Scruffy phrasing is deliberate: it is how reps type. The web chat shows one short paragraph (the
verdict and whether it can be sent), then one card per document. Each card has a **Public link** or
**Internal only** tag, any warning, and an **Open** button.

| # | Beat | Type this | Time |
|---|---|---|---|
| 1 | Something I can send | `BFSI case study I can send to a private bank customer` | 1.5 min |
| 2 | Prep for me | `citrix battlecard for my own prep before the call tmrw` | 1.5 min |
| 3 | Both at once | the Kerala hospital paragraph below | 1.5 min |
| 4 | SAM protects you | `customer on vmware horizon wants to move after broadcom price hike, omnissa migration pitch?` | 1.5 min |
| 5 | An honest "we don't have it" + ask marketing | `remote browser isolation brochure` | 2.5 min |
| 6 | A follow-up | `anything newer?` | 1 min |
| 7 | Other ways in | (talk only) | 1 min |

**1. `BFSI case study I can send to a private bank customer`**
- *What they should see:*
  - "The library has a BFSI case study for a private bank." or similar.
  - "Both are public, so they can be sent to a customer."
  - Two cards, both **Public link**, opening PDFs on `downloads.accops.com`:
    - *Two Leading Indian Private Banks: Secure Access, MFA and Biometrics* (2026)
    - *Top-5 Indian Private Bank: 3,000 to 25,000 Remote Users On-Prem and on Azure* (2026)
- *Say:* "You didn't have to check whether it's allowed out. SAM checks that and tells you on every
  answer."
- *Don't type* the longer version, "pvt bank in mumbai moving off citrix ...". Sometimes it answers
  "No exact match for Citrix" over the same two good case studies. That is a known bug (a competitor
  mentioned as background is treated as a requirement).

**2. `citrix battlecard for my own prep before the call tmrw`**
- *What they should see:*
  - "All internal: don't send outside Accops."
  - Two cards, **Internal only**:
    - *Accops Powered VDI vs Citrix and VMware Horizon: Feature Comparison* (2024)
    - *Accops Powered VDI vs Citrix VDI: Feature Comparison* (2024)
  - Each card says "Check first: Published 2024; over two years old, so check it still reflects the
    product."
- *Say:* "Internal is the point here. This is for your prep, not the customer's inbox. And it tells
  you when a document is old enough to double-check."
- The first sentence may just be "Best matches in the library." That is SAM playing safe with the
  model's wording. The cards are the answer.

**3. The mixed ask.** Paste this:

> `Hospital chain in Kerala, ~800 users, want VDI for their HIS + PACS access from outside, evaluating Citrix and Azure Virtual Desktop. Need something I can send the CIO today plus something for my own prep against AVD`

- *What they should see:*
  - "1 of 3 can be sent to a customer; the rest are internal only."
  - First card: *Accops Zulekha Hospital Case Study*, **Public link**. This is the one for the CIO.
  - Then two **Internal only** cards for prep, each "do not send outside Accops": a VDI deck (the Aug
    2026 VDI deck or the 2021 Healthcare deck) and *Accops Powered VDI vs the Field (29 Nov 2022)*,
    which covers AVD and AWS WorkSpaces.
- *Say:* "One question, two jobs. It split what you can send from what you should read."

**4. The trust moment:
`customer on vmware horizon wants to move after broadcom price hike, omnissa migration pitch?`**
- *What they should see:*
  - "All internal: don't send outside Accops."
  - Three cards:
    - *Migration Strategy from VMware EUC: Three Full-Stack Replacement Options* (2024)
    - *Omnissa Horizon with VMware vSphere Foundation for VDI: Analysis of the Bundled Offering*
      (2026)
    - *Vanquishing VMware: Broadcom Acquisition Battlecard (Jul 2022)*, with the warning **"A newer
      edition exists: Omnissa Horizon VVF Analysis - prefer that one."**
- *Say:* "SAM knows when a document has been replaced, and it shows the newer one next to it.
  Nobody sends the 2022 version by mistake."
- *Also point at* the "Check first" notes and the **Internal only** tags on every card. The warning
  is on the card itself, not left to the chat text.

**5. The honest gap: `remote browser isolation brochure`** (the longest beat, and the one that
matters most)
- *What they should see:*
  - "No exact Browser Isolation brochure in the library."
  - Under "Closest in the library": *Accops Virtual Browser: Remote Browser Isolation for Air-Gapped
    Environments* (2025, "a technical product document rather than a brochure") and the *ZTNA and
    Isolation customer webinar (18 June 2026)*. Both are **Internal only**.
  - A box: **"Not in the library yet. Need exactly this? Marketing can create it."** with the button
    **Ask marketing to create this**.
- *Say:* "It didn't pretend. A tool that invents a brochure gets trusted once. It told you what's
  missing and what's closest."
- *Click* **Ask marketing to create this**. The title is filled in from the question. Add a note,
  e.g. "demo - for a BFSI prospect", then click **Send request**. It shows "Sent to marketing" and
  a link, **See your requests**.
- *Switch to the `/requests` tab and refresh.* "Your requests" lists the brochure under "In
  progress", marked **Requested**, with its steps (Requested, Planned, In progress, Delivered), and "N others asked too" if other reps asked for it. When marketing delivers it,
  the link appears there and in the chat.
- *Switch to the `/admin` tab (Requests) and refresh.* This is marketing's queue, "Requests, ranked
  by demand". **Demand counts distinct reps**, so one person asking five ways counts once. Below it,
  "Asked for, never requested" lists gaps SAM saw that nobody turned into a request.
- *Say the line:* **"Your asks become marketing's to-do list. The more of you ask for the same
  thing, the higher it goes."**
- *After the demo:* the request is real. Leave it if the brochure is genuinely wanted (it is a real
  gap), or decline it in the admin tab with a reason.

**6. Back in the chat tab: `anything newer?`**
- *What they should see:*
  - "All internal: don't send outside Accops."
  - The *ZTNA and Isolation customer webinar (18 June 2026)* first, then the *Virtual Browser* paper
    (2025). The newest is on top.
- *Say:* "You don't repeat yourself. It knows 'anything newer' means newer isolation material."
- **If you refreshed or left the chat page**, the conversation is gone and "anything newer?" means
  nothing on its own. Use this verified pair instead:
  - `pharma case study I can send a customer`: *Accops City Pharmacy Case Study* and *Accops
    Zulekha Hospital Case Study*, both **Public link**, "Both are public".
  - Then `what about hospitals?`: Zulekha moves to the top.

**7. Other ways in (talk only)**
- **WhatsApp:** the same answers on a phone, for numbers on the allowlist. It runs on a Meta test
  number until early December, so don't promise it to everyone yet. When something is missing, SAM
  replies:

  > Logged as a content gap. Reply *REQUEST* to ask marketing to create it (add a note after it,
  > e.g. REQUEST for Axis Bank by Friday).

  Replying **REQUEST** files the same request as the button.
- **MCP:** SAM plugs into Claude, or any MCP client, as a set of tools: search collateral, ask SAM,
  get a public link, request an asset be published, and ask marketing to create content. That
  suits anyone who already works in Claude.

## The two buttons: how to explain them

Under every answer, **"Did this help? Yes / Wrong asset / What I need doesn't exist."**
- One click is logged against that exact question and the documents SAM returned.
- **Wrong asset:** "the right thing exists but SAM showed the wrong one". This tells us the ranking
  is off for that kind of question.
- **What I need doesn't exist:** opens the same "Ask marketing to create this" form. Use it when SAM
  showed something but it isn't what you need.
- **Ask marketing to create this** appears on its own whenever SAM knows the exact thing is
  missing. Your requests live at `/requests`, and you're told when one is delivered.
- **The ask:** click one button on every answer for the next two weeks. Every click improves SAM,
  and every request goes into marketing's queue.

## Questions to avoid in the demo

Each of these was still unsatisfying in production on 26 Sep. They are the known bugs in the retest
doc.

| Don't ask | What happens |
|---|---|
| **Data residency / "is our DaaS hosted in India"** | An honest gap, but the "closest" documents are a 2021 Nutanix brief and a partner talk, which don't help. |
| **ISO 27001 certificate** | Shows the 2013-edition certificate with no expiry warning. Wait for your decision on the warning. |
| **SOC 2 report** | "The library has no SOC 2 Type 2 report" but no request button, and it mentions a brochure it doesn't show. |
| **"hysecure demo video" / "product video hysecure"** | Shows the two right demo videos, then says there is "no exact HySecure demo video". Contradictory. |
| **"pvt bank ... moving off citrix ..." and other asks that mention a competitor as background** | Can say "No exact match for Citrix" over good case studies. Use step 1's wording. |
| **Pricing** | Correctly refuses and says to check with your sales manager. Fine if a rep asks, but it is not a highlight. |
| **GCC, Malaysia/Indonesia, Saudi/Arabic, APRA, GITEX** | Honest gaps with the button, but weak "closest" documents. Use step 5 for the gap moment. |
| **Customer names** ("what did we do for <bank>") | Case-study clients are anonymised on purpose. |
| **Several people typing at once** | This burns the per-minute limit, and answers get plainer. |

If a rep insists on an off-script question, try one. If it goes wrong, say so plainly and click
**Wrong asset**. That is part of the demo too: "How SAM got there" shows the working.

## After the demo: three questions for the reps

Write the answers down word for word. They go into the eval set, which still has questions we
invented instead of theirs.

1. "What's the last piece of collateral you went looking for, and how did you find it or not find
   it? Type it the way you'd type it to SAM."
2. "What's the one document you wish existed right now for a deal you're working?" If they name
   one, ask them to request it in SAM today.
3. "When you send something to a customer, what do you check first: date, audience, the numbers?
   What would make you trust SAM's answer without opening the file?"
