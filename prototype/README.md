# SAM prototype (codelab shape)

Mirrors Google's "Streamlit RAG agent with ADK on Cloud Run" codelab, box for box, on real Accops collateral:

| Codelab box | SAM prototype |
|---|---|
| User's browser → Web Interface (Streamlit) | `app.py` |
| Agent Runtime: ADK `LlmAgent` | `agent.py` (instruction + tools), `runtime.py` (ADK / Claude / local) |
| Custom Python Tool (RAG) | `sam_tools.py` → `search_assets()`, `list_catalog_summary()` |
| Local `menu.json` | `data/asset_cards.json`, built by `build_cards.py` from the 68-doc inventory + PDFs on disk |
| Gemini API | Gemini via ADK **or** Claude via the Anthropic SDK, chosen by which key is in `.env` |

## Run locally
```
python -m venv .venv && .venv/Scripts/activate      # Windows
pip install -r requirements.txt
copy .env.example .env                              # add one API key, or leave empty for retrieval-only
python build_cards.py                               # rebuild data/asset_cards.json (needs Downloads/Assets + inventory .md)
streamlit run app.py
```

## Deploy to Cloud Run (as the codelab does, buildpacks, no Dockerfile)
```
gcloud run deploy sam-prototype --source . --region asia-south1 \
  --set-env-vars GOOGLE_API_KEY=... \
  --command "/cnb/lifecycle/launcher" \
  --args "sh,-c,python3 -m streamlit run app.py --server.port=\$PORT --server.address=0.0.0.0 --server.headless=true"
```
Do **not** use `--allow-unauthenticated` for SAM. The cards contain client names and outcomes. Put it behind IAP or
Cloud Run IAM with the Accops Google Workspace group, or deploy on Vercel behind Entra ID as per the main design.

## What this prototype proves, and what it does not
Proves: the four-box flow works on real collateral; the tool + card schema is enough to answer "find me X" asks;
trace visibility per answer. Does not yet: read SharePoint (files come from Downloads/Assets), know public URLs
(every card is `private` until the bucket map exists), use embeddings (keyword + fuzzy only), or handle Teams/WhatsApp.
