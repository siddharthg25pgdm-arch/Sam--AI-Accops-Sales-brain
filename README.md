# SAM — Accops sales & marketing brain

Internal tool that answers two questions for Accops sales and marketing: **where is the X?** and **what do we say?** It searches Accops' own collateral (case studies, whitepapers, brochures) and returns a short verdict plus up to three assets, each with one line on why it fits and a link that is safe for the intended audience.

**Live:** https://sam-accops.vercel.app (login required)
**Deploys:** push to `main` → Vercel builds from `web/` → production

## What is in this repository

| Path | What it is |
|---|---|
| `web/` | The product. Next.js app: chat + catalogue + admin dashboard + REST API + MCP server + WhatsApp channel. See `web/README.md`. |
| `prototype/` | Earlier Python spike (Streamlit) and the card-building scripts. `build_cards.py` turns the collateral inventory plus the PDFs on disk into `data/asset_cards.json`; `generate_cards.py` uses an LLM to write asset cards for uncatalogued files. |
| `docs/2026-09-04-sam-design.md` | The design document, v0.6. Every decision, its reasoning, and what was rejected. Read this first. |
| `docs/2026-09-04-design-review.md` | A critical review of the design against its own goals. |
| `docs/sam-query-simulation.html` | Interactive simulation of a query flowing through the system. Open in a browser, press Play. |
| `docs/supabase-sam-events.sql` | Analytics table schema (already applied). |
| `docs/TASK-*.md` | Open tasks with enough context to be picked up cold. |

## How it works, briefly

A question arrives from the web app, the API, the MCP server, or WhatsApp. All four paths hit the same engine:

1. **Router** — a language model decides which filters apply (industry, asset type, product, audience) and calls the search tool.
2. **Search** — keyword and fuzzy matching over 74 asset cards, each carrying industry, products, client descriptor, outcomes, "use for" guidance, publication year and visibility.
3. **Answer** — the model writes a verdict and a why-it-fits line per asset. If nothing fits, it says so plainly and the gap is logged.
4. **Log** — every question, result and rating goes to Supabase, feeding the dashboard and the content-gap list.

Public links are offered before internal ones, and internal links are labelled as login-required. Private files are never attached or forwarded.

## Credentials

All credentials, URLs and account details are in `secrets/secrets.md.gpg`, AES-256 encrypted.

```bash
bash secrets/decrypt.sh
```

> **Passphrase hint: search in your Teams for "Passphrase" sent to yourself.**

Lost it? `secrets/RECOVERY.md` rebuilds every value from the Vercel, Supabase, Groq and Meta dashboards.

## Current state

Working: web app, catalogue with facets, "Not available" gap view, admin dashboard, REST API, MCP server, WhatsApp channel code, Supabase analytics, model answers via Groq's free tier.

Not yet: SharePoint ingestion (assets come from a local folder), public/internal asset mapping (everything shows as internal), a real WhatsApp number, embeddings-based retrieval.

## Open tasks

| Task | Status |
|---|---|
| [`docs/TASK-sharepoint-ingestion.md`](docs/TASK-sharepoint-ingestion.md) | **Next up.** Ingest the real Sales and Marketing libraries. Includes the recommended mechanism, what to ask IT for, and a ready-to-paste prompt. |
| [`docs/TASK-whatsapp-meta-setup.md`](docs/TASK-whatsapp-meta-setup.md) | Closed, channel live. Kept for the config record and two expiry dates. |

After SharePoint: publication-date extraction and freshness badges, the public/internal asset map, consuming feedback thumbs, publish requests, a weekly gap digest.
