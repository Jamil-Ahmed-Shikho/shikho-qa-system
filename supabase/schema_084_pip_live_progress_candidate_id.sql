-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 084 — qa_pip_live_progress() gains candidate_id (pip_candidates.id),
-- so the PIP live-progress row can link straight to /pip/{candidateId}
-- (feedback + training), the same way the Team Lead and Manager dashboards'
-- own PIP sections now do. Apply after schema_083.
--
-- Jamil, 2026-10-12: rather than duplicate the feedback/training workflow
-- INTO the live-progress table (multiple feedback entries, a multi-row
-- training-session history with its own actions, and a QA/Manager-only
-- termination-flag panel don't fit a compact summary row), each row links
-- straight to the existing /pip/{candidateId} page instead — same decision
-- already applied to the Team Lead and Manager dashboards.
--
-- The return shape changes, so the function is DROPPED before being
-- redefined (CREATE OR REPLACE can't change output columns, §14). Every
-- other line is carried over unchanged from schema_083 — only pc.id was
-- added to the SELECT list and candidate_id to RETURNS TABLE.
-- ============================================================

drop function if exists qa_pip_live_progress(text);
create or replace function qa_pip_live_progress(p_view text default 'team')
returns table (
  candidate_id uuid,
  agent_id uuid,
  agent_name text,
  team_leader_name text,
  site_name text,
  auditor_name text,
  cycle_month date,
  cycle_end_date date,
  target_usd numeric,
  achieved_usd numeric,
  days_left int,
  run_rate_required_usd_per_day numeric,
  target_met boolean,
  last_sale_date date
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
  v_cycle record;
  v_start timestamptz;
  v_end_exclusive timestamptz;
begin
  if v_role not in ('super_admin', 'qa_manager', 'qa_auditor') then
    return;
  end if;
  if p_view not in ('mine', 'team') then
    raise exception 'Choose My view or Team view.';
  end if;

  select c.id, c.month, c.start_date, c.end_date into v_cycle
    from pip_cycles c
   where c.start_date <= v_today and c.end_date >= v_today
   order by c.start_date desc
   limit 1;
  if v_cycle.id is null then
    return;
  end if;

  v_start := (v_cycle.start_date::timestamp) at time zone 'Asia/Dhaka';
  v_end_exclusive := ((v_cycle.end_date + 1)::timestamp) at time zone 'Asia/Dhaka';

  return query
  select
    pc.id,
    pc.agent_id,
    u.name,
    tl.name,
    pc.site_name,
    qa.name,
    v_cycle.month,
    v_cycle.end_date,
    pc.target_revenue,
    achieved.rev,
    greatest(v_cycle.end_date - v_today, 0),
    case when pc.target_revenue is null or achieved.rev >= pc.target_revenue then null
      else round((pc.target_revenue - achieved.rev) / greatest(v_cycle.end_date - v_today, 1), 2) end,
    case when pc.target_revenue is null then null else achieved.rev >= pc.target_revenue end,
    zs.last_sale_date
    from pip_candidates pc
    join users u on u.id = pc.agent_id
    left join users tl on tl.id = u.team_leader_id
    left join users qa on qa.id = u.quality_auditor_id
    left join agent_zero_seller_status zs on zs.agent_id = pc.agent_id
    cross join lateral (select coalesce(agent_revenue_usd(pc.agent_id, v_start, least(now(), v_end_exclusive)), 0) as rev) achieved
   where pc.pip_cycle_id = v_cycle.id and pc.status = 'approved'
     and (v_role <> 'qa_auditor' or p_view = 'team' or u.quality_auditor_id = v_me)
   order by achieved.rev / nullif(pc.target_revenue, 0) asc nulls first, u.name;
end;
$$;
revoke all on function qa_pip_live_progress(text) from public;
grant execute on function qa_pip_live_progress(text) to authenticated;
