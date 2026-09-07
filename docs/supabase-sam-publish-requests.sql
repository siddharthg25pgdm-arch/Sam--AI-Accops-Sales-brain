-- SAM publish requests. Applied to accops-marketing-dashboard (ref iwqhayuoxnrhqzozznes) as
-- migration sam_publish_requests on 7 September 2026. Kept here so the schema lives in the repo.
--
-- Until this existed, apiPublicLink() returned can_request_publish:true and there was nothing behind
-- it: a rep was told they could ask and given no way to ask. Approver is Siddharth (settled 6 Sep).

create table if not exists sam_publish_requests (
  id           bigserial primary key,
  created_at   timestamptz not null default now(),
  asset_title  text not null,
  asset_path   text,
  requested_by text not null,
  channel      text not null default 'web',
  reason       text,                                    -- who it is for and why, in the rep's words
  status       text not null default 'open',            -- open | approved | rejected | published
  decided_by   text,
  decided_at   timestamptz,
  public_url   text,                                    -- filled in when it actually goes live
  note         text
);

-- One OPEN request per asset, case-insensitive. An agent that retries, or three reps hitting the
-- same wall in one week, should raise demand on a single row rather than bury the approver in
-- duplicates. Partial index, so the same asset can be requested again after it is resolved.
create unique index if not exists sam_pubreq_open_idx
  on sam_publish_requests (lower(asset_title))
  where status = 'open';

create index if not exists sam_pubreq_status_idx on sam_publish_requests (status, created_at desc);

alter table sam_publish_requests enable row level security;
