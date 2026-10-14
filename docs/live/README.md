# SAM Live: how to run, test and ship it

Accops' own call copilot for Windows. Design and decisions: [2026-10-14-sam-live-design.md](2026-10-14-sam-live-design.md).

| Part | Where |
|---|---|
| Windows app (Electron) | `desktop/` |
| API + `/live` dashboard | `web/app/api/live/*`, `web/app/live/*`, `web/lib/live/*` |
| Tables | `live_deals`, `live_meetings`, `live_segments` in Supabase `iwqhayuoxnrhqzozznes` ([supabase-live.sql](supabase-live.sql)) |
| Post-call email + sheet | Power Automate flow 9 "SAM Live -> Rep Email + Calls Sheet" (`2fd33126-…`), built by `Downloads\Accops-Ads-Analysis-2026\li_flows.py` (`flow9`), writes `SAM Live Calls.xlsx` in Siddharth's OneDrive |
| Production settings | `ops/set-live-env.ps1` (run by Siddharth; secrets never printed) |

## Models (benchmarked 14 Oct 2026 on a synthetic Accops call)

Speech-to-text `gpt-transcribe`, live insight `gpt-5.4-mini`, summary `gpt-5.5`, all on `LIVE_OPENAI_API_KEY`;
each falls back to SAM's Groq tier. `GET /api/v1/provider` (admin) shows the `live` chain and which models exist.

## Tests

From `web/`: `node scripts/checks.mjs` (includes `live.check`), `node scripts/live-smoke.mjs` (whole HTTP contract
against a running server, cleans up after itself; `LIVE_MOCK=1` on `next dev` needs no model keys).
`node scripts/live-assist-smoke.mjs` (assist, echo de-duplication and delete; real providers, cleans up after itself).

From `desktop/` (unset `ELECTRON_RUN_AS_NODE` first if your terminal sets it):
- `npm run check`: VAD/WAV, AEC3 + echo gate + call-audio health, upload queue + connection pill, mic-registry call
  detection, log rotation
- `node test/ui.check.mjs`: every screen against the stub server (60 assertions)
- `node test/loopback.check.mjs`: real Windows system-audio capture, plays speech out loud
- `node test/aec.check.mjs`: real echo test. Plays a customer out loud with the mic ON and counts rep-channel echo
  uploads per echo mode (Chromium only / gate only / AEC3 + gate). Keep the room quiet; speakers on, no headset.
- `node test/notify.check.mjs`: call detection through main with a fake registry file (`SAM_LIVE_FAKE_REG`)
- `node test/e2e-real.check.mjs`: the packaged app against a real SAM server and real models (needs
  `SAM_LIVE_E2E_ID`/`SAM_LIVE_E2E_PW`). It creates a test call ("E2E Northwind Co-op Bank …"). Delete it afterwards
  (`is_test` rows), and remove the flow's sheet row with `clean_live_calls.py`.
- Add `SAM_LIVE_EXE="dist/win-unpacked/SAM Live.exe"` to test the packaged build instead of the source.

## Releasing a new installer

1. Bump `version` in `desktop/package.json`, then `npm run dist` → `desktop/dist/SAM-Live-Setup-<version>.exe` (~100 MB, unsigned,
   so SmartScreen says "unknown publisher": More info → Run anyway).
2. Put it where reps can get it (OneDrive/SharePoint/Teams) and share it with them, then put that link in
   `LIVE_DOWNLOAD_URL` (`ops/set-live-env.ps1 -DownloadUrl <link>`) so `/live` shows the download button.

## Adding a rep

They need a SAM login (`SAM_USERS` in Vercel). Add `<id>:<email>` to `LIVE_REP_EMAILS` so their post-call
summary reaches them; until then it goes to `LIVE_FALLBACK_EMAIL`.

## Known limits

- Speakers work: AEC3 removes the call audio from the mic and the echo gate keeps what is left off the rep channel
  (the server also drops a rep line that repeats a customer line within 4 s). Talking over the customer is chopped a
  little more than with a headset.
- Call audio is the Windows default output device only. If Teams plays to another device the customer channel is
  silent; the app warns after 20 s ("Can't hear the call").
- Field logs: `%APPDATA%\SAM Live\main.log` (+ `main.log.1`).
- Everything the PC plays counts as the customer (notifications, videos).
- Answers shorter than ~0.6 s of speech are not sent ("yes" alone won't appear).
- Not built yet: CRM write-back (Zoho/GHL), calendar auto-start, macOS, code signing, a question-template editor.
