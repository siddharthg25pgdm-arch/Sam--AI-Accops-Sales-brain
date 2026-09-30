-- The Accops Sales Brain read model, version 1. Applied 30 September 2026 as migration sam_v1_brain.
-- Project: iwqhayuoxnrhqzozznes (shared - sam_ objects only). Contract for tool builders:
-- docs/SALES-BRAIN-PLATFORM.md (every column below is documented there).
--
-- Why a versioned layer. SAM chat, the digest, MCP, WhatsApp, the Dwight extension and the future website
-- bot all need the same answers to "which documents exist, which copy is current, may answers use it, may
-- a customer see it, what changed". Those rules live in sam_asset_families + the cards + the registry. The
-- v1 views are the one stable shape over them: a later change to a table or a rule changes the view body,
-- never a v1 column's name or meaning. A breaking change ships as v2 next to v1.
--
-- Contents:
--   sam_test_users             test identities, for SQL that must exclude test traffic (mirrors SAM_TEST_USERS)
--   sam_change_log + triggers  what changed and when: files, cards, content requests (trigger-fed)
--   sam_v1_assets              one row per asset (live registry file, or a card with no live file)
--   sam_v1_families            one row per document family
--   sam_v1_changes             the change feed: the log + ratings, newest last, keyset-pageable
--   sam_v1_public_assets       ONLY what a customer may see; the website's whole world
--   role sam_web_reader        SELECT on sam_v1_public_assets and nothing else

-- ---------------------------------------------------------------- test identities

