-- SAM document families + answer eligibility. Applied 30 September 2026.
-- Project: iwqhayuoxnrhqzozznes (shared - sam_ objects only).
--
-- The library holds the same document many times: v1/v2/V5, Big/Small/compressed, Final/Draft/(1),
-- bulk-rename date prefixes, PDF+PPTX twins, Confidential vs Sharable, English vs Japanese. A family is
-- every one of them under one key, so any tool on Supabase can ask "is this the newest copy?" and "may
-- answers use it?" - not only SAM's TypeScript.
--
-- THE SAME RULES LIVE IN web/lib/family.ts (parseName, families, isNewer) and web/lib/cards.ts
-- (eligibility). Change one, change both; web/lib/family.check.mjs lists the cases, and
--   select x, sam_family_key(x) from unnest(array['...', '...']) x
-- runs them here.
--
-- Contents:
--   sam_file_stem(name)          the PDF/PPTX twin key (dedupeKey in cards.ts, the carding queue)
--   sam_family_parts(name)       key, edition, version, outdated - from the filename alone
--   stored columns               stem / fam_* on sam_sharepoint_files and sam_asset_cards (computed on write)
--   sam_asset_pins               admin pins: kept in answers despite their age
--   sam_asset_family_overrides   human corrections: this stem belongs to that family
--   sam_asset_families (view)    one row per live registry file and per unbound card
--   sam_carding_queue (view)     rebuilt on the stored stems (hash joins), with the family role

-- ---------------------------------------------------------------- normalisation

create or replace function sam_file_stem(name text) returns text
language sql immutable parallel safe as $$
  select regexp_replace(regexp_replace(lower(coalesce(name, '')), '\.(pdf|pptx?|docx?|xlsx?)$', ''), '[^a-z0-9]', '', 'g')
$$;

-- A filename with everything that marks a version, a date, a re-save or an edition taken out. What
-- stays is what makes a document different: product, customer, city, audience, length ("15min").
create or replace function sam_family_parts(name text, out key text, out edition text, out version int[], out outdated boolean)
language plpgsql immutable parallel safe as $$
declare
  s text := lower(btrim(coalesce(name, '')));
  media text;
  m text[];
  tags text[] := '{}';
  mon constant text := 'jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december';
  dd constant text := '(?:0[1-9]|[12][0-9]|3[01])';
  mm constant text := '(?:0[1-9]|1[0-2])';
  ver constant text := '\yv(?:er(?:sion)?)?\s*[-.]?\s*([0-9]+(?:\.[0-9]+)*)(?![a-z0-9])|\y([0-9]+\.[0-9]+)\y';
