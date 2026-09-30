-- Proof that sam_web_reader sees the public surface and nothing else. Run in the SQL editor (or via the
-- Supabase MCP execute_sql) before every website-bot stage launch; every row must say what `expect` says.
-- Read-only: set local role inside one transaction, each probe in its own subtransaction.
begin;
create temp table if not exists _probe (object text, expect text, got text);
grant all on _probe to sam_web_reader;
set local role sam_web_reader;
do $$
declare t text; n bigint;
begin
  foreach t in array array['sam_v1_public_assets', 'sam_v1_assets', 'sam_v1_families', 'sam_v1_changes', 'sam_asset_cards',
                           'sam_sharepoint_files', 'sam_events', 'sam_content_requests', 'sam_content_request_votes',
                           'sam_asset_families', 'sam_carding_queue', 'sam_change_log', 'sam_ops_runs', 'sam_publish_requests', 'sam_test_users'] loop
    begin
      execute format('select count(*) from %I', t) into n;
      insert into _probe values (t, case when t = 'sam_v1_public_assets' then 'readable' else 'denied' end, 'readable (' || n || ' rows)');
    exception when insufficient_privilege or undefined_table then
      insert into _probe values (t, case when t = 'sam_v1_public_assets' then 'readable' else 'denied' end, 'denied: ' || sqlerrm);
    end;
  end loop;
  -- Columns on the public view: none of the sensitive ones exist there at all.
  insert into _probe select 'sam_v1_public_assets.' || c, 'absent',
    case when exists (select 1 from information_schema.columns where table_name = 'sam_v1_public_assets' and column_name = c) then 'PRESENT' else 'absent' end
  from unnest(array['client_actual', 'needs_human', 'internal_reason', 'sharepoint_url', 'key_problem', 'use_for', 'stale_risk', 'folder', 'modified_by']) c;
  begin
    perform sam_dashboard(30, false, array['dwight-test'], 'Asia/Kolkata');
    insert into _probe values ('function sam_dashboard()', 'denied', 'callable');
  exception when insufficient_privilege then insert into _probe values ('function sam_dashboard()', 'denied', 'denied: ' || sqlerrm);
  end;
end $$;
reset role;
select object, expect, got, (got like expect || '%') as ok from _probe order by ok, object;
rollback;   -- nothing to keep
