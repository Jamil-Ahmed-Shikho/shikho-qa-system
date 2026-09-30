-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 054 — QA Manager dashboard, Stage 3: RYG breakdown, PIP overview
-- (two views — historic reference + current-cycle live progress),
-- Zero-Seller overview, and a fatal-incident overview.
-- Apply after schema_053. Test against the live database before relying on it.
--
-- Jamil, 2026-09-30, scoped via three short AskUserQuestion picks:
--   - Every section shows counts AND an agent-level list (not summary-only).
--   - The fatal-incident window follows the page's own period picker (not a
--     separate fixed 4-week window).
--   - PIP needed a genuine design conversation, not just a pick: the
--     suggested/excluded/approved/completed/failed counts he originally
--     asked for are "historic data for reference" (a simple per-cycle
--     summary — qa_pip_history_summary below); what he actually wants to
--     WORK from day to day is a second, live view of the CURRENT cycle's
--     approved candidates — who's on a PIP right now, their Team Lead and
--     site, their auditor, their target, how much they've achieved so far,
--     how many days are left in the cycle, and the daily run rate still
--     needed to hit target (qa_pip_live_progress below — his own "you think
--     how to make it better" invitation, since he didn't specify the run-
--     rate math himself).
--
-- Every function here follows the same shape schema_052 established:
-- SECURITY DEFINER, its own role check (super_admin/qa_manager/qa_auditor),
-- and a p_view ('mine'/'team') parameter — 'mine' scopes to the caller's own
-- assigned agents (quality_auditor_id = caller), 'team' is company-wide,
-- ignored for super_admin/qa_manager. This is now the STANDING shape for
-- every Stage 3-6 function, per Jamil's confirmation after Stage 2 that QA
-- Auditor access with My View/Team View should apply throughout, not be
-- asked about again each stage.
--
-- qa_fatal_incident_overview(p_from, p_to, p_view) is the only one of the
-- five that takes a period — it follows the page's own picker, per Jamil's
-- pick above. The others are current-state snapshots (RYG's own status is
-- already a rolling 4-week figure per §6.2; Zero-Seller streak and PIP are
-- inherently "right now" facts, not period-filterable in a way that would
-- mean anything different).
-- ============================================================

