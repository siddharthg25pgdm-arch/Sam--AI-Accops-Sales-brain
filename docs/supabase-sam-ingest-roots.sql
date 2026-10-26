-- SAM ingestion roots: more than one SharePoint folder, as configuration rather than code.
-- Project: iwqhayuoxnrhqzozznes (shared - sam_ objects only). NOT APPLIED. Written 26 October 2026 on branch
-- claude/ingestion-folders; see docs/plans/2026-10-26-ingestion-roots-and-hardening.md for the order of steps.
--
-- Apply BEFORE deploying the branch: the web code writes and filters sam_sharepoint_files.root. Everything
-- here is additive (one table, one column with a default, one index) except part 3, which replaces the
-- sam_asset_families view with the same view plus two rules. After applying, run from web/:
--   node scripts/family-parity.mjs      (TS vs SQL eligibility; expect 0 differences)
--
-- Why a table: four readers need the list - the change and snapshot routes (which folder a path is in),
-- carding_prep.py (where the folder is synced on the laptop), the families view (whether a folder's file
-- dates mean anything), and the admin pages. The Power Automate flows mirror it by hand (the plan has the
-- exact edits): adding a folder = one row here + those flow edits + Siddharth's OneDrive shortcut.

-- ---------------------------------------------------------------- 1. the roots

create table if not exists sam_ingest_roots (
  key               text primary key,                 -- stable id, stored on every registry row
  label             text not null,                    -- how a rep is told where a file lives
  library_path      text not null unique,             -- library-relative, as Power Automate's {Path} says it
  onedrive_folder   text,                             -- folder name under %USERPROFILE%\OneDrive - Accops Systems Private Limited
  -- False when SharePoint's created/modified dates are copy dates (a folder bulk-uploaded in one go): then
  -- only a year read from the document body makes a file eligible, never the file date (part 3).
  trust_file_dates  boolean not null default true,
  enabled           boolean not null default true,    -- false: changes and snapshots for it are ignored
  added_at          timestamptz not null default now(),
  note              text
);
alter table sam_ingest_roots enable row level security;   -- no policies: service role only, like every sam_ table

