-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 056 — QA Manager dashboard, Stage 5: Review Request oversight and
-- calibration consistency.
-- Apply after schema_055. Test against the live database before relying on it.
--
-- Jamil, 2026-09-30, scoped via two short AskUserQuestion picks:
--   - Review Request oversight = status counts + an aging list of what's
--     still open (surfaces what's stuck), PLUS a breakdown of outcomes per
--     Team Lead and per (original) auditor — not just the base list.
--   - Calibration consistency = BOTH per-auditor deviation from the group
--     mean (true calibration quality — who consistently scores high/low
--     vs. the team) AND a session participation/agreement overview (is
--     calibration happening at all, and how much did each session's group
--     agree).
--
-- All five functions follow the standing Stage 3+ shape: SECURITY DEFINER,
-- super_admin/qa_manager/qa_auditor, p_view ('mine'/'team').
--
-- A DELIBERATE scoping choice, not guessed: the "per auditor" Review Request
-- breakdown is keyed on the ORIGINAL audit's auditor (audits.auditor_id via
-- review_requests.audit_id), not on who was assigned to conduct the
-- re-audit — this measures "how often THIS auditor's own original scoring
-- gets revised on review," which is the actual QA-quality signal a manager
-- would want, versus "how many re-audits did this auditor do" (already
-- visible in Stage 1's Audit %). The Team Lead breakdown reads
-- review_requests.team_lead_decided_by directly (their own uphold/escalate
-- decisions) — there is no similar ambiguity there.
--
-- BOTH calibration functions only ever look at CLOSED sessions' actual
-- scores — never a still-open or cancelled session's scores — because
-- schema_032's own reveal rule restricts EVEN a QA Manager/Super Admin who
-- isn't a participant from seeing individual scores before a session closes
-- or its time passes; aggregating only closed sessions sidesteps ever
-- needing to reproduce that per-viewer reveal logic in a cross-cutting
-- report. Participant/submission COUNTS (not the score values themselves)
-- are shown for every session regardless of status, since a count doesn't
-- reveal what anyone actually scored.
-- ============================================================

-- ── Review Requests still open, oldest first — "what's stuck" ──
create or replace function qa_review_request_status_summary(p_view text default 'team')
returns table (
  request_id uuid,
  audit_id uuid,
  agent_id uuid,
  agent_name text,
  team_name text,
  site_name text,
  filer_role text,
  status text,
  held_by_name text,
  days_open int,
  created_at timestamptz
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
  if v_role not in ('super_admin', 'qa_manager', 'qa_auditor') then
    return;
  end if;
  if p_view not in ('mine', 'team') then
    raise exception 'Choose My view or Team view.';
  end if;

  return query
  select
    r.id, r.audit_id, u.id, u.name, u.team_name, u.site_name, r.filer_role, r.status,
    case when r.status = 'with_team_lead' then tl.name
         when r.status = 'with_qa_manager' then coalesce(asg.name, 'Unassigned')
         else null end,
    (extract(epoch from (now() - r.created_at)) / 86400)::int,
    r.created_at
    from review_requests r
    join users u on u.id = r.agent_id
    left join users tl on tl.id = u.team_leader_id
    left join users asg on asg.id = r.assigned_to
   where r.status <> 'resolved'
     and (v_role <> 'qa_auditor' or p_view = 'team' or u.quality_auditor_id = v_me)
   order by r.created_at asc;
end;
$$;
revoke all on function qa_review_request_status_summary(text) from public;
grant execute on function qa_review_request_status_summary(text) to authenticated;

-- ── Team Lead outcomes: their own uphold/escalate decisions in the period ──
create or replace function qa_review_request_team_lead_outcomes(p_from timestamptz, p_to timestamptz, p_view text default 'team')
returns table (
  team_lead_id uuid,
  team_lead_name text,
  decided_count int,
  upheld_count int,
  escalated_count int,
  upheld_pct numeric
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
  select
    tl.id, tl.name,
    count(*)::int as decided_count,
    count(*) filter (where r.team_lead_decision = 'upheld')::int as upheld_count,
    count(*) filter (where r.team_lead_decision = 'escalated')::int as escalated_count,
    round(count(*) filter (where r.team_lead_decision = 'upheld')::numeric / count(*) * 100, 1) as upheld_pct
    from review_requests r
    join users u on u.id = r.agent_id
    join users tl on tl.id = r.team_lead_decided_by
   where r.team_lead_decision is not null
     and r.team_lead_decided_at >= p_from and r.team_lead_decided_at < p_to
     and (v_role <> 'qa_auditor' or p_view = 'team' or u.quality_auditor_id = v_me)
   group by tl.id, tl.name
   order by decided_count desc, tl.name;
end;
$$;
revoke all on function qa_review_request_team_lead_outcomes(timestamptz, timestamptz, text) from public;
grant execute on function qa_review_request_team_lead_outcomes(timestamptz, timestamptz, text) to authenticated;

-- ── Auditor outcomes: how often THIS auditor's own original audits get revised on review ──
create or replace function qa_review_request_auditor_outcomes(p_from timestamptz, p_to timestamptz, p_view text default 'team')
returns table (
  auditor_id uuid,
  auditor_name text,
  filed_count int,
  resolved_count int,
  revised_count int,
  no_change_count int,
  revision_pct numeric
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
  select
    au.id, au.name,
    count(*)::int as filed_count,
    count(*) filter (where r.status = 'resolved')::int as resolved_count,
    count(*) filter (where r.final_outcome = 'revised')::int as revised_count,
    count(*) filter (where r.final_outcome = 'no_change')::int as no_change_count,
    case when count(*) filter (where r.final_outcome is not null) > 0
      then round(count(*) filter (where r.final_outcome = 'revised')::numeric / count(*) filter (where r.final_outcome is not null) * 100, 1)
      else null end as revision_pct
    from review_requests r
    join audits a on a.id = r.audit_id
    join users au on au.id = a.auditor_id
   where r.created_at >= p_from and r.created_at < p_to
     and (v_role <> 'qa_auditor' or p_view = 'team' or au.id = v_me)
   group by au.id, au.name
   order by revision_pct desc nulls last, filed_count desc;
end;
$$;
revoke all on function qa_review_request_auditor_outcomes(timestamptz, timestamptz, text) from public;
grant execute on function qa_review_request_auditor_outcomes(timestamptz, timestamptz, text) to authenticated;

-- ── Calibration: session participation & agreement overview ──
-- Participant/submission COUNTS are shown for every session; mean/stddev/range are shown only once a
-- session is CLOSED (never for a still-open or cancelled one — see the note above).
create or replace function qa_calibration_session_overview(p_from timestamptz, p_to timestamptz, p_view text default 'team')
returns table (
  session_id uuid,
  title text,
  team_name text,
  site_name text,
  scheduled_at timestamptz,
  status text,
  participants_count int,
  scores_submitted_count int,
  group_mean_score numeric,
  group_stddev numeric,
  score_range numeric
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_role text := current_app_role();
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
  select
    s.id, coalesce(s.title, 'Calibration session'), s.team_name, s.site_name, s.scheduled_at, s.status,
    (select count(*)::int from calibration_participants p where p.session_id = s.id),
    (select count(*)::int from calibration_scores sc where sc.session_id = s.id),
    case when s.status = 'closed' then (select round(avg(sc.score_percent), 1) from calibration_scores sc where sc.session_id = s.id) end,
    case when s.status = 'closed' then (select round(stddev_pop(sc.score_percent), 1) from calibration_scores sc where sc.session_id = s.id) end,
    case when s.status = 'closed' then (select round(max(sc.score_percent) - min(sc.score_percent), 1) from calibration_scores sc where sc.session_id = s.id) end
    from calibration_sessions s
   where s.scheduled_at >= p_from and s.scheduled_at < p_to
     and (v_role <> 'qa_auditor' or p_view = 'team' or s.id in (select calibration_my_session_ids()))
   order by s.scheduled_at desc;
end;
$$;
revoke all on function qa_calibration_session_overview(timestamptz, timestamptz, text) from public;
grant execute on function qa_calibration_session_overview(timestamptz, timestamptz, text) to authenticated;

-- ── Calibration: per-person deviation from the group mean, across closed sessions in the period ──
-- Lower average absolute deviation = more consistently aligned with the group (better calibrated).
-- Average SIGNED deviation shows a directional bias (consistently scoring high or low vs. the team).
create or replace function qa_calibration_consistency(p_from timestamptz, p_to timestamptz, p_view text default 'team')
returns table (
  user_id uuid,
  user_name text,
  user_role text,
  sessions_scored int,
  avg_abs_deviation numeric,
  avg_signed_deviation numeric
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
  with sessions as (
    select s.id from calibration_sessions s
     where s.status = 'closed' and s.scheduled_at >= p_from and s.scheduled_at < p_to
  ),
  session_stats as (
    select sc.session_id, avg(sc.score_percent) as mean_score
      from calibration_scores sc
      join sessions s on s.id = sc.session_id
     group by sc.session_id
    having count(*) >= 2
  ),
  deviations as (
    select sc.user_id, sc.score_percent - ss.mean_score as dev
      from calibration_scores sc
      join session_stats ss on ss.session_id = sc.session_id
  )
  select
    u.id, u.name, u.role,
    count(*)::int as sessions_scored,
    round(avg(abs(d.dev)), 2) as avg_abs_deviation,
    round(avg(d.dev), 2) as avg_signed_deviation
    from deviations d
    join users u on u.id = d.user_id
   where (v_role <> 'qa_auditor' or p_view = 'team' or u.id = v_me)
   group by u.id, u.name, u.role
   order by avg_abs_deviation asc nulls last, u.name;
end;
$$;
revoke all on function qa_calibration_consistency(timestamptz, timestamptz, text) from public;
grant execute on function qa_calibration_consistency(timestamptz, timestamptz, text) to authenticated;
