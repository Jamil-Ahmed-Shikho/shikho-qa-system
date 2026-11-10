-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 114 — Call Duration Audit Coverage report (Jamil, 2026-11-10): "I want to monitor my team
-- is auditing all types of call duration, not only some small calls." Apply after 113.
-- Test in the Supabase SQL Editor before relying on it.
--
-- Scope: real audits only (audit_type='call', check_mode='audit', submitted) — Sample Checks are
-- excluded, same as every other "audit count" report in this system (schema_074's own fix). Duration
-- is computed on the fly (call_ended_at - call_started_at) — not stored anywhere, and doesn't need
-- to be: 28,702 of 28,705 real call audits already have both timestamps.
--
-- Same tidy "cross-join the fixed dimension, left join actual counts" shape as qa_daily_activity()
-- (schema_095/096) — one row per (auditor, slab), every slab always present even at 0, pivoted into
-- a matrix client-side. Slab boundaries are half-open [min, max) except the last ("more than 20
-- minutes", unbounded) — so a call at exactly 1:00 falls in "1-3 minutes", not "less than 1 minute".
--
-- p_team_name filters by the AUDITED AGENT's team (not the auditor's own team_name, which is
-- informational-only everywhere else in this system, §2) — same convention as qa_channel_progress().
-- ============================================================

create or replace function qa_call_duration_distribution(
  p_from timestamptz, p_to timestamptz, p_view text default 'team', p_team_name text default null
)
returns table (auditor_id uuid, auditor_name text, slab text, slab_order int, calls_done int)
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
  with auditors as (
    select u.id, u.name from users u where u.role = 'qa_auditor' and u.is_active
      and (v_role <> 'qa_auditor' or p_view = 'team' or u.id = v_me)
  ),
  slabs(slab, slab_order, min_sec, max_sec) as (
    values
      ('Less than 1 minute', 1, 0::numeric, 60::numeric),
      ('1–3 minutes', 2, 60::numeric, 180::numeric),
      ('3–5 minutes', 3, 180::numeric, 300::numeric),
      ('5–8 minutes', 4, 300::numeric, 480::numeric),
      ('8–12 minutes', 5, 480::numeric, 720::numeric),
      ('12–20 minutes', 6, 720::numeric, 1200::numeric),
      ('More than 20 minutes', 7, 1200::numeric, null::numeric)
  ),
  grid as (
    select au.id as auditor_id, au.name as auditor_name, s.slab, s.slab_order
      from auditors au cross join slabs s
  ),
  durations as (
    select a.auditor_id, extract(epoch from (a.call_ended_at - a.call_started_at)) as secs
      from audits a
     where a.status = 'submitted' and a.audit_type = 'call' and a.check_mode = 'audit'
       and a.submitted_at >= p_from and a.submitted_at < p_to
       and a.call_started_at is not null and a.call_ended_at is not null
       and (p_team_name is null or exists (select 1 from users ag where ag.id = a.agent_id and ag.team_name = p_team_name))
  ),
  bucketed as (
    select d.auditor_id, s.slab, count(*)::int as n
      from durations d
      join slabs s on d.secs >= s.min_sec and (s.max_sec is null or d.secs < s.max_sec)
     group by d.auditor_id, s.slab
  )
  select g.auditor_id, g.auditor_name, g.slab, g.slab_order, coalesce(b.n, 0)
    from grid g
    left join bucketed b on b.auditor_id = g.auditor_id and b.slab = g.slab
   order by g.auditor_name, g.slab_order;
end;
$$;
