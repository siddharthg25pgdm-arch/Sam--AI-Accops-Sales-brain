-- Accops brain: close the public holes found 6 Oct 2026. Project iwqhayuoxnrhqzozznes.
-- APPLIED 6 Oct 2026 as migration brain_security_close_public_holes (verified: anon reads 0 ADI
-- views, calls 0 of the 7 functions; ADI data intact; PRM's 3 RLS helpers still callable).
-- Kept as the record; safe to run again.
--
-- 1. ADI views ran as their owner (bypassing row security) AND were readable with the public anon
--    key: account scores, footprint and calibration readable by anyone with that key. ADI reads
--    only with the service-role key (checked: adi/ source uses SUPABASE_SERVICE_ROLE_KEY only),
--    which bypasses row security anyway, so ADI keeps working.
alter view public.adi_account_scores_latest set (security_invoker = true);
alter view public.adi_account_current_footprint set (security_invoker = true);
alter view public.adi_calibration set (security_invoker = true);
revoke all on public.adi_account_scores_latest, public.adi_account_current_footprint, public.adi_calibration from anon, authenticated;

-- 2. PRM / certificate trigger and cron functions were callable by anyone over /rest/v1/rpc.
--    Triggers do not need EXECUTE to fire and pg_cron runs as postgres, so nothing legitimate
--    loses access.
revoke execute on function public.expire_deal_registrations(), public.notify_certificate_issued(),
  public.on_deal_won(), public.on_deal_won_customer(), public.on_transaction_insert(),
  public.sync_deal_amount(), public.write_audit()
  from public, anon, authenticated;

-- Deliberately NOT changed: is_admin(), is_internal(), member_partner_ids(). About 60 PRM row-security
-- rules call them as the signed-in user; revoking them would break PRM. They only return a yes/no
-- or the caller's own partner ids.

-- Check afterwards (should return 0 rows):
select c.relname from pg_class c
where c.relname in ('adi_account_scores_latest','adi_account_current_footprint','adi_calibration')
  and has_table_privilege('anon', c.oid, 'select');
