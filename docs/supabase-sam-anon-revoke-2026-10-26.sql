-- Defence in depth (26 Oct 2026): the website proof found anon/authenticated holding SELECT on two internal
-- views (Supabase grants new objects to them by default). Both are security_invoker over RLS-locked tables, so
-- nothing was readable, but SAM only ever reads them with the service key: take the grant back.
revoke all on sam_asset_families, sam_carding_queue from anon, authenticated;
