-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 083 — QA Manager/Auditor dashboard parity for the Team Lead
-- dashboard's new Fatal/Zero-Seller/PIP detail (Jamil, 2026-10-11:
-- "is this implemented to other places like QA, manager view as well").
-- Same three facts, same reasoning, just read company-wide (or My View)
-- through /reports/qa-status-overview (schema_054) instead of one team.
-- Manager's own dashboard has no equivalent Fatal/Zero-Seller/PIP section
-- at all today (just links to the PIP pages) — nothing to extend there.
-- Apply after schema_082. Test in the Supabase SQL Editor before relying on it.
--
-- qa_fatal_incident_overview gains fatal_parameters (the fatal item(s)
-- actually ticked on that audit) and lifetime_fatal_count (that agent's
-- all-time critical-fatal count — not scoped to the picked period, same
-- "running total, not reset by the period picker" shape as everywhere else
-- a lifetime figure appears in this system).
-- qa_zero_seller_overview gains vintage_label/vintage_days,
-- days_since_last_sale, and last_sale_revenue_usd (summed the same way
-- agent_revenue_usd always converts, over the last-sale Dhaka calendar day
-- — more than one sale on the same day is routine, so this sums the whole
-- day rather than guessing at a single transaction).
-- qa_pip_live_progress gains last_sale_date (looked up from
-- agent_zero_seller_status, the same source the Team Lead dashboard reads).
-- "Remaining" is deliberately NOT added as a column — target_usd minus
-- achieved_usd is already both present, so the page computes it the same
-- way the Team Lead dashboard's own service layer does, rather than storing
-- a third copy of simple subtraction.
--
-- The return shape of all three changes, so each is DROPPED before being
-- redefined (CREATE OR REPLACE can't change a function's output columns) —
-- same discipline as every prior signature change in this project (§14).
-- Every other line (role check, scoping, ordering) is carried over unchanged
-- from schema_054 — only the SELECT list and RETURNS TABLE grew.
-- ============================================================

-- ── Fatal-incident overview: + fatal item(s) ticked, + lifetime fatal count ──
drop function if exists qa_fatal_incident_overview(timestamptz, timestamptz, text);
create or replace function qa_fatal_incident_overview(p_from timestamptz, p_to timestamptz, p_view text default 'team')
returns table (
  audit_id uuid,
  agent_id uuid,
  agent_name text,
  team_name text,
  site_name text,
  auditor_name text,
  submitted_at timestamptz,
  fatal_parameters text[],
  lifetime_fatal_count int
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
  select a.id, u.id, u.name, u.team_name, u.site_name, au.name, a.submitted_at,
         (select array_agg(fp.description order by fp.sort_order)
            from audit_fatal_results afr
            join fatal_parameters fp on fp.id = afr.fatal_parameter_id
           where afr.audit_id = a.id),
         (select count(*)::int
            from audits a2
           where a2.agent_id = a.agent_id and a2.status = 'submitted'
             and a2.check_mode = 'audit' and a2.critical_fail)
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

-- ── Zero-Seller overview: + vintage, + days since last sale, + that day's USD revenue ──
drop function if exists qa_zero_seller_overview(text);
create or replace function qa_zero_seller_overview(p_view text default 'team')
returns table (
  agent_id uuid,
  agent_name text,
  team_name text,
  site_name text,
  current_streak_weeks int,
  streak_start_week date,
  last_sale_date date,
  vintage_label text,
  vintage_days int,
  days_since_last_sale int,
  last_sale_revenue_usd numeric
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
begin
  if v_role not in ('super_admin', 'qa_manager', 'qa_auditor') then
    return;
  end if;
  if p_view not in ('mine', 'team') then
    raise exception 'Choose My view or Team view.';
  end if;

  return query
  select u.id, u.name, u.team_name, u.site_name, z.current_streak_weeks, z.streak_start_week, z.last_sale_date,
         vintage_slab_for(u.employment_stage, u.joining_date, v_today),
         case when u.employment_stage in ('ojt', 're_training') or u.joining_date is null then null
              else (v_today - u.joining_date) end,
         case when z.last_sale_date is null then null else (v_today - z.last_sale_date) end,
         case when z.last_sale_date is null then null
              else coalesce(agent_revenue_usd(
                     u.id,
                     (z.last_sale_date::timestamp) at time zone 'Asia/Dhaka',
                     ((z.last_sale_date + 1)::timestamp) at time zone 'Asia/Dhaka'
                   ), 0)
         end
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

-- ── PIP live progress: + last sale date ──
drop function if exists qa_pip_live_progress(text);
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
