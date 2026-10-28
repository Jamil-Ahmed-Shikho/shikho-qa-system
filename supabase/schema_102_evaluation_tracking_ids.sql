-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 102 — Evaluation Email Tracking: return the QA Auditor's and
-- Team Lead's own ids (not just their names), so the report page can
-- build a QA-wise / Team-Lead-wise summary and filter by a specific
-- person without relying on a display name, which is not guaranteed
-- unique (per §14/listUsers() — several real users already share a
-- display name in this org). Apply after 101.
--
-- Output column set changes, so the function is dropped and recreated
-- (§14). Role gate, scoping, filters and ordering are unchanged from
-- schema_101 — only the two new id columns are added.
-- ============================================================

drop function if exists evaluation_tracking_report(timestamptz, timestamptz, text);

create or replace function evaluation_tracking_report(p_from timestamptz, p_to timestamptz, p_view text default 'team')
returns table (
  audit_id uuid,
  agent_id uuid,
  agent_name text,
  team_name text,
  site_name text,
  team_leader_id uuid,
  team_leader_name text,
  auditor_id uuid,
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
  select a.id, a.agent_id, u.name, u.team_name, u.site_name, tl.id, tl.name, qa.id, qa.name,
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
