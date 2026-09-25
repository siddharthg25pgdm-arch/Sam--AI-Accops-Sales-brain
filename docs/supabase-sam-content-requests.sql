-- SAM content requests: "ask marketing to create this". Applied to accops-marketing-dashboard
-- (ref iwqhayuoxnrhqzozznes) as migration sam_content_requests on 25 September 2026.
--
-- A rep asks SAM for something the library does not have (a Remote Browser Isolation brochure), gets
-- the closest substitutes, and can ask marketing to create the real thing. Marketing sees a queue
-- ranked by DEMAND = distinct reps, so fifteen salespeople wanting the same kind of brochure reads
-- as fifteen, and one rep rephrasing five times reads as one.
--
-- Two tables: the thing wanted (one row, however many ask) and who asked (one row per rep per
-- request). Repeat asks merge on topic_key, computed in web/lib/requests.ts (requestKey):
-- type | canonical product | vertical | topic words (topic words only when no product or vertical).
-- Statuses: open -> planned -> in_progress -> done | declined; 'merged' marks a duplicate folded
-- into another request (merged_into), kept so later asks under its key still land on the survivor.

create table if not exists sam_content_requests (
  id              bigserial primary key,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  topic_key       text not null,
  title           text not null,
  asset_type      text,                       -- Case Study | Whitepaper | Battlecard | Deck | Brochure
  product         text,
  vertical        text,
  description     text,
  status          text not null default 'open'
                  check (status in ('open', 'planned', 'in_progress', 'done', 'declined', 'merged')),
  owner           text,
  due_date        date,
  delivered_title text,
  delivered_url   text,
  decline_reason  text,
  notes           text,
  merged_into     bigint references sam_content_requests(id),
  source          text not null default 'rep' check (source in ('rep', 'gap')),  -- gap = promoted by marketing
  created_by      text,
  closed_at       timestamptz,
  -- Same rule as sam_events.is_test: local dev, test identities, x-sam-test. Test requests get their
  -- own rows (the unique index includes is_test) so test data never lands in marketing's queue.
  is_test         boolean not null default false
);

-- One ACTIVE request per topic. Partial, so the same thing can be asked for again after it is done.
create unique index if not exists sam_creq_active_key
  on sam_content_requests (topic_key, is_test)
  where status in ('open', 'planned', 'in_progress');
create index if not exists sam_creq_status_idx on sam_content_requests (status, updated_at desc);

create table if not exists sam_content_request_votes (
  id          bigserial primary key,
  request_id  bigint not null references sam_content_requests(id) on delete cascade,
  user_id     text not null,
  channel     text not null default 'web',     -- web | whatsapp | api | mcp | gap (asked SAM, promoted by marketing)
  question    text,                            -- what the rep typed to SAM
  note        text,                            -- customer, deadline, why
  event_id    bigint,                          -- the sam_events question it came from
  created_at  timestamptz not null default now(),
  notified_at timestamptz,                     -- delivery sent over WhatsApp
  seen_at     timestamptz,                     -- delivery seen on the web
  unique (request_id, user_id)                 -- demand = distinct reps
);
create index if not exists sam_creq_votes_user_idx on sam_content_request_votes (user_id, created_at desc);

alter table sam_content_requests enable row level security;
alter table sam_content_request_votes enable row level security;

-- File a request (or add a vote to the existing one) atomically. Returns the request and its demand.
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
  select * into r from sam_content_requests
    where topic_key = p_key and is_test = p_is_test and status in ('open', 'planned', 'in_progress') limit 1;
  if not found then
    -- A duplicate marketing merged away: its askers belong on the survivor.
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
        set note = coalesce(excluded.note, sam_content_request_votes.note)
      returning (xmax = 0) into v_new_vote;
    update sam_content_requests set updated_at = now() where id = r.id;
  end if;
  select count(distinct user_id) into n from sam_content_request_votes where request_id = r.id;
  return jsonb_build_object('id', r.id, 'title', r.title, 'status', r.status, 'demand', n,
                            'new_request', v_new_req, 'new_vote', v_new_vote);
end $$;

-- Fold a duplicate into another request: votes move (a rep on both counts once), the duplicate is
-- kept as status 'merged' so its key keeps routing to the survivor.
create or replace function sam_merge_content_requests(p_from bigint, p_into bigint)
returns void language plpgsql security definer set search_path = public as $$
declare f sam_content_requests; t sam_content_requests;
begin
  if p_from = p_into then raise exception 'cannot merge a request into itself'; end if;
  select * into f from sam_content_requests where id = p_from;
  select * into t from sam_content_requests where id = p_into;
  if f.id is null or t.id is null then raise exception 'request not found'; end if;
  if t.status not in ('open', 'planned', 'in_progress') then raise exception 'merge into an active request'; end if;
  if f.is_test <> t.is_test then raise exception 'cannot merge test and real requests'; end if;
  insert into sam_content_request_votes (request_id, user_id, channel, question, note, event_id, created_at)
    select p_into, user_id, channel, question, note, event_id, created_at
    from sam_content_request_votes where request_id = p_from
    on conflict (request_id, user_id) do nothing;
  delete from sam_content_request_votes where request_id = p_from;
  update sam_content_requests set status = 'merged', merged_into = p_into, updated_at = now(), closed_at = now() where id = p_from;
  update sam_content_requests set merged_into = p_into where merged_into = p_from;
  update sam_content_requests set updated_at = now() where id = p_into;
end $$;

revoke all on function sam_file_content_request(text, text, text, text, text, text, text, text, text, text, bigint, boolean, text) from public, anon, authenticated;
revoke all on function sam_merge_content_requests(bigint, bigint) from public, anon, authenticated;
