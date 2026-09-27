-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 032 — Calibration sessions, Stage 3: independent scoring (§5)
-- Test this in the Supabase SQL Editor before relying on it. Apply after 031.
--
-- Each participant scores the session's call against the session's rubric, on their own.
-- SCORING WINDOW (confirmed by Jamil 2026-09-26):
--   * scoring opens the moment someone is invited (the recording is available ahead of time);
--   * a submitted score is FINAL — no edit, no delete;
--   * others' scores stay hidden until the viewer has submitted their own AND the session time has passed,
--     OR the scheduler / an admin has CLOSED the session (which reveals to every participant);
--   * nobody can score once the session is closed or cancelled.
-- The scorecard is the same binary rule as an audit (§3): a parameter earns its full points on Pass, 0 on Fail;
-- any ticked Critical fatal zeroes the score. (No error attributes / root causes — calibration compares
-- outcomes, it does not coach.) The DATABASE computes the score from the marks.
-- No app role can read or write the score tables directly: only the functions below (security definer).
-- NO email is sent by anything here (Stage 4).
-- ============================================================

create table calibration_scores (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references calibration_sessions(id),
  user_id uuid not null references users(id),
  score_percent numeric not null check (score_percent between 0 and 100),
  critical_fail boolean not null default false,
  notes text check (notes is null or (length(btrim(notes)) > 0 and length(notes) <= 2000)),
  submitted_at timestamptz not null default now(),
  unique (session_id, user_id)
);

create table calibration_score_params (
  score_id uuid not null references calibration_scores(id),
  parameter_id uuid not null references rubric_parameters(id),
  passed boolean not null,
  points_awarded numeric not null,
  primary key (score_id, parameter_id)
);

create table calibration_score_fatals (
  score_id uuid not null references calibration_scores(id),
  fatal_parameter_id uuid not null references fatal_parameters(id),
  severity text not null,
  primary key (score_id, fatal_parameter_id)
);

-- Locked down: RLS on, NO policies — reads and writes only through the security-definer functions.
alter table calibration_scores enable row level security;
alter table calibration_score_params enable row level security;
alter table calibration_score_fatals enable row level security;
revoke all on calibration_scores, calibration_score_params, calibration_score_fatals from anon, authenticated;

-- A participant who has already scored can't be removed from the session (their score would be orphaned).
create or replace function calibration_participant_keep_scored()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from calibration_scores where session_id = old.session_id and user_id = old.user_id) then
    raise exception 'Someone who has already submitted a score cannot be removed from the session.';
  end if;
  return old;
end;
$$;
create trigger trg_calibration_participant_keep_scored before delete on calibration_participants
  for each row execute function calibration_participant_keep_scored();

