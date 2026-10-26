-- SAM website chatbot, stage 1: the public surface. Migration name sam_web_02_public. Needs 01.
-- NOT APPLIED. Awaiting Siddharth's approval (docs/plans/web-s1-a-APPROVAL.md). Record the date here when applied.
-- Safe to run twice.
--
-- The boundary, the sam_v1_public_assets way: owner-rights (security definer) row functions do the filtering,
-- security_invoker views sit on top, and sam_web_reader may read the views and call the functions, nothing
-- underneath. Each view exposes only columns a visitor may see.
--
--   sam_web_qa_public      approved, sourced, not past review_by, nothing blocked
--   sam_web_pages_public   allowlisted hosts, not needs_recard, blocked facts removed, blocked summary sentences cut
--   sam_web_assets_public  sam_v1_public_assets minus Regulation / Third-Party Research, blocked titles removed
--   sam_web_roots(page_url) / sam_web_children(qa_id) / sam_web_search(q, page_group, k)   read RPCs

-- ---------------------------------------------------------------- row functions

create or replace function sam_web_qa_rows()
returns table (id text, question text, aliases text[], answer text, visual text, visual_data jsonb, pages text[],
               parent_id text, nudge_weight int, regions text[], cta text, cta_url text, sources text[], updated_at timestamptz)
language sql stable security definer set search_path = public, pg_catalog as $$
  with b as (select coalesce(string_agg('(' || pattern || ')', '|'), 'a^') as rx from sam_web_blocked_patterns)
  select q.id, q.question, q.aliases, q.answer, q.visual, q.visual_data - 'figures_approved', q.pages, q.parent_id,
         q.nudge_weight, q.regions, q.cta, q.cta_url, q.sources, q.updated_at
  from sam_web_qa q, b
  where q.status = 'approved' and cardinality(q.sources) > 0 and (q.review_by is null or q.review_by >= current_date)
    and q.question !~* b.rx and q.answer !~* b.rx and coalesce(q.visual_data::text, '') !~* b.rx
  order by q.id
$$;

create or replace function sam_web_page_rows()
returns table (url text, title text, page_type text, page_group text, products text[], industries text[], summary text,
               facts jsonb, questions_answered text[], cta text, lastmod date, thumb_url text, updated_at timestamptz)
language sql stable security definer set search_path = public, pg_catalog as $$
  with b as (select coalesce(string_agg('(' || pattern || ')', '|'), 'a^') as rx from sam_web_blocked_patterns)
  select p.url, p.title, p.page_type, p.page_group, p.products, p.industries,
         (select string_agg(s, ' ' order by n) from regexp_split_to_table(p.summary, '(?<=[.!?])\s+') with ordinality t(s, n)
          where s !~* b.rx),
         coalesce((select jsonb_agg(jsonb_build_object('fact', f ->> 'fact', 'quote', f ->> 'quote') order by n)
                   from jsonb_array_elements(p.facts) with ordinality e(f, n)
                   where coalesce(f ->> 'fact', '') !~* b.rx and coalesce(f ->> 'quote', '') !~* b.rx), '[]'::jsonb),
         array(select x from unnest(p.questions_answered) x where x !~* b.rx),
         p.cta, p.lastmod, p.thumb_url, p.updated_at
  from sam_web_pages p, b
  where not p.needs_recard
    and p.url ~* '^https://(www\.accops\.com|accops-citrix-lp\.vercel\.app)([/?#]|$)'
    and p.title !~* b.rx
  order by p.url
$$;

-- Only what the DocCard needs: never client, key_outcomes or anything internal.
create or replace function sam_web_asset_rows()
returns table (asset_id text, title text, asset_type text, industry text, products text[], brief text, publish_year int,
               public_url text, updated_at timestamptz)
language sql stable security definer set search_path = public, pg_catalog as $$
  with b as (select coalesce(string_agg('(' || pattern || ')', '|'), 'a^') as rx from sam_web_blocked_patterns)
  select a.asset_id, a.title, a.asset_type, a.industry, a.products,
         (select string_agg(s, ' ' order by n) from regexp_split_to_table(a.brief, '(?<=[.!?])\s+') with ordinality t(s, n)
          where s !~* b.rx),
         a.publish_year, a.public_url, a.updated_at
  from sam_v1_public_asset_rows() a, b
  where lower(a.asset_type) not in ('regulation', 'third-party research')
    and a.title !~* b.rx
  order by a.title, a.asset_id
$$;

create or replace view sam_web_qa_public with (security_invoker = true) as select * from sam_web_qa_rows();
create or replace view sam_web_pages_public with (security_invoker = true) as select * from sam_web_page_rows();
create or replace view sam_web_assets_public with (security_invoker = true) as select * from sam_web_asset_rows();

-- ---------------------------------------------------------------- read RPCs

