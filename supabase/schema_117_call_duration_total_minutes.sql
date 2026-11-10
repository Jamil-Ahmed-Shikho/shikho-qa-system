-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 117 — Total Audited Minutes per auditor on the Call Duration report (Jamil, 2026-11-10):
-- "QA wise Total Audited Minute... summation of all call duration one qa has audited this/last sales
-- week or last 30 days." Apply after 116.
--
-- Adds one new OUT column (total_minutes) to qa_call_duration_distribution() — a genuine signature
-- change, so the old function is dropped first (§14). The value is the same for every slab row of a
-- given auditor (computed once per auditor from the identical `durations` CTE the slab buckets
-- already use, so it can never disagree with the matrix's own row total), picked off any one row by
-- the client rather than summed from the slab rows (summing would double-count nothing here, but
-- reading it directly off the per-auditor total avoids relying on that).
-- ============================================================

drop function if exists qa_call_duration_distribution(timestamptz, timestamptz, text, text);

create or replace function qa_call_duration_distribution(
  p_from timestamptz, p_to timestamptz, p_view text default 'team', p_team_name text default null
)
returns table (auditor_id uuid, auditor_name text, slab text, slab_order int, calls_done int, total_minutes numeric)
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
  ),
  auditor_totals as (
    select d.auditor_id, round(sum(d.secs) / 60.0, 1) as total_minutes
      from durations d
     group by d.auditor_id
  )
  select g.auditor_id, g.auditor_name, g.slab, g.slab_order, coalesce(b.n, 0), coalesce(t.total_minutes, 0)
    from grid g
    left join bucketed b on b.auditor_id = g.auditor_id and b.slab = g.slab
    left join auditor_totals t on t.auditor_id = g.auditor_id
   order by g.auditor_name, g.slab_order;
end;
$$;
