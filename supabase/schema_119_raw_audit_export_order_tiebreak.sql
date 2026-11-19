-- ============================================================
-- Raw Audit Data Export — deterministic ordering for pagination (Jamil, 2026-11-19)
--
-- Jamil found the export silently stops at 1000 rows on a period that has
-- more than that. Root cause (application-side, audit-export.service.ts):
-- both RPCs (schema_107) were called with no pagination at all, so
-- PostgREST's own default row cap on an unpaginated request truncated the
-- result — the exact same class of bug already found and fixed once in
-- this project for listUsers() (CLAUDE.md §14) and scripts/rematch-revenue.mjs.
--
-- The application-side fix (a .range() page loop) is what actually solves
-- it. This migration only strengthens the ORDER BY the two functions
-- already had — `order by a.submitted_at desc` alone is not a FULLY
-- deterministic sort when two audits share the exact same submitted_at
-- (confirmed common among the historical-import rows, CLAUDE.md's own
-- note: "many historical rows share an identical timestamp"). Paginating
-- with .range() runs the query again for each page; without a unique
-- tiebreaker, Postgres is free to return tied rows in a different relative
-- order between those separate executions, which could skip or duplicate
-- a row across page boundaries. Adding a.id as the tiebreak (same fix
-- listUsers() used, with its own name tiebreak) makes every page's cut
-- point exact and repeatable.
--
-- Same signatures as schema_107 — create or replace is enough, no drop.
-- ============================================================

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
   order by a.submitted_at desc, a.id desc;
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
   order by a.submitted_at desc, a.id desc, rp.sort_order;
end;
$$;
revoke all on function raw_audit_export_failed_parameters(timestamptz, timestamptz, uuid, text) from public;
grant execute on function raw_audit_export_failed_parameters(timestamptz, timestamptz, uuid, text) to authenticated;
