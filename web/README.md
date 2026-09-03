# SAM web app

Bot plus catalogue in one place, behind a login, with an admin dashboard. Next.js 16 on Vercel.

| Screen | What it does |
|---|---|
| `/login` | Login ID and password from `SAM_USERS` |
| `/` | Left: ask SAM (Claude with the search tool, or retrieval-only without a key). Right: catalogue with facets (type, industry, product, year), Latest view, and "Not available" view of coverage gaps, ranked by how often people have actually asked |
| `/admin` | People, questions, answer rate, feedback, catalogue opens, gaps, top questions, most surfaced assets, recent questions. Admin users only |

Data is `data/asset_cards.json`, built by `../prototype/build_cards.py`. Copy it over when it changes.

## Environment
See `.env.example`. Minimum to run: `SAM_USERS` and `SAM_SESSION_SECRET`.
Add `ANTHROPIC_API_KEY` for reasoning answers. Add `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (after running `../docs/supabase-sam-events.sql`) so dashboard events survive deploys.

## Run
```
npm install
copy .env.example .env.local   # fill in
npm run dev
```

## Deploy
```
vercel --prod
vercel env add SAM_USERS production          # id:password:admin,id2:password2
vercel env add SAM_SESSION_SECRET production
vercel env add ANTHROPIC_API_KEY production  # optional
```
`robots` is set to noindex. Every page and API route checks the session cookie server side.

## API and MCP (for the Dwight extension and other tools)
Every route accepts either the browser session cookie or `Authorization: Bearer <token>` with a token from `SAM_API_TOKENS`.

| REST | MCP tool | Purpose |
|---|---|---|
| `GET /api/v1/search?q=&vertical=&type=&product=&audience=&limit=` | `search_assets` | Ranked asset cards with why-matched, visibility, links |
| `POST /api/v1/ask {question, history?}` | `ask_sam` | Verdict + up to three assets, gap flag |
| `GET /api/v1/assets?vertical=&type=&product=` | `list_catalogue` | Browse the catalogue with facet counts |
| `GET /api/v1/public-link?asset=` | `public_link` | Public URL or `private_only` with a do-not-forward note |
| `GET /api/v1/gaps` | `content_gaps` | Combinations with no collateral, ranked by asks |
| `POST /api/v1/context {company, person_title?, country?, industry?, intent?}` | `context_for_account` | Account brief for outreach |

MCP endpoint (streamable HTTP): `https://sam-accops.vercel.app/api/mcp`. Claude Code:
```
claude mcp add --transport http sam https://sam-accops.vercel.app/api/mcp --header "Authorization: Bearer <token>"
```
Calls made this way show up in the dashboard under the token's label with channel `api` or `mcp`.

## Not in this version
SharePoint ingestion (cards come from the files on Siddharth's disk), public URLs (all assets show as internal until the bucket map exists), embeddings, Teams, WhatsApp, Slack. Those are channels and feeds onto the same engine; see `../docs/2026-09-04-sam-design.md`.