-- Root questions for a page: its group's roots, or the 'general' roots when the group has none.
create or replace function sam_web_roots(page_url text)
returns table (id text, question text, nudge_weight int)
language sql stable security definer set search_path = public, pg_catalog as $$
  with g as (select sam_web_page_group(sam_web_roots.page_url) as g),
  r as (select q.id, q.question, q.nudge_weight, q.pages from sam_web_qa_rows() q where q.parent_id is null),
  own as (select r.* from r, g where g.g = any(r.pages))
  select id, question, nudge_weight from own
  union all
  select r.id, r.question, r.nudge_weight from r where 'general' = any(r.pages) and not exists (select 1 from own)
  order by nudge_weight desc, id
$$;

create or replace function sam_web_children(qa_id text)
returns table (id text, question text, nudge_weight int)
language sql stable security definer set search_path = public, pg_catalog as $$
  select q.id, q.question, q.nudge_weight from sam_web_qa_rows() q
  where q.parent_id = sam_web_children.qa_id
  order by q.nudge_weight desc, q.id
$$;

-- Candidates for the model (contracts.ts Candidate), at most 12, best first. Refs:
--   qa:<id>   fact:<page url>#<n> (n = 1-based index into sam_web_pages_public.facts; split at the LAST '#')
--   page:<url>   asset:<asset_id>
-- Score = full-text rank (any word) + trigram word similarity to the title (catches typos) + 0.1 for the page's
-- own group. A row needs a word hit or a title similarity >= 0.5. text is cut to 300 chars.
create or replace function sam_web_search(q text, page_group text default 'general', k int default 12)
returns table (ref text, kind text, types text[], title text, text text, url text, score real)
language sql stable security definer set search_path = public, extensions, pg_catalog as $$
  with a as (
    select left(coalesce(sam_web_search.q, ''), 500) as q,
           coalesce(sam_web_search.page_group, 'general') as g,
           greatest(1, least(coalesce(sam_web_search.k, 12), 12)) as k,
           nullif(replace(plainto_tsquery('english', left(coalesce(sam_web_search.q, ''), 500))::text, ' & ', ' | '), '')::tsquery as tsq
  ),
  pr as (select * from sam_web_page_rows()),
  c as (
    select 'qa:' || r.id as ref, 'qa' as kind,
           array['text'] || case when r.visual in ('doc_card', 'compare_table', 'steps', 'stat', 'picker') then array[r.visual] else '{}'::text[] end as types,
           r.question as title, r.answer as body, r.sources[1] as url, r.pages as groups,
           r.question || ' ' || array_to_string(r.aliases, ' ') || ' ' || r.answer as doc
    from sam_web_qa_rows() r
    union all
    select 'fact:' || p.url || '#' || f.n, 'fact', array['text'], p.title, f.e ->> 'quote', p.url, array[p.page_group],
           p.title || ' ' || (f.e ->> 'fact')
    from pr p, jsonb_array_elements(p.facts) with ordinality f(e, n)
    union all
    select 'page:' || p.url, 'page', array['doc_card'], p.title, coalesce(p.summary, ''), p.url, array[p.page_group],
           p.title || ' ' || coalesce(p.summary, '')
    from pr p
    union all
    select 'asset:' || x.asset_id, 'asset', array['doc_card'], x.title, coalesce(x.brief, ''), x.public_url, '{}'::text[],
           x.title || ' ' || x.asset_type || ' ' || coalesce(x.brief, '')
    from sam_web_asset_rows() x
  ),
  s as (
    select c.*, coalesce(to_tsvector('english', c.doc) @@ a.tsq, false) as hit, word_similarity(a.q, c.title) as ws,
           coalesce(ts_rank_cd(to_tsvector('english', c.doc), a.tsq), 0) as rank, a.g
    from c, a
  )
  select s.ref, s.kind, s.types, s.title, left(s.body, 300), s.url,
         (s.rank + s.ws + case when s.g = any(s.groups) then 0.1 else 0 end)::real as score
  from s
  where s.hit or s.ws >= 0.5
  order by score desc, s.ref
  limit (select k from a)
$$;

-- ---------------------------------------------------------------- access

revoke all on sam_web_qa_public, sam_web_pages_public, sam_web_assets_public from public, anon, authenticated;
grant select on sam_web_qa_public, sam_web_pages_public, sam_web_assets_public to sam_web_reader, service_role;

revoke execute on function sam_web_qa_rows(), sam_web_page_rows(), sam_web_asset_rows(), sam_web_roots(text),
  sam_web_children(text), sam_web_search(text, text, int) from public, anon, authenticated;
-- The views check the session's rights on their row functions, so the reader needs EXECUTE on those too.
grant execute on function sam_web_qa_rows(), sam_web_page_rows(), sam_web_asset_rows(), sam_web_page_group(text),
  sam_web_roots(text), sam_web_children(text), sam_web_search(text, text, int) to sam_web_reader, service_role;
