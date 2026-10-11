-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 087 — Repeat-Mistake Report: filter/scope columns (Jamil, 2026-10-13).
-- Test in the Supabase SQL Editor before relying on it. Apply after schema_086.
--
-- Adds team_name, site_name and team_leader_name to repeat_mistake_report()'s
-- output — the agent's CURRENT values (a live join, same convention as every
-- other "current state" report in this system, e.g. qa_ryg_breakdown) — so the
-- UI can filter by Channel/Site/Team Leader without any new scoping logic:
-- these are just more columns on rows a viewer could already see.
--
-- Also adds p_view ('mine'/'team', default 'team') so a QA Auditor gets the
-- same My View/Team View choice every other Stage 3+ QA report has (this one
-- predates that standing convention, schema_052) — unrestricted for
-- super_admin/qa_manager, and unchanged for team_lead/manager (still always
-- their own team/chain, no toggle, per §2's own "Team Lead scoping is always
-- the one view" rule).
--
-- The return shape changes, so the function is DROPPED before being
-- redefined (§14) — every other line (role check, visibility rules,
-- ordering) is carried over unchanged from schema_049.
-- ============================================================

drop function if exists repeat_mistake_report(uuid);
create or replace function repeat_mistake_report(p_parameter_id uuid default null, p_view text default 'team')
returns table (
  agent_id uuid,
  agent_name text,
  team_name text,
  site_name text,
  team_leader_name text,
  parameter_id uuid,
  parameter_name text,
  fail_count int,
  status text,
  first_flagged_at timestamptz,
  last_checked_at timestamptz
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
  if v_role not in ('super_admin', 'qa_manager', 'qa_auditor', 'team_lead', 'manager') then
    return;
  end if;
  if p_view not in ('mine', 'team') then
    raise exception 'Choose My view or Team view.';
  end if;

  return query
  select crm.agent_id, u.name, u.team_name, u.site_name, tl.name,
         crm.parameter_id, rp.name,
         crm.fail_count, crm.status, crm.first_flagged_at, crm.last_checked_at
  from capa_repeat_mistakes crm
  join users u on u.id = crm.agent_id
  left join users tl on tl.id = u.team_leader_id
  join rubric_parameters rp on rp.id = crm.parameter_id
  where (p_parameter_id is null or crm.parameter_id = p_parameter_id)
    and (
      v_role in ('super_admin', 'qa_manager')
      or (v_role = 'qa_auditor' and (p_view = 'team' or u.quality_auditor_id = v_me))
      or (v_role = 'team_lead' and crm.agent_id in (select a from team_agent_ids() as a))
      or (v_role = 'manager' and crm.agent_id in (select a from manager_chain_ids() as a))
    )
  order by crm.fail_count desc, crm.status, u.name;
end;
$$;
revoke all on function repeat_mistake_report(uuid, text) from public;
grant execute on function repeat_mistake_report(uuid, text) to authenticated;
