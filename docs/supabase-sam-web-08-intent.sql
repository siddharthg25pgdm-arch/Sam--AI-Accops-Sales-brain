-- SAM website chatbot: anonymous intent from the qualifying question, and the routing bar's events (27 Oct 2026).
-- Migration name sam_web_08_intent. Needs 03 (sam_web_conversations, sam_web_events). Redefines the event-name check last
-- set by 07, so apply order is 05, 06, 07, 08 (08 already includes 05's booking_opened and 07's page_viewed; running 05
-- or 07 AFTER 08 would drop the new names again). NOT APPLIED. Siddharth applies it. Record the date here when applied.
-- Safe to run twice. Additive.
--
--   sam_web_conversations.intent  {users?, renewal?, platform?}: the visitor's taps on the qualifying card, allowlisted
--                                 values only (web/lib/web/qualify.ts; web-answer.check proves the lists match). No email,
--                                 no name, no free text: anonymous intent on an anonymous conversation.
--   sam_web_set_intent(...)       the one way to write it: validates key and value, stores only on a conversation
--                                 labelled human. Granted to sam_web_reader ONLY.
--   qualify_answered, routing_*   four new allowlisted events (the card's tap; the bar's Book a call / Existing customer
--                                 support / Partner enquiry)
--
-- The Website tab reads intent with the service key through its existing conversations read (no new grant). Microsoft
-- Bookings cannot be prefilled from its URL, so the booking itself never carries the intent: it stays here, next to the
-- conversation. Retention: it lives and dies with its conversation row (sam_web_purge, 180 days).

-- ---------------------------------------------------------------- the intent column

alter table sam_web_conversations add column if not exists intent jsonb not null default '{}'::jsonb;
alter table sam_web_conversations drop constraint if exists sam_web_conversations_intent_check;
alter table sam_web_conversations add constraint sam_web_conversations_intent_check
  check (jsonb_typeof(intent) = 'object' and octet_length(intent::text) <= 256);

-- ---------------------------------------------------------------- the write

-- true = stored (the latest answer per key wins). false for a key or value outside the allowlist, an unknown
-- conversation, or one labelled suspect or bot (labels only escalate, so a later bot turn keeps what a human gave).
-- ponytail: the conversation row is created by the answer's log (sam_web_log_message, right after the response); a tap
-- within that moment finds no row and is dropped. The card shows under an answer, so a person never taps that fast.
create or replace function sam_web_set_intent(conversation_id text, key text, value text)
returns boolean language sql volatile security definer set search_path = public, pg_catalog as $$
  with u as (
    update sam_web_conversations c set intent = c.intent || jsonb_build_object($2, $3)
    where c.id = $1 and c.label = 'human'
      and ($2, $3) in (('users', 'under_250'), ('users', '250_1000'), ('users', '1000_5000'), ('users', '5000_plus'),
                       ('renewal', 'within_3m'), ('renewal', '3_12m'), ('renewal', 'later'), ('renewal', 'not_citrix'),
                       ('platform', 'citrix'), ('platform', 'vmware_omnissa'), ('platform', 'avd'), ('platform', 'other'))
    returning 1
  )
  select exists (select 1 from u)
$$;

-- ---------------------------------------------------------------- the events

-- 07's allowlist (05's plus page_viewed) plus the qualifying card and the routing bar. No free text, as before (the event
-- route also refuses a qualify_answered whose ref is not an allowlisted key:value).
alter table sam_web_events drop constraint if exists sam_web_events_name_check;
alter table sam_web_events add constraint sam_web_events_name_check check (name in ('chat_opened', 'chat_closed', 'popup_shown',
  'popup_clicked', 'popup_dismissed', 'question_clicked', 'answer_shown', 'doc_opened', 'talk_to_sales_clicked', 'filter_used',
  'step_viewed', 'booking_opened', 'page_viewed', 'qualify_answered', 'routing_book', 'routing_support', 'routing_partner'));

-- ---------------------------------------------------------------- access

-- The website's reader only (not anon, not authenticated, not service_role: the admin tab reads the column directly).
revoke execute on function sam_web_set_intent(text, text, text) from public, anon, authenticated, service_role;
grant execute on function sam_web_set_intent(text, text, text) to sam_web_reader;

-- ---------------------------------------------------------------- proof (run after applying; expected in comments)
-- select sam_web_set_intent('c_does-not-exist', 'users', '5000_plus');                       -- false
-- select sam_web_set_intent(id, 'users', 'lots') from sam_web_conversations limit 1;         -- false (not allowlisted)
-- select sam_web_set_intent(id, 'email', 'a@b.com') from sam_web_conversations limit 1;      -- false
-- select sam_web_set_intent(id, 'users', '5000_plus') from sam_web_conversations
--   where label = 'human' and is_test order by started_at desc limit 1;                     -- true
-- select intent from sam_web_conversations where intent <> '{}' order by started_at desc limit 5;   -- {"users": "5000_plus"}
-- select r.rolname, has_function_privilege(r.rolname, 'sam_web_set_intent(text, text, text)', 'execute')
--   from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role', 'sam_web_reader');  -- only sam_web_reader true
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'sam_web_events_name_check';  -- ends with 'routing_partner'
