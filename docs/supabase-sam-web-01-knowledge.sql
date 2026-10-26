-- SAM website chatbot, stage 1: the knowledge tables. Migration name sam_web_01_knowledge.
-- NOT APPLIED. Awaiting Siddharth's approval (docs/plans/web-s1-a-APPROVAL.md). Record the date here when applied.
-- Plan: docs/plans/2026-10-26-website-chatbot-stage1.md section 5. Apply order: 01 -> 02 -> 03.
--
-- Additive only: new sam_web_* objects, no change to anything that exists, no trigger on an existing table.
-- Safe to run twice. Every table: RLS on, no policies, nothing granted to public/anon/authenticated.
-- The website role sam_web_reader gets NOTHING here; it reads through the views in 02 and writes through the
-- functions in 03.
--
--   sam_web_qa                the Q&A bank (drafts loaded by prototype/load_web_knowledge.py, approved by a person)
--   sam_web_pages             one card per public page (accops.com + the Citrix LP), facts with verbatim quotes
--   sam_web_page_rules        URL regex -> page group ('citrix-lp', catch-all 'general')
--   sam_web_blocked_patterns  claims that must never reach a visitor until signed off (removed in the public views)
--   sam_web_settings          kill switches, ceilings, CTA, knowledge_version (the answer cache's invalidation stamp)

-- On the shared project pg_trgm is already installed (in schema public: rpc/show_trgm is in the PostgREST index), so
-- this is a no-op there. gin_trgm_ops below is unqualified on purpose: it resolves through the migration session's
-- search_path ("$user", public, extensions) wherever the extension lives.
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------- Q&A bank

create table if not exists sam_web_qa (
  id           text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),     -- slug; a chip id is <= 80 chars
  question     text not null check (char_length(question) between 3 and 200),
  aliases      text[] not null default '{}',
  -- A Text block body is <= 600 chars; the PRD caps an answer at 80 words.
  answer       text not null check (char_length(answer) <= 600 and cardinality(regexp_split_to_array(btrim(answer), '\s+')) <= 80),
  visual       text check (visual in ('text', 'doc_card', 'compare_table', 'steps', 'stat', 'picker', 'calculator', 'cta')),
  visual_data  jsonb check (visual_data is null or jsonb_typeof(visual_data) = 'object'),   -- block props minus type/source
  pages        text[] not null default '{}',                                  -- page groups this pair belongs to
  parent_id    text,                                                          -- null = a root question
  nudge_weight int not null default 0,
  regions      text[] not null default '{}',
  cta          text check (char_length(cta) <= 28),
  cta_url      text check (cta_url ~ '^(https://|#)' and char_length(cta_url) <= 300),
  sources      text[] not null default '{}',                                  -- public URLs; sources[1] is the provenance pill
  status       text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  origin       text not null default 'bank',                                  -- bank | missed | manual
  approved_by  text,
  approved_at  timestamptz,
  review_by    date,                                                          -- past this date the pair leaves the public view
  updated_at   timestamptz not null default now(),
  constraint sam_web_qa_approval check (status <> 'approved' or (approved_by is not null and approved_at is not null)),
  -- The LP's $220 / $132 per seat are placeholders: no calculator pair until Siddharth approves sourced figures.
  constraint sam_web_qa_calculator check (visual is distinct from 'calculator' or visual_data @> '{"figures_approved": true}')
);
create index if not exists sam_web_qa_question_trgm on sam_web_qa using gin (question gin_trgm_ops);
create index if not exists sam_web_qa_parent_idx on sam_web_qa (parent_id);

-- ---------------------------------------------------------------- page cards

create table if not exists sam_web_pages (
  url                text primary key check (url ~ '^https://' and char_length(url) <= 500),
  title              text not null,
  page_type          text,
  page_group         text not null default 'general',                      -- set by trigger from sam_web_page_rules
  products           text[] not null default '{}',
  industries         text[] not null default '{}',
  summary            text,
  facts              jsonb not null default '[]' check (jsonb_typeof(facts) = 'array'),   -- [{fact, quote}], quote verbatim
  questions_answered text[] not null default '{}',
  cta                text,
  lastmod            date,
  content_hash       text,                                                  -- the loader's hash of the row it wrote
  needs_recard       boolean not null default false,
  thumb_url          text,
  fetched_at         timestamptz,
  updated_at         timestamptz not null default now(),
  -- What a visitor may see, derived by the stamp trigger below from sam_web_blocked_patterns (never written by the
  -- loader). Filtering at write time keeps sam_web_search free of ~3,000 regex checks per question.
  case_study         boolean not null default false,                       -- page_type 'case-study' on www.accops.com
  title_blocked      boolean not null default false,
  summary_public     text,                                                  -- summary minus sentences with a blocked claim
  facts_public       jsonb not null default '[]',                           -- facts minus any with a blocked claim
  questions_public   text[] not null default '{}'
);
create index if not exists sam_web_pages_text_trgm on sam_web_pages using gin ((title || ' ' || coalesce(summary, '')) gin_trgm_ops);

