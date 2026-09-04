# Task: set up a WhatsApp test number for SAM on Meta

**Status:** open, waiting on Siddharth.
**Owner:** Siddharth Gupta.
**Written:** 4 September 2026.
**Why this file exists:** so any assistant on any device can guide Siddharth through this without the original conversation. Everything needed is below.

---

## 1. What SAM is, in one paragraph

SAM is Accops' sales and marketing brain: an internal tool that answers "where is the X?" and "what do we say?" from Accops' own collateral. It is live at **https://sam-accops.vercel.app** behind a login ID and password. The web app has a chat pane on the left and a browsable catalogue on the right (74 case studies, whitepapers and brochures with facets for type, industry, product and year, a Latest view, and a "Not available" view showing which industry-by-product combinations have no collateral). An admin dashboard at `/admin` shows who is asking, top questions, answer rate, feedback, and content gaps. The same engine is exposed as a REST API under `/api/v1/` and as a Model Context Protocol server at `/api/mcp`, both authenticated with a bearer token, so the Dwight Chrome extension can call it.

The remaining piece is a **WhatsApp channel**, so a salesperson can message SAM from a phone and get back up to three links. The code is already written, deployed and tested in dry-run mode. What is missing is a WhatsApp number and its credentials from Meta.

## 2. The decision behind this task

WhatsApp was originally going to run on **OpenWA**, an open-source bridge over WhatsApp Web. That was reversed on 4 September 2026 because OpenWA needs a server running Docker around the clock, and there is no VM or office server available. It is also an unofficial client, and its own documentation says it is not approved where regulatory compliance matters, which is a problem for a company selling to banks.

The replacement is **Meta's official WhatsApp Business Cloud API**. Meta hosts the connection and posts webhooks directly to the app on Vercel, so there is no server to run, no phone to keep logged in, and no ban risk. Replies within 24 hours of a user's message are free.

## 3. What is already built and deployed

| Piece | Where | State |
|---|---|---|
| Webhook endpoint | `https://sam-accops.vercel.app/api/channels/whatsapp` | Live. Answers Meta's verification handshake, rejects unsigned requests with 401. |
| Channel logic | `web/lib/whatsapp.ts` | Signature verification, message extraction, dedupe, number-to-login mapping, six-hour conversation memory, WhatsApp-formatted replies. |
| Route | `web/app/api/channels/whatsapp/route.ts` | Acknowledges Meta immediately, answers after the response so Meta never times out. |
| Verify token | Already generated and set in Vercel | Value is in `web/.env.deploy.local` on Siddharth's laptop, under `WHATSAPP_VERIFY_TOKEN`. |

Tested locally in dry-run mode: verification handshake, wrong verify token, bad signature, correctly signed message, unregistered sender, and a replayed message ID all behaved correctly, and a WhatsApp question appeared in the dashboard.

**Still needed from Meta:** `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, and the list of phone numbers allowed to use SAM (`SAM_WHATSAPP_USERS`).

## 4. Why a test number and not Siddharth's existing WhatsApp Business number

A phone number can be attached to only one WhatsApp product at a time. Siddharth's existing number is on the WhatsApp Business **app**; moving it to the Cloud API would remove it from the app and break whatever customer conversations run there. Meta does offer a "coexistence" mode, but only via Embedded Signup through a solutions partner in certain markets, so it is not a reliable plan.

So: use Meta's **free test number** now to prove the whole loop works, then buy or repurpose a dedicated number later. A new number does not need a phone permanently; it only needs to receive one verification code at registration.

## 5. The steps

A Facebook login that can manage a Meta Business account is required. About 15 minutes.

1. **Create the app.** Go to https://developers.facebook.com → My Apps → **Create App**. Choose app type **Business**. Name it something like "SAM Accops". Attach the business portfolio when prompted.

2. **Add the WhatsApp product.** On the app dashboard, find **WhatsApp** in the product list and click **Set up**. Meta automatically creates a WhatsApp Business Account behind it.

3. **Collect the test-number credentials.** Left menu → WhatsApp → **API Setup**. On this page:
   - A **test number** is already provisioned. Under it is a **Phone number ID** (a long numeric string). Copy it. This is `WHATSAPP_PHONE_NUMBER_ID`. Do not confuse it with the WhatsApp Business Account ID.
   - Click **Generate access token**. Copy the token. This is `WHATSAPP_ACCESS_TOKEN`. It expires in 24 hours, which is fine for testing.
   - In the **To** field, click "Manage phone number list", add the mobile number that will message SAM, and enter the verification code Meta sends to it. Up to five recipient numbers are allowed. **Only these numbers can exchange messages with the test number.**

4. **Get the app secret.** Left menu → App settings → **Basic**. Click **Show** next to **App secret** and copy it. This is `WHATSAPP_APP_SECRET`. It is used to verify that incoming webhooks genuinely come from Meta.

5. **Hand back four values:**
   - Phone number ID
   - Access token
   - App secret
   - Mobile number(s) allowed to use SAM, in the form `91XXXXXXXXXX` — country code, digits only, no `+`, no spaces

   These go into Vercel as environment variables and the app is redeployed. The access token and app secret are secrets; the token expires in 24 hours regardless.

6. **Configure the webhook** (do this *after* the redeploy, otherwise verification fails). Left menu → WhatsApp → **Configuration** → Webhook → **Edit**:
   - Callback URL: `https://sam-accops.vercel.app/api/channels/whatsapp`
   - Verify token: the `WHATSAPP_VERIFY_TOKEN` value from `web/.env.deploy.local`
   - Click **Verify and save**. It should succeed immediately, because the endpoint is already live and already knows that token.
   - Then next to "Webhook fields" click **Manage** and subscribe to **messages**.

