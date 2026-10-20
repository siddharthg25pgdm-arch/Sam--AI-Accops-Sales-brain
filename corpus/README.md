# corpus/ — downloaded source documents

**Gitignored in full. Nothing here is ever committed.**

Working area for carding. Documents are downloaded here, text is extracted, cards are written, and
the cards go to Supabase. The source files stay local so a card can be re-derived without
re-downloading.

```
corpus/
  public/      PDFs from downloads.accops.com - already published to the internet
  sharepoint/  PRIVATE files from the Sales Collateral library. See the rule below.
  text/        extracted plain text, one .txt per source document
  cards/       generated asset cards as JSON, before they are loaded to Supabase
```

## The rule these files sit under

Design section 2: **a private asset's file body never leaves SharePoint.** That is what makes the
WhatsApp channel acceptable to InfoSec, and what the carding boundary rests on.

Siddharth authorised downloading private documents on 7 September 2026 for the MVP build. That is a
**build-time exception, not a change to the runtime rule**, and the distinction is the whole point:

- **Still true, and must stay true:** SAM never serves a private file body to a user, on any channel.
  It hands out links. Nothing in `web/` reads from this folder.
- **Now allowed at build time:** Claude downloads a private document, extracts text, and writes a
  card. Only the card reaches Supabase.

So the InfoSec argument is unchanged - a rep on WhatsApp still cannot receive a private PDF from SAM.
What changed is who does the downloading during carding, and it is a laptop-local step either way.

**If this folder is ever read by anything under `web/`, the rule is broken.** Keep it a build input.

### Superseded for passage text, 17 October 2026

**Siddharth's decision (17 Oct 2026): passages of public AND internal carded Sales/Marketing collateral
are indexed in the shared Supabase project.** For that passage text, "a private file body never leaves
SharePoint" no longer holds: `prototype/build_passages.py` splits each carded document's extracted text
into page/slide/section passages and stores them in `sam_passages` (`docs/supabase-sam-passages.sql`). What
still holds, and is enforced in code:

- `web/` still never reads this folder; passages reach Supabase from the laptop, like cards.
- Text only, never a file: no PDF, deck or attachment is stored or served. E-mail addresses, phone numbers,
  IP addresses and credentials are replaced at build time. Spreadsheets are not indexed.
- `sam_passages` is service-role only (RLS on, nothing granted to anon/authenticated).
- Internal passages are served by `/api/v1/passages` only to tokens holding the `passages:internal` scope
  (SAM Live's). Everyone else, a signed-in browser included, gets public passages only.
- A passage is never offered for external sharing without the asset's approval metadata
  (`sharing.external_approved`: a public URL on accops.com or a decided publish request).
- Kill switch: `SAM_PASSAGES_INTERNAL=0` in Vercel stops serving internal passages at once; running
  `build_passages.py` with it set deletes the internal rows.

SAM still never sends a private file to a user on any channel: a rep on WhatsApp still gets a link.

## Blocked: Graph and SharePoint REST, 7 September 2026

`sp_fetch.py` resolves all 27 demo documents against the registry and is ready to run, but both
document APIs now return 401 with
`InvalidAuthenticationToken ... Continuous access evaluation ... InteractionRequired`.

**A fresh interactive `az login` does not clear it.** That rules out a stale token, which was the
first guess. What remains is a Conditional Access policy the Azure CLI cannot satisfy - typically a
compliant-device requirement, an MFA claim the CLI does not carry, or an approved-client-app
restriction.

Scoped, not total:

| API | State |
|---|---|
| Microsoft Graph | 401, CAE challenge |
| SharePoint REST (`_api/web`) | 401 `invalid_request` |
| Power Automate Flow API | **works** - 2 flows listed |

Flow still working is what shows this is a policy scoped to document access rather than a broken
login. It also means the change trigger keeps running: the pipeline is unaffected, only bulk
download is.

The timing lines up with the Sales Collateral permission change earlier the same day, so something
on the tenant tightened.

**This is not worth engineering around.** The options are to ask IT which policy applies to Graph
for CLI clients, or for Siddharth to download the 27 documents through the browser - where the
session already satisfies whatever the policy wants, since he can open the folder. The second needs
no ticket. `docs/demo-corpus.md` lists exactly which files.