-- ---------------------------------------------------------------- page groups

create table if not exists sam_web_page_rules (
  pattern    text primary key,              -- POSIX regex, case-insensitive, matched against the full URL
  page_group text not null,
  priority   int not null default 100       -- lowest wins
);
insert into sam_web_page_rules (pattern, page_group, priority) values
  ('^https://accops-citrix-lp\.vercel\.app([/?#]|$)', 'citrix-lp', 10),
  ('.', 'general', 1000)
on conflict (pattern) do nothing;

-- Owner rights: the rules table is closed to everyone else. Granted to sam_web_reader in 02.
create or replace function sam_web_page_group(url text) returns text
language sql stable security definer set search_path = public, pg_catalog as $$
  select coalesce((select r.page_group from sam_web_page_rules r
                   where left(coalesce(sam_web_page_group.url, ''), 500) ~* r.pattern
                   order by r.priority, r.pattern limit 1), 'general')
$$;
revoke execute on function sam_web_page_group(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- blocked claims

-- A page fact (fact or quote), a page title, a Q&A pair or a public asset title that matches any pattern never
-- reaches a visitor; summary sentences that match are cut. POSIX ARE, case-insensitive. No back-references
-- (the views OR every pattern into one regex). Delete a row once the claim is signed off and sourced.
-- except_case_studies (Siddharth, 26 Oct): figures published in a case study may be shown with that case study as
-- the source. Such a pattern does not apply to a case study (sam_web_is_case_study below); it still applies
-- everywhere else, the Citrix LP included.
create table if not exists sam_web_blocked_patterns (
  pattern             text primary key,
  reason              text not null,
  except_case_studies boolean not null default false,
  added_at            timestamptz not null default now()
);
insert into sam_web_blocked_patterns (pattern, reason, except_case_studies) values
  ('\m10\s?x\M',                                  'unsourced headline tile (accops.com/why-accops: 10x shorter time to value)', true),
  ('\m4\s?x\M',                                   'unsourced headline tile (accops.com/why-accops: 4x reduction in support time)', true),
  ('\m40\s?%',                                    'unsourced headline tile (accops.com/why-accops: 40% lower TCO)', true),
  ('\mTCO\M|total cost of ownership',             'TCO figures outside published case studies (eval trap: "what is the TCO saving?")', true)
on conflict (pattern) do nothing;
insert into sam_web_blocked_patterns (pattern, reason) values
  ('\$\s?(220|132)\M',                            'illustrative per-seat rates on the Citrix LP calculator'),
  ('\millustrative\M|\mplaceholder\M',            'LP placeholder copy and cards that describe it'),
  ('sign-off',                                    'LP copy still awaiting Sales leadership / Legal sign-off'),
  ('mid-term repricing',                          'licensing commitments copy awaiting sign-off'),
  ('reduce seats at renewal',                     'licensing commitments copy awaiting sign-off'),
  ('perpetual licensing remains available',       'licensing commitments copy awaiting sign-off'),
  ('renewal pricing stated upfront',              'licensing commitments copy awaiting sign-off'),
  ('price is fixed for the contract term',        'licensing commitments copy awaiting sign-off'),
  ('terms written into the contract',             'licensing commitments copy awaiting sign-off'),
  ('terms that hold for the life of the contract','licensing commitments copy awaiting sign-off'),
  ('\mgartner\M|magic quadrant|\mMQ\M',           'Gartner wording awaits legal (citation rules)')
on conflict (pattern) do nothing;

-- ---------------------------------------------------------------- settings

create table if not exists sam_web_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
insert into sam_web_settings (key, value) values
  ('enabled',           'true'),     -- false hides the launcher (config is CDN-cached 300 s)
  ('model_enabled',     'true'),     -- false = bank, intent and cache only (instant kill switch)
  ('model_ceiling',     '300'),      -- OpenAI answers per IST day, reserved before each call
  ('groq_daily_cap',    '40'),       -- Groq fallback answers per IST day
  ('repeat_n',          '3'),        -- the nth same question from one visitor ...
  ('repeat_window_min', '10'),       -- ... within this many minutes gets "talk to sales" only
  ('cta_url',           'https://www.accops.com/schedule-a-free-demo'),
  ('cta_label',         'Talk to an expert'),
  ('knowledge_version', now()::text) -- bumped by the triggers below; a cached answer older than this is ignored
on conflict (key) do nothing;

-- ---------------------------------------------------------------- triggers (new tables only)

create or replace function sam_web_bump_knowledge() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
begin
  update sam_web_settings set value = clock_timestamp()::text, updated_at = now() where key = 'knowledge_version';
  return null;
end $$;

create or replace function sam_web_qa_touch() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Every blocked pattern that applies OR-ed into one regex ('a^' never matches). For a case study the
-- except_case_studies patterns (published figures) are left out.
create or replace function sam_web_blocked_rx(case_study boolean default false) returns text
language sql stable set search_path = public, pg_catalog as $$
  select coalesce(string_agg('(' || b.pattern || ')', '|'), 'a^') from sam_web_blocked_patterns b
  where not (coalesce(sam_web_blocked_rx.case_study, false) and b.except_case_studies)
$$;

create or replace function sam_web_pages_stamp() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
declare rx text;
begin
  -- A case study = an accops.com page carded as page_type 'case-study'. The Citrix LP never is.
  new.case_study := coalesce(new.page_type, '') = 'case-study' and new.url ~* '^https://www\.accops\.com/';
  rx := sam_web_blocked_rx(new.case_study);
  new.page_group := sam_web_page_group(new.url);
  new.updated_at := now();
  new.title_blocked := coalesce(new.title, '') ~* rx;
  new.summary_public := (select string_agg(s, ' ' order by n)
                         from regexp_split_to_table(new.summary, '(?<=[.!?])\s+') with ordinality t(s, n) where s !~* rx);
  new.facts_public := coalesce((select jsonb_agg(jsonb_build_object('fact', f ->> 'fact', 'quote', f ->> 'quote') order by n)
                                from jsonb_array_elements(new.facts) with ordinality e(f, n)
                                where coalesce(f ->> 'fact', '') !~* rx and coalesce(f ->> 'quote', '') !~* rx), '[]'::jsonb);
  new.questions_public := array(select x from unnest(new.questions_answered) x where x !~* rx);
  return new;
end $$;

-- A change to the blocked patterns or the page rules re-stamps every page (about 250 rows).
create or replace function sam_web_restamp_pages() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
begin
  update sam_web_pages set url = url;
  return null;
end $$;

drop trigger if exists sam_web_qa_touch on sam_web_qa;
create trigger sam_web_qa_touch before update on sam_web_qa for each row execute function sam_web_qa_touch();
drop trigger if exists sam_web_pages_stamp on sam_web_pages;
create trigger sam_web_pages_stamp before insert or update on sam_web_pages for each row execute function sam_web_pages_stamp();

-- Any change to what the public views can show invalidates every cached answer. Statement-level: one bump per load.
drop trigger if exists sam_web_qa_knowledge on sam_web_qa;
create trigger sam_web_qa_knowledge after insert or update or delete or truncate on sam_web_qa
  for each statement execute function sam_web_bump_knowledge();
drop trigger if exists sam_web_pages_knowledge on sam_web_pages;
create trigger sam_web_pages_knowledge after insert or update or delete or truncate on sam_web_pages
  for each statement execute function sam_web_bump_knowledge();
drop trigger if exists sam_web_blocked_knowledge on sam_web_blocked_patterns;
create trigger sam_web_blocked_knowledge after insert or update or delete or truncate on sam_web_blocked_patterns
  for each statement execute function sam_web_bump_knowledge();
drop trigger if exists sam_web_rules_knowledge on sam_web_page_rules;
create trigger sam_web_rules_knowledge after insert or update or delete or truncate on sam_web_page_rules
  for each statement execute function sam_web_bump_knowledge();
drop trigger if exists sam_web_blocked_restamp on sam_web_blocked_patterns;
create trigger sam_web_blocked_restamp after insert or update or delete or truncate on sam_web_blocked_patterns
  for each statement execute function sam_web_restamp_pages();
drop trigger if exists sam_web_rules_restamp on sam_web_page_rules;
create trigger sam_web_rules_restamp after insert or update or delete or truncate on sam_web_page_rules
  for each statement execute function sam_web_restamp_pages();
-- Cached answers carry the CTA, so a CTA change invalidates them too (no deploy needed to switch to #talk).
drop trigger if exists sam_web_cta_knowledge on sam_web_settings;
create trigger sam_web_cta_knowledge after update on sam_web_settings
  for each row when (new.key in ('cta_url', 'cta_label') and new.value is distinct from old.value)
  execute function sam_web_bump_knowledge();

-- ---------------------------------------------------------------- access

alter table sam_web_qa enable row level security;
alter table sam_web_pages enable row level security;
alter table sam_web_page_rules enable row level security;
alter table sam_web_blocked_patterns enable row level security;
alter table sam_web_settings enable row level security;
-- Supabase grants new objects to anon/authenticated by default: take that back.
revoke all on sam_web_qa, sam_web_pages, sam_web_page_rules, sam_web_blocked_patterns, sam_web_settings from public, anon, authenticated;
revoke execute on function sam_web_blocked_rx(boolean) from public, anon, authenticated;
-- The page trigger runs as the writer (the loader's service key).
grant execute on function sam_web_blocked_rx(boolean), sam_web_page_group(text) to service_role;
-- The loader and the admin tab use the service key.
grant select, insert, update, delete on sam_web_qa, sam_web_pages, sam_web_page_rules, sam_web_blocked_patterns, sam_web_settings to service_role;
