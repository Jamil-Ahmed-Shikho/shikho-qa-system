-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 112 — Rubric Fail Trends: "Who needs coaching" follows the page's own period picker
-- (Jamil, 2026-11-08). Apply after 111.
--
-- qa_parameter_coaching_list() always looked at "the current sales week so far", no matter what
-- period (This sales week / Last sales week / Last 30 days) was picked for the rest of the page —
-- so picking "Last sales week" showed the right fail-rate numbers but an empty coaching list every
-- time ("Nobody failed this this week"), because it silently kept asking about THIS week underneath.
-- Jamil's own point: he wants to see who failed LAST week specifically, to check whether they've
-- since been coached — exactly the case this bug made impossible.
--
-- Fix: take p_from/p_to like every other period-driven report in this system (qa_channel_progress,
-- qa_auditor_ranking, etc.) instead of computing the current week internally. Defaults match the old
-- hardcoded behaviour (current sales week to now) so nothing breaks if ever called without them.
--
-- The old 2-argument function is dropped first — two new TRAILING default-valued parameters still
-- change the signature, so a bare create-or-replace would have left both versions sitting side by
-- side as silent overloads rather than replacing it (§14's own documented lesson, hit for real while
-- building this: applying this file live first created exactly that pair of overloads, confirmed via
-- pg_get_function_identity_arguments(), before the explicit drop below was added).
-- ============================================================

drop function if exists qa_parameter_coaching_list(text, text);

create or replace function qa_parameter_coaching_list(
  p_view text default 'team',
  p_team_name text default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (parameter_id uuid, agent_id uuid, agent_name text, team_leader_name text, total_count int, fail_count int)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_role text := current_app_role();
  v_me uuid := current_app_user_id();
  v_from timestamptz := coalesce(p_from, (sales_week_start((now() at time zone 'Asia/Dhaka')::date)::timestamp at time zone 'Asia/Dhaka'));
  v_to timestamptz := coalesce(p_to, now());
begin
  if v_role not in ('super_admin', 'qa_manager', 'qa_auditor', 'team_lead', 'manager') then
    return;
  end if;
  if p_view not in ('mine', 'team') then
    raise exception 'Choose My view or Team view.';
  end if;
  if v_to <= v_from then
    raise exception 'The period''s end must be after its start.';
  end if;

  return query
  select apr.parameter_id, u.id, u.name, tl.name,
         count(*)::int as total_count,
         count(*) filter (where not apr.passed)::int as fail_count
    from audit_parameter_results apr
    join audits a on a.id = apr.audit_id
    join users u on u.id = a.agent_id
    left join users tl on tl.id = u.team_leader_id
   where a.status = 'submitted' and a.submitted_at >= v_from and a.submitted_at < v_to
     and (
       (v_role in ('super_admin', 'qa_manager') and (p_team_name is null or u.team_name = p_team_name))
       or (v_role = 'qa_auditor' and (p_team_name is null or u.team_name = p_team_name) and (p_view = 'team' or u.quality_auditor_id = v_me))
       or (v_role = 'team_lead' and a.agent_id in (select x from team_agent_ids() as x))
       or (v_role = 'manager' and a.agent_id in (select x from manager_chain_ids() as x))
     )
   group by apr.parameter_id, u.id, u.name, tl.name
  having count(*) filter (where not apr.passed) > 0
   order by apr.parameter_id, fail_count desc, u.name;
end;
$$;
