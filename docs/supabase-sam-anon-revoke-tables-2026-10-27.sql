-- Defence in depth (27 Oct 2026, Siddharth: "yes revoke public access"): the website's pre-deploy probe found
-- anon/authenticated still holding SELECT on 12 internal sam_* tables (Supabase's default grants). RLS with no
-- policies meant every read returned 0 rows, but the grant was an unlocked door. SAM reads these only with the
-- service key.
revoke all on sam_asset_cards, sam_asset_family_overrides, sam_asset_pins, sam_content_request_votes,
  sam_content_requests, sam_events, sam_ingest_roots, sam_metrics_daily, sam_publish_requests,
  sam_rank_feedback, sam_sharepoint_files, sam_sharepoint_sync
from anon, authenticated;
