-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 090 — Rubric Fail Trends rebuild: channel filter (default Telesales),
-- category rollup, weekly trend history, raw prior-period counts so the app
-- can aggregate correctly. Apply after 089. Test in the Supabase SQL Editor
-- first.
--
-- Jamil asked for a channel-wise filter (Telesales default) on the Rubric
-- Fail Trends report (§11, Stage 6). Proposed back, and approved as a small
-- bundle (2026-10-12): the channel filter, plus a category-level rollup, a
-- weekly trend sparkline, and raw counts so a "small sample" flag can be
-- shown client-side — see qa-rubric-trends.service.ts for the TS side.
--
-- qa_rubric_fail_trends(): signature changes (new p_team_name arg) AND the
-- RETURNS TABLE shape changes (category_id, prior_total_scored,
-- prior_total_failed added) — a plain CREATE OR REPLACE cannot do either
-- (§14), so the old 3-argument function is dropped first.
--
-- "Channel" = users.team_name, not site_name — same established distinction
-- as schema_039 (TS3P's site is Dhaka but must never be grouped with Dhaka
-- Telesales): a parameter's fail rate is scoped to the AGENT'S team, not
-- which rubric the parameter belongs to (several teams can share one
-- rubric, e.g. Telesales/Retention/TS3P all use the Telesales Scorecard).
-- p_team_name = null means every channel, unchanged from today's behaviour.
-- ============================================================

drop function if exists qa_rubric_fail_trends(timestamptz, timestamptz, text);

create or replace function qa_rubric_fail_trends(
  p_from timestamptz, p_to timestamptz, p_view text default 'team', p_team_name text default null
)
returns table (
  parameter_id uuid,
  parameter_name text,
  category_id uuid,
  category_name text,
  rubric_name text,
  total_scored int,
  total_failed int,
  fail_rate_pct numeric,
  prior_total_scored int,
  prior_total_failed int,
  prior_fail_rate_pct numeric,
  trend_pct_points numeric
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_role text := current_app_role();
  v_me uuid := current_app_user_id();
  v_prior_from timestamptz;
begin
  if v_role not in ('super_admin', 'qa_manager', 'qa_auditor') then
    return;
  end if;
  if p_to <= p_from then
    raise exception 'The period''s end must be after its start.';
  end if;
  if p_view not in ('mine', 'team') then
    raise exception 'Choose My view or Team view.';
  end if;

  v_prior_from := p_from - (p_to - p_from);

  return query
  with scoped_now as (
    select apr.parameter_id, apr.passed
      from audit_parameter_results apr
      join audits a on a.id = apr.audit_id
      join users u on u.id = a.agent_id
     where a.status = 'submitted' and a.submitted_at >= p_from and a.submitted_at < p_to
       and (p_team_name is null or u.team_name = p_team_name)
       and (v_role <> 'qa_auditor' or p_view = 'team' or u.quality_auditor_id = v_me)
  ),
  scoped_prior as (
    select apr.parameter_id, apr.passed
      from audit_parameter_results apr
      join audits a on a.id = apr.audit_id
      join users u on u.id = a.agent_id
     where a.status = 'submitted' and a.submitted_at >= v_prior_from and a.submitted_at < p_from
       and (p_team_name is null or u.team_name = p_team_name)
       and (v_role <> 'qa_auditor' or p_view = 'team' or u.quality_auditor_id = v_me)
  ),
  now_agg as (
    select sn.parameter_id, count(*)::int as total, count(*) filter (where not sn.passed)::int as failed
      from scoped_now sn group by sn.parameter_id
  ),
  prior_agg as (
    select sp.parameter_id, count(*)::int as total, count(*) filter (where not sp.passed)::int as failed
      from scoped_prior sp group by sp.parameter_id
  )
  select
    rp.id,
    rp.name,
    rc.id,
    rc.name,
    r.name,
    na.total,
    na.failed,
    round(na.failed::numeric / na.total * 100, 1),
    coalesce(pa.total, 0),
    coalesce(pa.failed, 0),
    case when coalesce(pa.total, 0) > 0 then round(pa.failed::numeric / pa.total * 100, 1) else null end,
    case when coalesce(pa.total, 0) > 0
         then round((na.failed::numeric / na.total * 100) - (pa.failed::numeric / pa.total * 100), 1)
         else null end
    from now_agg na
    join rubric_parameters rp on rp.id = na.parameter_id
    join rubric_categories rc on rc.id = rp.category_id
    join rubrics r on r.id = rc.rubric_id
    left join prior_agg pa on pa.parameter_id = na.parameter_id
   order by (na.failed::numeric / na.total) desc, na.total desc;
end;
$$;
revoke all on function qa_rubric_fail_trends(timestamptz, timestamptz, text, text) from public;
grant execute on function qa_rubric_fail_trends(timestamptz, timestamptz, text, text) to authenticated;

-- ── Weekly trend history, for the per-parameter sparkline ──────────────────────────────────────
-- Trailing p_weeks sales weeks (Sat-Fri, Asia/Dhaka — the system's one week convention, §6.3),
-- ending at the CURRENT (possibly in-progress) week, independent of whichever period preset the
-- page's main comparison is using — a sparkline needs enough history to show a shape regardless
-- of which single period is selected for the headline numbers. Sparse: a (parameter, week) with no
-- scored results that week simply has no row; the client fills the gap rather than treating it as 0%.
create or replace function qa_rubric_fail_trend_history(
  p_weeks int default 8, p_view text default 'team', p_team_name text default null
)
returns table (
  parameter_id uuid,
  week_start date,
  total_scored int,
  total_failed int,
  fail_rate_pct numeric
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_role text := current_app_role();
  v_me uuid := current_app_user_id();
  v_weeks int := greatest(1, least(coalesce(p_weeks, 8), 26));
  v_oldest_week date;
  v_from timestamptz;
begin
  if v_role not in ('super_admin', 'qa_manager', 'qa_auditor') then
    return;
  end if;
  if p_view not in ('mine', 'team') then
    raise exception 'Choose My view or Team view.';
  end if;

  v_oldest_week := sales_week_start((now() at time zone 'Asia/Dhaka')::date) - (v_weeks - 1) * 7;
  v_from := (v_oldest_week::timestamp at time zone 'Asia/Dhaka');

  return query
  with scoped as (
    select apr.parameter_id, apr.passed,
           sales_week_start((a.submitted_at at time zone 'Asia/Dhaka')::date) as wk
      from audit_parameter_results apr
      join audits a on a.id = apr.audit_id
      join users u on u.id = a.agent_id
     where a.status = 'submitted' and a.submitted_at >= v_from and a.submitted_at < now()
       and (p_team_name is null or u.team_name = p_team_name)
       and (v_role <> 'qa_auditor' or p_view = 'team' or u.quality_auditor_id = v_me)
  )
  select s.parameter_id, s.wk, count(*)::int, count(*) filter (where not s.passed)::int,
         round(count(*) filter (where not s.passed)::numeric / count(*) * 100, 1)
    from scoped s
   group by s.parameter_id, s.wk
   order by s.parameter_id, s.wk;
end;
$$;
revoke all on function qa_rubric_fail_trend_history(int, text, text) from public;
grant execute on function qa_rubric_fail_trend_history(int, text, text) to authenticated;
