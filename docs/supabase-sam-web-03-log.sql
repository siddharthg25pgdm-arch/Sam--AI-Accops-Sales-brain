-- SAM website chatbot, stage 1: conversation log, limits, model ceiling, answer cache. Migration name sam_web_03_log.
-- Needs 01 (settings). The cache checks sam_v1_public_asset_rows (v1, applied 30 Sep) directly.
-- NOT APPLIED. Awaiting Siddharth's approval (docs/plans/web-s1-a-APPROVAL.md). Record the date here when applied.
-- Safe to run twice.
--
-- sam_web_reader gets NO table grants: it writes only through the six functions below (owner rights, fixed
-- search_path, inputs length-capped), so a stolen reader JWT can append log rows and burn rate-limit counters,
-- and can read nothing back except a cached answer by its exact sha256 key.
--
--   sam_web_conversations  one row per widget conversation, with the human/suspect/bot label (only escalates)
--   sam_web_messages       the ONLY place a visitor's question text is stored
--   sam_web_events         allowlisted widget events (no free text)
--   sam_web_usage_daily    model answers per IST day (the 300 ceiling, the Groq cap) and tokens
--   sam_web_rate           rate-limit and repeat counters (rows older than 2 days deleted by sam_web_admit)
--   sam_web_answer_cache   tier-2 shared cache, key = q_hash, valid 24 h and only while knowledge is unchanged

-- ---------------------------------------------------------------- tables

create table if not exists sam_web_conversations (
  id         text primary key check (id ~ '^[A-Za-z0-9_.:-]{1,80}$'),       -- the widget's id (ask route's Id rule)
  visitor_id text not null check (char_length(visitor_id) <= 80),
  page       text check (char_length(page) <= 500),
  page_group text not null default 'general' check (char_length(page_group) <= 80),
  country    text check (char_length(country) <= 8),
  label      text not null default 'human' check (label in ('human', 'suspect', 'bot')),
  signals    text[] not null default '{}' check (cardinality(signals) <= 20),
  started_at timestamptz not null default now(),
  is_test    boolean not null default false
);
create index if not exists sam_web_conversations_started_idx on sam_web_conversations (started_at);

create table if not exists sam_web_messages (
  id              uuid primary key default gen_random_uuid(),            -- the ask route's message_id
  conversation_id text not null references sam_web_conversations (id) on delete cascade,
  turn_kind       text not null check (turn_kind in ('click', 'typed')),
  qa_id           text check (char_length(qa_id) <= 80),
  question        text check (char_length(question) <= 500),
  q_hash          text check (q_hash ~ '^[0-9a-f]{64}$'),
  source          text not null check (source in ('bank', 'intent', 'cache', 'model', 'fallback', 'guard', 'limited', 'repeat')),
  verdict         text check (verdict in ('answered', 'partial', 'none')),
  refs            text[] not null default '{}',
  candidates      int not null default 0,                                 -- how many candidates sam_web_search offered
  model           text,
  tokens          int not null default 0,
  latency_ms      int,
  error           text,
  guard_reason    text,                                                   -- which pre-guard rule answered (source 'guard')
  created_at      timestamptz not null default now()
);
create index if not exists sam_web_messages_conversation_idx on sam_web_messages (conversation_id);
create index if not exists sam_web_messages_created_idx on sam_web_messages (created_at);

