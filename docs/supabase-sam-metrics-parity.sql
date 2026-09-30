-- Proof that the metrics CSV (sam_metrics_daily, via sam_rollup_metrics) matches the dashboard
-- (sam_dashboard, sam_usage_window) over the last 30 IST days. Run after changing either side.
-- Pass the same test identities the app uses (SAM_TEST_USERS). Every *_equal count must equal its total,
-- the dash_/roll_ pairs must match, and `mismatches` must be null.
-- Per-channel rows make People and p95 non-additive, so those are compared on single-channel days.
select sam_rollup_metrics(40, array['dwight-test', 'dwight-siddharth']);
with d as (select sam_dashboard(30, false, array['dwight-test', 'dwight-siddharth'], 'Asia/Kolkata') as j),
since as (select (now() at time zone 'Asia/Kolkata')::date - 29 as d0),
dash_daily as (select (x ->> 'day')::date as day, (x ->> 'questions')::int as q, (x ->> 'people')::int as p
               from d, jsonb_array_elements(d.j -> 'daily') x),
roll as (select m.day, sum(queries)::int as q, sum(users)::int as p_sum, count(*) as channels, max(latency_p95) as p95
         from sam_metrics_daily m, since where m.day >= since.d0 group by m.day),
per_day as (
  select dd.day, dd.q as dash_q, coalesce(r.q, 0) as roll_q, dd.p as dash_people, coalesce(r.p_sum, 0) as roll_users,
         coalesce(r.channels, 0) as channels, r.p95 as roll_p95,
         (sam_usage_window(dd.day::timestamp at time zone 'Asia/Kolkata', (dd.day + 1)::timestamp at time zone 'Asia/Kolkata',
                           array['dwight-test', 'dwight-siddharth']) ->> 'p95')::int as window_p95
  from dash_daily dd left join roll r using (day)),
tot as (select sum(catalogue_opens) as opens, sum(feedback_total) as rated, sum(feedback_helpful) as helpful, sum(gaps) as gaps
        from sam_metrics_daily m, since where m.day >= since.d0)
select
  (select count(*) from per_day)                                                            as days,
  (select count(*) from per_day where dash_q = roll_q)                                      as days_questions_equal,
  (select count(*) from per_day where channels <= 1)                                        as single_channel_days,
  (select count(*) from per_day where channels <= 1 and dash_people = roll_users)           as single_channel_days_people_equal,
  (select count(*) from per_day where channels = 1)                                         as one_channel_days_with_traffic,
  (select count(*) from per_day where channels = 1 and roll_p95 is not distinct from window_p95) as one_channel_days_p95_equal,
  (select sum(dash_q) from per_day) as dash_questions, (select sum(roll_q) from per_day) as roll_questions,
  (select j -> 'summary' -> 'cur' ->> 'opens' from d) as dash_opens,        (select opens from tot) as roll_opens,
  (select j -> 'summary' -> 'cur' ->> 'rated' from d) as dash_rated,        (select rated from tot) as roll_rated,
  (select j -> 'summary' -> 'cur' ->> 'helpful' from d) as dash_helpful,    (select helpful from tot) as roll_helpful,
  (select j -> 'summary' -> 'cur' ->> 'gap_events' from d) as dash_gaps,    (select gaps from tot) as roll_gaps,
  (select json_agg(per_day order by day) filter (where dash_q <> roll_q or (channels <= 1 and dash_people <> roll_users)
     or (channels = 1 and roll_p95 is distinct from window_p95)) from per_day) as mismatches;
