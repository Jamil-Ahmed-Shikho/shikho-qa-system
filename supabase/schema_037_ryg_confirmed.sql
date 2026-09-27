-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 037 — RYG status (§6.2): Section B answers CONFIRMED by Jamil, 2026-09-27. Apply after 026 (any time
-- before/after 027-036). Test this in the Supabase SQL Editor before relying on it.
--
--   Q2 (4-week window), Q3 (green >= 90), Q4 (one org-wide threshold, no per-rubric) — all matched the
--     built/seeded behaviour already; nothing to change, just no longer placeholders.
--   Q5 — CHANGED: an eligible agent with NO audit in the window now gets a row with a DISTINCT NEUTRAL status,
--     'unrated' (reason 'no_audits_in_window') — not silently no row. 'unrated' is never a colour; it reads
--     as "not enough data", the same way a rubric shows nothing invented when there's nothing to show.
--   Q6 — unchanged: a disputed/resolved audit already counts immediately (status <> 'draft' always did).
--     DEPENDENCY NOTED, NOT BUILT: if resolving a dispute should later change an audit's outcome, RYG must
--     recompute for the affected period — the mechanism depends on Q16 (disputes, still open, docs/questions).
--   Q7 — CHANGED: eligibility now requires employment_stage = 'active' (was role=agent + is_active only) — an
--     OJT or re-training agent never gets an RYG row, whatever audits they happen to have (during OJT they are
--     audited 3x/week, so this was a real gap, not theoretical). A not_certified/discontinued agent is likewise
--     excluded (neither is "active"), matching "certified/active agents" as the only agents RYG applies to.
-- ============================================================

alter table agent_status_log drop constraint agent_status_log_status_check;
alter table agent_status_log add constraint agent_status_log_status_check
  check (status in ('red', 'yellow', 'green', 'unrated'));

alter table agent_status_log drop constraint agent_status_log_status_reason_check;
alter table agent_status_log add constraint agent_status_log_status_reason_check
  check (status_reason in ('score_threshold', 'critical_fatal_override', 'no_audits_in_window'));

create or replace function compute_agent_status(
  p_as_of date default ((now() at time zone 'Asia/Dhaka')::date),
  p_window_weeks int default 4
)
returns int
language plpgsql
set search_path = public
as $$
declare
  v_period_end date;
  v_period_start date;
  v_today date := (now() at time zone 'Asia/Dhaka')::date;
  v_latest_end_today date;
  v_from_ts timestamptz;
  v_to_ts timestamptz;
  v_green numeric;
  v_yellow numeric;
  v_n int;
begin
  if p_window_weeks is null or p_window_weeks < 1 or p_window_weeks > 26 then
    raise exception 'The window must be between 1 and 26 weeks.';
  end if;

  v_period_end := sales_week_start(p_as_of) - 1;
  v_period_start := v_period_end - (7 * p_window_weeks - 1);
  v_latest_end_today := sales_week_start(v_today) - 1;

  v_from_ts := (v_period_start::timestamp) at time zone 'Asia/Dhaka';
  v_to_ts := ((v_period_end + 1)::timestamp) at time zone 'Asia/Dhaka';

  select green_min, yellow_min into v_green, v_yellow
    from status_thresholds
   where rubric_id is null and effective_from <= v_to_ts
   order by effective_from desc
   limit 1;
  if v_green is null then
    select green_min, yellow_min into v_green, v_yellow
      from status_thresholds
     where rubric_id is null
     order by effective_from asc
     limit 1;
  end if;
  if v_green is null then
    raise exception 'There is no org-wide status threshold row — nothing to band scores against.';
  end if;

  -- Q7: eligibility is role=agent, active, AND employment_stage='active' — an OJT or re-training agent is
  -- never rated (even though they may well have audits, at 3/week during OJT), and neither is a
  -- not_certified/discontinued one. Q5: every eligible agent gets a row this period, LEFT JOINed to their
  -- audit stats — one with zero audits in the window gets 'unrated', not simply no row.
  with eligible as (
    select u.id as agent_id
      from users u
     where u.role = 'agent' and u.is_active and u.employment_stage = 'active'
  ), agg as (
    select a.agent_id,
           round(avg(a.score_percent), 2) as avg_score,
           count(*)::int as n_audits,
           count(*) filter (where a.critical_fail)::int as n_critical
      from audits a
     where a.status <> 'draft'
       and a.submitted_at >= v_from_ts and a.submitted_at < v_to_ts
       and a.score_percent is not null
     group by a.agent_id
  ), merged as (
    select e.agent_id, ag.avg_score, coalesce(ag.n_audits, 0) as n_audits, coalesce(ag.n_critical, 0) as n_critical
      from eligible e
      left join agg ag on ag.agent_id = e.agent_id
  ),
  ins as (
    insert into agent_status_log (
      agent_id, period_start, period_end, avg_audit_score, status, status_reason,
      audit_count, critical_fatal_count, green_min_used, yellow_min_used, window_weeks
    )
    select agent_id, v_period_start, v_period_end, avg_score,
           case when n_audits = 0 then 'unrated'
                when n_critical > 0 then 'red'
                when avg_score >= v_green then 'green'
                when avg_score >= v_yellow then 'yellow'
                else 'red' end,
           case when n_audits = 0 then 'no_audits_in_window'
                when n_critical > 0 then 'critical_fatal_override' else 'score_threshold' end,
           n_audits, n_critical, v_green, v_yellow, p_window_weeks
      from merged
    on conflict (agent_id, period_end) do update
      set period_start = excluded.period_start,
          avg_audit_score = excluded.avg_audit_score,
          status = excluded.status,
          status_reason = excluded.status_reason,
          audit_count = excluded.audit_count,
          critical_fatal_count = excluded.critical_fatal_count,
          green_min_used = excluded.green_min_used,
          yellow_min_used = excluded.yellow_min_used,
          window_weeks = excluded.window_weeks,
          computed_at = now()
      where agent_status_log.period_end = v_latest_end_today
    returning 1
  )
  select count(*) into v_n from ins;

  return v_n;
end;
$$;

revoke all on function compute_agent_status(date, int) from public;
revoke all on function compute_agent_status(date, int) from authenticated;
grant execute on function compute_agent_status(date, int) to service_role;