begin
  -- A logo as PNG and as JPG are two files a designer picks between, not two versions.
  media := coalesce(substring(s from '(\.(?:png|jpe?g|gif|svg|webp))$'), case when s ~ '\.(mp4|mov|avi|wmv|webm)$' then '.video' else '' end);
  for i in 1..2 loop
    s := regexp_replace(regexp_replace(regexp_replace(s, '\.(pdf|pptx?|docx?|xlsx?|txt|csv|zip)$', ''), '\.(png|jpe?g|gif|svg|webp)$', ''), '\.(mp4|mov|avi|wmv|webm)$', '');
  end loop;
  s := regexp_replace(s, '(?<=[0-9])(pptx|pdf|docx)$', '');                        -- "Version 3.1pptx"
  outdated := s ~ 'outdated';
  s := regexp_replace(regexp_replace(s, '[]_+&,!@#{}[]', ' ', 'g'), '\s+', ' ', 'g');
  -- dates: 2021-01-01-, 2022-08, 16-06-2020, leading 0424-/1009_/251029-/20250426, 05082022, 25 Aug 2026, 21st, '26, 2026
  s := regexp_replace(s, 'v?[0-9]{4}-[0-9]{2}-[0-9]{2}', ' ', 'g');
  s := regexp_replace(s, '\y(?:19|20)[0-9]{2}-(?:0[1-9]|1[0-2])\y', ' ', 'g');
  s := regexp_replace(s, '\y[0-9]{1,2}[-./][0-9]{1,2}[-./][0-9]{2,4}\y', ' ', 'g');
  s := regexp_replace(s, '^(?:' || mm || '[0-9]{2}|' || mm || dd || '|[0-9]{2}' || mm || dd || '|20[0-9]{2}' || mm || dd || ')(?=[^a-z0-9]|$)', ' ');
  s := regexp_replace(s, '(?<![0-9])(?:' || dd || mm || '(?:20)?[0-9]{2}|(?:20)?[0-9]{2}' || mm || dd || ')(?![0-9])', ' ', 'g');
  s := regexp_replace(s, '(?:(?<![0-9.])[0-9]{1,2}(?:st|nd|rd|th)?[\s_-]*)?\y(?:' || mon || ')(?:[\s_-]*''?[0-9]{2}(?:[0-9]{2})?)?(?![a-z])', ' ', 'g');
  s := regexp_replace(s, '\y[0-9]{1,2}(?:st|nd|rd|th)\y', ' ', 'g');
  s := regexp_replace(s, '''[0-9]{2}\y', ' ', 'g');
  s := regexp_replace(s, '\y(?:19|20)[0-9]{2}\y', ' ', 'g');
  -- version: v2, V1.0, Ver02, Version 3.1, v-2.3, a bare 1.0
  m := regexp_match(s, ver);
  version := case when m is null then '{}'::int[] else string_to_array(coalesce(m[1], m[2]), '.')::int[] end;
  s := regexp_replace(s, ver, ' ', 'g');
  -- editions are siblings, not versions: "" is the default (internal/confidential, English, global)
  if s ~ '\y(public|sharable|shareable)\y' then tags := tags || 'sharable'::text; s := regexp_replace(s, '\y(public|sharable|shareable)\y', ' ', 'g'); end if;
  if s ~ '\y(japanese|jp)\y' then tags := tags || 'japanese'::text; s := regexp_replace(s, '\y(japanese|jp)\y', ' ', 'g'); end if;
  if s ~ '\y(for)?japan\y' then tags := tags || 'japan'::text; s := regexp_replace(s, '\y(for)?japan\y', ' ', 'g'); end if;
  if s ~ '\ymea\y' then tags := tags || 'mea'::text; s := regexp_replace(s, '\ymea\y', ' ', 'g'); end if;
  s := regexp_replace(s, '\y(confidential|internal|eng|english)\y', ' ', 'g');
  if 'japanese' = any(tags) then tags := array_remove(tags, 'japan'); end if;
  edition := array_to_string(array(select t from unnest(tags) t order by t collate "C"), ' ');
  -- re-save and variant words; "(1)" is a Windows duplicate, "(14)" a numbered image
  s := regexp_replace(s, '\y(final|draft|copy|compressed|big|small|updated|latest|new|old|outdated|submitted|file|version|with videos)\y|\([0-9]\)', ' ', 'g');
  s := regexp_replace(regexp_replace(s, '\yaccops\y', ' ', 'g'), '\yz\y', ' ', 'g');
  key := regexp_replace(s, '[^a-z0-9]', '', 'g');
  if key = '' then key := regexp_replace(lower(coalesce(name, '')), '[^a-z0-9]', '', 'g'); end if;
  key := key || media;
end $$;

create or replace function sam_family_key(name text) returns text
language sql immutable parallel safe as $$ select (sam_family_parts(name)).key $$;

-- The file a card's superseded_by points at, as a stem. The field reads "sharepoint/<file.ext> - why".
-- The FIRST file: Postgres sets a whole regex's greediness from its first quantifier, so the leading
-- "??" is what makes ".+?" stop at the first extension ("... .docx - see also X.pptx" is the .docx).
create or replace function sam_superseding_stem(superseded_by text) returns text
language sql immutable parallel safe as $$
  select sam_file_stem(regexp_replace((regexp_match(coalesce(superseded_by, ''), '^(?:[a-zA-Z]+/)??(.+?\.(?:pdf|pptx|docx|ppt|doc|xlsx))(?:\s|$)', 'i'))[1], '^.*/', ''))
$$;

-- ---------------------------------------------------------------- stored columns (computed on write)
-- Stored, so reads never re-run the regexes. AFTER CHANGING ANY FUNCTION ABOVE, recompute them:
--   update sam_sharepoint_files set filename = filename;
--   update sam_asset_cards set filename = filename;

alter table sam_sharepoint_files add column if not exists stem text generated always as (sam_file_stem(filename)) stored;
alter table sam_sharepoint_files add column if not exists fam_key text generated always as ((sam_family_parts(filename)).key) stored;
alter table sam_sharepoint_files add column if not exists fam_edition text generated always as ((sam_family_parts(filename)).edition) stored;
alter table sam_sharepoint_files add column if not exists fam_version int[] generated always as ((sam_family_parts(filename)).version) stored;
alter table sam_sharepoint_files add column if not exists fam_outdated boolean generated always as ((sam_family_parts(filename)).outdated) stored;
create index if not exists sam_sp_stem_idx on sam_sharepoint_files (stem);
create index if not exists sam_sp_fam_idx on sam_sharepoint_files (fam_key);

alter table sam_asset_cards add column if not exists stem text generated always as (sam_file_stem(filename)) stored;
alter table sam_asset_cards add column if not exists fam_key text generated always as ((sam_family_parts(filename)).key) stored;
alter table sam_asset_cards add column if not exists fam_edition text generated always as ((sam_family_parts(filename)).edition) stored;
alter table sam_asset_cards add column if not exists fam_version int[] generated always as ((sam_family_parts(filename)).version) stored;
alter table sam_asset_cards add column if not exists fam_outdated boolean generated always as ((sam_family_parts(filename)).outdated) stored;
alter table sam_asset_cards add column if not exists sup_stem text generated always as (sam_superseding_stem(superseded_by)) stored;
create index if not exists sam_cards_stem_idx on sam_asset_cards (stem);

-- ---------------------------------------------------------------- pins and overrides

-- Owner decision, 30 Sep 2026: pre-2024 documents are out of answers unless an admin pins them.
-- asset_key = 'id:<registry item_id>' (survives a rename) or 'path:<card source>' for a card with no file.
create table if not exists sam_asset_pins (
  asset_key  text primary key,
  pinned_by  text not null,
  reason     text,
  created_at timestamptz not null default now()
);
alter table sam_asset_pins enable row level security;

-- A family detection a human corrected: files with this stem (sam_file_stem) belong to family_key.
-- Seeded from the 30 Sep audit, where the card text says two same-named files are different documents.
create table if not exists sam_asset_family_overrides (
  stem       text primary key,
  family_key text not null,
  reason     text not null default '',
  set_by     text not null default '',
  created_at timestamptz not null default now()
);
alter table sam_asset_family_overrides enable row level security;
insert into sam_asset_family_overrides (stem, family_key, reason, set_by) values
  ('accopsindustrysolutionhealthcare', 'industrysolutionhealthcare2pager', 'The 2020 two-page one-pager, not the 43-slide healthcare deck v4', 'claude 30 Sep audit'),
  ('corporatedeck2026', 'corporatekeynote2026', 'A 20-slide CEO/CTO keynote (Jun 2026), not an edition of the corporate presentation', 'claude 30 Sep audit'),
  ('accopshysecureproductv2', 'workfromanywhereportfoliodeck2021', 'Card: "despite the file name, this is the 2021 Work from Anywhere portfolio deck", not the HySecure product deck', 'claude 30 Sep audit'),
  ('v20260904accopspartnerbootcampeventdeckjapanesev40', 'partnerbootcampeventdeck4hour', 'The Japanese-language edition of the 4-hour partner bootcamp deck (filename lacks "4Hour")', 'claude 30 Sep audit'),
  ('reviewaccessmanagementaccopsaccopshyiddisplay1', 'reviewaccessmanagementhyiddisplay1', 'A different Gartner Peer Insights review, not a Windows duplicate', 'claude 30 Sep audit'),
  ('reviewdesktopasaserviceaccopsaccopshyworksdisplay1', 'reviewdesktopasaservicehyworksdisplay1', 'A different Gartner Peer Insights review, not a Windows duplicate', 'claude 30 Sep audit')
on conflict (stem) do nothing;

-- ---------------------------------------------------------------- the view

-- True when document b is newer than document a. Mirrors isNewer() in family.ts: superseded and
-- outdated sink; eligible first; publication year when both state one; version when both carry one;
-- modified; carded; name in code-point order. Pairwise and partial, so ranks are "how many members
-- are newer than me" - identical in both languages.
create or replace function sam_family_newer(
  b_sup boolean, b_out boolean, b_el boolean, b_py int, b_ver int[], b_mod timestamptz, b_card boolean, b_name text,
  a_sup boolean, a_out boolean, a_el boolean, a_py int, a_ver int[], a_mod timestamptz, a_card boolean, a_name text)
returns boolean language sql immutable parallel safe as $$
  select case
    when b_sup <> a_sup then a_sup
    when b_out <> a_out then a_out
    when b_el <> a_el then b_el
    when b_py is not null and a_py is not null and b_py <> a_py then b_py > a_py
    when cardinality(b_ver) > 0 and cardinality(a_ver) > 0 and b_ver <> a_ver then b_ver > a_ver
    when coalesce(b_mod, '-infinity') <> coalesce(a_mod, '-infinity') then coalesce(b_mod, '-infinity') > coalesce(a_mod, '-infinity')
    when b_card <> a_card then b_card
    else b_name collate "C" < a_name collate "C"
  end
$$;

create or replace view sam_asset_families with (security_invoker = true) as
with recursive f as (
  select item_id, folder, filename, modified_at, asset_type, stem, fam_key, fam_edition, fam_version, fam_outdated
  from sam_sharepoint_files where scope = 'sales' and status = 'active' and not deleted
    and lower(coalesce(ext, '')) not in ('tmp', 'lnk', 'csv')   -- registry-cache.ts JUNK_EXT
),
-- A card belongs to a live file by its binding, else by stem (the app's merge rule). Two equi-joins,
-- not one OR-join, so both are hash joins.
cf as (
  select distinct on (x.stem) x.stem, x.source, x.publish_year, x.asset_type, x.sup_stem, x.item_id
  from (
    select f.stem, c.source, c.publish_year, c.asset_type, c.sup_stem, c.item_id, 0 as pri, c.carded_at from f join sam_asset_cards c on c.item_id = f.item_id
    union all
    select f.stem, c.source, c.publish_year, c.asset_type, c.sup_stem, c.item_id, 1, c.carded_at from f join sam_asset_cards c on c.stem = f.stem
  ) x order by x.stem, x.pri, x.carded_at desc
),
reg_docs as (   -- one document per stem: PDF/PPTX twins and same-name copies are one
  select distinct on (f.stem) f.stem, f.filename as name, f.fam_key, f.fam_edition, f.fam_version, f.fam_outdated,
         max(f.modified_at) over (partition by f.stem) as modified, f.asset_type[1] as reg_type,
         array_agg(f.item_id) over (partition by f.stem) as item_ids
  from f order by f.stem, f.modified_at desc nulls last
),
card_docs as (  -- cards with no live file: public-only cards, cards whose file was archived
  select distinct on (c.stem) c.stem, c.filename as name, c.fam_key, c.fam_edition, c.fam_version, c.fam_outdated,
         c.source, c.publish_year, c.asset_type, c.sup_stem, c.item_id
  from sam_asset_cards c
  where not exists (select 1 from f where f.item_id = c.item_id) and not exists (select 1 from f where f.stem = c.stem)
  order by c.stem, c.carded_at desc
),
docs0 as (
  select r.stem, r.name, r.fam_key, r.fam_edition, r.fam_version, r.fam_outdated, r.modified, r.item_ids, cf.source,
         case when cf.publish_year ~ '^[0-9]{4}$' then cf.publish_year::int end as publish_year,
         coalesce(cf.asset_type, r.reg_type, '') as asset_type, cf.sup_stem, cf.source is not null as carded
  from reg_docs r left join cf on cf.stem = r.stem
  union all
  select d.stem, d.name, d.fam_key, d.fam_edition, d.fam_version, d.fam_outdated, null, case when d.item_id is null then '{}'::text[] else array[d.item_id] end, d.source,
         case when d.publish_year ~ '^[0-9]{4}$' then d.publish_year::int end, coalesce(d.asset_type, ''), d.sup_stem, true
  from card_docs d
),
docs as (
  select d.*, coalesce(o.family_key, d.fam_key) as own_key,
         coalesce(d.publish_year, extract(year from d.modified)::int) as year,
         exists (select 1 from sam_asset_pins p where p.asset_key = any (array(select 'id:' || i from unnest(d.item_ids) i) || ('path:' || coalesce(d.source, '')))) as pinned
  from docs0 d left join sam_asset_family_overrides o on o.stem = d.stem
),
docs_el as (
  select d.*,
         (d.pinned or d.asset_type ~* 'certif|analyst report|regulation|third-party research' or coalesce(d.year >= 2024, false)) as eligible,
         case when d.pinned or d.asset_type ~* 'certif|analyst report|regulation|third-party research' or coalesce(d.year >= 2024, false) then null
              when d.publish_year is not null then 'published ' || d.publish_year
              when d.year is not null then 'year unknown, last modified ' || d.year
              else 'year unknown' end as excluded_reason
  from docs d
),
-- superseded_by: up to three hops to a successor that is here; the superseded joins its family.
chain (origin, cur, hop) as (
  select d.stem, d.sup_stem, 1 from docs_el d
  where d.sup_stem is not null and d.sup_stem <> d.stem and exists (select 1 from docs_el x where x.stem = d.sup_stem)
  union all
  select c.origin, x.sup_stem, c.hop + 1 from chain c join docs_el x on x.stem = c.cur
  where c.hop < 3 and x.sup_stem is not null and x.sup_stem <> c.origin and x.sup_stem <> x.stem and exists (select 1 from docs_el y where y.stem = x.sup_stem)
),
ends as (select distinct on (origin) origin, cur from chain order by origin, hop desc),
fam as (
  select d.*, e.origin is not null as superseded, coalesce(de.own_key, d.own_key) as family_key
  from docs_el d left join ends e on e.origin = d.stem left join docs_el de on de.stem = e.cur
),
beaten as (
  select a.stem,
         count(*) filter (where b.stem <> a.stem and b.fam_edition = a.fam_edition and sam_family_newer(
           b.superseded, b.fam_outdated, b.eligible, b.publish_year, b.fam_version, b.modified, b.carded, b.name,
           a.superseded, a.fam_outdated, a.eligible, a.publish_year, a.fam_version, a.modified, a.carded, a.name)) as in_edition,
         count(*) filter (where b.stem <> a.stem and sam_family_newer(
           b.superseded, b.fam_outdated, b.eligible, b.publish_year, b.fam_version, b.modified, b.carded, b.name,
           a.superseded, a.fam_outdated, a.eligible, a.publish_year, a.fam_version, a.modified, a.carded, a.name)) as in_family
  from fam a join fam b on b.family_key = a.family_key
  group by a.stem
),
ranked as (
  select f.*, b.in_family,
         row_number() over (partition by f.family_key, f.fam_edition order by b.in_edition, f.name collate "C") as version_rank,
         count(*) over (partition by f.family_key) as family_size,
         count(*) filter (where f.carded) over (partition by f.family_key) as carded_in_family
  from fam f join beaten b on b.stem = f.stem
),
heads as (
  select r.*, (r.version_rank = 1 and not r.superseded) as head0,
         bool_or(r.version_rank = 1 and not r.superseded) over (partition by r.family_key) as family_has_head,
         row_number() over (partition by r.family_key order by r.in_family, r.name collate "C") as family_rank
  from ranked r
),
led as (
  select h.*, (h.head0 or (not h.family_has_head and h.family_rank = 1)) as is_head from heads h
),
final as (
  select l.*,
         row_number() over (partition by l.family_key order by (not l.is_head), (case when l.eligible then 0 else 4 end) + (case l.fam_edition when '' then 0 when 'sharable' then 1 else 2 end),
                            l.in_family, l.name collate "C") = 1 as is_canonical,
         count(*) filter (where l.is_head) over (partition by l.family_key) as heads_in_family
  from led l
)
select coalesce('id:' || f.item_id, 'path:' || d.source) as member_key,
       f.item_id, d.source, coalesce(f.filename, d.name) as filename, f.folder,
       d.family_key, d.fam_edition as edition, array_to_string(d.fam_version, '.') as version,
       d.publish_year, d.year, d.family_size::int, d.version_rank::int, d.is_head, d.is_canonical, d.superseded,
       d.eligible, d.excluded_reason, d.pinned, d.carded, (d.family_size - d.heads_in_family)::int as older_versions,
       first_value(d.name) over (partition by d.family_key order by d.is_canonical desc) as canonical_filename,
       d.carded_in_family::int
from final d
left join f on f.stem = d.stem and f.item_id = any (d.item_ids);

-- ---------------------------------------------------------------- the carding queue, rebuilt

-- Same reasons as docs/supabase-sam-carding-queue.sql, on the stored stems: two hash joins instead of
-- a lateral join that re-ran the stem regexes on every card for every file (1.68 s on 30 Sep).
-- New: family_key, family_role and canonical_filename. 'older_version' = an older copy of a family
-- that already has a card (the nightly job skips and logs it); 'new_version' = the newest copy of a
-- family carded from another file (carded first).
drop view if exists sam_carding_queue;
create view sam_carding_queue with (security_invoker = true) as
with f as (
  select item_id, filename, folder, web_url, modified_at, modified_by, stem
  from sam_sharepoint_files
  where scope = 'sales' and not deleted and status = 'active' and suggest_ingest
),
c as (
  select c.item_id, c.carded_at, c.stem as card_stem, coalesce(r.stem, c.stem) as merge_key
  from sam_asset_cards c left join sam_sharepoint_files r on r.item_id = c.item_id and not r.deleted
),
m as (
  select distinct on (x.item_id) x.item_id, x.carded_at, x.bound, x.card_stem
  from (
    select f.item_id, c.carded_at, true as bound, c.card_stem from f join c on c.item_id = f.item_id
    union all
    select f.item_id, c.carded_at, false, c.card_stem from f join c on c.merge_key = f.stem
  ) x order by x.item_id, x.bound desc, x.carded_at desc
),
q as (
  select f.item_id, f.filename, f.folder, f.web_url, f.modified_at, f.modified_by,
         case when m.carded_at is null then 'uncarded'
              when m.bound and m.card_stem <> f.stem then 'renamed'
              when f.modified_at > m.carded_at then 'changed_since_card'
         end as reason,
         m.carded_at as card_updated_at
  from f left join m on m.item_id = f.item_id
)
select q.item_id, q.filename, q.folder, q.web_url, q.modified_at, q.modified_by, q.reason, q.card_updated_at,
       a.family_key,
       case when a.family_key is null or a.family_size = 1 then 'new'
            when not a.is_head and a.carded_in_family > 0 then 'older_version'
            when q.reason = 'uncarded' and a.carded_in_family > 0 then 'new_version'
            else 'new' end as family_role,
       a.canonical_filename
from q left join sam_asset_families a on a.item_id = q.item_id
where q.reason is not null;

-- ---------------------------------------------------------------- hardening (Supabase advisor 0011)
alter function sam_file_stem(text) set search_path = public, pg_catalog;
alter function sam_family_parts(text) set search_path = public, pg_catalog;
alter function sam_family_key(text) set search_path = public, pg_catalog;
alter function sam_superseding_stem(text) set search_path = public, pg_catalog;
alter function sam_family_newer(boolean, boolean, boolean, int, int[], timestamptz, boolean, text, boolean, boolean, boolean, int, int[], timestamptz, boolean, text) set search_path = public, pg_catalog;