-- ── RYG breakdown: every eligible agent's current status, with the agent-level detail ──
create or replace function qa_ryg_breakdown(p_view text default 'team')
returns table (
  agent_id uuid,
  agent_name text,
  team_name text,
  site_name text,
  status text,
  avg_audit_score numeric,
  critical_fatal_count int,
  period_end date
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_role text := current_app_role();
  v_me uuid := current_app_user_id();
begin
  if v_role not in ('super_admin', 'qa_manager', 'qa_auditor') then
    return;
  end if;
  if p_view not in ('mine', 'team') then
    raise exception 'Choose My view or Team view.';
  end if;

  return query
  select u.id, u.name, u.team_name, u.site_name,
         coalesce(s.status, 'unrated'), s.avg_audit_score, coalesce(s.critical_fatal_count, 0), s.period_end
    from users u
    left join agent_current_status s on s.agent_id = u.id
   where u.role = 'agent' and u.is_active and u.employment_stage = 'active'
     and (v_role <> 'qa_auditor' or p_view = 'team' or u.quality_auditor_id = v_me)
   order by case coalesce(s.status, 'unrated') when 'red' then 1 when 'unrated' then 2 when 'yellow' then 3 when 'green' then 4 else 5 end, u.name;
end;
$$;
revoke all on function qa_ryg_breakdown(text) from public;
grant execute on function qa_ryg_breakdown(text) to authenticated;

-- ── Zero-Seller overview: everyone currently ON a streak, with the agent-level detail ──
create or replace function qa_zero_seller_overview(p_view text default 'team')
returns table (
  agent_id uuid,
  agent_name text,
  team_name text,
  site_name text,
  current_streak_weeks int,
  streak_start_week date,
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
begin
  if v_role not in ('super_admin', 'qa_manager', 'qa_auditor') then
    return;
  end if;
  if p_view not in ('mine', 'team') then
    raise exception 'Choose My view or Team view.';
  end if;

  return query
  select u.id, u.name, u.team_name, u.site_name, z.current_streak_weeks, z.streak_start_week, z.last_sale_date
    from agent_zero_seller_status z
    join users u on u.id = z.agent_id
   where z.current_streak_weeks > 0
     and u.role = 'agent' and u.is_active and u.employment_stage = 'active'
     and (v_role <> 'qa_auditor' or p_view = 'team' or u.quality_auditor_id = v_me)
   order by z.current_streak_weeks desc, u.name;
end;
$$;
revoke all on function qa_zero_seller_overview(text) from public;
grant execute on function qa_zero_seller_overview(text) to authenticated;

-- ── Fatal-incident overview: every critical-fatal audit in the picked period, with the agent-level detail ──
create or replace function qa_fatal_incident_overview(p_from timestamptz, p_to timestamptz, p_view text default 'team')
returns table (
  audit_id uuid,
  agent_id uuid,
  agent_name text,
  team_name text,
  site_name text,
  auditor_name text,
  submitted_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_role text := current_app_role();
  v_me uuid := current_app_user_id();
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

  return query
  select a.id, u.id, u.name, u.team_name, u.site_name, au.name, a.submitted_at
    from audits a
    join users u on u.id = a.agent_id
    left join users au on au.id = a.auditor_id
   where a.status = 'submitted' and a.critical_fail
     and a.submitted_at >= p_from and a.submitted_at < p_to
     and (v_role <> 'qa_auditor' or p_view = 'team' or u.quality_auditor_id = v_me)
   order by a.submitted_at desc;
end;
$$;
revoke all on function qa_fatal_incident_overview(timestamptz, timestamptz, text) from public;
grant execute on function qa_fatal_incident_overview(timestamptz, timestamptz, text) to authenticated;

-- ── PIP overview, view 1: historic reference — per-cycle status counts, last 12 cycles ──
create or replace function qa_pip_history_summary(p_view text default 'team')
returns table (
  cycle_id uuid,
  month date,
  suggested_count int,
  excluded_count int,
  approved_count int,
  completed_count int,
  failed_count int
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_role text := current_app_role();
  v_me uuid := current_app_user_id();
begin
  if v_role not in ('super_admin', 'qa_manager', 'qa_auditor') then
    return;
  end if;
  if p_view not in ('mine', 'team') then
    raise exception 'Choose My view or Team view.';
  end if;

  return query
  select c.id, c.month,
         count(*) filter (where pc.status = 'suggested')::int,
         count(*) filter (where pc.status = 'excluded')::int,
         count(*) filter (where pc.status = 'approved')::int,
         count(*) filter (where pc.status = 'completed')::int,
         count(*) filter (where pc.status = 'failed')::int
    from pip_cycles c
    left join pip_candidates pc on pc.pip_cycle_id = c.id
    left join users u on u.id = pc.agent_id
   where (v_role <> 'qa_auditor' or p_view = 'team' or pc.agent_id is null or u.quality_auditor_id = v_me)
   group by c.id, c.month
   order by c.month desc
   limit 12;
end;
$$;
revoke all on function qa_pip_history_summary(text) from public;
grant execute on function qa_pip_history_summary(text) to authenticated;

-- ── PIP overview, view 2: the current cycle's LIVE progress (Jamil's own design request) ──
-- Only the cycle whose date range covers today (there should be at most one). For each currently-APPROVED
-- candidate: their Team Lead and site (site frozen at selection, matching this area's existing
-- "_at_selection" convention, schema_040/046), their auditor (current quality_auditor_id), their target
-- (frozen at selection, schema_046), what they've earned so far this cycle (agent_revenue_usd over the
-- cycle's own window, capped at now — the same calculation Stage 6's agent-facing loadMyPip() already uses),
-- days left in the cycle, and the daily USD run rate still needed to hit target (null once target is met,
-- or if the target was never set).
create or replace function qa_pip_live_progress(p_view text default 'team')
returns table (
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
  target_met boolean
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
    case when pc.target_revenue is null then null else achieved.rev >= pc.target_revenue end
    from pip_candidates pc
    join users u on u.id = pc.agent_id
    left join users tl on tl.id = u.team_leader_id
    left join users qa on qa.id = u.quality_auditor_id
    cross join lateral (select coalesce(agent_revenue_usd(pc.agent_id, v_start, least(now(), v_end_exclusive)), 0) as rev) achieved
   where pc.pip_cycle_id = v_cycle.id and pc.status = 'approved'
     and (v_role <> 'qa_auditor' or p_view = 'team' or u.quality_auditor_id = v_me)
   order by achieved.rev / nullif(pc.target_revenue, 0) asc nulls first, u.name;
end;
$$;
revoke all on function qa_pip_live_progress(text) from public;
grant execute on function qa_pip_live_progress(text) to authenticated;
