-- ============================================================
-- ONE-TIME DATA FIX (not a schema migration) — run ONCE, in the SQL editor.
--
-- Problem: the CRM sends a call's started_at / ended_at as zoneless
-- 'YYYY-MM-DD hh:mm:ss' in DHAKA local time. startAudit stored them as if
-- they were UTC, i.e. 6 hours late, in audits.call_started_at / call_ended_at.
-- (Same bug as the revenue timestamps — see fix_001.)
-- Evidence: the recorder's own filename timestamp (server3-...-20260923-043239.mp3)
-- is exactly 6 hours before the stored call time on every call checked.
--
-- The code is already fixed (src/lib/crm/time.mjs crmTimestamp, used by
-- startAudit), so audits started after the fix are correct. This shifts only
-- the audits created BEFORE the fix.
--
-- Safe order:  1) run the CHECK below  2) run the FIX  3) run the CHECK again
-- Run-once guard: the fix writes an audit_log row and refuses to run if that
-- row already exists, so a second run cannot shift the times twice.
-- ============================================================

-- 1) CHECK (no changes). Compares each stored call time with the time in its
--    recording filename (UTC, from the recorder). Before the fix, hours_apart
--    is ~6 on old audits; after it, ~0. Calls with no recording (e.g. No Answer)
--    show no filename time — they can't be checked this way.
--    (Assumes this SQL editor session's timezone is UTC, the Supabase default.)
--    CAVEAT (found when this was first applied): the filename check only holds for
--    RECENT recordings, which the recorder stamps in UTC. An old recording can be
--    stamped in Dhaka local time instead (audit 5151fc75, Oct 2025, showed -5.89h
--    although its stored time was exactly right). The definitive check is against
--    the CRM itself: every stored call time was compared with the CRM's own
--    started_at (read as Dhaka) and all 24 matched. Trust that, not the filename,
--    for anything old.
select id, created_at,
       call_started_at,
       to_timestamp(substring(call_recording_url from '\d{8}-\d{6}'), 'YYYYMMDD-HH24MISS') as filename_time_utc,
       round((extract(epoch from (call_started_at
              - to_timestamp(substring(call_recording_url from '\d{8}-\d{6}'), 'YYYYMMDD-HH24MISS'))) / 3600)::numeric, 2) as hours_apart
  from audits
 where call_started_at is not null
 order by created_at desc;

-- 2) THE FIX. Uncomment the whole block to run.
-- do $$
-- declare n int;
-- begin
--   if exists (select 1 from audit_log where action = 'fix.call_times_dhaka') then
--     raise exception 'fix_002 has already been applied — refusing to shift the times twice.';
--   end if;
--
--   update audits
--      set call_started_at = call_started_at - interval '6 hours',
--          call_ended_at   = call_ended_at   - interval '6 hours'
--    where call_started_at is not null
--      and created_at < timestamptz '2026-09-24 09:25:00+00';
--   get diagnostics n = row_count;
--
--   insert into audit_log (action, table_name, after_data)
--   values ('fix.call_times_dhaka', 'audits', jsonb_build_object('rows_shifted', n, 'shift', '-6 hours'));
--   raise notice 'fix_002 applied to % audits', n;
-- end $$;

-- 3) Run the CHECK (step 1) again: hours_apart should now be ~0 for every call with a recording.
