-- SAM morning digest: usage over an arbitrary window. Applied to iwqhayuoxnrhqzozznes as migration
-- sam_usage_window on 29 September 2026 (shared project - sam_ objects only).
--
-- Why a second function. sam_dashboard's window is whole IST calendar days ending now, so at 08:30
-- "1 day" means 8.5 hours of today. The digest wants a rolling last 24 hours and the 7 x 24 hours
-- before it, so it calls this twice (web/lib/metrics.ts usageWindow, web/app/api/v1/digest).
--
-- The definitions are sam_dashboard's (docs/supabase-sam-observability.sql), copied, not reinvented:
-- question, answered, error (schema_version >= 2 only), fallback (over model attempts), p95 without
-- catalogue searches. Change one there, change it here.
--   gaps               questions that were a content gap (intent gap, or a gap event pointing at them)
--   provider_failures  any provider trouble, including the invisible kind (provider_error), for Health
create or replace function sam_usage_window(
  p_from timestamptz, p_to timestamptz, p_test_users text[] default array['dwight-test'])
returns jsonb language sql stable as $$
with q as (
  select e.*,
    exists (select 1 from sam_events g where g.ref_event_id = e.id and g.kind = 'gap') as gap_ref,
    coalesce(e.schema_version, 0) >= 2 as instrumented
  from sam_events e
  where e.kind = 'query' and e.created_at >= p_from and e.created_at < p_to
    and coalesce(e.intent, '') not in ('request_publish', 'unregistered')
    and not (e.is_test or e.user_id = any(p_test_users))
),
a as (
  select q.*,
    (coalesce(result_count, 0) >= 1 and coalesce(intent, '') <> 'gap' and not gap_ref
      and coalesce(error_kind, '') not in ('server_error', 'empty_answer', 'step_exhausted')) as answered,
    (coalesce(intent, '') = 'gap' or gap_ref) as gap
  from q
)
select jsonb_build_object(
  'questions',         count(*),
  'people',            count(distinct user_id),
  'answered',          count(*) filter (where answered),
  'gaps',              count(*) filter (where gap),
  'instrumented',      count(*) filter (where instrumented),
  'errors',            count(*) filter (where instrumented and error_kind is not null),
  'model_attempted',   count(*) filter (where instrumented and (model is not null or error_kind in ('timeout', 'fallback_retrieval'))),
  'fallback',          count(*) filter (where instrumented and error_kind in ('timeout', 'fallback_retrieval')),
  'provider_failures', count(*) filter (where instrumented and error_kind in ('provider_error', 'timeout', 'fallback_retrieval')),
  'p95', percentile_disc(0.95) within group (order by latency_ms) filter (where latency_ms is not null and coalesce(runtime, '') <> 'search')
) from a
$$;

revoke execute on function sam_usage_window(timestamptz, timestamptz, text[]) from public, anon, authenticated;
grant execute on function sam_usage_window(timestamptz, timestamptz, text[]) to service_role;
