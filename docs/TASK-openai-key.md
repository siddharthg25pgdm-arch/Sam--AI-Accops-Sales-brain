# Adding the OpenAI key to SAM

What this does: SAM asks OpenAI first. If OpenAI fails (rate limit, outage), it asks Groq the way it does today. If Groq fails too, SAM still answers from plain search. Nothing else changes for the reps.

You add **one** variable. Everything else stays as it is.

## 1. Get the key (5 minutes)

1. Go to https://platform.openai.com and sign in with the Accops account that will pay.
2. Left menu: **Settings** → **Billing**. Add a card and buy credit. $10 lasts a long time (see "What it costs" below). Turn **Auto recharge** off unless you want it.
3. Left menu: **API keys** → **Create new secret key**.
   - Name: `SAM production`
   - Project: Default project (or make a "SAM" project first: **Settings** → **Projects** → **Create**)
   - Permissions: **All**
4. Copy the key (it starts `sk-`). It is shown once. Don't paste it into chat, email or Teams. If it ever ends up somewhere like that, delete it on this page and make a new one.

## 2. Paste it into Vercel (2 minutes)

1. Go to https://vercel.com and open the **sam-accops** project.
2. Top menu: **Settings** → left menu: **Environment Variables**.
3. Click **Add New** (or **Create new**). Fill in:
   - **Key:** `OPENAI_API_KEY`
   - **Value:** the `sk-...` key
   - **Environments:** tick **Production** (Preview too if you like; leave Development unticked)
   - **Sensitive:** on
4. Click **Save**.

**Leave these alone.** They are Groq, and Groq becomes the backup:
`LLM_PROVIDER`, `OPENAI_COMPAT_BASE_URL`, `OPENAI_COMPAT_API_KEY`, `OPENAI_COMPAT_MODEL`, `OPENAI_COMPAT_FALLBACK_MODEL`.

**Remove nothing.**

Optional, only if you want a different model than the default: add `OPENAI_MODEL` with the model name (default `gpt-6-luna`, see "Which model" below). Optional second OpenAI model tried before Groq: `OPENAI_FALLBACK_MODEL=gpt-5.4-mini`.

## 3. Redeploy (1 minute)

A new variable only takes effect on a new deployment.

1. Top menu: **Deployments**.
2. On the top row (the one marked **Production** / **Current**), click the **⋯** menu on the right → **Redeploy**.
3. Leave "Use existing Build Cache" as it is → **Redeploy**.
4. Wait for the status to go **Ready** (1 to 2 minutes).

## 4. Check it worked (1 minute)

1. Sign in to https://sam-accops.vercel.app with your admin login.
2. Open https://sam-accops.vercel.app/api/v1/provider in the same browser.
3. You should see, near the top:
   - `"provider": "openai"` and `"model": "gpt-6-luna"`
   - `"order"`: `gpt-6-luna (openai)`, then the two Groq models, then `retrieval only`
4. Under `"tiers"`, the first block is OpenAI. Check:
   - `"key_valid": true`
   - `"available": { "gpt-6-luna": true }`
   - `"ping": [ { "ok": true, ... "reply": "ok" ... } ]` (the `ms` number is how long it took)
5. Then ask SAM one real question in the chat. In **Admin** → **System**, "Model provider" should read
   `OpenAI · gpt-6-luna → then OpenAI-compatible · openai/gpt-oss-120b, openai/gpt-oss-20b`, and
   "Last model answer" should name `gpt-6-luna`.

If something is wrong:

| You see | Meaning | Fix |
|---|---|---|
| `"provider": "openai-compatible"` and no OpenAI tier | The variable isn't in this deployment | Check the name is exactly `OPENAI_API_KEY`, ticked for Production, then redeploy again |
| `"key_valid": false` | Wrong or deleted key | Make a new key, replace the value in Vercel, redeploy |
| `"ping"` ok false, `http: 429`, "insufficient_quota" | No credit on the account | Billing → add credit |
| `"available": { "gpt-6-luna": false }` | The model name is wrong or not on your account | Remove `OPENAI_MODEL` (uses the default) or set another model |
| ping ok false, error mentions tools or reasoning | That model can't do SAM's tool calling in this API | Use `gpt-6-luna`, `gpt-6-sol` or `gpt-5.4-mini` |

To switch OpenAI off again: delete `OPENAI_API_KEY` in Vercel and redeploy. SAM goes back to Groq exactly as before.

## Which model, and why

**`gpt-6-luna` (default).** OpenAI's own recommendation for "cost-sensitive, high-volume workloads", and the cheapest current model: $0.10 per million input tokens, $0.50 per million output (cached input $0.01). 1M-token context. SAM calls it with reasoning off (`reasoning_effort: "none"`), which is both the fastest setting and the only one where OpenAI's Chat Completions API allows tool calling on GPT-6 Sol/Luna.

Alternatives if Luna disappoints: `gpt-5.4-mini` ($0.75 / $4.50; reasoning off by default, tool calling in Chat Completions without restrictions) or `gpt-6-sol` ($2 / $10). Don't use `gpt-6-astra` or `gpt-6.1-sol`: Chat Completions does not do tool calling with them.

Sources (checked 30 Sep 2026): [models](https://developers.openai.com/api/docs/models), [gpt-6-luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [pricing](https://developers.openai.com/api/docs/pricing), [latest-model guide](https://developers.openai.com/api/docs/guides/latest-model), [gpt-5.4-mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini).

## What it costs

One SAM question is a few model calls that re-send the prompt and search results: roughly 5,000 to 10,000 input tokens and a few hundred output tokens. On `gpt-6-luna` that is about **$0.001 per question** (under ₹0.10). 1,000 questions a month is about $1. Rate limits on a new account (Tier 1): 500 requests and 500,000 tokens per minute, far above SAM's traffic.

## What OpenAI does with the data

From OpenAI's [data controls page](https://developers.openai.com/api/docs/guides/your-data):
- API data is **not used to train** OpenAI's models unless you opt in. Don't opt in (Settings → Data controls → Sharing: leave off).
- **Abuse-monitoring logs are kept up to 30 days** by default. Zero Data Retention exists but needs OpenAI's approval.
- SAM sends `store: false`, so nothing is kept for OpenAI's evals / distillation tools.
- India data residency exists (`in.api.openai.com`, regional storage, not regional processing) and needs setup with OpenAI; if you get it, add `OPENAI_BASE_URL=https://in.api.openai.com/v1`.

SAM's prompts contain case-study customer names, the same as with Groq today; InfoSec should know the provider changed.

## For the developer

- Env contract and request shapes: `web/lib/agent-openai.ts` (header comment, `tiers()`, `requestBody()`).
- Offline check: `node web/lib/provider.check.mjs`.
- Answers still log `runtime = "openai-compatible"`; the `model` column says which model answered (`gpt-6-luna` vs `openai/gpt-oss-*`), and the trace's model step says `(openai)` or `(openai-compatible)`.
