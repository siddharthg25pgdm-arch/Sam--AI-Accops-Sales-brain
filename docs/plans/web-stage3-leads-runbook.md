# Website chatbot stage 3: leads from Microsoft Bookings (runbook)

Built 27 Oct 2026 on Siddharth's decisions of the same day. Code: `web/lib/web-leads.ts` (checks, storage, forward), `web/app/api/v1/leads/booking/route.ts` (the endpoint), the Website tab's **Leads** view, and the chat's in-panel calendar (`web/app/embed/Widget.tsx`). Checks: `web/lib/web-leads.check.mjs`, `web/lib/web-widget.check.mjs`.

How it works:

1. A visitor books a time in the Microsoft Bookings calendar, either on the Citrix LP (the calendar that replaces the form) or inside the chat ("Talk to an expert" opens the same calendar in the chat panel).
2. Bookings fires the Power Automate flow **SAM - Bookings lead in** ("When a appointment is Created"). The flow POSTs the appointment to SAM with a shared secret.
3. SAM checks the lead, stores it in `sam_web_leads`, and:
   - **clean** (every check passed): forwards it straight away to the Website Leads flow (`WEB_LEAD_WEBHOOK_URL`, a Power Automate HTTP trigger);
   - **suspect** (any check failed): **quarantines** it. It is stored and shown on the Website tab, and never forwarded until you release it.
4. The visitor's booking is never affected: it is already in the Bookings calendar whatever SAM decides.

## 1. Apply the SQL (you, in the Supabase SQL editor)

| Order | File | What it does |
|---|---|---|
| 1 | `docs/supabase-sam-web-05-leads.sql` | The `sam_web_leads` table (RLS on, no grants to anon, authenticated or `sam_web_reader`), `sam_web_purge_leads()`, the `booking_url` setting (default: the Accops Bookings page), `sam_web_settings()` with `booking_url` added, and `booking_opened` added to the event allowlist |
| 2 | `docs/supabase-sam-web-06-restamp-where.sql` | Independent fix: `sam_web_restamp_pages()` gets `where true`, so changing a blocked pattern or a page rule through PostgREST no longer fails with "UPDATE requires a WHERE clause" |

Both files are safe to run twice. Write the date at the top of each once applied.

Check 05 worked:

```sql
select sam_web_settings();                     -- has "booking_url": "https://bookings.cloud.microsoft/book/..."
select count(*) from sam_web_leads;            -- 0
select has_table_privilege('sam_web_reader', 'sam_web_leads', 'select');   -- false
```

Before 05 is applied: the lead endpoint answers 500 (so the flow retries and then shows a failed run), the Leads view says which file to apply, the chat keeps opening the demo page in a new tab, and `booking_opened` events are dropped (the widget is unaffected).

## 2. Environment variables (Vercel, Production, then redeploy)

| Name | Value | Notes |
|---|---|---|
| `WEB_LEAD_SECRET` | a new random secret | Make one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. The Bookings flow sends it as `Authorization: Bearer <secret>`. Without it the endpoint answers 503 to everything |
| `WEB_LEAD_WEBHOOK_URL` | the Website Leads flow's HTTP trigger URL (section 4) | **Treat the whole URL as a secret**: its `sig=` parameter is the key. SAM never logs it or stores it. Unset = clean leads are stored and shown, but not forwarded |

**Why a new secret rather than `SP_WEBHOOK_SECRET`:** this route writes personal data and feeds the sales pipeline. With its own secret it can be rotated, or revoked after a leak, without touching the SharePoint, snapshot and digest flows that carry `SP_WEBHOOK_SECRET`. The comparison is the same as the digest's: SHA-256 of both sides, then `timingSafeEqual`.

`SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are already set (the admin tab uses them).

## 3. Flow 1: SAM - Bookings lead in (Bookings to SAM)

You must be an admin of the Bookings page to create this trigger. Bookings allows at most 5 flows per Bookings mailbox.

1. **Trigger**: Microsoft Bookings, **When a appointment is Created**.
   - Booking page: `AccopsUnifiedPlatformforSecureRemoteAccess2@propalmsnetwork.onmicrosoft.com`. If it is not in the list, choose "Enter custom value" and paste that address.
2. **Action**: HTTP.
   - Method: `POST`
   - URI: `https://sam-accops.vercel.app/api/v1/leads/booking`
   - Headers: `Authorization` = `Bearer <WEB_LEAD_SECRET>` (paste the secret after `Bearer `) and `Content-Type` = `application/json`
   - Body: `@{triggerBody()}`. Send the trigger's output as it is; SAM picks the fields it needs (table below).
   - Retry policy: leave the default. SAM answers 500 only when it could not store the lead, so a retry is safe: a second POST with the same email within 24 hours is recognised as a duplicate.
3. Save, then book a test slot (section 7).

**What SAM reads from the Bookings trigger.** Key names are matched ignoring case, underscores and spaces, so both `CustomerEmail` and `customerEmailAddress` work.

| Bookings trigger output | SAM reads it as | Stored in |
|---|---|---|
| `CustomerName` | split at the first space | `first_name`, `last_name` (required) |
| `CustomerEmail` (or `customerEmailAddress`) | lower-cased | `email` (required) |
| `CustomerPhone` | as given | `phone` |
| `CustomQuestionAnswers[]` (`Question`, `Answer`) | matched by the question's wording: a question with users / seats / employees / endpoints / headcount / "how many" → **seats**; role / title / designation / position / job → **role**; company / organisation / employer / business / firm → **company** (checked in that order, so "Number of users in your company" counts as users) | `seats`, `role`, `company` (all answers are also kept in `raw.answers`) |
| `StartTime` | ISO time; a time without an offset is read as UTC | `booking_start` |
| `ServiceName` | e.g. "Free IT Health Assessment" | `raw.service` |
| `CustomerNotes` | at most 1,000 characters | `raw.notes` |
| `SelfServiceAppointmentId` | the stable appointment id | `raw.appointment_id` |
| `CustomerTimeZone` | | `raw.time_zone` |
| `CustomerLocation.PhysicalAddress.CountryOrRegion` | only if the page asks for an address | `country` |
| `TrackingData` | if it carries `utm_*=` pairs, they are kept | `raw.utm` |

**Never stored:** the staff list, the Teams join link (`JoinWebURL`), the customer id and any street address.

