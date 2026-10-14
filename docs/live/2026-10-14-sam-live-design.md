# SAM Live — Accops call copilot (design, 14 Oct 2026)

**What:** a Windows desktop app that listens to a sales call (Teams, Zoom, Meet, WhatsApp — anything
that plays audio), transcribes both sides live, shows the rep which qualification questions are
still open, suggests the next question, and pulls SAM battlecards/collateral when the customer
raises a competitor, objection or question. After the call: summary + follow-up email draft emailed
to the rep and a lead row added to a sheet (Power Automate), everything stored in the Accops brain
(Supabase) and visible on a `/live` dashboard inside SAM.

**Why build it (Siddharth, 14 Oct):** convverse.ai does live call guidance but does not run on
Windows (Accops reps are on Windows), knows nothing about Accops products, does not feed SAM or our
Supabase, and has no dashboard/tracking or post-call automation we control. Internal tool only.

**Clean-room note:** built from Siddharth's requirements and convverse's *public* feature list. The
confidential security-review deck convverse shared with Accops IT and their installer were NOT used.

## Decisions (made by Claude under the build-it-end-to-end instruction; change any of them)

| # | Decision | Why |
|---|---|---|
| 1 | Backend lives **inside SAM web** (`/api/live/*`, `/live` pages), not a new service | Reuses SAM login, Supabase helper, Groq config and in-process collateral search; one deploy |
| 2 | Desktop app = **Electron**, in `desktop/` of this repo | Only practical way to get Windows system-audio loopback + an always-on-top overlay without native code |
| 3 | **Two audio channels**: mic = rep ("Accops"), system loopback = customer | Speaker labels for free, no diarization model |
| 4 | Client does **VAD** (energy gate) and uploads one **16 kHz mono WAV per utterance** (1.2–15 s) | Clean utterances transcribe better than fixed chunks; silence never costs quota; no whisper "Thank you." hallucinations on silence |
| 5 | Speech-to-text = **Groq `whisper-large-v3-turbo`** via the OpenAI-compatible `/audio/transcriptions` on SAM's existing Groq tier | Account and key already exist, server side only. `LIVE_STT_*` env overrides |
| 6 | Live insight model = **`openai/gpt-oss-20b`**, summary = **`openai/gpt-oss-120b`** (fallback 20b) | 20b is fast + spares 120b's daily token cap; env `LIVE_INSIGHT_MODEL`, `LIVE_SUMMARY_MODEL` |
| 7 | Insight runs **server side after a customer utterance**, at most once per 12 s per meeting | Bounds tokens (~1k/insight) while staying "live" |
| 8 | Data in SAM's Supabase (`iwqhayuoxnrhqzozznes`), `live_*` tables in `public`, RLS on, service role only | Same pattern as `sam_events`; reachable by SAM's REST helper today |
| 9 | Desktop login = SAM id/password → 30-day bearer JWT (same secret as the cookie), stored with Electron `safeStorage` (DPAPI) | No new identity system |
| 10 | Post-call automation = **Power Automate HTTP-trigger flow** (`LIVE_FLOW_URL`): email the rep (summary + follow-up draft) and add a row to an Excel table | Siddharth asked for PA; flows stay editable by him |
| 11 | Follow-up goes **to the rep, not the prospect** | Auto-mailing customers is outward-facing; the rep forwards it |
| 12 | Qualification framework = Accops-tuned list in code (`lib/live/framework.ts`) | No template editor until someone needs to change it |

**Not in v1 (add when asked):** template editor UI, CRM (Zoho/GHL) write-back, auto meeting join/calendar, macOS build,
code signing (installer shows a SmartScreen "unknown publisher" warning), mic/loopback echo de-duplication when the rep
uses speakers instead of a headset.

## Qualification framework (v1)

`need` (pain / why now) · `current_solution` (Citrix, VMware/Omnissa Horizon, AVD, none…) · `users` (count / user types) ·
`use_case` (remote work, BYOD, contractors, branch, DR…) · `compliance` (RBI, SEBI, DPDP, IRDAI, ISO…) · `budget` ·
`decision_maker` (who signs, who evaluates) · `timeline` · `competition` (who else they are evaluating) · `next_step` (agreed).

Each field: `{ status: "open" | "partial" | "done", value: string, evidence: string /* verbatim quote */ }`.

## Data model (`docs/live/supabase-live.sql`)

