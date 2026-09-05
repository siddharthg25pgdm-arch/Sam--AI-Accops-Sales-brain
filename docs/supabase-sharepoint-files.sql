-- SAM SharePoint file registry. Run once in the Supabase SQL editor, same project as sam_events.
-- Holds WHERE every in-scope document lives, never its contents: SAM hands out links, and the
-- private-asset-body-never-leaves-SharePoint rule (design section 2) depends on that staying true.

create table if not exists sam_sharepoint_files (
  item_id        text primary key,             -- Graph driveItem id: stable across rename and move
  drive_id       text not null,
  scope          text not null,                -- sales | marketing
  folder         text not null default '',     -- path inside the scope root, '' at the root
  filename       text not null,
  ext            text,
  size_bytes     bigint,
  web_url        text not null,                -- the real link. Never construct this.
  created_at     timestamptz,
  modified_at    timestamptz,
  modified_by    text,
  etag           text,                         -- changes on any edit, including metadata only
  ctag           text,                         -- changes only when CONTENT changes: re-card gate
  deleted        boolean not null default false,
  deleted_at     timestamptz,
  suggest_ingest boolean not null default false,
  skip_reason    text,
  first_seen     timestamptz not null default now(),
  last_synced    timestamptz not null default now()
);

create index if not exists sam_sp_scope_idx    on sam_sharepoint_files (scope, deleted);
create index if not exists sam_sp_folder_idx   on sam_sharepoint_files (scope, folder);
create index if not exists sam_sp_modified_idx on sam_sharepoint_files (modified_at desc);

-- Delta cursors and webhook subscriptions, one row per watched drive.
-- Graph drive subscriptions expire in <= 3 days, so the nightly job renews from here.
create table if not exists sam_sharepoint_sync (
  drive_id        text primary key,
  scope           text not null,
  root_folder     text not null,
  delta_link      text,                        -- resume token for the next incremental sync
  subscription_id text,
  expires_at      timestamptz,
  client_state    text,                        -- shared secret echoed back on every notification
  last_run        timestamptz,
  last_result     text
);

alter table sam_sharepoint_files enable row level security;
alter table sam_sharepoint_sync  enable row level security;
