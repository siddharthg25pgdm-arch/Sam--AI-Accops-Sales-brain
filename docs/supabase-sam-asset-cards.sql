-- SAM asset cards: what a document SAYS, as opposed to where it lives.
-- Project: accops-marketing-dashboard (ref iwqhayuoxnrhqzozznes), same project as every other sam_ table.
--
-- The third corpus, and the one that makes the other two answerable. sam_sharepoint_files knows
-- WHERE all 874 documents are; asset_cards.json knows what 77 of them say but is frozen and
-- undated. This table holds cards written by Claude Enterprise from the real document text, so a
-- registry row stops being just a filename and starts being an answer.
--
-- The carding boundary, which this table IS the implementation of (ROADMAP section 4):
--   Claude Enterprise reads the documents and writes the cards. The cards go here. Groq reads only
--   the cards. No original file is ever ingested by SAM or sent to a free-tier model.
-- So this table is the boundary object: read every row and you know exactly what a third-party
-- model can see. That property is why the card is stored whole and legible rather than as an
-- opaque blob or an embedding.
--
-- On the public/private column split. ROADMAP section 4 proposed splitting each card so the model
-- saw a leaner projection than the browser. Superseded 8 September 2026 by Siddharth's call: SAM is
-- an internal tool, and key_problem, key_outcomes and client detail are not confidential in that
-- context. One column, whole card. The one field still kept out of prompts is client_actual - not
-- because any single name is secret, but because one card can carry thirty customer names at once
-- and none of them help a model rank a match.

create table if not exists sam_asset_cards (
  -- 'sharepoint/Accops vs Citrix.pdf' or 'public/Accops - DTH - Case Study.pdf'. The path within
  -- corpus/, which is also how a card is traced back to the document it was written from.
  source        text primary key,
  filename      text not null,                  -- basename, for joining to sam_sharepoint_files
  origin        text not null default 'sharepoint',  -- sharepoint | public
  title         text not null,
  asset_type    text not null default 'Other',  -- Case Study | Whitepaper | Brochure | Datasheet | Deck | Battlecard | Solution Document | Other
  industry      text not null default '',
  -- Descriptive and anonymised: "India's largest private sector bank". Safe in a prompt.
  client        text not null default '',
  -- Real customer names exactly as printed. NEVER put this in a model prompt: a single deck's list
  -- runs to thirty banks and defence agencies, and no ranking decision needs any of them.
  client_actual text not null default '',
  client_named  boolean not null default false,
  products      text[] not null default '{}',
  competitors   text[] not null default '{}',
  personas      text[] not null default '{}',
  regulations   text[] not null default '{}',
  key_problem   text not null default '',
  key_outcomes  text[] not null default '{}',
  brief         text not null default '',
  use_for       text not null default '',

  -- The trust fields. This is what P1.1 was asking for and why carding was worth doing.
  -- publish_year is read out of the DOCUMENT BODY, never the filename or modified_at: the file
  -- '2026-06-11-Accops vs other VDI providers.pptx' is dated 29 NOV 2022 on its own title slide,
  -- so the filename date is a SharePoint touch and believing it would age the deck four years wrong.
  publish_year  text,
  -- Set where the document states an expiry that has passed. The ISO 27001 certificate expired on
  -- 20 September 2024 and is exactly the file a rep sends when procurement asks - so this field
  -- exists to stop that send, which is a commercial risk rather than a cosmetic one.
  expired       boolean not null default false,
  expiry_date   date,
  -- Free text: why this document might mislead even though it is not formally expired. A newer
  -- edition exists, a competitor's licensing has moved on, the content predates the filename.
  stale_risk    text not null default '',
  -- 'public/Accops DaaS Brochure V4 2026.pdf' - a newer edition of the same document. Checked
  -- against what is actually on disk when written, never asserted.
  superseded_by text not null default '',

  -- internal = never forward to a customer. both = already published, safe to send.
  visibility    text not null default 'internal',
  internal_reason text not null default '',
  public_url    text not null default '',
  -- The card writer's own 0-1 estimate that the card is faithful to the document.
  confidence    numeric not null default 0,
  -- Where a card needs a human before SAM should act on it, e.g. "obtain the current ISO
  -- certificate". Surfaced on the dashboard rather than buried in a JSON file on one laptop.
  needs_human   text not null default '',

  batch         text not null default '',       -- batch-01 .. batch-05, so a bad prompt is traceable
  generated_by  text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Answers are filtered by these three far more often than anything else.
create index if not exists sam_cards_filename_idx   on sam_asset_cards (filename);
create index if not exists sam_cards_visibility_idx on sam_asset_cards (visibility);
create index if not exists sam_cards_expired_idx    on sam_asset_cards (expired) where expired;
create index if not exists sam_cards_product_idx    on sam_asset_cards using gin (products);
create index if not exists sam_cards_industry_idx   on sam_asset_cards (industry);

alter table sam_asset_cards enable row level security;