create table if not exists sam_web_events (
  id              bigint generated always as identity primary key,
  conversation_id text check (char_length(conversation_id) <= 80),
  visitor_id      text not null check (char_length(visitor_id) <= 80),
  page            text check (char_length(page) <= 500),
  country         text check (char_length(country) <= 8),
  name           text not null check (name in ('chat_opened', 'chat_closed', 'popup_shown', 'popup_clicked', 'popup_dismissed',
                    'question_clicked', 'answer_shown', 'doc_opened', 'talk_to_sales_clicked', 'filter_used', 'step_viewed')),
  qa_id           text check (char_length(qa_id) <= 80),
  ref             text check (char_length(ref) <= 300),
  is_test         boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists sam_web_events_created_idx on sam_web_events (created_at);

create table if not exists sam_web_usage_daily (
  day           date primary key,             -- IST
  model_answers int not null default 0,       -- OpenAI slots taken
  groq_answers  int not null default 0,       -- Groq slots taken
  tokens        bigint not null default 0
);

create table if not exists sam_web_rate (
  bucket       text not null,                 -- tm:/td:/ce:<visitor>, ip:<ip hash>, q:<visitor>:<q_hash>
  window_start timestamptz not null,
  n            int not null default 1,
  primary key (bucket, window_start)
);
create index if not exists sam_web_rate_window_idx on sam_web_rate (window_start);

create table if not exists sam_web_answer_cache (
  q_hash     text primary key check (q_hash ~ '^[0-9a-f]{64}$'),
  page_group text not null,
  answer     jsonb not null check (octet_length(answer::text) <= 8192),
  source     text not null check (source in ('model', 'fallback')),   -- every tier-3 outcome, including 'none'
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- write RPCs (granted to sam_web_reader)

-- null = go ahead, 'rate' = over a limit, 'repeat' = the nth same question within the window (settings).
-- Typed: 6 / minute and 20 / IST day per visitor, 60 / IST day per IP hash. Clicks and events: 300 / IST day per
-- visitor. Attempts count, including refused ones. The eval header skips this call in the route, not here.
create or replace function sam_web_admit(visitor text, ip_hash text, kind text, q_hash text default null)
returns text language plpgsql volatile security definer set search_path = public, pg_catalog as $$
declare
  today timestamptz := ((now() at time zone 'Asia/Kolkata')::date)::timestamp at time zone 'Asia/Kolkata';
  v text := left(visitor, 64);
  n_min int; n_day int; n_ip int := 0; n_rep int;
  rep_n int := coalesce((select value::int from sam_web_settings where key = 'repeat_n'), 3);
  rep_win int := coalesce((select value::int from sam_web_settings where key = 'repeat_window_min'), 10);
begin
  if coalesce(v, '') = '' or kind is null or kind not in ('typed', 'click', 'event') then return 'rate'; end if;
  delete from sam_web_rate where window_start < now() - interval '2 days';
  if kind <> 'typed' then
    insert into sam_web_rate as r values ('ce:' || v, today, 1)
      on conflict (bucket, window_start) do update set n = r.n + 1 returning r.n into n_day;
    return case when n_day > 300 then 'rate' end;
  end if;
  insert into sam_web_rate as r values ('tm:' || v, date_trunc('minute', now()), 1)
    on conflict (bucket, window_start) do update set n = r.n + 1 returning r.n into n_min;
  insert into sam_web_rate as r values ('td:' || v, today, 1)
    on conflict (bucket, window_start) do update set n = r.n + 1 returning r.n into n_day;
  if coalesce(ip_hash, '') <> '' then
    insert into sam_web_rate as r values ('ip:' || left(ip_hash, 64), today, 1)
      on conflict (bucket, window_start) do update set n = r.n + 1 returning r.n into n_ip;
  end if;
  if n_min > 6 or n_day > 20 or n_ip > 60 then return 'rate'; end if;
  if coalesce(q_hash, '') <> '' then
    insert into sam_web_rate as r values ('q:' || v || ':' || left(q_hash, 64), clock_timestamp(), 1)
      on conflict (bucket, window_start) do update set n = r.n + 1;
    select coalesce(sum(r.n), 0) into n_rep from sam_web_rate r
      where r.bucket = 'q:' || v || ':' || left(q_hash, 64) and r.window_start > now() - make_interval(mins => rep_win);
    if n_rep >= rep_n then return 'repeat'; end if;
  end if;
  return null;
end $$;

-- true = a slot was reserved for one model answer today (IST). One upsert; the row lock makes concurrent callers
-- queue on the day's row and re-check the cap, so exactly the cap succeed. model_enabled=false closes both providers.
create or replace function sam_web_take_model_slot(provider text)
returns boolean language plpgsql volatile security definer set search_path = public, pg_catalog as $$
declare
  d date := (now() at time zone 'Asia/Kolkata')::date;
  cap int;
  ok boolean;
begin
  if coalesce((select value from sam_web_settings where key = 'model_enabled'), 'false') <> 'true' then return false; end if;
  if provider = 'openai' then cap := coalesce((select value::int from sam_web_settings where key = 'model_ceiling'), 0);
  elsif provider = 'groq' then cap := coalesce((select value::int from sam_web_settings where key = 'groq_daily_cap'), 0);
  else return false;
  end if;
  if cap <= 0 then return false; end if;
  insert into sam_web_usage_daily as u (day, model_answers, groq_answers)
    values (d, (provider = 'openai')::int, (provider = 'groq')::int)
  on conflict (day) do update
    set model_answers = u.model_answers + (provider = 'openai')::int,
        groq_answers  = u.groq_answers + (provider = 'groq')::int
    where (provider = 'openai' and u.model_answers < cap) or (provider = 'groq' and u.groq_answers < cap)
  returning true into ok;
  return coalesce(ok, false);
end $$;

-- The cached Answer JSON, or null. Valid for 24 h, and only if written after the last knowledge change
-- (knowledge_version) and after the newest public asset's updated_at.
create or replace function sam_web_cache_get(q_hash text)
returns jsonb language sql stable security definer set search_path = public, pg_catalog as $$
  select c.answer from sam_web_answer_cache c
  where c.q_hash = sam_web_cache_get.q_hash
    and c.created_at > now() - interval '24 hours'
    and c.created_at > coalesce((select s.value::timestamptz from sam_web_settings s where s.key = 'knowledge_version'), '-infinity')
    and c.created_at > coalesce((select max(a.updated_at) from sam_v1_public_asset_rows() a), '-infinity')
$$;

-- Best effort: an oversized answer, a bad key or a source other than model/fallback is silently not cached.
create or replace function sam_web_cache_put(q_hash text, page_group text, answer jsonb, source text)
returns void language sql volatile security definer set search_path = public, pg_catalog as $$
  insert into sam_web_answer_cache as c (q_hash, page_group, answer, source, created_at)
  select $1, left(coalesce($2, 'general'), 80), $3, $4, now()
  where $1 ~ '^[0-9a-f]{64}$' and $3 is not null and octet_length($3::text) <= 8192 and $4 in ('model', 'fallback')
  on conflict on constraint sam_web_answer_cache_pkey do update
    set page_group = excluded.page_group, answer = excluded.answer, source = excluded.source, created_at = excluded.created_at
$$;

-- A JSON array of strings -> text[] (first n items); anything else -> '{}'. Internal helper, not granted.
create or replace function sam_web_text_array(j jsonb, n int) returns text[]
language sql immutable set search_path = public, pg_catalog as $$
  select case when jsonb_typeof(j) = 'array'
              then (select coalesce(array_agg(left(x, 300) order by i), '{}') from jsonb_array_elements_text(j) with ordinality t(x, i) where i <= n)
              else '{}'::text[] end
$$;

-- One message, m = the ask route's log object: {id, turn_kind, qa_id, question, q_hash, source, verdict, refs,
-- candidates, model, tokens, latency_ms, error, guard_reason, conversation_id, visitor_id, page, page_group, country,
-- label, signals, is_test}. Creates the conversation on first sight; its label only escalates human -> suspect -> bot
-- and its signals accumulate. Tokens are added to today's usage. Unknown keys are ignored.
create or replace function sam_web_log_message(m jsonb)
returns void language plpgsql volatile security definer set search_path = public, pg_catalog as $$
declare tok int := greatest(coalesce((m ->> 'tokens')::int, 0), 0);
begin
  insert into sam_web_conversations as c (id, visitor_id, page, page_group, country, label, signals, is_test)
  values (m ->> 'conversation_id', left(m ->> 'visitor_id', 80), left(m ->> 'page', 500), left(coalesce(m ->> 'page_group', 'general'), 80),
          left(m ->> 'country', 8), coalesce(m ->> 'label', 'human'), sam_web_text_array(m -> 'signals', 20),
          coalesce((m ->> 'is_test')::boolean, false))
  on conflict (id) do update set
    label   = case when array_position(array['human', 'suspect', 'bot'], excluded.label)
                      > array_position(array['human', 'suspect', 'bot'], c.label) then excluded.label else c.label end,
    signals = (select coalesce(array_agg(distinct x), '{}') from unnest(c.signals || excluded.signals) x)[1:20],
    is_test = c.is_test or excluded.is_test;
  if tok > 0 then
    insert into sam_web_usage_daily as u (day, tokens) values ((now() at time zone 'Asia/Kolkata')::date, tok)
    on conflict (day) do update set tokens = u.tokens + excluded.tokens;
  end if;
  insert into sam_web_messages (id, conversation_id, turn_kind, qa_id, question, q_hash, source, verdict, refs, candidates,
                                model, tokens, latency_ms, error, guard_reason)
  values (coalesce((m ->> 'id')::uuid, gen_random_uuid()), m ->> 'conversation_id', m ->> 'turn_kind', left(m ->> 'qa_id', 80),
          left(m ->> 'question', 500), m ->> 'q_hash', m ->> 'source', m ->> 'verdict', sam_web_text_array(m -> 'refs', 12),
          coalesce((m ->> 'candidates')::int, 0), left(m ->> 'model', 60), tok, (m ->> 'latency_ms')::int,
          left(m ->> 'error', 200), left(m ->> 'guard_reason', 80));
end $$;

-- One event, e = {conversation_id?, visitor_id, page, name, qa_id?, ref?, country?, is_test?}. The table's check
-- rejects any name outside the allowlist.
create or replace function sam_web_log_event(e jsonb)
returns void language sql volatile security definer set search_path = public, pg_catalog as $$
  insert into sam_web_events (conversation_id, visitor_id, page, country, name, qa_id, ref, is_test)
  values (left(e ->> 'conversation_id', 80), left(e ->> 'visitor_id', 80), left(e ->> 'page', 500), left(e ->> 'country', 8),
          e ->> 'name', left(e ->> 'qa_id', 80), left(e ->> 'ref', 300), coalesce((e ->> 'is_test')::boolean, false))
$$;

-- ---------------------------------------------------------------- service-role only

-- Everything the Website tab shows, in one call. usd_per_mtok: blended gpt-6-luna price per million tokens
-- (about 2.5k in at $0.10/M + ~50 out at $0.50/M per answer).
create or replace function sam_web_dashboard(days int default 30, include_test boolean default false, usd_per_mtok numeric default 0.11)
returns jsonb language sql stable security definer set search_path = public, pg_catalog as $$
  with conv as (
    select * from sam_web_conversations
    where started_at > now() - make_interval(days => $1) and ($2 or not is_test)
  ),
  m as (
    select m.*, c.label, c.country from sam_web_messages m join conv c on c.id = m.conversation_id
  ),
  h as (select * from m where label = 'human'),
  ev as (
    select * from sam_web_events where created_at > now() - make_interval(days => $1) and ($2 or not is_test)
  )
  select jsonb_build_object(
    'days', $1,
    'conversations', (select jsonb_object_agg(label, n) from (select label, count(*) n from conv group by label) x),
    'messages', (select count(*) from m),
    'tier_mix', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'source', source, 'label', label, 'n', n) order by d, source, label), '[]')
                 from (select (created_at at time zone 'Asia/Kolkata')::date d, source, label, count(*) n from m group by 1, 2, 3) x),
    'without_model_share', (select round(count(*) filter (where source in ('bank', 'intent', 'cache'))::numeric
                                         / nullif(count(*) filter (where source in ('bank', 'intent', 'cache', 'model')), 0), 3) from h),
    'tokens', (select coalesce(sum(tokens), 0) from m),
    'est_usd', (select round(coalesce(sum(tokens), 0) * $3 / 1e6, 4) from m),
    'cost_per_human_conversation', (select round(coalesce(sum(tokens), 0) * $3 / 1e6 / nullif(count(distinct conversation_id), 0), 6) from h),
    'missed', (select coalesce(jsonb_agg(jsonb_build_object('at', created_at, 'question', question, 'source', source, 'verdict', verdict,
                                                            'refs', refs, 'conversation_id', conversation_id) order by created_at desc), '[]')
               from (select * from h where turn_kind = 'typed' and (source in ('model', 'fallback') or verdict = 'partial')
                     order by created_at desc limit 200) x),
    'events', (select jsonb_object_agg(name, n) from (select name, count(*) n from ev group by name) x),
    'cta_clicks', (select count(*) from ev where name = 'talk_to_sales_clicked'),
    'countries', (select jsonb_object_agg(coalesce(country, '?'), n) from (select country, count(*) n from conv group by country) x),
    'ceiling', (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'model_answers', model_answers, 'groq_answers', groq_answers,
                                                             'tokens', tokens) order by day), '[]')
                from sam_web_usage_daily where day > (now() at time zone 'Asia/Kolkata')::date - $1),
    'model_ceiling', (select value::int from sam_web_settings where key = 'model_ceiling'),
    'groq_daily_cap', (select value::int from sam_web_settings where key = 'groq_daily_cap')
  )
