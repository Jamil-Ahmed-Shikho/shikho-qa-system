-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 110 — Portal Usage: one-time backfill from Supabase Auth's own login history
-- (Jamil, 2026-11-04 — "it has started counting the report from today... if it is present somewhere
-- else i would like to update the previous logging data"). Apply after 109.
--
-- user_activity_days (schema_109) only started recording the day it was deployed (2026-11-04) — it
-- had no reason to exist before then. But auth.sessions (Supabase's own login-session table) turns
-- out to already hold a real login history reaching back to late September: Supabase creates a new
-- row there on every actual sign-in and, in this project, has never purged old ones (confirmed live
-- before writing this — 236 rows, 163 distinct users, spanning 2026-09-29 through today). That's not
-- a complete page-by-page usage log, but it IS a trustworthy "this person signed in on this day"
-- record for every day before the real tracking started — exactly the gap Jamil asked about.
--
-- One-time, not a reusable function: going forward, user_activity_days (schema_109) is the live
-- record; this only ever needs to backfill the one gap before it existed. Idempotent regardless —
-- ON CONFLICT widens an existing row's first/last_seen_at (never narrows it) rather than erroring,
-- so a second accidental run changes nothing.
-- ============================================================

do $$
declare
  v_count int;
begin
  insert into user_activity_days (user_id, activity_date, first_seen_at, last_seen_at)
  select u.id,
         (s.created_at at time zone 'Asia/Dhaka')::date as activity_date,
         min(s.created_at) as first_seen_at,
         max(s.created_at) as last_seen_at
    from auth.sessions s
    join users u on u.auth_id = s.user_id
   group by u.id, (s.created_at at time zone 'Asia/Dhaka')::date
  on conflict (user_id, activity_date) do update
     set first_seen_at = least(user_activity_days.first_seen_at, excluded.first_seen_at),
         last_seen_at = greatest(user_activity_days.last_seen_at, excluded.last_seen_at);
  get diagnostics v_count = row_count;
  raise notice 'Backfilled/merged % user_activity_days rows from auth.sessions login history.', v_count;
end $$;
