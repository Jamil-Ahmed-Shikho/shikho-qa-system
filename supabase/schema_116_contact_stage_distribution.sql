-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 116 — Contact Stage Audit Coverage report (Jamil, 2026-11-10): "what contact stage's call
-- audited what percentage" — the same monitoring purpose as schema_114's Call Duration report, just
-- for lead stage instead of call length: is QA auditing calls across every stage of the pipeline, or
-- clustering on a few easy ones? Apply after 115 (audits.contact_stage).
--
-- Scope: real audits only (audit_type='call', check_mode='audit', submitted) — same exclusions as
-- every other "audit count" report (schema_074). contact_stage is the stage AT THE TIME OF THE CALL
-- (frozen, §10/schema_115) — never today's current stage. Unlike duration, stage has no fixed slab
-- width — it's whatever the CRM's own stage list contains (confirmed ~10 values) — so this groups by
-- the actual distinct value present (coalesced to 'Not recorded' when null: not yet backfilled, or a
-- CRM lookup failure at audit time) rather than a cross-joined fixed grid.
-- ============================================================

create or replace function qa_contact_stage_distribution(
  p_from timestamptz, p_to timestamptz, p_view text default 'team', p_team_name text default null
)
returns table (auditor_id uuid, auditor_name text, stage text, calls_done int)
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
  select a.auditor_id, u.name as auditor_name, coalesce(a.contact_stage, 'Not recorded') as stage, count(*)::int as calls_done
    from audits a
    join users u on u.id = a.auditor_id
   where a.status = 'submitted' and a.audit_type = 'call' and a.check_mode = 'audit'
     and a.submitted_at >= p_from and a.submitted_at < p_to
     and u.role = 'qa_auditor'
     and (v_role <> 'qa_auditor' or p_view = 'team' or a.auditor_id = v_me)
     and (p_team_name is null or exists (select 1 from users ag where ag.id = a.agent_id and ag.team_name = p_team_name))
   group by a.auditor_id, u.name, coalesce(a.contact_stage, 'Not recorded')
   order by u.name, calls_done desc;
end;
$$;
