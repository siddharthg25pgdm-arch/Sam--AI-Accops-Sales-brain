-- SAM passages: what a document says, in its own words, page by page.
-- Project: accops-marketing-dashboard (ref iwqhayuoxnrhqzozznes), same project as every other sam_ table.
-- ADDITIVE ONLY and NOT APPLIED by the W2 stream: SAM Live's W1 stream applies DDL (branch first, then
-- production). Idempotent: safe to run twice.
--
-- Why: a card says what a document is FOR; it cannot back a product claim ("HySecure checks device posture
-- on macOS"). SAM Live's grounded assist needs the sentence that says so, with the page it is on. Passages
-- are that sentence: 400-1,200 characters of extracted text split by page (PDF), slide (PPTX) or heading
-- (DOCX), written by prototype/build_passages.py from corpus/text after carding.
--
-- Policy (Siddharth, 17 Oct 2026): passages are indexed for public AND internal Sales/Marketing collateral
-- that SAM already cards. This SUPERSEDES the old "a private file body never leaves SharePoint" rule for
-- passage text stored here; see corpus/README.md. What still holds:
--   - service role only (RLS on, no policies, nothing granted to anon/authenticated);
--   - internal passages are served by /api/v1/passages only to tokens with the passages:internal scope;
--   - a passage is never offered for external sharing without the asset's approval metadata;
--   - kill switch: SAM_PASSAGES_INTERNAL=0 stops indexing (build_passages.py deletes internal rows) and
--     serving (the API drops them) of internal passages.
-- No original file is stored: text only, scrubbed of e-mail addresses, phone numbers, IP addresses and
-- credentials at build time. Spreadsheets are not indexed.

create table if not exists sam_passages (
  id            text primary key,                     -- '<source>#<ordinal>'
  source        text not null references sam_asset_cards(source) on delete cascade on update cascade,
  item_id       text,                                 -- the card's registry binding at build time
  doc_version   text not null,                        -- sha256 of the extracted text, 16 hex chars
  ordinal       int  not null check (ordinal >= 0),
  locator       jsonb not null default '{}',          -- {"page":3} | {"slide":7} | {"section":"Architecture"} | {}
  text          text not null check (length(text) between 40 and 2000),
  tsv           tsvector generated always as (to_tsvector('english', text)) stored,
  audience      text not null check (audience in ('internal', 'public')),   -- the card's visibility at build time
  extracted_at  timestamptz not null default now(),
  extractor     text not null,                        -- e.g. build_passages.py@1 (bump to rebuild everything)
  unique (source, ordinal)
);
create index if not exists sam_passages_tsv_idx on sam_passages using gin (tsv);
create index if not exists sam_passages_audience_idx on sam_passages (audience);

alter table sam_passages enable row level security;
revoke all on sam_passages from public, anon, authenticated;
grant select, insert, update, delete on sam_passages to service_role;

-- Candidates for a question: any of its words (OR, not AND: a rep's question is a sentence, and AND over
-- every word of it matches almost nothing), ranked by cover density. The API re-ranks these with SAM's own
-- token and entity scoring (web/lib/passages.ts), so this only has to be a good, cheap recall step.
create or replace function sam_passages_search(p_query text, p_audiences text[] default array['public'], p_limit int default 60)
returns table (id text, source text, item_id text, doc_version text, ordinal int, locator jsonb, text text,
               audience text, extracted_at timestamptz, rank real)
language sql stable security invoker set search_path = public, pg_catalog as $$
  with q as (select nullif(replace(plainto_tsquery('english', coalesce(p_query, ''))::text, ' & ', ' | '), '')::tsquery as tsq)
  select p.id, p.source, p.item_id, p.doc_version, p.ordinal, p.locator, p.text, p.audience, p.extracted_at,
         ts_rank_cd(p.tsv, q.tsq, 32) as rank
  from sam_passages p, q
  where q.tsq is not null and p.tsv @@ q.tsq and p.audience = any(p_audiences)
  order by rank desc, p.id
  limit least(greatest(coalesce(p_limit, 60), 1), 200)
$$;

-- One document's passages, replaced in one transaction: a search never sees half an edition.
-- p_rows: [{ordinal, locator, text, audience, doc_version, extractor}]. Returns the rows written.
create or replace function sam_passages_replace(p_source text, p_rows jsonb)
returns int language plpgsql security invoker set search_path = public, pg_catalog as $$
declare n int;
begin
  delete from sam_passages where source = p_source;
  insert into sam_passages (id, source, item_id, doc_version, ordinal, locator, text, audience, extractor)
  select p_source || '#' || r.ordinal, p_source, (select c.item_id from sam_asset_cards c where c.source = p_source),
         r.doc_version, r.ordinal, coalesce(r.locator, '{}'), r.text, r.audience, r.extractor
  from jsonb_to_recordset(coalesce(p_rows, '[]')) as r(ordinal int, locator jsonb, text text, audience text, doc_version text, extractor text);
  get diagnostics n = row_count;
  return n;
end $$;

-- KnowledgeStatus.index_built_at and the API's `index` block.
create or replace function sam_passages_stats()
returns table (built_at timestamptz, documents bigint, passages bigint, internal_passages bigint)
language sql stable security invoker set search_path = public, pg_catalog as $$
  select max(extracted_at), count(distinct source), count(*), count(*) filter (where audience = 'internal') from sam_passages
$$;

revoke execute on function sam_passages_search(text, text[], int), sam_passages_replace(text, jsonb), sam_passages_stats()
  from public, anon, authenticated;
grant execute on function sam_passages_search(text, text[], int), sam_passages_replace(text, jsonb), sam_passages_stats()
  to service_role;

-- Rollback (nothing else depends on it):
--   drop function if exists sam_passages_search(text, text[], int), sam_passages_replace(text, jsonb), sam_passages_stats();
--   drop table if exists sam_passages;
