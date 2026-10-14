# SAM Live moved

SAM Live (the Windows call copilot, its server and its /live dashboard) is its own product now:
https://github.com/siddharthg25pgdm-arch/sam-live, deployed at https://sam-live-nine.vercel.app.
It uses SAM only through `GET /api/v1/search` (API token `sam-live`). Its history up to the split is in this
repo (commits 37dac7e..56c8a1b). The `live_*` tables stay in the shared Supabase project.
