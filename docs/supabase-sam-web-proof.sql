-- Proof that the website chatbot's database boundary holds (docs/supabase-sam-web-0{1,2,3}-*.sql).
-- Run in the SQL editor (or the Supabase MCP execute_sql) after applying the three migrations and before every
-- launch. Every row must have ok = true. Read-only: one transaction, rolled back at the end (the RPC probes write
-- a slot, a cache row and log rows, and all of it is undone).
--
-- What it checks:
--   1. anon / authenticated: no access to any sam_* relation in public (no grant, or RLS on with no policy) and
--      no EXECUTE on any sam_web_* function
--   2. sam_web_reader: SELECT on exactly the 4 allowlisted views across public and core; no other relation; EXECUTE
--      on exactly the allowlisted functions (any other definer function it could call is a hole)
--   3. as sam_web_reader for real: the views read, every sam_web_* table and the internal v1 tables are denied
--   4. no sensitive column on the three views
--   5. every RPC callable as the reader; the dashboard functions denied; sam_web_search under 100 ms
--   6. no blocked claim survives in the public views; the asset view is exactly the approved title list
--   7. every sam_web_* definer function has a fixed search_path
begin;
create temp table _probe (object text, expect text, got text);
grant all on _probe to sam_web_reader;

-- 1. anon / authenticated (catalog)
insert into _probe
select 'anon/authenticated on ' || c.relname, 'closed',
  case when not (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select')) then 'closed (no grant)'
       when c.relkind in ('r', 'p') and c.relrowsecurity
            and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) then 'closed (rls, no policy)'
       else 'OPEN' end
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname like 'sam\_%' and c.relkind in ('r', 'p', 'v', 'm', 'f');

insert into _probe
select 'anon/authenticated execute ' || p.proname, 'closed',
  case when has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
       then 'OPEN' else 'closed' end
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'sam\_web\_%' and p.prokind = 'f'
  and p.prorettype <> 'trigger'::regtype;

-- 2. sam_web_reader's grants (catalog)
insert into _probe
select 'reader select ' || n.nspname || '.' || c.relname,
  case when c.relname in ('sam_web_qa_public', 'sam_web_pages_public', 'sam_web_assets_public', 'sam_v1_public_assets') and n.nspname = 'public'
       then 'granted' else 'denied' end,
  case when has_table_privilege('sam_web_reader', c.oid, 'select') then 'granted' else 'denied' end
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'core') and c.relkind in ('r', 'p', 'v', 'm', 'f')
  and (has_table_privilege('sam_web_reader', c.oid, 'select')
       or c.relname in ('sam_web_qa_public', 'sam_web_pages_public', 'sam_web_assets_public', 'sam_v1_public_assets'));
insert into _probe
select 'reader select: every other relation in public + core (' || count(*) || ')', 'denied',
  case when bool_or(has_table_privilege('sam_web_reader', c.oid, 'select')) then 'SOME GRANTED (see rows above)' else 'denied' end
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'core') and c.relkind in ('r', 'p', 'v', 'm', 'f')
  and c.relname not in ('sam_web_qa_public', 'sam_web_pages_public', 'sam_web_assets_public', 'sam_v1_public_assets');