$$;

-- Retention (scheduled in stage 2). Returns what it deleted.
create or replace function sam_web_purge(days int default 180)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_catalog as $$
declare n_conv int; n_ev int; n_cache int; n_rate int;
begin
  delete from sam_web_conversations c where c.started_at < now() - make_interval(days => $1)
    and not exists (select 1 from sam_web_messages m where m.conversation_id = c.id and m.created_at >= now() - make_interval(days => $1));
  get diagnostics n_conv = row_count;
  delete from sam_web_events where created_at < now() - make_interval(days => $1);
  get diagnostics n_ev = row_count;
  delete from sam_web_answer_cache where created_at < now() - interval '2 days';
  get diagnostics n_cache = row_count;
  delete from sam_web_rate where window_start < now() - interval '2 days';
  get diagnostics n_rate = row_count;
  return jsonb_build_object('conversations', n_conv, 'events', n_ev, 'cache', n_cache, 'rate', n_rate);
end $$;

-- ---------------------------------------------------------------- access

alter table sam_web_conversations enable row level security;
alter table sam_web_messages enable row level security;
alter table sam_web_events enable row level security;
alter table sam_web_usage_daily enable row level security;
alter table sam_web_rate enable row level security;
alter table sam_web_answer_cache enable row level security;
revoke all on sam_web_conversations, sam_web_messages, sam_web_events, sam_web_usage_daily, sam_web_rate, sam_web_answer_cache
  from public, anon, authenticated;
grant select on sam_web_conversations, sam_web_messages, sam_web_events, sam_web_usage_daily, sam_web_rate, sam_web_answer_cache
  to service_role;

revoke execute on function sam_web_admit(text, text, text, text), sam_web_take_model_slot(text), sam_web_cache_get(text),
  sam_web_cache_put(text, text, jsonb, text), sam_web_log_message(jsonb), sam_web_log_event(jsonb), sam_web_text_array(jsonb, int),
  sam_web_dashboard(int, boolean, numeric), sam_web_purge(int)
  from public, anon, authenticated;
grant execute on function sam_web_admit(text, text, text, text), sam_web_take_model_slot(text), sam_web_cache_get(text),
  sam_web_cache_put(text, text, jsonb, text), sam_web_log_message(jsonb), sam_web_log_event(jsonb)
  to sam_web_reader, service_role;
grant execute on function sam_web_dashboard(int, boolean, numeric), sam_web_purge(int) to service_role;
