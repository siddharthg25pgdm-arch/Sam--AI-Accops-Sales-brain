-- SAM Live (call copilot) tables. Additive only. Service role (server) reads/writes; RLS on, no anon policy.

create table if not exists live_deals (
  id             uuid primary key default gen_random_uuid(),
  owner          text not null,                 -- SAM login id of the rep
  company        text not null,
  contact_name   text,
  contact_email  text,
  contact_title  text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists live_deals_owner_idx on live_deals (owner);
create index if not exists live_deals_company_idx on live_deals (lower(company));

create table if not exists live_meetings (
  id              uuid primary key default gen_random_uuid(),
  deal_id         uuid references live_deals(id) on delete set null,
  owner           text not null,
  title           text,
  status          text not null default 'live',          -- live | ended
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  qualification   jsonb not null default '{}'::jsonb,     -- key -> {status, value, evidence}
  suggestions     jsonb not null default '[]'::jsonb,     -- latest ask_next
  battlecards     jsonb not null default '[]'::jsonb,     -- every card shown during the call
  summary         jsonb,
  flow_status     text,                                   -- sent | failed: ... | not_configured
  last_insight_at timestamptz,
  is_test         boolean not null default false
);
-- Added 14 Oct 2026 (applied in production): what the call ran on, and whether the desktop app started it itself.
alter table live_meetings add column if not exists platform text;      -- phone-link | teams | zoom | meet | whatsapp | webex | slack | browser | manual
alter table live_meetings add column if not exists auto_started boolean not null default false;
create index if not exists live_meetings_owner_idx on live_meetings (owner, started_at desc);
create index if not exists live_meetings_deal_idx on live_meetings (deal_id, started_at desc);

create table if not exists live_segments (
  id           bigserial primary key,
  meeting_id   uuid not null references live_meetings(id) on delete cascade,
  channel      text not null check (channel in ('rep', 'customer')),
  t_ms         int not null default 0,                   -- offset from meeting start
  duration_ms  int,
  text         text not null,
  created_at   timestamptz not null default now()
);
create index if not exists live_segments_meeting_idx on live_segments (meeting_id, t_ms);

alter table live_deals enable row level security;
alter table live_meetings enable row level security;
alter table live_segments enable row level security;
