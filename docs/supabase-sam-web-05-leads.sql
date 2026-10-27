-- SAM website chatbot, stage 3: leads from Microsoft Bookings, the booking calendar setting, the booking_opened event.
-- Migration name sam_web_05_leads. Needs 01 (settings), 02 (sam_web_settings()), 03 (sam_web_events).
-- NOT APPLIED. The table was approved by Siddharth on 27 Oct 2026 (docs/plans/web-stage3-leads-runbook.md); he applies it.
-- Record the date here when applied. Apply order: 05, then 06 (independent). Safe to run twice. Additive only.
--
--   sam_web_leads          one row per booking the Power Automate flow posts (POST /api/v1/leads/booking, web/lib/web-leads.ts):
--                          status clean | suspect (quarantined, with reasons) | released | discarded, and whether it was forwarded
--   sam_web_purge_leads()  retention: leads older than 365 days that were never forwarded (NOT scheduled; run it by hand)
--   booking_url            the Bookings page the chat opens inside its panel (sam_web_settings + sam_web_settings())
--   booking_opened         a new allowlisted widget event
--
-- Access: RLS on, no policies, nothing for public / anon / authenticated, and NOTHING for sam_web_reader: the website
-- never reads or writes a lead. Only the service key does, in the one server-to-server lead route and the admin tab.

-- ---------------------------------------------------------------- leads

create table if not exists sam_web_leads (
  id              uuid primary key default gen_random_uuid(),     -- sam_lead_id in the forwarded payload
  created_at      timestamptz not null default now(),
  source          text not null check (source in ('citrix-lp-booking', 'citrix-lp-chat')),
  status          text not null check (status in ('clean', 'suspect', 'released', 'discarded')),
  reasons         text[] not null default '{}' check (cardinality(reasons) <= 20),   -- rule codes only (web-leads.ts REASON_LABEL)
  forwarded       boolean not null default false,
  forwarded_at    timestamptz,
  forward_error   text check (char_length(forward_error) <= 200),                   -- an HTTP status or a timeout, never the URL
  first_name      text check (char_length(first_name) <= 100),
  last_name       text check (char_length(last_name) <= 100),
  email           text not null check (char_length(email) <= 254 and email = lower(email)),
  phone           text check (char_length(phone) <= 40),
  company         text check (char_length(company) <= 200),
  role            text check (char_length(role) <= 120),
  seats           text check (char_length(seats) <= 40),                            -- Bookings' "Number of users" answer, as given
  country         text check (char_length(country) <= 64),
  page            text check (char_length(page) <= 500),
  conversation_id text check (char_length(conversation_id) <= 80),
  booking_start   timestamptz,
  -- Appointment id, service, customer time zone, notes, the custom answers, utm_*. Never the staff, the Teams join link,
  -- the customer id or a street address (web-leads.ts normalise keeps an allowlist).
  raw             jsonb not null default '{}' check (jsonb_typeof(raw) = 'object' and octet_length(raw::text) <= 16384),
  ip_hash         text check (ip_hash ~ '^[0-9a-f]{64}$'),                          -- null for server-to-server bookings
  constraint sam_web_leads_forwarded check (not forwarded or forwarded_at is not null),
  constraint sam_web_leads_suspect_has_reason check (status <> 'suspect' or cardinality(reasons) > 0)
);
create index if not exists sam_web_leads_created_idx on sam_web_leads (created_at);
create index if not exists sam_web_leads_email_idx on sam_web_leads (email, created_at desc);   -- the 24 h dedupe

-- Retention (Siddharth, 27 Oct): a lead older than 365 days is deleted unless it was forwarded (then it lives on in the
-- Website Leads pipeline, and SAM keeps the record of having sent it). Not scheduled: run
--   select sam_web_purge_leads();
-- by hand, or add it to the stage-2 retention job with sam_web_purge(180). Returns how many it deleted.
create or replace function sam_web_purge_leads(days int default 365)
returns int language sql volatile security definer set search_path = public, pg_catalog as $$
  with d as (delete from sam_web_leads where created_at < now() - make_interval(days => greatest(coalesce($1, 365), 30)) and not forwarded
             returning 1)
  select count(*)::int from d
$$;

alter table sam_web_leads enable row level security;
revoke all on sam_web_leads from public, anon, authenticated;
grant select, insert, update, delete on sam_web_leads to service_role;
revoke execute on function sam_web_purge_leads(int) from public, anon, authenticated;
grant execute on function sam_web_purge_leads(int) to service_role;

-- ---------------------------------------------------------------- the booking calendar

-- The chat's "Talk to an expert" opens this page inside the chat panel. Empty = the old behaviour (cta_url in a new tab).
-- /embed may frame only https://bookings.cloud.microsoft (next.config.ts frame-src); the Website tab refuses any other origin.
insert into sam_web_settings (key, value) values
  ('booking_url', 'https://bookings.cloud.microsoft/book/AccopsUnifiedPlatformforSecureRemoteAccess2@propalmsnetwork.onmicrosoft.com/s/UEDDAf42hEiNVqsGcRVJ-w2?ismsaljsauthenabled')
on conflict (key) do nothing;

-- 02's public subset plus booking_url (the existing keys unchanged). CREATE OR REPLACE keeps the grants; restated below.
create or replace function sam_web_settings() returns jsonb
language sql stable security definer set search_path = public, pg_catalog as $$
  select jsonb_build_object(
    'enabled',       coalesce(max(value) filter (where key = 'enabled'), 'false') = 'true',
    'model_enabled', coalesce(max(value) filter (where key = 'model_enabled'), 'false') = 'true',
    'cta_url',       max(value) filter (where key = 'cta_url'),
    'cta_label',     max(value) filter (where key = 'cta_label'),
    'booking_url',   coalesce(max(value) filter (where key = 'booking_url'), ''))
  from sam_web_settings
$$;
revoke execute on function sam_web_settings() from public, anon, authenticated;
grant execute on function sam_web_settings() to sam_web_reader, service_role;

-- ---------------------------------------------------------------- the booking_opened event

-- 03's allowlist plus booking_opened (the widget opened the calendar in its panel). No free text, as before.
alter table sam_web_events drop constraint if exists sam_web_events_name_check;
alter table sam_web_events add constraint sam_web_events_name_check check (name in ('chat_opened', 'chat_closed', 'popup_shown',
  'popup_clicked', 'popup_dismissed', 'question_clicked', 'answer_shown', 'doc_opened', 'talk_to_sales_clicked', 'filter_used',
  'step_viewed', 'booking_opened'));
