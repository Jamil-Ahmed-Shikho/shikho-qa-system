-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 096 — fix qa_daily_activity()'s "Sample Checks done" count to
-- include Special Checks ticked during an ordinary audit, not just
-- standalone Sample Checks (Jamil, 2026-10-13). Apply after schema_095.
--
-- THE BUG: schema_095's sample_checks_by_day only counted
-- audits.check_mode = 'sample_check' (the standalone, no-rubric check
-- type, §4 Part 3). But there is a SECOND, separate way to do a "sample/
-- special check": ticking one or more Special Check campaigns on an
-- ORDINARY audit's own scorecard (the "Special Check" section, §4 Part B2
-- — audit_campaigns/audit_campaign_answers, check_mode stays 'audit').
-- Jamil's own words: "we have two places from where we can do sample
-- checks... our report is showing the individual special check count
-- only, not adding the special checks we added during call audit."
--
-- FIX: a day's "sample checks done" by an auditor is now the count of
-- their SUBMITTED audits that day which are EITHER check_mode =
-- 'sample_check' OR an ordinary audit (check_mode = 'audit') with at
-- least one row in audit_campaigns — counted once per audit, never
-- twice, even if (hypothetically) more than one campaign is attached.
-- Same audit still also counts toward audits_done (an audit that was
-- both a real scored audit AND had a Special Check ticked legitimately
-- counts in both figures — both things really happened).
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
    -- Either a standalone Sample Check, or an ordinary audit that had a
    -- Special Check campaign ticked on its own scorecard — one count per
    -- audit either way (exists(), not a join, so a multi-campaign audit
    -- is never double-counted).
    select x.auditor_id, x.day, count(*)::int as n
      from (
        select a.auditor_id, (a.submitted_at at time zone 'Asia/Dhaka')::date as day
          from audits a
         where a.status = 'submitted'
           and a.submitted_at >= v_week_start_ts and a.submitted_at < v_tomorrow_ts
           and (
             a.check_mode = 'sample_check'
             or exists (select 1 from audit_campaigns ac where ac.audit_id = a.id)
           )
      ) x
     group by x.auditor_id, x.day
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
