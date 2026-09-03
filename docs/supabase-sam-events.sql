-- SAM analytics tables. Run once in the Supabase SQL editor of the project you point the web app at.
-- The web app writes here through the service-role key (server side only) and reads for /admin.

create table if not exists sam_events (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  user_id       text not null,                 -- login id from SAM_USERS
  channel       text not null default 'web',   -- web | teams | whatsapp | mcp (future)
  session_id    text,
  kind          text not null,                 -- query | feedback | catalogue_open | gap
  query         text,                          -- the question asked (kind = query)
  intent        text,                          -- find_asset | answer_question | share_externally | gap | other
  filters       jsonb,                         -- slots the router extracted
  result_count  int,
  result_ids    jsonb,                         -- asset titles/paths returned
  runtime       text,                          -- claude | local
  latency_ms    int,
  feedback      text,                          -- helpful | wrong_asset | missing (kind = feedback)
  ref_event_id  bigint references sam_events(id) on delete set null,  -- feedback -> the query it rates
  asset_path    text                           -- catalogue_open: which asset was opened
);

create index if not exists sam_events_created_idx on sam_events (created_at desc);
create index if not exists sam_events_kind_idx on sam_events (kind);
create index if not exists sam_events_user_idx on sam_events (user_id);

-- Row-level security on, no anon policy: only the service role (server) can read/write.
alter table sam_events enable row level security;
