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
