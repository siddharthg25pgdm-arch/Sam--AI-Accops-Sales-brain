# corpus/web: public knowledge for the website chatbot

Stage 1 knowledge for the SAM website chatbot ([PRD](../../docs/PRD-website-chatbot.md), sections 3, 4 and 6).
Everything here comes from **public** pages only: accops.com (every URL in its sitemaps) and the Citrix
alternative landing page (accops-citrix-lp.vercel.app). No internal SAM material is read or referenced.

| File | What it is |
|---|---|
| `pages-accops-com.json` | One card per accops.com sitemap URL (221 unique; the case-studies sitemap lists one URL twice) |
| `pages-citrix-lp.json` | One card per `<section>` of the Citrix LP (13) |
| `fetch-log.json` | Pages that failed, came back thin, or lost a fact because its quote left the page |
| `qa-citrix-lp.json` | Draft Q&A bank for the Citrix LP (stage 1 placement). Review sheet: [docs/web-qa-review.md](../../docs/web-qa-review.md) |

Page bodies are cached in `corpus/web-raw/` (gitignored); only cards are committed.

## Page card fields

| Field | Meaning |
|---|---|
| `url`, `title` | Page URL (LP sections as `#anchor`) and its own h1 |
| `page_type` | `product`, `solution`, `industry`, `comparison`, `case-study`, `blog`, `resource`, `company`, `legal`, `other` |
| `products`, `industries` | Master-list labels from `core.terms` (`docs/brain/01-core-reference-lists.sql`); left empty rather than guessed |
| `summary` | 2-3 sentences |
| `facts[]` | `{fact, quote[, caveat]}`. `quote` is copied exactly from the page (a ` \| ` marks a line break between page elements); `fact` is the claim in short form. `caveat` flags facts the page itself qualifies (e.g. LP commitments marked NEEDS SIGN-OFF) |
| `questions_answered[]` | 3-5 visitor questions the page answers |
| `cta` | The page's own call to action `{label, url}` (download, video, contact) or null |
| `published`, `lastmod`, `fetched_at` | Post date (news), sitemap lastmod, crawl time |
| `content_hash`, `words` | Hash and length of the extracted text |
| `carded_by`, `needs_recard` | `claude` = summary, facts and questions written by Claude and checked; `auto` = mechanical baseline (meta description, verbatim number/certification sentences, the page's own FAQ headings) |

Legal and careers pages are listed with no facts. The LP's visible drafting notes (`.ph` blocks: PLACEHOLDER,
NEEDS SIGN-OFF) and HTML comments are stripped before carding, so placeholder numbers never become facts.

## Q&A bank fields

Columns follow `sam_web_qa` (PRD section 6): `question`, `aliases`, `parent_id`, `nudge_weight`, `pages`,
`regions`, `cta` (`talk_to_sales` / `asset` / `none`), `cta_url`, `sources`, `status`, `origin`. Additions:
`short_answer` (≤ 60 words, at most one `link`), `visual` (`{type, data}`, type one of `doc_card`,
`compare_table`, `steps`, `stat`, `cta`, with the rows/steps/stats the widget renders), `evidence[]`
(`{url, quote}` for every claim), `needs_approval` + `approval_reasons` (numbers, certifications, customers,
analyst or competitor claims), `notes` (gaps and caveats for the reviewer).

## Regenerate

```
python prototype/web_pages.py              # fetch new pages (4 at a time), rebuild cards
python prototype/web_pages.py --refetch    # ignore the cache, fetch everything
python prototype/web_pages.py --apply notes.json   # merge Claude-written {url: {summary, facts, questions_answered, ...}}
python prototype/web_pages.py --qa         # verify every Q&A evidence quote, rewrite docs/web-qa-review.md
python prototype/web_pages.py --selftest   # the quote check, offline
```

A Claude card survives a rebuild while its page text is unchanged (same `content_hash`). When a page changes,
the card falls back to the auto baseline with `needs_recard: true` and a log line; re-card it with `--apply`.
Every run re-checks every fact quote against the current page text and drops any quote no longer there.
`--qa` also reads the 22 rows of `sam_v1_public_assets`, cached read-only at `corpus/web-raw/public-assets.json`
(fetch it with a GET on the Supabase REST view; the key stays in `web/.env.local`).

News bodies are rendered client-side on accops.com, so the script reads them from the site's public WordPress
API (`blogs.accops.com/wp-json`). Plain HTTP only; no scraping services.

## State on 26 October 2026

- 221 URLs fetched, 0 failed. 37 thin: 18 webinar pages incl. the index (an embedded video and a title),
  9 case-study pages (one blurb plus a PDF link), 9 listing, form or client-rendered pages (`/products`,
  `/industry-solutions`, `/technical-solutions`, `/hyseries`, `/investor-relations`, `/news`, `/buy`,
  `/schedule-a-free-demo`, `/edm-generator`), and the LP's trust strip (short by design).
- Claude-carded: 137 (all 13 LP sections, products, solutions, industries, case studies, company, legal and
  resource pages, and 9 key news posts). Auto baseline: 97 (59 news posts, 18 partner-award pages, 20 webinar
  and video pages).
