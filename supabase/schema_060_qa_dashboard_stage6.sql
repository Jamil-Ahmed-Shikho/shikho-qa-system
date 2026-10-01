-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 060 — QA Manager dashboard, Stage 6 (the last stage): rubric fail
-- trends with analytics. Apply after schema_059.
--
-- Scope, per §11's own original spec text ("parameter-wise error trend
-- (WoW)") — Jamil was unavailable to confirm this round (deployment day,
-- "start next big task" while away), so this follows the doc's own words
-- plus the exact pattern every other stage already settled: fail rate
-- THIS period vs the immediately preceding period of the same length
-- (same "growth" shape as qa_revenue_growth_by_channel, Stage 4), per
-- rubric PARAMETER (not fatals — those already have Stage 3's fatal-
-- incident overview), sorted worst-first. A Claude-made call, flag if
-- the "WoW" in the original spec meant something narrower (literally
-- only week-over-week, never a longer period) — the page's own period
-- picker already lets Jamil pick "This week" for exactly that reading;
-- this just doesn't ALSO hard-code week-length elsewhere.
--
-- Standing rule from Stage 2 on: super_admin/qa_manager/qa_auditor,
-- SECURITY DEFINER, p_view ('mine'/'team').
-- ============================================================

-- Only scores from audits in scope (My View: the caller's own assigned agents via
-- quality_auditor_id, same scoping every other Stage 2-6 function uses) feed either
-- period's count. A parameter with zero scores THIS period is left out entirely (there
-- is nothing to rank) — a prior-period-only parameter (e.g. a rubric version just retired)
-- is equally uninformative for "what needs attention now," so the same omission is correct
-- there too, not an oversight.
create or replace function qa_rubric_fail_trends(p_from timestamptz, p_to timestamptz, p_view text default 'team')
returns table (
  parameter_id uuid,
  parameter_name text,
  category_name text,
  rubric_name text,
  total_scored int,
  total_failed int,
  fail_rate_pct numeric,
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
       and (v_role <> 'qa_auditor' or p_view = 'team' or u.quality_auditor_id = v_me)
  ),
  scoped_prior as (
    select apr.parameter_id, apr.passed
      from audit_parameter_results apr
      join audits a on a.id = apr.audit_id
      join users u on u.id = a.agent_id
     where a.status = 'submitted' and a.submitted_at >= v_prior_from and a.submitted_at < p_from
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
    rc.name,
    r.name,
    na.total,
    na.failed,
    round(na.failed::numeric / na.total * 100, 1),
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
revoke all on function qa_rubric_fail_trends(timestamptz, timestamptz, text) from public;
grant execute on function qa_rubric_fail_trends(timestamptz, timestamptz, text) to authenticated;