-- Functions: the allowlist must be executable; any other SECURITY DEFINER function in public the reader can
-- execute is a hole (an invoker function runs with the reader's own rights, so it can reach nothing extra).
insert into _probe
select 'reader execute ' || p.proname,
  case when p.proname in ('sam_web_qa_rows', 'sam_web_page_rows', 'sam_web_asset_rows', 'sam_web_page_group', 'sam_web_roots',
                          'sam_web_children', 'sam_web_search', 'sam_web_settings', 'sam_web_admit', 'sam_web_take_model_slot', 'sam_web_cache_get',
                          'sam_web_cache_put', 'sam_web_log_message', 'sam_web_log_event', 'sam_v1_public_asset_rows')
       then 'granted' else 'denied' end,
  case when has_function_privilege('sam_web_reader', p.oid, 'execute') then 'granted' else 'denied' end
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
  and (p.proname like 'sam\_web\_%' or p.proname = 'sam_v1_public_asset_rows' or has_function_privilege('sam_web_reader', p.oid, 'execute'));

-- 7. fixed search_path on every sam_web_* definer function
insert into _probe
select 'search_path fixed: ' || p.proname, 'fixed',
  case when exists (select 1 from unnest(p.proconfig) x where x like 'search\_path=%') then 'fixed' else 'MISSING' end
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'sam\_web\_%' and p.prosecdef;

-- 3-6 as the reader itself
set local role sam_web_reader;
do $$
declare t text; n bigint; ms numeric; worst numeric := 0; t0 timestamptz; ok boolean; j jsonb; mid bigint;
  qh text := repeat('a', 64);
  expected text[] := array[
    -- The approved public asset list (sam_v1_public_assets minus Regulation / Third-Party Research, minus titles
    -- carrying a blocked claim), as read on 26 Oct 2026. The PRD's count of 11 was taken 26 Sep; case studies were
    -- published since. Case studies may carry their own published figures (26 Oct decision).
    -- Any change shows up below as missing/extra: update this list deliberately.
    'A Leading BPO Delivers Seamless Customer Service with Wire-Speed VoIP for Work-from-Home Users',
    'A Major Indian E-commerce Firm Eliminates Data Security Concerns Using Accops Application Access Gateway',
    'Accops Corporate Brochure: Anywhere Access, Secure and Simplified - India / Sovereign Edition (2026)',
    'Accops Corporate Brochure: Anywhere Access, Secure and Simplified - International Edition with Global Customer Logos (2025)',
    'Accops DaaS: Managed Cloud Desktops with ZTNA and MFA Built In',
    'Accops Digital Workspace: Integrated Platform Brochure with Full Datasheet (V2, 2026)',
    'Accops Empowers Ecom Express to Enable Seamless WFH and Secure Endpoint Connectivity (Dataquest, Nov 2022)',
    'Accops for Government: Zero Trust Reference Architecture, Seven Integrated Components (2026 V2)',
    'Accops HyDesk: Thin and Zero Client Endpoints',
    'Accops HySecure Gateway: Zero Trust Remote Access Datasheet',
    'Accops Nano: Compliant BYOD Access from a USB Stick',
    'Alphasure Adopts DaaS to Enable Work from Anywhere, Records 70% Drop in Attrition and Saves 50% on Office Rent',
    'City Pharmacy Replaces Citrix XenApp with Accops HyWorks for ERP Virtualisation',
    'Food Processing Firm Adopts Accops Digital Workspace for Secure Work from Home (50% Lower TCO)',
    'Kalupur Bank Switches to ZTNA-Based Remote Access, Cuts Support Resolution Time 45x',
    'Major Indian DTH and OTT Platform: Secure Remote Access for 300+ Vendors',
    'Maveric Wins New Customers and Optimises OpEx by 20% Using Accops Secure Remote Access',
    'Textile Maker Switches to Rugged Thin Clients to Boost Shop-Floor Efficiency and Cut Endpoint Costs',
    'Top-5 Indian Private Bank: 3,000 to 25,000 Remote Users On-Prem and on Azure',
    'Two Leading Indian Private Banks: Secure Access, MFA and Biometrics',
    'Zulekha Hospital Empowers Doctors with ZTNA-Based Remote Access to Deliver Better Patient Care'];
  got text[];
begin
  -- 3. real reads
  foreach t in array array['sam_web_qa_public', 'sam_web_pages_public', 'sam_web_assets_public', 'sam_v1_public_assets',
                           'sam_web_qa', 'sam_web_pages', 'sam_web_page_rules', 'sam_web_blocked_patterns', 'sam_web_settings',
                           'sam_web_conversations', 'sam_web_messages', 'sam_web_events', 'sam_web_usage_daily', 'sam_web_rate',
                           'sam_web_answer_cache', 'sam_v1_assets', 'sam_v1_families', 'sam_v1_changes', 'sam_asset_cards',
                           'sam_sharepoint_files', 'sam_events', 'sam_asset_families', 'sam_passages', 'sam_ops_runs', 'core.terms'] loop
    begin
      execute 'select count(*) from ' || case when t like '%.%' then t else quote_ident(t) end into n;
      insert into _probe values ('read ' || t, case when t like '%\_public' or t = 'sam_v1_public_assets' then 'readable' else 'denied' end,
                                 'readable (' || n || ' rows)');
    exception when insufficient_privilege or undefined_table or invalid_schema_name then
      insert into _probe values ('read ' || t, case when t like '%\_public' or t = 'sam_v1_public_assets' then 'readable' else 'denied' end,
                                 'denied: ' || sqlerrm);
    end;
  end loop;

  -- 4. sensitive columns
  insert into _probe select 'column ' || v || '.' || c, 'absent',
    case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = v and column_name = c)
         then 'PRESENT' else 'absent' end
  from unnest(array['sam_web_qa_public', 'sam_web_pages_public', 'sam_web_assets_public']) v,
       unnest(array['client_actual', 'client', 'key_problem', 'use_for', 'stale_risk', 'needs_human', 'internal_reason', 'sharepoint_url',
                    'folder', 'modified_by', 'key_outcomes', 'status', 'origin', 'approved_by', 'review_by', 'content_hash',
                    'needs_recard', 'fetched_at']) c;

  -- 5. RPCs as the reader (writes are rolled back with the transaction)
  begin
    perform sam_web_page_group('https://accops-citrix-lp.vercel.app/');
    perform * from sam_web_roots('https://accops-citrix-lp.vercel.app/');
    perform * from sam_web_children('x');
    perform sam_web_admit('v_proof', 'iphash', 'typed', qh);
    perform sam_web_take_model_slot('openai');
    perform sam_web_cache_put(qh, 'general', '{"blocks":[],"chips":[]}', 'model');
    j := sam_web_cache_get(qh);
    perform sam_web_log_message(jsonb_build_object('id', 'f0f0f0f0-0000-4000-8000-000000000001', 'conversation_id', 'proof_conversation',
      'visitor_id', 'v_proof', 'page', 'https://accops-citrix-lp.vercel.app/', 'page_group', 'citrix-lp', 'country', 'IN', 'label', 'human',
      'signals', '[]'::jsonb, 'is_test', true, 'turn_kind', 'typed', 'question', 'proof', 'q_hash', qh, 'source', 'guard',
      'guard_reason', 'proof', 'refs', '[]'::jsonb, 'candidates', 0, 'tokens', 0, 'latency_ms', 1));
    perform sam_web_log_event(jsonb_build_object('conversation_id', 'proof_conversation', 'visitor_id', 'v_proof',
      'page', 'https://accops-citrix-lp.vercel.app/', 'name', 'chat_opened', 'country', 'IN'));
    j := j || jsonb_build_object('settings', sam_web_settings());
    insert into _probe values ('reader RPCs (settings, roots, children, page_group, admit, slot, cache put/get, log message/event)', 'callable',
                               case when j ? 'blocks' and j -> 'settings' ? 'cta_url' then 'callable' else 'callable but cache/settings returned null' end);
  exception when others then
    insert into _probe values ('reader RPCs (settings, roots, children, page_group, admit, slot, cache put/get, log message/event)', 'callable', 'ERROR: ' || sqlerrm);
  end;
  foreach t in array array['select sam_web_dashboard(30, false)', 'select sam_web_purge(180)', 'select sam_dashboard(30, false, array[''x''], ''Asia/Kolkata'')'] loop
    begin
      execute t;
      insert into _probe values (t, 'denied', 'callable');
    exception when insufficient_privilege or undefined_function then
      insert into _probe values (t, 'denied', 'denied: ' || sqlerrm);
    end;
  end loop;
  foreach t in array array['citrix renewal price went up', 'migrate from citrix without downtime', 'hyper-v nutanix vmware support',
                           'zero trust remote access for banks', 'citrx alternativ'] loop
    t0 := clock_timestamp();
    perform * from sam_web_search(t, 'citrix-lp', 12);
    ms := extract(epoch from clock_timestamp() - t0) * 1000;
    worst := greatest(worst, ms);
  end loop;
  insert into _probe values ('sam_web_search, worst of 5 queries', 'under 100 ms',
                             case when worst < 100 then 'under 100 ms (' || round(worst) || ' ms)' else 'SLOW: ' || round(worst) || ' ms' end);

  -- 6. blocked claims and the asset list (patterns read through the definer row function's own rule: re-check here
  -- with the literal claims, since the reader cannot read sam_web_blocked_patterns)
  -- fig: published figures, allowed only on case studies (26 Oct decision). always: blocked everywhere.
  -- A case study: pages_public.case_study, or an asset of type 'Case Study'. A pair counts as one only if every
  -- source is a case-study page or PDF.
  select count(*) into n from sam_web_pages_public p, jsonb_array_elements(p.facts) f
  where ((f ->> 'fact') || ' ' || (f ->> 'quote')) ~* '\mgartner\M|magic quadrant|\$\s?(220|132)\M|\millustrative\M|\mplaceholder\M|mid-term repricing|reduce seats at renewal|perpetual licensing remains available|sign-off'
     or (not p.case_study and ((f ->> 'fact') || ' ' || (f ->> 'quote')) ~* '\m10\s?x\M|\m4\s?x\M|\m40\s?%|\mTCO\M|total cost of ownership');
  insert into _probe values ('blocked claims in sam_web_pages_public facts', '0', n::text);
  select count(*) into n from sam_web_pages_public p
  where (coalesce(p.summary, '') || ' ' || p.title) ~* '\mgartner\M|magic quadrant|\millustrative\M|\mplaceholder\M|sign-off'
     or (not p.case_study and (coalesce(p.summary, '') || ' ' || p.title) ~* '\m10\s?x\M|\m4\s?x\M|\mTCO\M|total cost of ownership');
  insert into _probe values ('blocked claims in sam_web_pages_public titles/summaries', '0', n::text);
  select count(*) into n from sam_web_pages_public p where p.case_study and p.url !~* '^https://www\.accops\.com/';
  insert into _probe values ('case studies outside www.accops.com (the LP never is one)', '0', n::text);
  select count(*) into n from sam_web_qa_public q
  where (q.answer || ' ' || q.question) ~* '\mgartner\M|magic quadrant|\$\s?(220|132)\M|sign-off'
     or ((q.answer || ' ' || q.question || ' ' || coalesce(q.visual_data::text, '')) ~* '\m10\s?x\M|\m4\s?x\M|\m40\s?%|\mTCO\M|total cost of ownership'
         and exists (select 1 from unnest(q.sources) s
                     where s not in (select url from sam_web_pages_public where case_study
                                     union select public_url from sam_web_assets_public where asset_type = 'Case Study')));
  insert into _probe values ('blocked claims in sam_web_qa_public (figures only with case-study-only sources)', '0', n::text);
  select count(*) into n from sam_web_assets_public a
  where (a.title || ' ' || coalesce(a.brief, '')) ~* '\mgartner\M|magic quadrant|sign-off'
     or (a.asset_type <> 'Case Study' and (a.title || ' ' || coalesce(a.brief, '')) ~* '\m10\s?x\M|\m4\s?x\M|\mTCO\M|total cost of ownership');
  insert into _probe values ('blocked claims in sam_web_assets_public', '0', n::text);
  select count(*) into n from sam_web_pages_public where url !~* '^https://(www\.accops\.com|accops-citrix-lp\.vercel\.app)([/?#]|$)';
  insert into _probe values ('pages outside the host allowlist', '0', n::text);

  select array_agg(title order by title) into got from sam_web_assets_public;
  insert into _probe values ('sam_web_assets_public titles', 'as approved',
    case when got is not distinct from (select array_agg(x order by x) from unnest(expected) x) then 'as approved (' || cardinality(got) || ')'
         else 'DIFF missing: ' || coalesce((select string_agg(x, ' | ') from unnest(expected) x where x <> all(coalesce(got, '{}'))), '-')
              || ' / extra: ' || coalesce((select string_agg(x, ' | ') from unnest(got) x where x <> all(expected)), '-') end);
end $$;
reset role;

select object, expect, got, (got like expect || '%') as ok from _probe order by ok, object;
rollback;   -- nothing to keep