- `live_deals` — id uuid, owner, company, contact_name, contact_email, contact_title, notes, created_at, updated_at.
- `live_meetings` — id uuid, deal_id → live_deals, owner, title, status (`live`|`ended`), started_at, ended_at,
  qualification jsonb, suggestions jsonb, battlecards jsonb, summary jsonb, flow_status text, last_insight_at, is_test.
- `live_segments` — id bigserial, meeting_id → live_meetings (cascade), channel (`rep`|`customer`), t_ms (offset from
  start), duration_ms, text, created_at.

## HTTP API (SAM web; all JSON; auth = `Authorization: Bearer <jwt>` or the SAM cookie)

| Method + path | Body / query | Returns |
|---|---|---|
| `POST /api/live/login` | `{id, password}` | `{token, user:{id,admin}}` |
| `GET /api/live/deals?q=` | | `{deals:[{id,company,contact_name,contact_email,last_meeting_at}]}` |
| `POST /api/live/meetings` | `{deal_id?} \| {company, contact_name?, contact_email?, contact_title?}`, `title?` | `{meeting:{id,deal_id,title,started_at,qualification}, framework:[{key,label,hint}]}` (qualification is carried over from the deal's previous meeting) |
| `POST /api/live/meetings/:id/audio?channel=rep\|customer&t_ms=&duration_ms=` | raw `audio/wav` body (≤ 4 MB) | `{segment:{id,channel,t_ms,text} \| null, insight?: Insight}` — `insight` only when one ran |
| `GET /api/live/meetings/:id` | | full meeting + segments (dashboard and desktop reconnect) |
| `POST /api/live/meetings/:id/end` | | `{summary: Summary, flow_status}` |

`Insight = { qualification: Record<key, Field>, ask_next: [{key, question, why}] (≤3), battlecards: [{trigger, title, brief, link, shareable}] (≤3), alerts: string[] }`

`Summary = { overview, pains[], qualification: Record<key, Field>, objections[], competitors[], next_steps[], follow_up_email:{subject, body}, deal_score 0-100, risks[] }`

Battlecards: the insight model names `customer_questions[]`, `competitors[]`, `objections[]`; the server runs SAM's
`searchAssets` for each (asset types battlecard/datasheet/case study first) and returns the top cards with the
public link when one exists (`shareable: true`) or the internal link otherwise.

## Power Automate payload (`POST LIVE_FLOW_URL`)

`{ meeting_id, rep, rep_email, company, contact_name, contact_email, contact_title, started_at, ended_at,
duration_min, deal_score, overview, next_steps (text), follow_up_subject, follow_up_body, qualification_text,
dashboard_url }` — flow: send the rep an Outlook email; add a row to the Excel table `LiveCalls` in
`SAM Live Calls.xlsx` (OneDrive). `rep_email` comes from `LIVE_REP_EMAILS="siddharth:siddharth.gupta@accops.com,..."`.

## Desktop app (`desktop/`)

Electron + plain HTML/JS (no framework). Windows: tray icon; compact always-on-top overlay (≈380×640, draggable,
opacity); screens: Sign in → Start call (company autocomplete from deals, contact, title) → Live (checklist with
✓/◐/○, "Ask next", battlecards, transcript tail, mic/system level meters, End) → Ended (summary, "Open in SAM").
Meeting-app watcher: every 20 s `tasklist` for Teams/Zoom/Webex → tray notification "Meeting app running — start SAM
Live?" (once per app session). Uploads are queued and retried (offline-tolerant); live keeps working if an upload fails.
Server URL default `https://sam-accops.vercel.app`, overridable in settings. Packaged with electron-builder → NSIS
`SAM-Live-Setup-<ver>.exe`.

## Dashboard (`/live` in SAM)

- `/live` — my calls (admin: everyone's), team strip: calls this week, average qualification %, top competitors and
  objections, desktop download link (`LIVE_DOWNLOAD_URL`).
- `/live/[id]` — transcript (Accops vs Customer), qualification card with evidence quotes, summary, follow-up email
  (copy button), battlecards shown during the call, flow status.
- `/live/deals/[id]` — deal timeline: meetings, qualification progress across meetings (tracking).

## Testing

- `lib/live/*.check.mjs` (SAM convention, run with node): VAD/WAV encoder, framework merge, insight JSON parsing,
  hallucination filter, payload builder.
- `LIVE_MOCK=1` makes STT and LLM deterministic so the whole desktop → API → Supabase → dashboard path runs locally
  with no Groq key; a scripted test plays a WAV fixture through the client pipeline.
- Real-provider check after deploy: `GET /api/v1/provider` extended to ping the STT model.
