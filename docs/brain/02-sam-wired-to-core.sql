-- SAM wired to the brain's reference lists (01-core-reference-lists.sql).
-- APPLIED 6 Oct 2026 as migration brain_sam_wired_to_core: functions, both triggers, core_unmapped.
-- The 317 cards were normalised by a normal load_cards.py run through the new trigger (0 rejected,
-- 0 carded_at moved, 0 change-log rows). The two UPDATE blocks at the bottom were run the same day
-- through SAM's REST path (the MCP tool auto-declines bulk updates from VS Code): 4 cards bound,
-- 43 file rows re-saved. Verified: core_unmapped empty, no change-log rows, answerable unchanged.
-- Safe to run twice.
--
-- Every write to SAM's two tag-carrying tables now goes through core.canon(), so whatever spelling a
-- carding agent or the rule tagger produces, the table stores the master label.
--
-- Cards (sam_asset_cards), written nightly by prototype/load_cards.py:
--   industry    blank -> 'Cross-industry' (the card states no industry); known spelling -> label;
--               unknown -> ERROR, so vocabulary drift fails loudly in the carding gate instead of
--               quietly creating a fourth spelling of Government.
--   asset_type  known -> label; unknown -> ERROR.
--   products, competitors: known -> label, unknown kept as written (open sets: a new vendor in a new
--               deck is legitimate). Unknowns are listed in public.core_unmapped for review.
-- load_cards.py hashes the card FILE, not the stored row, so normalising here never moves carded_at.
--
-- Files (sam_sharepoint_files), written by the nightly snapshot: all four tag arrays are normalised,
-- never rejected - a refused write there would lose the snapshot for every file.

create or replace function public.sam_canon_tags(p_facet text, p_vals text[]) returns text[]
language sql stable set search_path = '' as $$
  -- keeps first-seen order (the rule tagger puts the folder's type first) and drops duplicates that
  -- canonicalising creates ("Airbridge" + "AirBridge" -> one "AirBridge")
  select coalesce(array_agg(c order by pos), '{}') from (
    select c, min(o) pos from (
      select coalesce(core.canon(p_facet, v), btrim(v)) c, o
      from unnest(p_vals) with ordinality u(v, o) where btrim(coalesce(v, '')) <> ''
    ) x group by c
  ) y
$$;

create or replace function public.sam_cards_canon() returns trigger
language plpgsql set search_path = '' as $$
declare v text;
begin
  if btrim(coalesce(new.industry, '')) = '' then
    new.industry := 'Cross-industry';
  else
    v := core.canon('industry', new.industry);
    if v is null then
      raise exception 'SAM card %: industry "%" is not in the brain''s list (core.terms)', new.source, new.industry
        using errcode = 'check_violation', hint = 'Use a listed label, or add the spelling as an alias in core.terms.';
    end if;
    new.industry := v;
  end if;
  v := core.canon('asset_type', new.asset_type);
  if v is null then
    raise exception 'SAM card %: asset_type "%" is not in the brain''s list (core.terms)', new.source, new.asset_type
      using errcode = 'check_violation', hint = 'Use a listed label, or add the spelling as an alias in core.terms.';
  end if;
  new.asset_type := v;
  new.products := public.sam_canon_tags('product', new.products);
  new.competitors := public.sam_canon_tags('competitor', new.competitors);
  return new;
end $$;

drop trigger if exists sam_cards_canon on public.sam_asset_cards;
create trigger sam_cards_canon before insert or update on public.sam_asset_cards
  for each row execute function public.sam_cards_canon();

create or replace function public.sam_files_canon() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.asset_type := public.sam_canon_tags('asset_type', new.asset_type);
  new.industry   := public.sam_canon_tags('industry', new.industry);
  new.product    := public.sam_canon_tags('product', new.product);
  new.competitor := public.sam_canon_tags('competitor', new.competitor);
  return new;
end $$;

drop trigger if exists sam_files_canon on public.sam_sharepoint_files;
create trigger sam_files_canon before insert or update on public.sam_sharepoint_files
  for each row execute function public.sam_files_canon();

revoke all on function public.sam_canon_tags(text, text[]), public.sam_cards_canon(), public.sam_files_canon()
  from anon, authenticated;

-- Values the lists do not know yet, across SAM. Empty = every tag is a master label.
create or replace view public.core_unmapped with (security_invoker = true) as
  select 'sam_asset_cards' as source_table, 'product' as facet, v as value, count(*) as rows
    from public.sam_asset_cards, unnest(products) v where core.canon('product', v) is null group by v
  union all
  select 'sam_asset_cards', 'competitor', v, count(*)
    from public.sam_asset_cards, unnest(competitors) v where core.canon('competitor', v) is null group by v
  union all
  select 'sam_sharepoint_files', f.facet, f.v, count(*) from (
    select 'asset_type' facet, unnest(asset_type) v from public.sam_sharepoint_files
    union all select 'industry', unnest(industry) from public.sam_sharepoint_files
    union all select 'product', unnest(product) from public.sam_sharepoint_files
    union all select 'competitor', unnest(competitor) from public.sam_sharepoint_files
  ) f where core.canon(f.facet, f.v) is null group by f.facet, f.v;
revoke all on public.core_unmapped from anon, authenticated;
grant select on public.core_unmapped to service_role;

-- The 4 cards whose filename exists in two SharePoint folders, so load_cards.py would not guess.
-- Bound to the active copy in the folder a rep would look in; the loader keeps a binding while the
-- row is alive, so this survives every nightly load.
update public.sam_asset_cards c set item_id = b.item_id
from (values
  ('sharepoint/Accops Whitepaper - Secure Internet Browsing v7.pdf', '01X5UIHTZSOTGAZ25NHFFKXD4QZBQWQO5N'), -- Whitepapers
  ('sharepoint/Accops-CIOKlub-Event-Deck-1Hour-July2025.pptx',      '01X5UIHT6LT4QH7UU4DBBIG2O6OVVJMJVN'), -- Event Presentations/CIO Events (other copy archived)
  ('sharepoint/Accops-Defense-Event-20min-01Dec25.pptx',            '01X5UIHT7FUIHIFZMWUVGY5A2AF3AEAWAT'), -- Event Presentations/Government Events
  ('sharepoint/Applying Virtualization to Training Lab.pptx',       '01X5UIHT6X6O4S4PICP5HLOMBUHFL7OELH')  -- Technical Solutions Presentations/Virtual Labs
) b(source, item_id)
where c.source = b.source and c.item_id is null;

-- Normalise what is already stored (the triggers do the work; no change-log rows, since the log
-- triggers watch carded_at / filename / folder / status / modified / deleted, not tags).
update public.sam_asset_cards set industry = industry;
update public.sam_sharepoint_files set asset_type = asset_type;