Optional fields you may add to the body (alongside the trigger output, e.g. with `addProperty(triggerBody(), 'source', 'citrix-lp-chat')`): `source` (`citrix-lp-booking`, the default, or `citrix-lp-chat`), `page`, `conversation_id`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_term` and `utm_content`. You can also set the source as a query parameter instead: `.../api/v1/leads/booking?source=citrix-lp-chat`.

**The chat's bookings arrive as `citrix-lp-booking` too.** The LP and the chat use the same Bookings page, so the trigger cannot tell them apart. The chat's side is still measured: every in-chat open is a `booking_opened` event. To split them later, give the chat its own Bookings page (or service link) and its own flow that adds `?source=citrix-lp-chat`.

### Endpoint contract

`POST /api/v1/leads/booking`, server-to-server only.

| Answer | When |
|---|---|
| `503 {"error":"leads are not configured"}` | `WEB_LEAD_SECRET` or the Supabase env is missing (fail closed) |
| `403 {"error":"server-to-server only"}` | the request has an `Origin` or `Sec-Fetch-Mode` header (a browser). No browser form exists, so the honeypot, render-timer and per-IP rules of plan 2.5 have nothing to guard; a browser can never use this route |
| `401 {"error":"unauthorized"}` | no `Authorization: Bearer`, or the wrong secret |
| `400 {"error":"..."}` | not a JSON object, over 32 KB, no `CustomerEmail`, no `CustomerName`, or an email over 254 characters |
| `200 {"ok":true,"duplicate":true,"sam_lead_id":"..."}` | the same email arrived within 24 hours. Nothing new is stored or forwarded |
| `200 {"ok":true,"sam_lead_id":"...","status":"clean"\|"suspect","reasons":[...],"forwarded":true\|false}` | stored. `forwarded` is false for a quarantined lead, and for a clean lead whose forward failed (the error is on the Leads view) |
| `500 {"error":"not stored, try again"}` | the database write failed; the flow's retry policy tries again |

The flow never sees a failure because the Website Leads flow is down: the lead is kept with `forward_error`, and you forward it again from the tab.

## 4. Flow 2: the Website Leads flow's HTTP trigger (SAM to the pipeline)

The existing Website Leads pipeline moves to Power Automate. Give it the trigger **When a HTTP request is received** (method POST) and paste this schema as the trigger's *Request Body JSON Schema* (or into a Parse JSON step). Every field is a flat string; `""` means unknown.

```json
{
  "type": "object",
  "properties": {
    "source":          { "type": "string", "description": "citrix-lp-booking | citrix-lp-chat" },
    "first_name":      { "type": "string" },
    "last_name":       { "type": "string" },
    "email":           { "type": "string" },
    "phone":           { "type": "string" },
    "company":         { "type": "string" },
    "role":            { "type": "string" },
    "seats":           { "type": "string", "description": "the 'Number of users' answer, as given" },
    "country":         { "type": "string" },
    "page":            { "type": "string" },
    "conversation_id": { "type": "string" },
    "booking_start":   { "type": "string", "description": "ISO 8601, UTC" },
    "utm_source":      { "type": "string" },
    "utm_medium":      { "type": "string" },
    "utm_campaign":    { "type": "string" },
    "utm_term":        { "type": "string" },
    "utm_content":     { "type": "string" },
    "submitted_at":    { "type": "string", "description": "when SAM received it, ISO 8601" },
    "sam_lead_id":     { "type": "string", "description": "SAM's id: use it to dedupe on your side" }
  },
  "required": ["source", "first_name", "last_name", "email", "phone", "company", "role", "seats", "country", "page",
               "conversation_id", "booking_start", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
               "submitted_at", "sam_lead_id"]
}
```

Example:

```json
{"source":"citrix-lp-booking","first_name":"Priya","last_name":"Raman","email":"priya.raman@acme-corp.com","phone":"+91 98450 12345",
 "company":"Acme Corp","role":"Head of IT","seats":"600","country":"","page":"https://accops-citrix-lp.vercel.app/","conversation_id":"",
 "booking_start":"2026-10-29T05:30:00.000Z","utm_source":"","utm_medium":"","utm_campaign":"","utm_term":"","utm_content":"",
 "submitted_at":"2026-10-27T10:00:00.000Z","sam_lead_id":"6f1c2c1e-6a0e-4c9b-9d1e-2b7f0f6f6a11"}
