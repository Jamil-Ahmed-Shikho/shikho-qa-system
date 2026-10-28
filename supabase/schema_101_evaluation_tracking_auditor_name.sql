-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 101 — Evaluation Email Tracking: add the QA Auditor's name
-- alongside the agent/Team Lead (Jamil, 2026-10-28: "Here, I want QA name
-- as well"). Apply after 100. Test in the Supabase SQL Editor first.
--
-- Output column set changes (new auditor_name column), so the function is
-- dropped and recreated rather than CREATE OR REPLACE (§14 — a changed
-- RETURNS TABLE needs a drop first). Everything else — role gate, scoping,
-- filters, ordering — is byte-for-byte unchanged from schema_092.
-- ============================================================

drop function if exists evaluation_tracking_report(timestamptz, timestamptz, text);

create or replace function evaluation_tracking_report(p_from timestamptz, p_to timestamptz, p_view text default 'team')
returns table (
  audit_id uuid,
  agent_id uuid,
  agent_name text,
  team_name text,
  site_name text,
  team_leader_name text,
  auditor_name text,
  submitted_at timestamptz,
  viewed_at timestamptz,
  view_count int
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
  if p_to <= p_from then
    raise exception 'The period''s end must be after its start.';
  end if;
  if p_view not in ('mine', 'team') then
    raise exception 'Choose My view or Team view.';
  end if;

  return query
  select a.id, a.agent_id, u.name, u.team_name, u.site_name, tl.name, qa.name,
         a.submitted_at, v.last_viewed_at, coalesce(v.view_count, 0)
    from audits a
    join users u on u.id = a.agent_id
    left join users tl on tl.id = u.team_leader_id
    left join users qa on qa.id = a.auditor_id
    left join audit_result_views v on v.audit_id = a.id
   where a.status = 'submitted' and a.check_mode = 'audit'
     and a.submitted_at >= p_from and a.submitted_at < p_to
     and (
       v_role in ('super_admin', 'qa_manager')
       or (v_role = 'qa_auditor' and (p_view = 'team' or u.quality_auditor_id = v_me))
       or (v_role = 'team_lead' and a.agent_id in (select x from team_agent_ids() as x))
       or (v_role = 'manager' and a.agent_id in (select x from manager_chain_ids() as x))
     )
   order by a.submitted_at desc;
end;
$$;
revoke all on function evaluation_tracking_report(timestamptz, timestamptz, text) from public;
grant execute on function evaluation_tracking_report(timestamptz, timestamptz, text) to authenticated;
