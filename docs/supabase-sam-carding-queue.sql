-- SAM carding queue + rename-safe card binding. Applied 25 September 2026.
-- Project: iwqhayuoxnrhqzozznes (shared - sam_ objects only).
--
-- Two gaps closed here (docs/sam-how-it-works.html section 3):
--   1. Nothing listed the files that need a card. sam_carding_queue does.
--   2. A rename detached a card from its file, because cards joined the registry by FILENAME.
--      A card now records the registry item_id it was written for (bound by load_cards.py), and
--      item_id survives a rename: applyChange() matches the rename by list_item_id and keeps the row.

-- The registry row this card describes. NULL = not resolvable to exactly one live row (public-only
-- cards, or a filename that exists in two folders); those still merge by filename, as before.
alter table sam_asset_cards add column if not exists item_id text;
-- When the card CONTENT last changed, which is what "is the card older than the file?" needs.
-- updated_at cannot answer it: load_cards.py upserts without it, so it is frozen at first insert and
-- never moves when a card is corrected. carded_at moves only when card_hash changes.
alter table sam_asset_cards add column if not exists carded_at timestamptz not null default now();
alter table sam_asset_cards add column if not exists card_hash text;
-- The 46 cards loaded on 8 September: their first insert IS their carding time.
update sam_asset_cards set carded_at = created_at where card_hash is null;
create index if not exists sam_cards_item_idx on sam_asset_cards (item_id);

-- Same normalisation as dedupeKey() in web/lib/cards.ts: lowercase, strip one document extension,
-- drop everything but [a-z0-9]. So a PDF and a PPTX of the same name are one document here too.
create or replace view sam_carding_queue with (security_invoker = true) as
with f as (
  select item_id, filename, folder, web_url, modified_at, modified_by,
         regexp_replace(regexp_replace(lower(filename), '\.(pdf|docx|pptx|doc|ppt|xlsx)$', ''), '[^a-z0-9]', '', 'g') as stem
  from sam_sharepoint_files
  where scope = 'sales' and not deleted and status = 'active' and suggest_ingest
),
c as (
  select c.item_id, c.carded_at,
         regexp_replace(regexp_replace(lower(c.filename), '\.(pdf|docx|pptx|doc|ppt|xlsx)$', ''), '[^a-z0-9]', '', 'g') as card_stem,
         -- The key the app merges this card under: its bound row's CURRENT name, else its own filename.
         coalesce(
           regexp_replace(regexp_replace(lower(r.filename), '\.(pdf|docx|pptx|doc|ppt|xlsx)$', ''), '[^a-z0-9]', '', 'g'),
           regexp_replace(regexp_replace(lower(c.filename), '\.(pdf|docx|pptx|doc|ppt|xlsx)$', ''), '[^a-z0-9]', '', 'g')) as merge_key
  from sam_asset_cards c
  left join sam_sharepoint_files r on r.item_id = c.item_id and not r.deleted
),
q as (
  select f.item_id, f.filename, f.folder, f.web_url, f.modified_at, f.modified_by,
         case when m.carded_at is null then 'uncarded'
              when m.bound and m.card_stem <> f.stem then 'renamed'
              when f.modified_at > m.carded_at then 'changed_since_card'
         end as reason,
         m.carded_at as card_updated_at
  from f
  left join lateral (
    -- A card bound to this exact row wins over a filename (or PDF/PPTX twin) match.
    select c.carded_at, (c.item_id = f.item_id) is true as bound, c.card_stem
    from c where c.item_id = f.item_id or c.merge_key = f.stem
    order by ((c.item_id = f.item_id) is true) desc, c.carded_at desc
    limit 1
  ) m on true
)
select item_id, filename, folder, web_url, modified_at, modified_by, reason, card_updated_at
from q where reason is not null;
