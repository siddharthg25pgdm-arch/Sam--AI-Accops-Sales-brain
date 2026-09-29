# Nightly carding job - backup copy

The live copies run from outside this repo. These are the versions to restore from.

| File | Live location |
|---|---|
| `SKILL.md` | `%USERPROFILE%\.claude\skills\sam-nightly-carding\SKILL.md` |
| `sam-nightly-carding.ps1` | `%USERPROFILE%\.claude\scripts\sam-nightly-carding.ps1` |
| `sam-nightly-carding.mcp.json` | `%USERPROFILE%\.claude\scripts\sam-nightly-carding.mcp.json` |

Windows Task Scheduler task **`SamNightlyCarding`**: daily 07:00, runs
`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File <the .ps1>`,
StartWhenAvailable + WakeToRun, 2 h limit. Log: `%USERPROFILE%\.claude\logs\sam-nightly-carding.log`.
The deterministic half is `prototype/carding_prep.py` (in this repo). See `docs/HANDOVER.md`,
"29 September 2026: the daily loop runs itself".

If you change a live copy, copy it back here and commit.
