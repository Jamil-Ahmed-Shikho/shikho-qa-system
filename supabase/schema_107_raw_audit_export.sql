-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 107 — Raw Audit Data Export (2026-11-01, Jamil: "Some of the team
-- leaders/manager asking for raw audit data"). Apply after 106.
--
-- Access, confirmed with Jamil, same standing pattern as every other report
-- in this system (§2's My View/Team View note):
--   - Super Admin / QA Manager: everyone, company-wide, always.
--   - QA Auditor: My View (their own assigned agents, quality_auditor_id)
--     or Team View (everyone) — defaults to My View, same convention as
--     qa_agent_queue()/dashboard/auditor's own default logic.
--   - Manager: their own reporting chain only, always.
--   - Team Lead: their own team only, always.
-- No manager-drill-down picker for Admin/QA roles here (unlike the
-- Campaign Report) — not asked for, kept out to stay tightly scoped to
-- what was actually agreed.
--
-- raw_audit_export_scope() is its own, separately-named copy of the same
-- role/chain-walk logic campaign_report_scope() already has (§14's own
-- lesson — don't widen/reuse a shared helper across unrelated reports;
-- each report keeps its own copy so one's access rule can never silently
-- change another's).
--
-- EFFECTIVE RESULT ONLY: an audit that has been superseded by a Review
-- Request revision (audits.superseded_by is not null) is excluded — the
-- re-audit row that replaced it is a complete, independent audits row and
-- appears in its own right with the current, correct score. Exporting
-- both would show the same call twice with two different scores; showing
-- only the original would show a stale one. Matches how /audits/[id] and
-- /my-audits/[id] already resolve this (loadEffectiveResult()).
--
-- VINTAGE shown is CURRENT vintage (as of today), not vintage at the time
-- of the audit — same convention as every other agent-facing screen in
-- this system (AgentQueueTable, AgentProfileView, etc.), not a new one
-- invented for this export.
--
-- Two functions, not one: the main summary (one row per audit) and the
-- failed-parameter detail (one row per FAILED parameter result only —
-- Jamil was explicit that passed parameters, which carry no feedback
-- anyway per the scoring rule, don't belong in the export). Fatal items
-- are summarized compactly on the main row instead (description +
-- feedback joined, since there's rarely more than one or two per audit)
-- rather than a third sheet — a Claude-made call, flag if you'd rather
-- have fatals as their own detail rows too.
-- ============================================================

create or replace function raw_audit_export_scope(p_manager_id uuid, p_view text default 'mine')
returns uuid[]
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_role text := current_app_role();
  v_me uuid := current_app_user_id();
begin
  if v_role in ('super_admin', 'qa_manager') then
    if p_manager_id is null then
      return null; -- no restriction: every agent
    end if;
    return (select coalesce(array_agg(c), '{}') from manager_chain_ids(p_manager_id) c);
  end if;

  if v_role = 'qa_auditor' then
    if p_manager_id is not null then
      return (
        select coalesce(array_agg(chain.id), '{}')
        from (
          with recursive c as (
            select u.id from users u where u.manager_id = p_manager_id and u.role = 'team_lead'
            union
            select u.id from users u join c on u.team_leader_id = c.id
          )
          select id from c
        ) chain
      );
    end if;
    if p_view = 'mine' then
      return (select coalesce(array_agg(u.id), '{}') from users u where u.quality_auditor_id = v_me and u.role = 'agent');
    end if;
    return null; -- team view: unrestricted
  end if;

  if v_role = 'manager' then
    return (select coalesce(array_agg(c), '{}') from manager_chain_ids(null) c);
  end if;

  if v_role = 'team_lead' then
    return (select coalesce(array_agg(c), '{}') from team_agent_ids(null) c);
  end if;

  return '{}'::uuid[]; -- any other role: nothing
end;
$$;
revoke all on function raw_audit_export_scope(uuid, text) from public;
grant execute on function raw_audit_export_scope(uuid, text) to authenticated;

create or replace function raw_audit_export_summary(
  p_from timestamptz, p_to timestamptz, p_manager_id uuid default null, p_view text default 'mine'
)
returns table (
  audit_id uuid,
  audit_type text,
  rubric_name text,
  agent_name text,
  agent_emp_id text,
  team_name text,
  site_name text,
  vintage_label text,
  auditor_name text,
  call_started_at timestamptz,
  call_duration_minutes numeric,
  crm_lead_id text,
  call_status text,
  score_percent numeric,
  passed boolean,
  critical_fail boolean,
  fatal_count int,
  fatal_summary text,
  overall_feedback text,
  submitted_at timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_role text := current_app_role();
  v_scope uuid[] := raw_audit_export_scope(p_manager_id, p_view);
begin
  if v_role not in ('super_admin', 'qa_manager', 'qa_auditor', 'team_lead', 'manager') then
    return;
  end if;
  if p_to <= p_from then
    raise exception 'The period''s end must be after its start.';
  end if;

  return query
  select a.id, a.audit_type,
         r.name || ' (v' || r.version || ')',
         u.name, u.emp_id, u.team_name, u.site_name,
         vintage_slab_for(u.employment_stage, u.joining_date, (now() at time zone 'Asia/Dhaka')::date),
         au.name,
         a.call_started_at,
         case when a.call_started_at is not null and a.call_ended_at is not null
              then round(extract(epoch from (a.call_ended_at - a.call_started_at)) / 60.0, 1) end,
         a.crm_lead_id, a.call_status,
         a.score_percent, a.passed, a.critical_fail,
         (select count(*) from audit_fatal_results f where f.audit_id = a.id)::int,
         (select string_agg(fp.description || coalesce(' — ' || f.feedback, ''), ' | ' order by fp.sort_order)
            from audit_fatal_results f join fatal_parameters fp on fp.id = f.fatal_parameter_id
           where f.audit_id = a.id),
         a.overall_feedback,
         a.submitted_at
    from audits a
    join users u on u.id = a.agent_id
    left join users au on au.id = a.auditor_id
    left join rubrics r on r.id = a.rubric_id
   where a.status = 'submitted' and a.check_mode = 'audit' and a.superseded_by is null
     and a.submitted_at >= p_from and a.submitted_at < p_to
     and (v_scope is null or a.agent_id = any(v_scope))
   order by a.submitted_at desc;
end;
$$;
revoke all on function raw_audit_export_summary(timestamptz, timestamptz, uuid, text) from public;
grant execute on function raw_audit_export_summary(timestamptz, timestamptz, uuid, text) to authenticated;

create or replace function raw_audit_export_failed_parameters(
  p_from timestamptz, p_to timestamptz, p_manager_id uuid default null, p_view text default 'mine'
)
returns table (
  audit_id uuid,
  agent_name text,
  parameter_name text,
  points_lost numeric,
  feedback text
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_role text := current_app_role();
  v_scope uuid[] := raw_audit_export_scope(p_manager_id, p_view);
begin
  if v_role not in ('super_admin', 'qa_manager', 'qa_auditor', 'team_lead', 'manager') then
    return;
  end if;
  if p_to <= p_from then
    raise exception 'The period''s end must be after its start.';
  end if;

  return query
  select a.id, u.name, rp.name, rp.points, apr.feedback
    from audit_parameter_results apr
    join audits a on a.id = apr.audit_id
    join users u on u.id = a.agent_id
    join rubric_parameters rp on rp.id = apr.parameter_id
   where apr.passed = false
     and a.status = 'submitted' and a.check_mode = 'audit' and a.superseded_by is null
     and a.submitted_at >= p_from and a.submitted_at < p_to
     and (v_scope is null or a.agent_id = any(v_scope))
   order by a.submitted_at desc, rp.sort_order;
end;
$$;
revoke all on function raw_audit_export_failed_parameters(timestamptz, timestamptz, uuid, text) from public;
grant execute on function raw_audit_export_failed_parameters(timestamptz, timestamptz, uuid, text) to authenticated;
