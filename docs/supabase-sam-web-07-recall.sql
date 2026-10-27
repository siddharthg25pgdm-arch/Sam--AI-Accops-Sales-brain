-- SAM website chatbot: welcome-back memory (Siddharth, 27 Oct 2026). Migration name sam_web_07_recall.
-- Needs 02 (sam_web_qa_public, sam_web_pages_public) and 03 (the log tables). Redefines the event-name check last set
-- by 05, so apply order is 05, 06, 07 (07 already includes 05's booking_opened; running 05 AFTER 07 would drop
-- page_viewed again). NOT APPLIED. Siddharth applies it. Record the date here when applied. Safe to run twice. Additive.
--
--   page_viewed           a new allowlisted event: the loader logs one per page load (visitor id + page URL, no text),
--                         so the bot can remember which public pages a device read
--   sam_web_recall(...)   what the bot may say to a returning device: approved question labels and public page titles,
--                         nothing else. Granted to sam_web_reader ONLY.
--   two indexes           the recall's lookups by visitor id
--
-- Memory is per DEVICE, never per IP (a shared office or mobile IP would show one person's topics to a colleague): the
-- key is a random UUID the loader keeps in the host page's own storage for 90 days (session-only for EU/EEA/UK/CH).
-- The recall looks back 90 days and returns null for an unknown id, a malformed id, and a known id with nothing
-- recallable alike, so a caller cannot even tell whether an id was ever seen.

-- ---------------------------------------------------------------- the page_viewed event

-- 05's allowlist (03's plus booking_opened) plus page_viewed. No free text, as before.
alter table sam_web_events drop constraint if exists sam_web_events_name_check;
alter table sam_web_events add constraint sam_web_events_name_check check (name in ('chat_opened', 'chat_closed', 'popup_shown',
  'popup_clicked', 'popup_dismissed', 'question_clicked', 'answer_shown', 'doc_opened', 'talk_to_sales_clicked', 'filter_used',
  'step_viewed', 'booking_opened', 'page_viewed'));

create index if not exists sam_web_conversations_visitor_idx on sam_web_conversations (visitor_id);
create index if not exists sam_web_events_visitor_idx on sam_web_events (visitor_id, created_at desc);

-- ---------------------------------------------------------------- the recall

-- {last_qa: [{id, question}], last_page: {url, title} | null, last_seen} or null.
--   last_qa    up to 3 distinct pairs this device asked or clicked (sam_web_messages.qa_id: a chip / starter / teaser
--              click, or a typed question the bank matched) in the last 90 days, most recent first, in conversations
--              not labelled bot. Joined through sam_web_qa_public, so a retired, unapproved, expired or blocked pair
--              never comes back, and `question` is the APPROVED label (never what the visitor typed: typed text lives
--              only in sam_web_messages.question, which this function never reads).
--   last_page  the most recent page this device had any event on in the last 90 days, other than not_page (the page
--              it is on now; trailing slashes ignored), and only if that page has a card in sam_web_pages_public:
--              its url and public title.
--   last_seen  the device's latest event or message in the window.
create or replace function sam_web_recall(visitor_id text, not_page text default null)
returns jsonb language sql stable security definer set search_path = public, pg_catalog as $$
  with v as (
    select $1 as id, now() - interval '90 days' as since
    where $1 ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  conv as (
    select c.id from sam_web_conversations c, v where c.visitor_id = v.id and c.label <> 'bot'
  ),
  msg as (
    select m.qa_id, m.created_at from sam_web_messages m join conv on conv.id = m.conversation_id, v
    where m.created_at > v.since
  ),
  qa as (
    select q.id, q.question, a.last_at
    from (select qa_id, max(created_at) as last_at from msg where qa_id is not null group by qa_id) a
    join sam_web_qa_public q on q.id = a.qa_id
    order by a.last_at desc, q.id
    limit 3
  ),
  ev as (
    select e.page, e.created_at from sam_web_events e, v
    where e.visitor_id = v.id and e.created_at > v.since
  ),
  pg as (
    select p.url, p.title
    from (select page, created_at from ev
          where page is not null and rtrim(page, '/') is distinct from rtrim(coalesce($2, ''), '/')
          order by created_at desc limit 50) e
    join sam_web_pages_public p on rtrim(p.url, '/') = rtrim(e.page, '/')
    order by e.created_at desc
    limit 1
  )
  select case when exists (select 1 from qa) or exists (select 1 from pg) then jsonb_build_object(
    'last_qa',   (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'question', question) order by last_at desc, id), '[]'::jsonb) from qa),
    'last_page', (select jsonb_build_object('url', url, 'title', title) from pg),
    'last_seen', greatest((select max(created_at) from ev), (select max(created_at) from msg)))
  end
$$;

-- ---------------------------------------------------------------- access

-- The website's reader only (not anon, not authenticated, not even service_role: nothing else needs it).
revoke execute on function sam_web_recall(text, text) from public, anon, authenticated, service_role;
grant execute on function sam_web_recall(text, text) to sam_web_reader;

-- ---------------------------------------------------------------- proof (run after applying; expected in comments)
-- select sam_web_recall('not-a-uuid');                                        -- null
-- select sam_web_recall(gen_random_uuid()::text);                             -- null (unknown id)
-- select sam_web_recall(visitor_id) from sam_web_conversations
--   where visitor_id ~ '^[0-9a-f]{8}-' order by started_at desc limit 5;      -- {last_qa, last_page, last_seen} or null
-- select r.rolname, has_function_privilege(r.rolname, 'sam_web_recall(text, text)', 'execute')
--   from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role', 'sam_web_reader');   -- only sam_web_reader true
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'sam_web_events_name_check';  -- ends with 'page_viewed'
