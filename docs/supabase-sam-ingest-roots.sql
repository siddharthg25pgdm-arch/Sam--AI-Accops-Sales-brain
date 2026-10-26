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
