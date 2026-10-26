-- A renamed SharePoint file changes its card's `source`; passages must follow it.
-- Found 26 Oct 2026: two renamed Partner Bootcamp decks sat in the carding queue for 17 days
-- because the card could not be re-pointed while sam_passages still referenced the old source.
-- Applied 26 Oct 2026 (Siddharth's OK) via the Management API.
alter table sam_passages drop constraint sam_passages_source_fkey;
alter table sam_passages add constraint sam_passages_source_fkey
  foreign key (source) references sam_asset_cards(source) on delete cascade on update cascade;
