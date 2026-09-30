-- SAM operations: the job run log, token usage per answer, a metrics rollup that matches the dashboard,
-- and the dashboard's recovered-fallback count. Applied 30 September 2026 as migration sam_ops.
-- Project: iwqhayuoxnrhqzozznes (shared - sam_ objects only). Additive: deployed code keeps working.

-- ---------------------------------------------------------------- job run log

-- One row per run of a scheduled job, so "nothing changed" and "did not run" look different.
--   job        carding_prep | carding (the nightly skill's outcome) | digest | snapshot | cron | rollup
--   status     ok | warn (ran, something needs a look) | failed | refused (a guard said no)
--   summary    one human line (the digest's subject, the snapshot's result, "carded 3 new, 1 updated")
--   details    anything else, jsonb
-- Written by web/lib/ops.ts (logRun) and prototype/carding_prep.py (log_run); read by the System tab
-- and the morning digest (jobHealth in web/lib/ops.ts).
create table if not exists sam_ops_runs (
  id          bigserial primary key,
  job         text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null check (status in ('ok', 'warn', 'failed', 'refused', 'running')),
  summary     text not null default '',
  details     jsonb not null default '{}'
);
create index if not exists sam_ops_runs_job_idx on sam_ops_runs (job, started_at desc);
alter table sam_ops_runs enable row level security;
revoke all on sam_ops_runs from public, anon, authenticated;

-- ---------------------------------------------------------------- tokens per answer

-- Total tokens the answering model used for one question (all tool rounds), from the answer trace.
-- null = retrieval only, a catalogue search, or written before 30 Sep 2026.
alter table sam_events add column if not exists tokens int;

-- ---------------------------------------------------------------- rollup = dashboard definitions

-- sam_metrics_daily (the metrics CSV) used UTC days, counted every event kind toward users, timed
-- catalogue searches and left SAM_TEST_USERS in. Now the dashboard's definitions exactly
-- (docs/supabase-sam-observability.sql, sam_dashboard):
--   day            IST calendar day
--   queries        kind query, excluding publish requests and unregistered WhatsApp numbers
--   users          distinct people with a question or a catalogue open (the dashboard's People, per day)
--   sessions       distinct session ids among those questions
--   gaps           gap events; zero_results = questions that returned nothing
--   feedback_*     ratings (all / helpful)
--   latency_*      over questions, catalogue searches (runtime 'search') excluded
--   test traffic   is_test, or user_id in p_test_users (the app passes SAM_TEST_USERS; a caller that
--                  passes nothing - the deployed code - gets sam_test_users)
-- Same name, new optional parameters: rpc/sam_rollup_metrics {days_back} still works.
drop function if exists sam_rollup_metrics(int);
create or replace function sam_rollup_metrics(days_back int default 30, p_test_users text[] default null, p_tz text default 'Asia/Kolkata')
returns int language plpgsql set search_path = public, pg_catalog as $$
declare
  touched int;
  tu text[] := coalesce(p_test_users, array(select user_id from sam_test_users));
  d0 date := (now() at time zone p_tz)::date - days_back;
begin
  delete from sam_metrics_daily where day >= d0;
  insert into sam_metrics_daily (
    day, channel, queries, users, sessions, gaps, zero_results, catalogue_opens,
    feedback_total, feedback_helpful, latency_p50, latency_p95, latency_max)
  select d, ch,
    count(*) filter (where is_q),
    count(distinct user_id) filter (where is_q or kind = 'catalogue_open'),
    count(distinct session_id) filter (where is_q),
    count(*) filter (where kind = 'gap'),
    count(*) filter (where is_q and coalesce(result_count, 0) = 0),
    count(*) filter (where kind = 'catalogue_open'),
    count(*) filter (where kind = 'feedback'),
    count(*) filter (where kind = 'feedback' and feedback = 'helpful'),
    percentile_disc(0.50) within group (order by latency_ms) filter (where timed)::int,
    percentile_disc(0.95) within group (order by latency_ms) filter (where timed)::int,
    max(latency_ms) filter (where timed)
  from (
    select e.*, (e.created_at at time zone p_tz)::date as d, coalesce(e.channel, 'web') as ch,
           (e.kind = 'query' and coalesce(e.intent, '') not in ('request_publish', 'unregistered')) as is_q,
           (e.kind = 'query' and coalesce(e.intent, '') not in ('request_publish', 'unregistered')
             and e.latency_ms is not null and coalesce(e.runtime, '') <> 'search') as timed
    from sam_events e
    where e.created_at >= (d0::timestamp at time zone p_tz)
      and not (e.is_test or e.user_id = any(tu))
  ) x
  group by d, ch;
  get diagnostics touched = row_count;
  return touched;
end $$;
revoke execute on function sam_rollup_metrics(int, text[], text) from public, anon, authenticated;
grant execute on function sam_rollup_metrics(int, text[], text) to service_role;
select sam_rollup_metrics(365);

-- ---------------------------------------------------------------- sam_dashboard + recovered

create or replace function sam_dashboard(
  p_days int default 30, p_include_test boolean default false,
  p_test_users text[] default array['dwight-test'], p_tz text default 'Asia/Kolkata')
returns jsonb language sql stable as $$
with
b0 as (
  select (date_trunc('day', now() at time zone p_tz) - make_interval(days => p_days - 1)) at time zone p_tz as t_from,
         now() as t_to
),
b as (select t_from, t_to, t_from - make_interval(days => p_days) as p_from, t_to - make_interval(days => p_days) as p_to from b0),
ev as (
  select e.*, case when e.created_at >= b.t_from then 'cur' when e.created_at < b.p_to then 'prev' end as per
  from sam_events e, b
  where e.created_at >= b.p_from and e.created_at < b.t_to
    and (p_include_test or not (e.is_test or e.user_id = any(p_test_users)))
),
q as (
  select ev.*,
    (coalesce(result_count, 0) >= 1 and coalesce(intent, '') <> 'gap'
      and coalesce(error_kind, '') not in ('server_error', 'empty_answer', 'step_exhausted')
      and not exists (select 1 from sam_events g where g.ref_event_id = ev.id and g.kind = 'gap')) as answered,
    coalesce(schema_version, 0) >= 2 as instrumented
  from ev
  where kind = 'query' and per is not null and coalesce(intent, '') not in ('request_publish', 'unregistered')
),
qe as (
  select q.*,
    (instrumented and error_kind is not null) as errored,
    (answered and coalesce(channel, 'web') = 'web' and (
      exists (select 1 from sam_events f where f.ref_event_id = q.id
               and ((f.kind = 'feedback' and f.feedback = 'helpful') or f.kind = 'catalogue_open'))
      or exists (select 1 from sam_events o where o.kind = 'catalogue_open' and o.user_id = q.user_id
               and o.created_at >= q.created_at and o.created_at < q.created_at + interval '30 minutes'
               and coalesce(q.result_ids, '[]'::jsonb) ? o.asset_path)
    )) as engaged
  from q
),
firsts as (
  select user_id, min(created_at) as first_at from sam_events
  where kind in ('query', 'catalogue_open') and coalesce(intent, '') not in ('request_publish', 'unregistered')
    and (p_include_test or not (is_test or user_id = any(p_test_users)))
  group by user_id
),
act as (
  select per, user_id, created_at from qe
  union all
  select per, user_id, created_at from ev where kind = 'catalogue_open' and per is not null
),
kpi as (
  select per, jsonb_build_object(
    'questions',       count(*),
    'answered',        count(*) filter (where answered),
    'web_answered',    count(*) filter (where answered and coalesce(channel, 'web') = 'web'),
    'engaged',         count(*) filter (where engaged),
    'instrumented',    count(*) filter (where instrumented),
    'errors',          count(*) filter (where errored),
    'model_attempted', count(*) filter (where instrumented and (model is not null or error_kind in ('timeout', 'fallback_retrieval'))),
    'fallback',        count(*) filter (where instrumented and error_kind in ('timeout', 'fallback_retrieval')),
    -- One provider failed and another model answered: the rep saw nothing wrong. Counted in 'errors'
    -- (old code reads that), shown apart on the dashboard: real errors = errors - recovered.
    'recovered',       count(*) filter (where instrumented and error_kind = 'provider_error'),
    'latency_n',       count(latency_ms) filter (where coalesce(runtime, '') <> 'search'),
    'p50', percentile_disc(0.5)  within group (order by latency_ms) filter (where latency_ms is not null and coalesce(runtime, '') <> 'search'),
    'p95', percentile_disc(0.95) within group (order by latency_ms) filter (where latency_ms is not null and coalesce(runtime, '') <> 'search')
  ) as j from qe group by per
),
periods as (select unnest(array['cur', 'prev']) as per),
summary as (
  select jsonb_object_agg(p.per, coalesce(k.j, '{}'::jsonb) || jsonb_build_object(
    'people',     (select count(distinct user_id) from act a where a.per = p.per),
    'new_people', (select count(distinct a.user_id) from act a join firsts f using (user_id)
                    where a.per = p.per and f.first_at >= (select case when p.per = 'cur' then t_from else p_from end from b)),
    'rated',       (select count(*) from ev where ev.per = p.per and kind = 'feedback'),
    'helpful',     (select count(*) from ev where ev.per = p.per and kind = 'feedback' and feedback = 'helpful'),
    'wrong_asset', (select count(*) from ev where ev.per = p.per and kind = 'feedback' and feedback = 'wrong_asset'),
    'missing',     (select count(*) from ev where ev.per = p.per and kind = 'feedback' and feedback = 'missing'),
    'opens',       (select count(*) from ev where ev.per = p.per and kind = 'catalogue_open'),
    'gap_events',  (select count(*) from ev where ev.per = p.per and kind = 'gap')
  )) as j
  from periods p left join kpi k using (per)
),
days as (
  select d::date as day from b, generate_series((b.t_from at time zone p_tz)::date, (b.t_to at time zone p_tz)::date, interval '1 day') d
),
daily as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'day', days.day, 'questions', coalesce(x.questions, 0), 'answered', coalesce(x.answered, 0),
    'errors', coalesce(x.errors, 0), 'people', coalesce(y.people, 0)) order by days.day), '[]'::jsonb) as j
  from days
  left join (select (created_at at time zone p_tz)::date as day, count(*) as questions,
               count(*) filter (where answered) as answered, count(*) filter (where errored) as errors
             from qe where per = 'cur' group by 1) x using (day)
  left join (select (created_at at time zone p_tz)::date as day, count(distinct user_id) as people
             from act where per = 'cur' group by 1) y using (day)
),
cur as (select * from qe where per = 'cur'),
returned as (
  select x.key, count(*) as returned from cur, jsonb_array_elements_text(coalesce(cur.result_ids, '[]'::jsonb)) x(key) group by 1
),
opened as (
  select asset_path as key, count(*) filter (where intent = 'chat') as from_answer,
         count(*) filter (where coalesce(intent, 'catalogue') <> 'chat') as from_catalogue
  from ev where per = 'cur' and kind = 'catalogue_open' and coalesce(asset_path, '') <> '' group by 1
)
select jsonb_build_object(
  'window', (select jsonb_build_object('from', t_from, 'to', t_to, 'prev_from', p_from, 'prev_to', p_to, 'days', p_days, 'tz', p_tz) from b),
  'summary', (select j from summary),
  'daily',   (select j from daily),
  'channel', (select coalesce(jsonb_agg(to_jsonb(t) order by t.questions desc), '[]') from (
      select coalesce(channel, 'web') as key, count(*) as questions, count(distinct user_id) as people,
             count(*) filter (where answered) as answered, count(*) filter (where instrumented) as instrumented,
             count(*) filter (where errored) as errors,
             percentile_disc(0.5)  within group (order by latency_ms) filter (where latency_ms is not null and coalesce(runtime, '') <> 'search') as p50,
             percentile_disc(0.95) within group (order by latency_ms) filter (where latency_ms is not null and coalesce(runtime, '') <> 'search') as p95
      from cur group by 1) t),
  'intent',     (select coalesce(jsonb_agg(to_jsonb(t) order by t.n desc), '[]') from (select coalesce(intent, 'unknown') as key, count(*) as n from cur group by 1) t),
  'asset_type', (select coalesce(jsonb_agg(to_jsonb(t) order by t.n desc), '[]') from (select coalesce(nullif(filters->>'asset_type', ''), 'Any') as key, count(*) as n from cur group by 1) t),
  'vertical',   (select coalesce(jsonb_agg(to_jsonb(t) order by t.n desc), '[]') from (select coalesce(nullif(filters->>'vertical', ''), 'Any') as key, count(*) as n from cur group by 1) t),
  'product',    (select coalesce(jsonb_agg(to_jsonb(t) order by t.n desc), '[]') from (select coalesce(nullif(filters->>'product', ''), 'Any') as key, count(*) as n from cur group by 1) t),
  'runtime',    (select coalesce(jsonb_agg(to_jsonb(t) order by t.n desc), '[]') from (
      select coalesce(runtime, 'unknown') as runtime, model, count(*) as n,
             percentile_disc(0.5) within group (order by latency_ms) filter (where latency_ms is not null and coalesce(runtime, '') <> 'search') as p50
      from cur group by 1, 2) t),
  'errors',     (select coalesce(jsonb_agg(to_jsonb(t) order by t.n desc), '[]') from (
      select error_kind as key, count(*) as n, max(created_at) as last_at,
             (array_agg(error_detail order by created_at desc))[1] as last_detail
      from cur where errored group by 1) t),
  'heatmap',    (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from (
      select extract(isodow from created_at at time zone p_tz)::int as dow, extract(hour from created_at at time zone p_tz)::int as hour, count(*) as n
      from cur group by 1, 2) t),
  'latency',    (select coalesce(jsonb_agg(to_jsonb(t) order by t.bucket), '[]') from (
      select case when latency_ms < 1000 then 0 when latency_ms < 2000 then 1 when latency_ms < 4000 then 2
                  when latency_ms < 8000 then 3 when latency_ms < 16000 then 4 else 5 end as bucket, count(*) as n
      from cur where latency_ms is not null and coalesce(runtime, '') <> 'search' group by 1) t),
  'assets',     (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from (
      select coalesce(r.key, o.key) as key, coalesce(r.returned, 0) as returned,
             coalesce(o.from_answer, 0) as from_answer, coalesce(o.from_catalogue, 0) as from_catalogue
      from returned r full join opened o on o.key = r.key
      order by coalesce(r.returned, 0) + coalesce(o.from_answer, 0) + coalesce(o.from_catalogue, 0) desc, 1
      limit 15) t),
  'people',     (select coalesce(jsonb_agg(to_jsonb(t) order by t.questions desc, t.last_seen desc), '[]') from (
      select a.user_id as key, count(c.id) as questions, count(c.id) filter (where c.answered) as answered,
             count(c.id) filter (where c.errored) as errors,
             (select count(*) from ev o where o.per = 'cur' and o.kind = 'catalogue_open' and o.user_id = a.user_id) as opens,
             (select array_agg(distinct coalesce(x.channel, 'web')) from cur x where x.user_id = a.user_id) as channels,
             max(a.created_at) as last_seen, min(f.first_at) as first_seen,
             mode() within group (order by c.query) as top
      from (select distinct user_id, max(created_at) over (partition by user_id) as created_at from act where per = 'cur') a
      left join cur c on c.user_id = a.user_id
      left join firsts f on f.user_id = a.user_id
      group by a.user_id limit 100) t),
  'top_questions', (select coalesce(jsonb_agg(to_jsonb(t) order by t.n desc, t.key), '[]') from (
      select lower(btrim(query)) as key, count(*) as n, count(distinct user_id) as people, count(*) filter (where answered) as answered
      from cur where coalesce(btrim(query), '') <> '' group by 1 order by 2 desc, 1 limit 12) t),
  'gaps',       (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from (
      select kind, query, filters, user_id, created_at from ev where per = 'cur' and kind = 'gap' order by created_at desc limit 1000) t),
  'first_event_at', (select min(created_at) from sam_events where not (is_test or user_id = any(p_test_users))),
  'last_event_at',  (select max(created_at) from sam_events where kind in ('query', 'catalogue_open')
                       and (p_include_test or not (is_test or user_id = any(p_test_users)))),
  'instrumented_since', (select min(created_at) from sam_events where schema_version >= 2)
)
$$;

-- Service role only. RLS already hides sam_events from anon, but an RPC anyone can call is one
-- policy change away from a leak.
revoke execute on function sam_dashboard(int, boolean, text[], text) from public, anon, authenticated;
grant execute on function sam_dashboard(int, boolean, text[], text) to service_role;
