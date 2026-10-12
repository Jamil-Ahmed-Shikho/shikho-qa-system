-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 095 — Daily Activity (§9/§11, 2026-10-12): a day-by-day breakdown
-- of what each QA Auditor did this sales week so far (Sat -> today), for
-- the QA Auditor's own dashboard and the "This Week's QA Progress" report.
-- Apply after schema_094. Test in the SQL Editor first.
--
-- WHY A DAY-BY-DAY BREAKDOWN, NOT A SINGLE "TODAY" NUMBER: a single day's
-- count tells you nothing about pace without the rest of the week for
-- context (Jamil, 2026-10-12) — so this returns one row per (auditor, day)
-- from the current sales week's Saturday through today, and the app builds
-- the chart/table from that.
--
-- THREE COUNTS PER DAY (Jamil's own pick, not critical fatals as first
-- proposed): audits_done, coaching_done, sample_checks_done — three
-- different things an auditor actually does, each meaningful on its own at
-- daily resolution (unlike the Impact Report's weighted metrics — Sales
-- Growth, vintage revenue targets, Recovery % — which are NOT exposed here,
-- deliberately: a 1-day version of any of those would be meaningless or
-- misleading, not just noisy).
--
-- Scoping is identical to every other function in this family: QA
-- Auditor gets My view (own row only) or Team view (everyone); Super
-- Admin/QA Manager always see Team view, unrestricted (§2's standing rule).
-- ============================================================

create or replace function qa_daily_activity(p_view text default 'team')
returns table (
  auditor_id uuid,
  auditor_name text,
  day date,
  audits_done int,
  coaching_done int,
  sample_checks_done int
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_role text := current_app_role();
  v_me uuid := current_app_user_id();
  v_today date := (now() at time zone 'Asia/Dhaka')::date;
  v_week date := sales_week_start(v_today);
  v_week_start_ts timestamptz := (v_week::timestamp at time zone 'Asia/Dhaka');
  v_tomorrow_ts timestamptz := ((v_today + 1)::timestamp at time zone 'Asia/Dhaka');
begin
  if v_role not in ('super_admin', 'qa_manager', 'qa_auditor') then
    return;
  end if;
  if p_view not in ('mine', 'team') then
    raise exception 'Choose My view or Team view.';
  end if;

  return query
  with auditors as (
    select u.id, u.name from users u where u.role = 'qa_auditor' and u.is_active
      and (v_role <> 'qa_auditor' or p_view = 'team' or u.id = v_me)
  ),
  days as (
    select generate_series(v_week::timestamp, v_today::timestamp, interval '1 day')::date as day
  ),
  grid as (
    select au.id as auditor_id, au.name as auditor_name, d.day
      from auditors au cross join days d
  ),
  audits_by_day as (
    select a.auditor_id, (a.submitted_at at time zone 'Asia/Dhaka')::date as day, count(*)::int as n
      from audits a
     where a.status = 'submitted' and a.check_mode = 'audit'
       and a.submitted_at >= v_week_start_ts and a.submitted_at < v_tomorrow_ts
     group by a.auditor_id, day
  ),
  sample_checks_by_day as (
    select a.auditor_id, (a.submitted_at at time zone 'Asia/Dhaka')::date as day, count(*)::int as n
      from audits a
     where a.status = 'submitted' and a.check_mode = 'sample_check'
       and a.submitted_at >= v_week_start_ts and a.submitted_at < v_tomorrow_ts
     group by a.auditor_id, day
  ),
  coaching_by_day as (
    select b.conducted_by as auditor_id, (b.scheduled_at at time zone 'Asia/Dhaka')::date as day, count(*)::int as n
      from briefings b
     where b.status = 'completed'
       and b.scheduled_at >= v_week_start_ts and b.scheduled_at < v_tomorrow_ts
     group by b.conducted_by, day
  )
  select g.auditor_id, g.auditor_name, g.day,
         coalesce(ad.n, 0), coalesce(cd.n, 0), coalesce(sd.n, 0)
    from grid g
    left join audits_by_day ad on ad.auditor_id = g.auditor_id and ad.day = g.day
    left join coaching_by_day cd on cd.auditor_id = g.auditor_id and cd.day = g.day
    left join sample_checks_by_day sd on sd.auditor_id = g.auditor_id and sd.day = g.day
   order by g.auditor_name, g.day;
end;
$$;
revoke all on function qa_daily_activity(text) from public;
grant execute on function qa_daily_activity(text) to authenticated;
