-- ============================================================
-- ONE-TIME DATA FIX (not a schema migration) — run ONCE, in the SQL editor.
--
-- Problem: the CRM sends event created_at / updated_at as zoneless
-- 'YYYY-MM-DD hh:mm:ss' in DHAKA local time. The first backfill run stored
-- them as if they were UTC, i.e. 6 hours late. Effect: every event after
-- 18:00 Dhaka time landed on the NEXT calendar day, which breaks the
-- Friday/Saturday sales-week boundary (about a third of events).
-- Evidence: as stored, events are nearly absent 01:00-08:00 and peak at
-- 18:00; as Dhaka time that is a normal student-purchase day.
--
-- The code is already fixed (scripts/lib/revenue-mapping.mjs crmTimestamp),
-- so anything written by the backfill/sync from now on is correct. This
-- shifts only the rows written BEFORE the fix.
--
-- Safe order:  1) run this  2) resume the backfill / let the sync run
--              3) select recompute_weekly_sales();  (if it was run before)
-- It only touches rows synced before the cutoff below, so re-fetched
-- (already-correct) rows are never shifted. The fix also stamps
-- last_synced_at = now() on the rows it corrects, which moves them past its
-- own guard — so accidentally running it a second time changes nothing.
-- ============================================================

-- 1) Look first (no changes): how many rows would move?
select count(*) as rows_to_fix,
       min(purchase_created_at) as oldest_now,
       min(purchase_created_at - interval '6 hours') as oldest_after
  from agent_revenue_transactions
 where source = 'crm_api'
   and last_synced_at < timestamptz '2026-09-24 00:00:00+00';

-- 2) The fix. Uncomment to run.
-- begin;
-- update agent_revenue_transactions
--    set purchase_created_at = purchase_created_at - interval '6 hours',
--        crm_updated_at      = crm_updated_at      - interval '6 hours',
--        last_synced_at      = now()
--  where source = 'crm_api'
--    and last_synced_at < timestamptz '2026-09-24 00:00:00+00';
-- -- expect: UPDATE <the same count as above>
-- commit;

-- 3) Afterwards the stored hour-of-day (as Dhaka time) should now show the
--    daytime shape: quiet ~01:00-08:00, evening peak ~18:00-19:00.
-- select extract(hour from purchase_created_at at time zone 'Asia/Dhaka')::int as dhaka_hour, count(*)
--   from agent_revenue_transactions group by 1 order by 1;
