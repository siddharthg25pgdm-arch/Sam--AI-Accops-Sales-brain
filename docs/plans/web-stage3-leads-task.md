# Website chatbot stage 3: lead capture task (protection spec, copied verbatim from the stage-1 plan section 2.5)

**27 Oct 2026: built, with Siddharth's changes of that day** (they win where they differ from the table below): leads come from a Microsoft Bookings calendar through Power Automate (server-to-server, `POST /api/v1/leads/booking`), not a browser form; dedupe is 24 h, not 30 days; status is clean / suspect (quarantine) / released / discarded; clean leads go to the Website Leads flow (Power Automate), not GHL. See [web-stage3-leads-runbook.md](web-stage3-leads-runbook.md).

Source: [2026-10-26-website-chatbot-stage1.md](2026-10-26-website-chatbot-stage1.md) section 2.5. Copied by Stream F on 26 Oct 2026 so stage 3 cannot skip it. No code yet. Stage-1 hooks already in place: every conversation carries a `label` (human/suspect/bot, only escalates) in `sam_web_conversations`; `web/lib/web/bot.ts` exports `mintHs`/`verifyHs` (reuse the same signed-timestamp pattern for the form render time); `checkBotId()` must also run on the lead route (add `/api/web/lead` to `initBotId` in `web/instrumentation-client.ts`).

### 2.5 Leads (stage 3; the protection is designed now so stage 3 cannot skip it)

Stage 3 adds `POST /api/web/lead` and a `sam_web_leads` table (a stage-3 migration, not part of this approval). **Nothing reaches GHL unless every rule passes.**

| Rule | Detail |
|---|---|
| Only from a human conversation | the label is `human`, at least 2 turns, BotID passes on the lead route too |
| Honeypot | a visually hidden `company_website` field. If filled: reject silently (200, nothing stored) |
| Time to submit | at least 4 s from form render (signed render timestamp, as with `hs`) |
| Work email | syntax; **disposable domains** (a committed blocklist) rejected; **free-mail** domains (gmail, yahoo, outlook, …) flagged; an **MX lookup** (`node:dns/promises.resolveMx`, 2 s timeout) must succeed |
| Caps | 3 leads per IP hash per day; 1 per visitor per day |
| Dedupe | lowercased email, 30 days: the second one is attached to the first, not created |
| **Quarantine** | Any flag (free-mail, suspect-adjacent signals, a failed MX lookup, any cap hit) → `status='quarantine'`. Siddharth reviews these in the Website tab. **Quarantined leads are never auto-pushed to GHL.** Only `clean` leads are upserted, tagged `website-chatbot` |


Open point from stage 1: `classify` labels each request afresh; the stored conversation label escalates in `sam_web_log_message` but is not read back. The lead route must read the conversation's stored label (a new reader RPC, e.g. `sam_web_conversation_label(id)`), not trust a fresh classify.