7. **Test.** From a registered mobile, WhatsApp the test number: `bank case study`. SAM should reply within a few seconds with a one-line verdict and up to three assets. The question then appears in the dashboard at `/admin` under channel `whatsapp`.

## 6. What to expect, and known quirks

- Meta's test number often sends a template message ("hello_world") first. Ignore it.
- The test number can only message the recipients registered in step 3. Anyone else gets nothing at all, not even SAM's refusal line, because Meta blocks it before it reaches the app.
- The temporary access token dies after 24 hours. When the permanent number is set up, create a **System user** under Business settings → Users → System users, assign the app, and generate a permanent token with the `whatsapp_business_messaging` and `whatsapp_business_management` permissions.
- Numbers not listed in `SAM_WHATSAPP_USERS` get one line back: "This number isn't registered with SAM yet." That is deliberate.
- SAM never attaches files over WhatsApp. It sends links only, public links first, and marks internal links as login-required. This is the rule that makes the channel acceptable to InfoSec.

## 7. If something fails

| Symptom | Cause | Fix |
|---|---|---|
| Webhook verification fails in step 6 | Verify token mismatch | Compare with `WHATSAPP_VERIFY_TOKEN` in Vercel → sam-accops → Settings → Environment Variables |
| Message sent, no reply | `messages` field not subscribed, or sender number not in `SAM_WHATSAPP_USERS` | Check step 6's Manage panel and the number format (no `+`) |
| Reply says the number isn't registered | Number missing from `SAM_WHATSAPP_USERS` or formatted with `+` | Re-add as `91XXXXXXXXXX` |
| Nothing in the dashboard | Deploy predates the environment variables | Redeploy after setting variables |

Runtime errors appear in Vercel → sam-accops → Logs, filtered to `/api/channels/whatsapp`.

## 8. Where the rest of the project state lives

- `docs/2026-09-04-sam-design.md` — the full design, now at v0.6, including every decision and its reasoning.
- `docs/2026-09-04-design-review.md` — a critical review of the design against its own goals.
- `docs/sam-query-simulation.html` — an interactive simulation of how a query flows through the system; open it in a browser and press Play.
- `docs/supabase-sam-events.sql` — the analytics table schema, already applied.
- `web/README.md` — how to run, deploy, and every environment variable.
- Repository: https://github.com/siddharthg25pgdm-arch/Sam--AI-Accops-Sales-brain, branch `main`. Pushing to `main` deploys to production automatically.

## 9. Other open items, for context

- **Real WhatsApp number** — the test number proves the loop; a dedicated number is needed for actual use.
- **SharePoint ingestion** — SAM's 74 assets currently come from files on Siddharth's laptop. Connecting the Sales and Marketing SharePoint sites through Microsoft Graph needs the two site URLs and approval for an app registration. This also brings in battlecards and decks, which are missing today.
- **Public asset map** — every asset currently shows "Internal only" because the public bucket's listing has not been mapped yet.
- **Model** — answers are generated by `openai/gpt-oss-120b` on Groq's free tier, because an Anthropic API key was not obtainable. Worth revisiting: Claude via Microsoft Foundry billed through Azure, which would also settle the question of where customer-named text is processed.
