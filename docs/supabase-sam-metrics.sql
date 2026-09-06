-- SAM operator metrics: a daily rollup of sam_events.
-- Applied to accops-marketing-dashboard (ref iwqhayuoxnrhqzozznes) as migration sam_metrics_daily
-- on 6 September 2026. Kept here so the schema lives in the repo and not only in the database.
--
-- Why a rollup at all. web/app/admin/page.tsx calls recentEvents(2000), pulls the rows into Node and
-- computes every metric with .filter(). Fine at 26 events; slower every day it is used; eventually a
-- Vercel function timeout. Aggregating in Postgres makes each panel one indexed read that stays
-- constant-time. Far cheaper to build at 26 rows than after real traffic.
--
-- Keyed by (day, channel), not day alone: "is WhatsApp slower than web?" and "did sales adopt it or
-- only marketing?" both need the split, and both are questions a manager actually asks. A tenant_id
-- can be added to the key later without a rewrite - the only concession to design decision 1.

create table if not exists sam_metrics_daily (
  day             date not null,
  channel         text not null,
  queries         int  not null default 0,
  users           int  not null default 0,
  sessions        int  not null default 0,
  gaps            int  not null default 0,
  zero_results    int  not null default 0,   -- queries that found nothing: the content-gap signal
  catalogue_opens int  not null default 0,
  feedback_total  int  not null default 0,
  feedback_helpful int not null default 0,
  -- Latency is "time to message". p95 matters more than the mean: an average of 1.4s hides the one
  -- question in twenty that took eight seconds, and that is the one a rep remembers.
  latency_p50     int,
  latency_p95     int,
  latency_max     int,
  refreshed_at    timestamptz not null default now(),
  primary key (day, channel)
);

create index if not exists sam_metrics_day_idx on sam_metrics_daily (day desc);

-- Recompute a window of days from raw events. Idempotent, so it is safe on a cron, on demand, or
-- twice. Recomputes rather than increments, so a late-arriving event or a backfill can never leave
-- the rollup permanently wrong.
create or replace function sam_rollup_metrics(days_back int default 30)
returns int language plpgsql as $$
declare touched int;
begin
  delete from sam_metrics_daily
   where day >= (current_date - days_back);

  insert into sam_metrics_daily (
    day, channel, queries, users, sessions, gaps, zero_results, catalogue_opens,
    feedback_total, feedback_helpful, latency_p50, latency_p95, latency_max)
  select
    (created_at at time zone 'UTC')::date                                   as day,
    coalesce(channel, 'web')                                                as channel,
    count(*) filter (where kind = 'query')                                  as queries,
    count(distinct user_id)                                                 as users,
    count(distinct session_id)                                              as sessions,
    count(*) filter (where kind = 'gap')                                    as gaps,
    count(*) filter (where kind = 'query' and coalesce(result_count, 0) = 0) as zero_results,
    count(*) filter (where kind = 'catalogue_open')                         as catalogue_opens,
    count(*) filter (where kind = 'feedback')                               as feedback_total,
    count(*) filter (where kind = 'feedback' and feedback = 'helpful')      as feedback_helpful,
    percentile_disc(0.50) within group (order by latency_ms)
      filter (where latency_ms is not null)::int                            as latency_p50,
    percentile_disc(0.95) within group (order by latency_ms)
      filter (where latency_ms is not null)::int                            as latency_p95,
    max(latency_ms)                                                         as latency_max
  from sam_events
  where created_at >= (current_date - days_back)
  group by 1, 2;

  get diagnostics touched = row_count;
  return touched;
end $$;

alter table sam_metrics_daily enable row level security;

-- Backfill everything, then schedule sam_rollup_metrics(3) on the nightly cron.
-- select sam_rollup_metrics(365);