-- ── Submit ──────────────────────────────────────────────────
-- p_marks  = [{"parameter_id": uuid, "passed": bool}, …] — EVERY parameter of the rubric, exactly once
-- p_fatals = [uuid, …] — the fatal errors observed (may be empty)
create or replace function submit_calibration_score(p_session_id uuid, p_marks jsonb, p_fatals uuid[], p_notes text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := current_app_user_id();
  s calibration_sessions%rowtype;
  v_total numeric;
  v_earned numeric;
  v_expected int;
  v_given int;
  v_distinct int;
  v_critical boolean;
  v_score numeric;
  v_id uuid;
  v_fatals uuid[] := coalesce(p_fatals, '{}'::uuid[]);
begin
  if v_me is null then raise exception 'You are not signed in.'; end if;
  select * into s from calibration_sessions where id = p_session_id for update;
  if not found then raise exception 'That calibration session does not exist.'; end if;
  if not exists (select 1 from calibration_participants where session_id = p_session_id and user_id = v_me) then
    raise exception 'You were not invited to this calibration session.';
  end if;
  if s.status <> 'scheduled' then raise exception 'Scoring is closed for this session (it is %).', s.status; end if;
  if exists (select 1 from calibration_scores where session_id = p_session_id and user_id = v_me) then
    raise exception 'You have already submitted your score — it is final.';
  end if;
  if jsonb_typeof(p_marks) is distinct from 'array' then raise exception 'Score every parameter first.'; end if;

  select count(*), coalesce(sum(rp.points), 0) into v_expected, v_total
    from rubric_parameters rp join rubric_categories rc on rc.id = rp.category_id where rc.rubric_id = s.rubric_id;
  if v_expected = 0 or v_total <= 0 then raise exception 'This rubric has no scoring parameters.'; end if;

  create temp table _cal_marks on commit drop as
    select (m ->> 'parameter_id')::uuid as parameter_id, (m ->> 'passed')::boolean as passed
      from jsonb_array_elements(p_marks) m;
  if exists (select 1 from _cal_marks where passed is null or parameter_id is null) then
    raise exception 'Score every parameter first.';
  end if;
  select count(*), count(distinct parameter_id) into v_given, v_distinct from _cal_marks;
  if v_given <> v_distinct or v_given <> v_expected then raise exception 'Score every parameter first.'; end if;
  if exists (
    select 1 from _cal_marks cm where not exists (
      select 1 from rubric_parameters rp join rubric_categories rc on rc.id = rp.category_id
       where rp.id = cm.parameter_id and rc.rubric_id = s.rubric_id)
  ) then
    raise exception 'The marks do not match this session''s rubric.';
  end if;
  if (select count(distinct x) from unnest(v_fatals) x) <> coalesce(array_length(v_fatals, 1), 0) then
    raise exception 'A fatal error was ticked twice.';
  end if;
  if exists (select 1 from unnest(v_fatals) x where not exists (select 1 from fatal_parameters f where f.id = x and f.rubric_id = s.rubric_id)) then
    raise exception 'A fatal error does not belong to this session''s rubric.';
  end if;

  select coalesce(sum(rp.points), 0) into v_earned
    from _cal_marks cm join rubric_parameters rp on rp.id = cm.parameter_id where cm.passed;
  select exists (select 1 from fatal_parameters f where f.id = any (v_fatals) and f.severity = 'critical') into v_critical;
  v_score := case when v_critical then 0 else round(v_earned / v_total * 100, 2) end;

  insert into calibration_scores (session_id, user_id, score_percent, critical_fail, notes)
  values (p_session_id, v_me, v_score, v_critical, nullif(btrim(coalesce(p_notes, '')), ''))
  returning id into v_id;

  insert into calibration_score_params (score_id, parameter_id, passed, points_awarded)
  select v_id, cm.parameter_id, cm.passed, case when cm.passed then rp.points else 0 end
    from _cal_marks cm join rubric_parameters rp on rp.id = cm.parameter_id;
  insert into calibration_score_fatals (score_id, fatal_parameter_id, severity)
  select v_id, f.id, f.severity from fatal_parameters f where f.id = any (v_fatals);

  drop table _cal_marks;
  return v_score;
end;
$$;
revoke all on function submit_calibration_score(uuid, jsonb, uuid[], text) from public;
grant execute on function submit_calibration_score(uuid, jsonb, uuid[], text) to authenticated;

-- ── Close (reveals every score to every participant) ────────
create or replace function close_calibration_session(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := current_app_user_id();
  v_role text := current_app_role();
  s calibration_sessions%rowtype;
begin
  select * into s from calibration_sessions where id = p_id for update;
  if not found then raise exception 'That calibration session does not exist.'; end if;
  if v_role not in ('super_admin', 'qa_manager') and s.created_by is distinct from v_me then
    raise exception 'Only the person who scheduled this session, or a QA Manager / Super Admin, can close it.';
  end if;
  if s.status <> 'scheduled' then raise exception 'Only a scheduled session can be closed (this one is %).', s.status; end if;
  if (select count(*) from calibration_scores where session_id = p_id) < 2 then
    raise exception 'At least two participants must have submitted a score before the session can be closed.';
  end if;
  update calibration_sessions set status = 'closed' where id = p_id;
end;
$$;
revoke all on function close_calibration_session(uuid) from public;
grant execute on function close_calibration_session(uuid) to authenticated;

-- ── Read: my state + the scores I am allowed to see ─────────
-- Returns null when the caller may not see the session at all (not a participant, not QA Manager / Super Admin).
create or replace function calibration_results(p_session_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_me uuid := current_app_user_id();
  v_role text := current_app_role();
  s calibration_sessions%rowtype;
  v_participant boolean;
  v_admin boolean := (v_role in ('super_admin', 'qa_manager'));
  v_mine boolean;
  v_revealed boolean;
  v_scores jsonb;
begin
  select * into s from calibration_sessions where id = p_session_id;
  if not found then return null; end if;
  select exists (select 1 from calibration_participants where session_id = p_session_id and user_id = v_me) into v_participant;
  if not v_participant and not v_admin then return null; end if;
  select exists (select 1 from calibration_scores where session_id = p_session_id and user_id = v_me) into v_mine;

  v_revealed := s.status = 'closed'
    or (s.status = 'scheduled' and now() >= s.scheduled_at and (v_mine or not v_participant));

  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', c.user_id,
      'name', u.name,
      'role', u.role,
      'score_percent', c.score_percent,
      'critical_fail', c.critical_fail,
      'notes', c.notes,
      'submitted_at', c.submitted_at,
      'params', (select coalesce(jsonb_agg(jsonb_build_object('parameter_id', p.parameter_id, 'passed', p.passed)), '[]'::jsonb)
                   from calibration_score_params p where p.score_id = c.id),
      'fatals', (select coalesce(jsonb_agg(f.fatal_parameter_id), '[]'::jsonb)
                   from calibration_score_fatals f where f.score_id = c.id)
    ) order by u.name), '[]'::jsonb)
    into v_scores
    from calibration_scores c join users u on u.id = c.user_id
   where c.session_id = p_session_id and (v_revealed or c.user_id = v_me);

  return jsonb_build_object(
    'is_participant', v_participant,
    'my_submitted', v_mine,
    'can_score', v_participant and not v_mine and s.status = 'scheduled',
    'revealed', v_revealed,
    'submitted_count', (select count(*) from calibration_scores where session_id = p_session_id),
    'participant_count', (select count(*) from calibration_participants where session_id = p_session_id),
    'scores', v_scores
  );
end;
$$;
revoke all on function calibration_results(uuid) from public;
grant execute on function calibration_results(uuid) to authenticated;
