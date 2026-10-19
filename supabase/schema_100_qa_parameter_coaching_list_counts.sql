-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 100 — qa_parameter_coaching_list (schema_099): add each agent's
-- total audits scored on the parameter this week alongside their fail
-- count, so "2 failed" can be read next to "out of how many" (e.g. "2 of
-- 2" reads very differently from "2 of 11"). Apply after 099.
--
-- Jamil's feedback on the first version: the inline per-row expand list
-- (capped at 10, "+N more" not clickable) was awkward for a parameter
-- with dozens of names — he wants the full list on its own page instead,
-- with the audit count alongside the fail count. This migration is the
-- data-side half of that; the page itself is an app-code change only.
--
-- Output column set changes (new total_count column), so the function is
-- dropped and recreated rather than CREATE OR REPLACE (§14 — a changed
-- RETURNS TABLE needs a drop first).
-- ============================================================

drop function if exists qa_parameter_coaching_list(text, text);

create or replace function qa_parameter_coaching_list(
  p_view text default 'team', p_team_name text default null
)
returns table (
  parameter_id uuid,
  agent_id uuid,
  agent_name text,
  team_leader_name text,
  total_count int,
  fail_count int
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_role text := current_app_role();
  v_me uuid := current_app_user_id();
  v_week_start date;
  v_from timestamptz;
begin
  if v_role not in ('super_admin', 'qa_manager', 'qa_auditor', 'team_lead', 'manager') then
    return;
  end if;
  if p_view not in ('mine', 'team') then
    raise exception 'Choose My view or Team view.';
  end if;

  v_week_start := sales_week_start((now() at time zone 'Asia/Dhaka')::date);
  v_from := (v_week_start::timestamp at time zone 'Asia/Dhaka');

  return query
  select apr.parameter_id, u.id, u.name, tl.name,
         count(*)::int as total_count,
         count(*) filter (where not apr.passed)::int as fail_count
    from audit_parameter_results apr
    join audits a on a.id = apr.audit_id
    join users u on u.id = a.agent_id
    left join users tl on tl.id = u.team_leader_id
   where a.status = 'submitted' and a.submitted_at >= v_from and a.submitted_at < now()
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
revoke all on function qa_parameter_coaching_list(text, text) from public;
grant execute on function qa_parameter_coaching_list(text, text) to authenticated;
