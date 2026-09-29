-- SAM feedback loop. Applied to accops-marketing-dashboard (ref iwqhayuoxnrhqzozznes) as migration
-- sam_feedback_loop on 30 September 2026. Code: web/lib/feedback.ts, web/app/api/feedback/route.ts.
--
-- 1. "What I need doesn't exist" is a content-request vote (source/channel 'feedback'), exactly like
--    pressing "Ask marketing to create this", keyed by the answered question's topic key.
--    - A rating never double-counts: if the rep already has a vote for that answer (event_id), the
--      rating adds nothing.
--    - An explicit request for the same answer REPLACES the rating's vote (the rep's own words win);
--      a request the rating created and nobody else joined is removed with it.
--    - Changing the rating to "Yes" or "Wrong asset" retracts the vote the same way.
-- 2. sam_rank_feedback: a human cleared a learned "wrong asset" demotion. Demotions themselves are
--    computed from sam_events (web/lib/feedback.ts, learnDemotions); only the clears are stored.

alter table sam_content_requests drop constraint if exists sam_content_requests_source_check;
alter table sam_content_requests add constraint sam_content_requests_source_check check (source in ('rep', 'gap', 'feedback'));

create index if not exists sam_creq_votes_event_idx on sam_content_request_votes (user_id, event_id) where event_id is not null;

create table if not exists sam_rank_feedback (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  asset_id    text not null,          -- sam_events.result_ids entry (assetKey: file path, else title)
  topic       text not null,          -- the demotion's topic tokens, sorted, space-joined
  cleared_by  text not null
);
create index if not exists sam_rank_feedback_idx on sam_rank_feedback (asset_id, topic, created_at desc);
alter table sam_rank_feedback enable row level security;

-- Remove the rating's vote for one answer. Returns how many votes went.
create or replace function sam_retract_feedback_vote(p_user text, p_event_id bigint)
returns int language plpgsql security definer set search_path = public as $$
declare rid bigint; n int := 0;
begin
  for rid in delete from sam_content_request_votes where user_id = p_user and event_id = p_event_id and channel = 'feedback' returning request_id loop
    n := n + 1;
    -- A request only this rating created goes with it; anything marketing touched or others joined stays.
    delete from sam_content_requests r where r.id = rid and r.source = 'feedback' and r.status = 'open'
      and not exists (select 1 from sam_content_request_votes v where v.request_id = r.id)
      and not exists (select 1 from sam_content_requests m where m.merged_into = r.id);
  end loop;
  return n;
end $$;

create or replace function sam_file_content_request(
  p_key text, p_title text, p_asset_type text, p_product text, p_vertical text, p_description text,
  p_user text, p_channel text, p_question text, p_note text, p_event_id bigint, p_is_test boolean,
  p_source text default 'rep'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r sam_content_requests;
  v_new_req boolean := false;
  v_new_vote boolean := false;
  n int;
begin
  if p_event_id is not null and p_user is not null then
    if coalesce(p_source, 'rep') = 'feedback' then
      -- Already counted for this answer (an explicit request, or the same rating pressed twice).
      select q.* into r from sam_content_request_votes v join sam_content_requests q on q.id = v.request_id
        where v.user_id = p_user and v.event_id = p_event_id order by v.id desc limit 1;
      if found then
        select count(distinct user_id) into n from sam_content_request_votes where request_id = r.id;
        return jsonb_build_object('id', r.id, 'title', r.title, 'status', r.status, 'demand', n,
                                  'new_request', false, 'new_vote', false, 'skipped', true);
      end if;
    else
      perform sam_retract_feedback_vote(p_user, p_event_id);
    end if;
  end if;
  select * into r from sam_content_requests
    where topic_key = p_key and is_test = p_is_test and status in ('open', 'planned', 'in_progress') limit 1;
  if not found then
    select t.* into r from sam_content_requests m join sam_content_requests t on t.id = m.merged_into
      where m.topic_key = p_key and m.is_test = p_is_test and t.status in ('open', 'planned', 'in_progress')
      order by m.id desc limit 1;
  end if;
  if not found then
    begin
      insert into sam_content_requests (topic_key, title, asset_type, product, vertical, description, created_by, is_test, source)
        values (p_key, p_title, p_asset_type, p_product, p_vertical, p_description, p_user, p_is_test, coalesce(p_source, 'rep'))
        returning * into r;
      v_new_req := true;
    exception when unique_violation then
      select * into r from sam_content_requests
        where topic_key = p_key and is_test = p_is_test and status in ('open', 'planned', 'in_progress') limit 1;
    end;
  end if;
  if p_user is not null then
    insert into sam_content_request_votes (request_id, user_id, channel, question, note, event_id)
      values (r.id, p_user, coalesce(p_channel, 'web'), p_question, p_note, p_event_id)
      on conflict (request_id, user_id) do update
        set note = coalesce(excluded.note, sam_content_request_votes.note),
            -- An explicit ask upgrades a rating's vote to the rep's own.
            channel = case when sam_content_request_votes.channel = 'feedback' then excluded.channel else sam_content_request_votes.channel end,
            question = case when sam_content_request_votes.channel = 'feedback' then coalesce(excluded.question, sam_content_request_votes.question) else sam_content_request_votes.question end,
            event_id = case when sam_content_request_votes.channel = 'feedback' then coalesce(excluded.event_id, sam_content_request_votes.event_id) else sam_content_request_votes.event_id end
      returning (xmax = 0) into v_new_vote;
    update sam_content_requests set updated_at = now() where id = r.id;
  end if;
  select count(distinct user_id) into n from sam_content_request_votes where request_id = r.id;
  return jsonb_build_object('id', r.id, 'title', r.title, 'status', r.status, 'demand', n,
                            'new_request', v_new_req, 'new_vote', v_new_vote);
end $$;

revoke all on function sam_file_content_request(text, text, text, text, text, text, text, text, text, text, bigint, boolean, text) from public, anon, authenticated;
revoke all on function sam_retract_feedback_vote(text, bigint) from public, anon, authenticated;
