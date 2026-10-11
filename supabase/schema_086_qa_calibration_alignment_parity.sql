-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 086 — QA Manager dashboard's calibration reports pick up the new
-- alignment outcome (schema_085), 2026-10-13.
--
-- qa_calibration_session_overview() gains aligned_score_percent (null until
-- the organizer records one) — the return shape changes, so it is DROPPED
-- before being redefined (§14).
--
-- qa_calibration_consistency() keeps its exact signature — only the body
-- changes: a session's baseline is now its ALIGNED score when one has been
-- recorded, falling back to the plain group mean otherwise (exactly what
-- was proposed: "difference from post-alignment score" once it exists,
-- degrading gracefully to the old behaviour for any session nobody aligned).
-- Apply after schema_085.
-- ============================================================

drop function if exists qa_calibration_session_overview(timestamptz, timestamptz, text);
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
  score_range numeric,
  aligned_score_percent numeric
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
    case when s.status = 'closed' then (select round(max(sc.score_percent) - min(sc.score_percent), 1) from calibration_scores sc where sc.session_id = s.id) end,
    (select ca.aligned_score_percent from calibration_alignment ca where ca.session_id = s.id)
    from calibration_sessions s
   where s.scheduled_at >= p_from and s.scheduled_at < p_to
     and (v_role <> 'qa_auditor' or p_view = 'team' or s.id in (select calibration_my_session_ids()))
   order by s.scheduled_at desc;
end;
$$;
revoke all on function qa_calibration_session_overview(timestamptz, timestamptz, text) from public;
grant execute on function qa_calibration_session_overview(timestamptz, timestamptz, text) to authenticated;

-- ── Calibration consistency: baseline is the aligned score when recorded, else the group mean ──
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
    select sc.session_id, coalesce(ca.aligned_score_percent, avg(sc.score_percent)) as baseline
      from calibration_scores sc
      join sessions s on s.id = sc.session_id
      left join calibration_alignment ca on ca.session_id = sc.session_id
     group by sc.session_id, ca.aligned_score_percent
    having count(*) >= 2
  ),
  deviations as (
    select sc.user_id, sc.score_percent - ss.baseline as dev
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
