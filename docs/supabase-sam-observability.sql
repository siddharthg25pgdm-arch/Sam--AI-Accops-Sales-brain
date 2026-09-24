-- SAM observability: test/real separation, an error taxonomy, the answer text, and one dashboard RPC.
-- Applied to accops-marketing-dashboard (ref iwqhayuoxnrhqzozznes) as migration sam_observability
-- on 25 September 2026. Kept here so the schema lives in the repo and not only in the database.
--
-- Why. On 25 Sep sam_events held 578 rows and 543 of them were the eval harness (dwight-test). Real
-- use was about ten events. Every rate on the old dashboard was a rate over test traffic. Errors were
-- not recorded at all: a provider failure fell back to retrieval silently, so a Groq outage and a
-- healthy day looked identical. And the answer text was never stored, so nobody could review quality.
--
-- Backward compatible with the code already deployed: every new column is nullable or defaulted,
-- and sam_rollup_metrics keeps its signature, so production keeps writing while this is merged.

alter table sam_events
  add column if not exists is_test        boolean not null default false,
  add column if not exists error_kind     text,      -- see taxonomy below; null = no error
  add column if not exists error_detail   text,      -- truncated to 500 chars at write time
  add column if not exists model          text,      -- the model that produced the answer; null = retrieval only
  add column if not exists answer         text,      -- the reply text, truncated to 2000 chars
  add column if not exists result_titles  jsonb,     -- titles of returned assets, same order as result_ids
  add column if not exists schema_version smallint;  -- 2 = written by code that records errors. null = before.

-- Error taxonomy (error_kind), one value per question, the worst thing that happened:
--   server_error        the route threw; the user got an HTTP error, not an answer
--   timeout             a model call hit the deadline; answered from retrieval instead
--   fallback_retrieval  every configured model failed (non-timeout); answered from retrieval
--   provider_error      one provider failed and another model answered; invisible to the user
--   step_exhausted      the model used every tool step without a final answer
--   empty_answer        the model finished with no text
-- A content gap is NOT an error: it is the library lacking something, recorded as intent 'gap'.
--
-- schema_version exists because error_kind = null is ambiguous on old rows: it can mean "no error"
-- or "written before errors were recorded". Error rates only count schema_version >= 2 rows.

-- Backfill: the eval harness. Other test identities are applied at read time from SAM_TEST_USERS,
-- so a later decision ("dwight-siddharth was testing too") needs an env change, not a data fix.
update sam_events set is_test = true where user_id = 'dwight-test' and not is_test;

create index if not exists sam_events_kind_created_idx on sam_events (kind, created_at desc);
create index if not exists sam_events_ref_idx on sam_events (ref_event_id) where ref_event_id is not null;

-- The daily rollup (export CSV) now counts real traffic only. Same signature, so deployed code that
-- calls it keeps working.
create or replace function sam_rollup_metrics(days_back int default 30)
returns int language plpgsql as $$
declare touched int;
begin
  delete from sam_metrics_daily where day >= (current_date - days_back);
  insert into sam_metrics_daily (
    day, channel, queries, users, sessions, gaps, zero_results, catalogue_opens,
    feedback_total, feedback_helpful, latency_p50, latency_p95, latency_max)
  select
    (created_at at time zone 'UTC')::date, coalesce(channel, 'web'),
    count(*) filter (where kind = 'query'),
    count(distinct user_id),
    count(distinct session_id),
    count(*) filter (where kind = 'gap'),
    count(*) filter (where kind = 'query' and coalesce(result_count, 0) = 0),
    count(*) filter (where kind = 'catalogue_open'),
    count(*) filter (where kind = 'feedback'),
    count(*) filter (where kind = 'feedback' and feedback = 'helpful'),
    percentile_disc(0.50) within group (order by latency_ms) filter (where latency_ms is not null)::int,
    percentile_disc(0.95) within group (order by latency_ms) filter (where latency_ms is not null)::int,
    max(latency_ms)
  from sam_events
  where created_at >= (current_date - days_back) and not is_test
  group by 1, 2;
  get diagnostics touched = row_count;
  return touched;
end $$;

-- Everything the dashboard shows, aggregated in Postgres, in one round trip.
--
-- Window: the last p_days calendar days in p_tz, today included (so "7 days" = today + 6 before).
-- Previous window: the same elapsed length immediately before, so a Wednesday-afternoon view compares
-- against the same number of hours, not against a full week.
--
-- ponytail: scans the window's raw events through the created_at index - milliseconds at internal-
-- tool volume, fine to roughly 1e5 events per window. Past that, move the counts onto
-- sam_metrics_daily and keep only the distinct-user and engagement parts here.
--
-- Definitions (mirrored in web/lib/metrics.ts and the dashboard's Definitions panel):
--   question   kind='query', excluding publish requests and messages from unregistered WhatsApp numbers
--   answered   >= 1 asset returned, not a gap, and no hard error (server_error, empty_answer, step_exhausted)
--   engaged    answered on web AND the asker opened a returned asset (within 30 min) or rated it helpful
--   error      error_kind not null, over schema_version >= 2 questions only
--   fallback   timeout or fallback_retrieval, over questions where a model was attempted
--   people     distinct users with >= 1 question or catalogue open; new = first ever such event is in window
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

-- Backfill the rollup under the new (real traffic only) definition.
select sam_rollup_metrics(365);