insert into sam_ingest_roots (key, label, library_path, onedrive_folder, trust_file_dates, enabled, note) values
  ('sales-collateral', 'Sales Collateral', 'Shared Documents/Sales/Sales Collateral', 'Company - Sales Collateral', true, true,
   'The original root, since 6 Sep 2026.'),
  -- Every file here was copied in on 15 Jan 2026 (ListFolder, 26 Oct 2026: LastModified 2026-01-15T09:43:26Z on
  -- almost every file), so its dates say nothing about when a document was written. Disabled until Siddharth
  -- approves and the flows are edited; flip enabled to true as the last step.
  ('sales-enablement', 'Other Sales Tools/2025_Sales Enablement', 'Shared Documents/Sales/Other Sales Tools/2025_Sales Enablement',
   'Company - 2025_Sales Enablement', false, false, 'Added 26 Oct 2026 (Siddharth). Sales tools: playbooks, cheat sheets, discovery docs, short decks, case studies.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- 2. which root each registry row is under

-- Every existing row is Sales Collateral's, so the default backfills them in one statement. `folder` keeps its
-- meaning: the path inside the row's root.
alter table sam_sharepoint_files add column if not exists root text not null default 'sales-collateral'
  references sam_ingest_roots (key);
-- (root, folder, filename) is how a change without a list item id finds its row; folder alone stops being
-- unique the moment two roots both have an "Industries/Banking".
create index if not exists sam_sp_root_folder_idx on sam_sharepoint_files (root, folder, filename);

-- ---------------------------------------------------------------- 3. sam_asset_families, plus two rules

-- The view from docs/supabase-sam-asset-families.sql, unchanged except the lines marked NEW. Mirrors
-- eligibility() in web/lib/cards.ts on the branch:
--   a. A card whose own file is gone and has no live copy (the card_docs branch) no longer answers:
--      deleted -> out, beats a pin; in an archive folder -> out unless pinned. Measured 26 Oct 2026: 9
--      eligible assets change, all bound to rows in zCase Studies (Archive_DONOTUSE), _archieve(d) or
--      Gartner Peer Insight archive folders (family-parity.mjs against the current view: exactly these 9).
--   b. A root whose file dates are copy dates (sam_ingest_roots.trust_file_dates = false): a file's
--      modified date is not used as its year, so an uncarded or undated file there is "year unknown"
--      until carding reads a year from the body. No row has such a root until sales-enablement is enabled.
-- Column order of the view is unchanged, so sam_v1_assets and sam_carding_queue (which read it) need nothing.
create or replace view sam_asset_families with (security_invoker = true) as
with recursive f as (
  select s.item_id, s.folder, s.filename, s.modified_at, s.asset_type, s.stem, s.fam_key, s.fam_edition, s.fam_version, s.fam_outdated,
         coalesce(ir.trust_file_dates, true) as trust_dates                            -- NEW: the root's file dates mean something
  from sam_sharepoint_files s left join sam_ingest_roots ir on ir.key = s.root
  where s.scope = 'sales' and s.status = 'active' and not s.deleted
    and lower(coalesce(s.ext, '')) not in ('tmp', 'lnk', 'csv')   -- registry-cache.ts JUNK_EXT
),
-- A card belongs to a live file by its binding, else by stem (the app's merge rule). Two equi-joins,
-- not one OR-join, so both are hash joins.
cf as (
  select distinct on (x.stem) x.stem, x.source, x.publish_year, x.asset_type, x.sup_stem, x.item_id, x.empty
  from (
    select f.stem, c.source, c.publish_year, c.asset_type, c.sup_stem, c.item_id, 0 as pri, c.carded_at, sam_card_says_empty(c.confidence, c.needs_human) as empty from f join sam_asset_cards c on c.item_id = f.item_id
    union all
    select f.stem, c.source, c.publish_year, c.asset_type, c.sup_stem, c.item_id, 1, c.carded_at, sam_card_says_empty(c.confidence, c.needs_human) from f join sam_asset_cards c on c.stem = f.stem
  ) x order by x.stem, x.pri, x.carded_at desc
),
reg_docs as (   -- one document per stem: PDF/PPTX twins and same-name copies are one
  select distinct on (f.stem) f.stem, f.filename as name, f.fam_key, f.fam_edition, f.fam_version, f.fam_outdated,
         max(f.modified_at) over (partition by f.stem) as modified, f.asset_type[1] as reg_type,
         array_agg(f.item_id) over (partition by f.stem) as item_ids,
         bool_or(f.trust_dates) over (partition by f.stem) as trust_dates                -- NEW: any copy with real dates
  from f order by f.stem, f.modified_at desc nulls last
),
card_docs as (  -- cards with no live file: public-only cards, cards whose file was archived
  select distinct on (c.stem) c.stem, c.filename as name, c.fam_key, c.fam_edition, c.fam_version, c.fam_outdated,
         c.source, c.publish_year, c.asset_type, c.sup_stem, c.item_id, sam_card_says_empty(c.confidence, c.needs_human) as empty,
         -- NEW: the card's own file is gone (bound row deleted, or filed in an archive folder). cards.ts fileGone().
         (select case when s.deleted then 'deleted' when s.status <> 'active' then 'archived' end
            from sam_sharepoint_files s where s.item_id = c.item_id) as gone
  from sam_asset_cards c
  where not exists (select 1 from f where f.item_id = c.item_id) and not exists (select 1 from f where f.stem = c.stem)
  order by c.stem, c.carded_at desc
),
docs0 as (
  select r.stem, r.name, r.fam_key, r.fam_edition, r.fam_version, r.fam_outdated, r.modified, r.item_ids, cf.source,
         case when cf.publish_year ~ '^[0-9]{4}$' then cf.publish_year::int end as publish_year,
         coalesce(cf.asset_type, r.reg_type, '') as asset_type, cf.sup_stem, cf.source is not null as carded, coalesce(cf.empty, false) as empty,
         r.trust_dates, null::text as gone
  from reg_docs r left join cf on cf.stem = r.stem
  union all
  select d.stem, d.name, d.fam_key, d.fam_edition, d.fam_version, d.fam_outdated, null, case when d.item_id is null then '{}'::text[] else array[d.item_id] end, d.source,
         case when d.publish_year ~ '^[0-9]{4}$' then d.publish_year::int end, coalesce(d.asset_type, ''), d.sup_stem, true, d.empty,
         true, d.gone
  from card_docs d
),
docs as (
  select d.*, coalesce(o.family_key, d.fam_key) as own_key,
         case when o.exclude then coalesce(nullif(o.reason, ''), 'excluded by hand')
              when d.gone = 'deleted' then 'the file was deleted in SharePoint' end as human_out,      -- NEW: deleted beats a pin
         coalesce(d.publish_year, case when d.trust_dates then extract(year from d.modified)::int end) as year,   -- NEW: copy dates are no year
         exists (select 1 from sam_asset_pins p where p.asset_key = any (array(select 'id:' || i from unnest(d.item_ids) i) || ('path:' || coalesce(d.source, '')))) as pinned
  from docs0 d left join sam_asset_family_overrides o on o.stem = d.stem
),
-- Out first (a human exclusion, or a card saying the file is empty: beats a pin), then the pre-2024 rule
-- with its exceptions: dated records and, owner 30 Sep, brand assets (logos, icons, signatures).
docs_el as (
  select d.*,
         (d.human_out is null and not d.empty and (d.pinned or (d.gone is distinct from 'archived'
            and (d.asset_type ~* 'certif|analyst report|regulation|third-party research|brand' or coalesce(d.year >= 2024, false))))) as eligible,
         case when d.human_out is not null then d.human_out
              when d.empty then 'the card says the file is empty'
              when d.pinned then null
              when d.gone = 'archived' then 'the file is in an archive folder in SharePoint'            -- NEW: pinnable
              when d.asset_type ~* 'certif|analyst report|regulation|third-party research|brand' or coalesce(d.year >= 2024, false) then null
              when d.publish_year is not null then 'published ' || d.publish_year
              when d.year is not null then 'year unknown, last modified ' || d.year
              when not d.trust_dates then 'year unknown: this folder''s file dates are copy dates'  -- NEW
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
