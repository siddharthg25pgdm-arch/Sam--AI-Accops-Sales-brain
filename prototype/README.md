# SAM prototype

The first working slice of SAM, Accops' sales and marketing brain. It follows the four-box shape of the
serverless agentic diagram Siddharth shared (web interface → agent runtime → custom tool → local data → model API),
built on our own stack: Streamlit for the interface, Claude for the model, Accops collateral for the data.
Nothing here depends on Google.

| Box | File |
|---|---|
| Web interface | `app.py` (Streamlit chat with a per-answer trace) |
| Agent runtime | `agent.py` (instruction + tools), `runtime.py` (Claude tool runner, or a no-model local stand-in) |
| Custom Python tool | `sam_tools.py` → `search_assets()`, `list_catalog_summary()` |
| Local data | `data/asset_cards.json`, built by `build_cards.py` from the 68-doc inventory + PDFs on disk |
| Model API | Claude Opus 5 via the Anthropic SDK |

## Run locally
```
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env          # add ANTHROPIC_API_KEY, or leave empty for retrieval-only
python build_cards.py           # rebuild data/asset_cards.json from Downloads/Assets + the inventory .md
streamlit run app.py
```

## Deploying (internal only)
The cards carry client names and deal outcomes, so this never goes on a public URL. In order of preference:
1. Fold the interface into the Next.js app behind Entra ID, as in `docs/2026-09-04-sam-design.md`.
2. Run Streamlit on an internal VM or Azure Container Apps with Entra ID in front.
Never a public PaaS with unauthenticated access.

## What this proves, and what it does not
Proves: the four-box flow answers "find me X" on real collateral, with a visible trace, and the card schema
is enough for that. Not yet: SharePoint ingestion (files come from Downloads/Assets), public URLs (every card is
`private` until the bucket map exists), embeddings (keyword + fuzzy only), Teams or WhatsApp channels.
