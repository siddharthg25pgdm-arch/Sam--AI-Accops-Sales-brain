-- SAM website chatbot: fix for sam_web_restamp_pages() (01). Migration name sam_web_06_restamp_where. Needs 01.
-- NOT APPLIED. Siddharth applies it. Record the date here when applied. Safe to run twice; independent of 05.
--
-- The bug: a change to sam_web_blocked_patterns or sam_web_page_rules fires the statement trigger below, whose
-- `update sam_web_pages set url = url` has no WHERE clause. Through PostgREST (the service key: the Website tab, the
-- loaders) pg-safeupdate is loaded and rejects it with "UPDATE requires a WHERE clause", so the triggering write fails.
-- `where true` is safeupdate's documented way of saying "every row, on purpose". Same behaviour otherwise: every page
-- (~250 rows) is re-stamped by sam_web_pages_stamp.

create or replace function sam_web_restamp_pages() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
begin
  update sam_web_pages set url = url where true;
  return null;
end $$;