```

- SAM counts **200 or 202** as accepted (a plain HTTP trigger answers 202). Any other status, a redirect (never followed), no answer within 8 seconds or an unreachable host is a failure: the lead stays, with `forward_error` (for example "the flow answered 500"), and shows on the Leads view.
- Copy the trigger's URL, after the first save, into `WEB_LEAD_WEBHOOK_URL` and redeploy.

## 5. The guardrails

Every lead gets `status` = `clean` or `suspect`, with `reasons[]` (rule codes). **Any** reason quarantines.

| Reason | Rule |
|---|---|
| `bad_email` | not a valid address |
| `disposable_email` | a throwaway domain, or a subdomain of one (a committed list of 116 in `web-leads.ts`) |
| `free_email` | Gmail, Outlook / Hotmail / Live, Yahoo (any country), iCloud, Proton, Rediffmail, Zoho Mail, and so on: flagged, not rejected |
| `internal_email` | an Accops address (a colleague testing the calendar) |
| `no_mx` / `mx_unchecked` | the email domain has no mail server (no MX record, or RFC 7505's null MX) / the MX lookup (`node:dns`, 2 s) failed or timed out |
| `junk_name`, `junk_company`, `junk_role` | a link or markup, no letters at all (all digits), a placeholder (test, asdf, n/a, ...), the same character 4+ times, a keyboard run (qwerty, asdfg, lkjhg, ...), a mashed word (6 consonants in a row, or 5+ letters and no vowel, except ALL-CAPS acronyms like GSPCL). Names may not contain digits |
| `junk_seats` | a link or markup in "Number of users" |
| `bad_phone` | letters in the number, fewer than 6 or more than 15 digits, or one digit 7+ times in a row |
| `link_in_notes` | a link in the visitor's notes (spam bots' favourite) |
| `too_long` | a field was longer than its column and was cut |
| `daily_cap` | 25 leads already arrived in the last 24 hours (a flood is held, not forwarded) |

Dedupe: the same email (case-insensitive) within 24 hours is not stored again. The route answers with the first lead's id.

Logs: one ops line per lead, with no personal data, e.g. `lead 6f1c…: citrix-lp-booking suspect [free_email], quarantined`. Never a name, an email, the notes, the webhook URL or a database message (a Postgres error can quote the whole row).

## 6. Releasing a quarantined lead

1. Open SAM admin, **Website** tab, **Leads**. The tab label shows how many leads wait in quarantine, and the morning digest's Website line says "N new leads (M quarantined)".
2. The **Quarantine** list shows each held lead with its reasons in words (and the visitor's notes).
3. Click **Release** to forward it to the Website Leads flow now (status becomes `released`), or **Discard** to keep it on record and never forward it.
4. If a forward fails (the flow is down, or `WEB_LEAD_WEBHOOK_URL` is not set), the lead shows "not forwarded: …" in **All leads** with a **Forward again** button. A double click forwards once: the row is claimed before the call.

## 7. Test it end to end

1. Book a slot on the Bookings page with your Accops address. It arrives quarantined as `internal_email`: this proves flow 1 and the secret without touching the pipeline. Then **Release** it to prove flow 2, or **Discard** it.
2. Or from the laptop, without Bookings (PowerShell):

```powershell
$h = @{ Authorization = "Bearer <WEB_LEAD_SECRET>" }
$b = '{"CustomerName":"Test Person","CustomerEmail":"siddharth.gupta@accops.com","CustomQuestionAnswers":[{"Question":"Company","Answer":"Accops"}],"StartTime":"2026-10-30T05:30:00"}'
Invoke-RestMethod -Method Post -Uri https://sam-accops.vercel.app/api/v1/leads/booking -Headers $h -ContentType application/json -Body $b
```

Expected: `status: suspect, reasons: {internal_email}, forwarded: False`. A second test with the same email within 24 hours answers `duplicate: True` (dedupe); use another address or wait.

## 8. The calendar inside the chat

- Setting `booking_url` (Website tab, **Settings**, "Booking calendar in the chat"). 05 sets it to the Accops Bookings page. Empty = the old behaviour (Talk to sales opens `cta_url` in a new tab). Only links on `https://bookings.cloud.microsoft` are accepted.
- Every talk-to-sales CTA in the chat opens it inside the panel: the answers' CTA, "Prefer a person?" and the error message's CTA. An `open_url` CTA (a document, a page) never does. The calendar takes the whole panel (the whole screen on a phone) with **Back** (to the chat, which keeps its thread, and the calendar keeps a half-filled booking), "open in a new tab" and close.
- `/embed`'s CSP adds `frame-src https://bookings.cloud.microsoft` and nothing else. If Microsoft ever redirects the page to another host, the frame shows blocked and the browser console names a `frame-src` violation. Then add that host to `BOOKING_ORIGIN` in `web/app/embed/bridge.ts` and `web/next.config.ts` (web-widget.check proves the two match) and deploy. curl gets a 417 from that host, so the in-frame rendering was verified only in Siddharth's own browser.
- Analytics: each open is a `talk_to_sales_clicked` plus a `booking_opened` (the event route, the Website tab's funnel, and the LP's dataLayer as `sam_chat` with `sam_event = booking_opened`, so GA4 gets it through the existing GTM tag). No text crosses.
- The new loader (`web/public/embed.js`, rebuilt from `scripts/embed.src.js`) is needed for GA4 to receive `booking_opened`; it ships with the deploy.

## 9. Retention

Leads older than 365 days that were never forwarded are deleted by `select sam_web_purge_leads();`. **It is not scheduled.** Run it by hand, or add it to the stage-2 retention job next to `sam_web_purge(180)`. Forwarded leads are kept as the record of what was sent.

## Not built (on purpose)

- A cancelled or rescheduled Bookings appointment does not update the lead (add flows on "When an appointment is Cancelled / Updated" if the pipeline needs them).
- No browser lead form: plan 2.5's honeypot, render timer, BotID and per-IP caps apply to a browser form, and none exists. The endpoint refuses browsers outright.
- `ip_hash` stays empty for these server-to-server leads (the caller's IP is Microsoft's).