-- web/lib/events.ts testUsers() reads SAM_TEST_USERS (default dwight-test,dwight-siddharth). SQL that runs
-- without the app (the rollup's default, the change feed) reads this table. Keep the two in step.
create table if not exists sam_test_users (
  user_id  text primary key,              -- lowercase
  note     text not null default '',
  added_at timestamptz not null default now()
);
alter table sam_test_users enable row level security;
insert into sam_test_users (user_id, note) values
  ('dwight-test', 'the eval harness'), ('dwight-siddharth', 'API token used only for testing (25 Sep 2026)')
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------- the change log

-- One row per change, written by triggers on the tables the flows and jobs already write, so no caller
-- has to remember to log. clock_timestamp(), not now(): a snapshot tombstoning 40 rows in one statement
-- gives 40 distinct times, and the feed pages by (at, change_id).
create table if not exists sam_change_log (
  id        bigserial primary key,
  at        timestamptz not null default clock_timestamp(),
  entity    text not null,               -- file | card | request
  entity_id text not null,               -- file/card: the v1 asset_id ('id:<item_id>' or 'path:<card source>'); request: 'request:<id>'
  change    text not null,               -- see sam_v1_changes below
  detail    jsonb not null default '{}'
);
create index if not exists sam_change_log_at_idx on sam_change_log (at, id);
alter table sam_change_log enable row level security;

create or replace function sam_log_file_change() returns trigger language plpgsql as $$
declare base jsonb;
begin
  base := jsonb_build_object('filename', new.filename, 'folder', new.folder, 'scope', new.scope);
  if tg_op = 'INSERT' then
    insert into sam_change_log (entity, entity_id, change, detail) values ('file', 'id:' || new.item_id, 'added', base);
    return new;
  end if;
  if new.deleted and not old.deleted then
    insert into sam_change_log (entity, entity_id, change, detail) values ('file', 'id:' || new.item_id, 'deleted', base);
  elsif old.deleted and not new.deleted then
    insert into sam_change_log (entity, entity_id, change, detail) values ('file', 'id:' || new.item_id, 'restored', base);
  end if;
  if new.filename is distinct from old.filename then
    insert into sam_change_log (entity, entity_id, change, detail) values ('file', 'id:' || new.item_id, 'renamed', base || jsonb_build_object('from', old.filename));
  end if;
  if new.folder is distinct from old.folder then
    insert into sam_change_log (entity, entity_id, change, detail) values ('file', 'id:' || new.item_id, 'moved', base || jsonb_build_object('from', old.folder));
  end if;
  if new.status is distinct from old.status then
    insert into sam_change_log (entity, entity_id, change, detail) values ('file', 'id:' || new.item_id, 'status', base || jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if new.modified_at is distinct from old.modified_at and not new.deleted then
    insert into sam_change_log (entity, entity_id, change, detail) values ('file', 'id:' || new.item_id, 'modified', base || jsonb_build_object('modified_at', new.modified_at, 'modified_by', new.modified_by));
  end if;
  return new;
end $$;
drop trigger if exists sam_file_changes on sam_sharepoint_files;
create trigger sam_file_changes after insert or update on sam_sharepoint_files
  for each row execute function sam_log_file_change();

-- A card changes when its content does: carded_at moves only when card_hash does (load_cards.py).
create or replace function sam_log_card_change() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.carded_at is distinct from old.carded_at then
    insert into sam_change_log (entity, entity_id, change, detail) values ('card',
      coalesce('id:' || new.item_id, 'path:' || new.source), case when tg_op = 'INSERT' then 'card_created' else 'card_updated' end,
      jsonb_build_object('title', new.title, 'source', new.source, 'batch', new.batch));
  end if;
  return new;
end $$;
drop trigger if exists sam_card_changes on sam_asset_cards;
create trigger sam_card_changes after insert or update on sam_asset_cards
  for each row execute function sam_log_card_change();

create or replace function sam_log_request_change() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into sam_change_log (entity, entity_id, change, detail) values ('request', 'request:' || new.id, 'request_created',
      jsonb_build_object('title', new.title, 'status', new.status, 'source', new.source, 'is_test', new.is_test));
  elsif new.status is distinct from old.status then
    insert into sam_change_log (entity, entity_id, change, detail) values ('request', 'request:' || new.id, 'request_status',
      jsonb_build_object('title', new.title, 'from', old.status, 'to', new.status, 'is_test', new.is_test,
                         'delivered_url', new.delivered_url, 'merged_into', new.merged_into));
  end if;
  return new;
end $$;
drop trigger if exists sam_request_changes on sam_content_requests;
create trigger sam_request_changes after insert or update on sam_content_requests
  for each row execute function sam_log_request_change();

-- Backfill once from the timestamps the tables already hold (only when the log is empty, so re-running
-- this file is harmless). Renames, moves and modifications before today were never recorded anywhere.
do $$ begin
  if not exists (select 1 from sam_change_log) then
    insert into sam_change_log (at, entity, entity_id, change, detail)
      select first_seen, 'file', 'id:' || item_id, 'added', jsonb_build_object('filename', filename, 'folder', folder, 'scope', scope, 'backfilled', true) from sam_sharepoint_files
      union all
      select deleted_at, 'file', 'id:' || item_id, 'deleted', jsonb_build_object('filename', filename, 'folder', folder, 'scope', scope, 'backfilled', true) from sam_sharepoint_files where deleted and deleted_at is not null
      union all
      select carded_at, 'card', coalesce('id:' || item_id, 'path:' || source), 'card_created', jsonb_build_object('title', title, 'source', source, 'batch', batch, 'backfilled', true) from sam_asset_cards
      union all
      select created_at, 'request', 'request:' || id, 'request_created', jsonb_build_object('title', title, 'status', 'open', 'source', source, 'is_test', is_test, 'backfilled', true) from sam_content_requests
      union all
      select closed_at, 'request', 'request:' || id, 'request_status', jsonb_build_object('title', title, 'from', null, 'to', status, 'is_test', is_test, 'backfilled', true) from sam_content_requests where closed_at is not null
      order by 1;
  end if;
end $$;

-- ---------------------------------------------------------------- v1 read model

-- One row per asset: every live Sales Collateral file (status active, not deleted, no temp/shortcut/CSV) and
-- every card with no live file (public-bucket cards, cards whose file was archived). PDF/PPTX twins are two
-- assets with one document_key. Never carries client_actual (real customer names): no tool needs them.
create or replace view sam_v1_assets with (security_invoker = true) as
select
  a.member_key                                                        as asset_id,
  a.item_id,
  a.source                                                            as card_source,
  coalesce(f.stem, c.stem)                                            as document_key,
  a.family_key,
  a.edition,
  nullif(a.version, '')                                               as version,
  a.version_rank,
  a.is_head                                                           as is_current,
  a.is_canonical                                                      as is_family_lead,
  a.superseded,
  a.family_size,
  a.older_versions                                                    as family_older_versions,
  a.eligible,
  a.excluded_reason,
  a.pinned,
  (a.is_head and a.eligible)                                          as answerable,
  case when c.visibility = 'both' and coalesce(c.public_url, '') <> '' then 'public' else 'internal' end as visibility,
  nullif(c.public_url, '')                                            as public_url,
  coalesce(c.public_url ~* '^https://([a-z0-9-]+\.)*accops\.com/', false) as public_url_verified,
  case when f.web_url ilike 'https://propalmsnetwork.sharepoint.com/%'
       then regexp_replace(f.web_url, '([?&])action=edit\y', '\1action=default') end as sharepoint_url,
  coalesce(nullif(c.title, ''), regexp_replace(a.filename, '\.[^.]+$', '')) as title,
  a.filename,
  a.folder,
  lower(coalesce(nullif(f.ext, ''), substring(a.filename from '\.([^.]+)$'))) as ext,
  coalesce(nullif(c.asset_type, ''), f.asset_type[1], 'Other')        as asset_type,
  coalesce(nullif(c.industry, ''), f.industry[1], '')                 as industry,
  coalesce(nullif(c.products, '{}'), f.product, '{}')                 as products,
  coalesce(nullif(c.competitors, '{}'), f.competitor, '{}')           as competitors,
  coalesce(c.regulations, '{}')                                       as regulations,
  coalesce(c.personas, '{}')                                          as personas,
  a.publish_year,
  a.year                                                              as eligibility_year,
  coalesce(c.expired, false)                                          as expired,
  c.expiry_date,
  nullif(c.stale_risk, '')                                            as stale_risk,
  nullif(c.superseded_by, '')                                         as superseded_by,
  a.carded,
  nullif(c.client, '')                                                as client,
  nullif(c.brief, '')                                                 as brief,
  nullif(c.key_problem, '')                                           as key_problem,
  coalesce(c.key_outcomes, '{}')                                      as key_outcomes,
  nullif(c.use_for, '')                                               as use_for,
  c.confidence,
  nullif(c.needs_human, '')                                           as needs_human,
  nullif(c.internal_reason, '')                                       as internal_reason,
  f.size_bytes,
  f.created_at                                                        as file_created_at,
  f.modified_at,
  f.modified_by,
  f.first_seen,
  f.last_synced,
  c.carded_at,
  greatest(f.modified_at, f.last_synced, c.carded_at)                 as updated_at
from sam_asset_families a
left join sam_sharepoint_files f on f.item_id = a.item_id
left join sam_asset_cards c on c.source = a.source;

-- One row per family (every version, re-save and edition of one document).
create or replace view sam_v1_families with (security_invoker = true) as
select
  family_key,
  (array_agg(asset_id order by is_family_lead desc, is_current desc, version_rank, asset_id))[1] as lead_asset_id,
  (array_agg(title    order by is_family_lead desc, is_current desc, version_rank, asset_id))[1] as lead_title,
  (array_agg(filename order by is_family_lead desc, is_current desc, version_rank, asset_id))[1] as lead_filename,
  count(*)::int                                                       as assets,
  count(distinct document_key)::int                                   as documents,
  count(distinct document_key) filter (where not is_current)::int     as older_versions,
  count(*) filter (where answerable)::int                             as answerable_assets,
  bool_or(answerable)                                                 as answerable,
  array_agg(distinct edition order by edition)                        as editions,
  count(distinct document_key) filter (where carded)::int             as carded_documents,
  bool_or(visibility = 'public' and public_url_verified and answerable) as has_public_asset,
  max(updated_at)                                                     as updated_at
from sam_v1_assets
group by family_key;

-- The change feed. Poll with "at > since" (keyset: order by at, change_id). Test traffic excluded.
--   file:    added | modified | renamed (detail.from) | moved (detail.from) | status (active/archived) | deleted | restored
--   card:    card_created | card_updated                       entity_id = the asset_id the card describes
--   request: request_created | request_status (detail.from/to)  entity_id = 'request:<id>'
--   answer:  feedback (detail.feedback = helpful | wrong_asset | missing)  entity_id = 'event:<question event id>'
create or replace view sam_v1_changes with (security_invoker = true) as
select 'log:' || lpad(l.id::text, 12, '0') as change_id, l.at, l.entity, l.entity_id, l.change, l.detail
from sam_change_log l
where not coalesce((l.detail ->> 'is_test')::boolean, false)
union all
select 'event:' || lpad(e.id::text, 12, '0'), e.created_at, 'answer', 'event:' || e.ref_event_id, 'feedback',
       jsonb_build_object('feedback', e.feedback, 'user_id', e.user_id, 'channel', e.channel)
from sam_events e
where e.kind = 'feedback' and not e.is_test
  and not exists (select 1 from sam_test_users t where t.user_id = lower(e.user_id));

-- ---------------------------------------------------------------- the public surface

-- ONLY what a customer may see. Published (card visibility 'both') with an Accops-hosted public_url, the
-- current edition, eligible, not expired, no newer edition recorded. Only non-sensitive columns: never
-- client_actual, needs_human, internal_reason, key_problem, use_for, stale_risk, a SharePoint link, a
-- folder or who edited it. Changing the filter is a visible data change, not a prompt edit.
--
-- The rows come from an owner-rights (security definer) function ON PURPOSE: it is the boundary, so a
-- reader needs no grant on anything underneath. A plain definer view is not enough - sam_v1_assets and
-- sam_asset_families are security_invoker views, which check the SESSION's role (sam_web_reader) even when
-- reached through a definer view; the first proof run failed exactly that way.
create or replace function sam_v1_public_asset_rows()
returns table (asset_id text, family_key text, edition text, title text, asset_type text, industry text, products text[],
               client text, brief text, key_outcomes text[], publish_year int, public_url text, updated_at timestamptz)
language sql stable security definer set search_path = public, pg_catalog as $$
  select asset_id, family_key, edition, title, asset_type, industry, products, client, brief, key_outcomes,
         publish_year, public_url, updated_at
  from sam_v1_assets
  where visibility = 'public' and public_url_verified and answerable and not expired
    and not superseded and superseded_by is null
  order by title, asset_id
$$;
revoke execute on function sam_v1_public_asset_rows() from public, anon, authenticated;
grant execute on function sam_v1_public_asset_rows() to service_role;

create or replace view sam_v1_public_assets with (security_invoker = true) as
select * from sam_v1_public_asset_rows();

-- Nobody reads v1 through the anon/authenticated keys; the app reads with the service key, the website
-- through sam_web_reader. Supabase grants new objects to anon/authenticated by default: take that back.
revoke all on sam_v1_assets, sam_v1_families, sam_v1_changes, sam_v1_public_assets, sam_change_log, sam_test_users from public, anon, authenticated;
grant select on sam_v1_assets, sam_v1_families, sam_v1_changes, sam_v1_public_assets to service_role;

-- The website bot's role (docs/PRD-website-chatbot.md, stage-1 prerequisite). NOLOGIN: it is reached
-- through PostgREST with a JWT whose role claim is sam_web_reader (issuing that key is a human step,
-- docs/SALES-BRAIN-PLATFORM.md). SELECT on the public view and nothing else.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'sam_web_reader') then create role sam_web_reader nologin noinherit; end if;
end $$;
grant usage on schema public to sam_web_reader;
grant select on sam_v1_public_assets to sam_web_reader;
grant execute on function sam_v1_public_asset_rows() to sam_web_reader;
grant sam_web_reader to authenticator;

-- Trigger functions: fixed search_path (Supabase advisor 0011).
alter function sam_log_file_change() set search_path = public, pg_catalog;
alter function sam_log_card_change() set search_path = public, pg_catalog;
alter function sam_log_request_change() set search_path = public, pg_catalog;
