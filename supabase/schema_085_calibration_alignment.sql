-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 085 — Calibration alignment (post-calibration consensus), 2026-10-13.
-- Test in the Supabase SQL Editor before relying on it. Apply after schema_084.
--
-- Jamil's own description of the gap, confirmed as standard practice and
-- scoped to a small addition on top of the existing flow (§5 Stage 3/4):
-- today, everyone scores blind, the session is closed, and the variance
-- report shows WHERE the group disagreed — but nothing records what the
-- group actually decided once they talk it through. This adds exactly
-- that one step, as a small layer on a CLOSED session — no change to
-- independent scoring, no new session status.
--
-- Only the organizer (created_by) or a QA Manager/Super Admin can record
-- it (same authority close_calibration_session already has). They only
-- have to decide the parameters/fatals the group actually SPLIT ON —
-- anything everyone already agreed on is carried over automatically, so
-- the input stays small no matter how big the rubric is. The result is
-- one aligned score, computed with the exact same binary rule every other
-- scorecard in this system uses (full points on Pass, zero on a critical
-- fatal) — no new scoring logic.
--
-- Editable, unlike a real scorecard: calling record_calibration_alignment()
-- again fully replaces the previous outcome. This is a team's own working
-- record of a discussion, not a compliance-grade score — lower stakes than
-- an audit, so no "final and locked" rule here.
-- ============================================================

create table calibration_alignment (
  session_id uuid primary key references calibration_sessions(id),
  aligned_score_percent numeric not null check (aligned_score_percent between 0 and 100),
  aligned_critical_fail boolean not null default false,
  aligned_by uuid not null references users(id),
  aligned_at timestamptz not null default now()
);

-- The FULL final verdict per parameter (explicit decision where the group split, else the
-- unanimous value) — a self-contained record, same shape as audit_parameter_results, not a diff.
create table calibration_alignment_params (
  session_id uuid not null references calibration_sessions(id),
  parameter_id uuid not null references rubric_parameters(id),
  passed boolean not null,
  primary key (session_id, parameter_id)
);

-- Only the fatals in the FINAL aligned outcome (ticked) — same "only what applies" shape as
-- calibration_score_fatals / audit_fatal_results.
create table calibration_alignment_fatals (
  session_id uuid not null references calibration_sessions(id),
  fatal_parameter_id uuid not null references fatal_parameters(id),
  primary key (session_id, fatal_parameter_id)
);

-- Locked down: RLS on, NO policies — reads and writes only through the functions below.
alter table calibration_alignment enable row level security;
alter table calibration_alignment_params enable row level security;
alter table calibration_alignment_fatals enable row level security;
revoke all on calibration_alignment, calibration_alignment_params, calibration_alignment_fatals from anon, authenticated;

-- ── Record (or replace) the alignment outcome ────────────────
-- p_param_decisions = [{"parameter_id": uuid, "passed": bool}, …] — ONLY the parameters the group
-- split on; everything the group already agreed on is filled in automatically.
-- p_fatal_decisions = [uuid, …] — fatal errors the group confirmed DID apply, for whichever ones
-- were split; a split fatal left out defaults to "did not apply" in the aligned outcome.
create or replace function record_calibration_alignment(p_session_id uuid, p_param_decisions jsonb, p_fatal_decisions uuid[])
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := current_app_user_id();
  v_role text := current_app_role();
  s calibration_sessions%rowtype;
  v_total numeric;
  v_earned numeric;
  v_critical boolean;
  v_score numeric;
  v_fatal_decisions uuid[] := coalesce(p_fatal_decisions, '{}'::uuid[]);
  v_missing text;
begin
  if v_me is null then raise exception 'You are not signed in.'; end if;
  select * into s from calibration_sessions where id = p_session_id for update;
  if not found then raise exception 'That calibration session does not exist.'; end if;
  if v_role not in ('super_admin', 'qa_manager') and s.created_by is distinct from v_me then
    raise exception 'Only the person who scheduled this session, or a QA Manager / Super Admin, can record the alignment outcome.';
  end if;
  if s.status <> 'closed' then raise exception 'Alignment can only be recorded once the session is closed.'; end if;
  if (select count(*) from calibration_scores where session_id = p_session_id) < 2 then
    raise exception 'At least two submitted scores are needed before an alignment outcome can be recorded.';
  end if;

  create temp table _align_marks on commit drop as
    select (m ->> 'parameter_id')::uuid as parameter_id, (m ->> 'passed')::boolean as passed
      from jsonb_array_elements(coalesce(p_param_decisions, '[]'::jsonb)) m;
  if exists (select 1 from _align_marks where parameter_id is null or passed is null) then
    raise exception 'Every decision needs a parameter and a Pass/Fail choice.';
  end if;
  if exists (
    select 1 from _align_marks am where not exists (
      select 1 from rubric_parameters rp join rubric_categories rc on rc.id = rp.category_id
       where rp.id = am.parameter_id and rc.rubric_id = s.rubric_id)
  ) then
    raise exception 'A decision does not match this session''s rubric.';
  end if;
  if exists (select 1 from unnest(v_fatal_decisions) x where not exists (select 1 from fatal_parameters f where f.id = x and f.rubric_id = s.rubric_id)) then
    raise exception 'A fatal decision does not match this session''s rubric.';
  end if;

  -- The final verdict per parameter: an explicit decision, else the group's unanimous value, else
  -- NULL — still split and nobody decided it. Refused below, naming the one parameter so it's
  -- directly actionable rather than a generic "incomplete" error.
  create temp table _final_params on commit drop as
    select rp.id as parameter_id, rp.points,
           coalesce(
             (select am.passed from _align_marks am where am.parameter_id = rp.id),
             case when (select count(distinct csp.passed) from calibration_score_params csp
                          join calibration_scores cs on cs.id = csp.score_id
                         where cs.session_id = p_session_id and csp.parameter_id = rp.id) = 1
                  then (select bool_and(csp.passed) from calibration_score_params csp
                          join calibration_scores cs on cs.id = csp.score_id
                         where cs.session_id = p_session_id and csp.parameter_id = rp.id)
             end
           ) as passed
      from rubric_parameters rp join rubric_categories rc on rc.id = rp.category_id
     where rc.rubric_id = s.rubric_id;

  select rp.name into v_missing
    from rubric_parameters rp join _final_params fp on fp.parameter_id = rp.id
   where fp.passed is null limit 1;
  if v_missing is not null then
    raise exception 'The group split on "%" — decide it before saving.', v_missing;
  end if;

  select coalesce(sum(points), 0) into v_total from _final_params;
  select coalesce(sum(points) filter (where passed), 0) into v_earned from _final_params;
  if v_total <= 0 then raise exception 'This rubric has no scoring parameters.'; end if;

  -- The final fatal outcome: unanimously-ticked fatals, plus whichever split ones were confirmed.
  create temp table _final_fatals on commit drop as
    select f.id as fatal_parameter_id, f.severity,
           (f.id = any (v_fatal_decisions)) or (
             exists (select 1 from calibration_scores cs where cs.session_id = p_session_id)
             and not exists (
               select 1 from calibration_scores cs
                where cs.session_id = p_session_id
                  and not exists (select 1 from calibration_score_fatals csf where csf.score_id = cs.id and csf.fatal_parameter_id = f.id)
             )
           ) as ticked
      from fatal_parameters f
     where f.rubric_id = s.rubric_id;

  select exists (select 1 from _final_fatals where ticked and severity = 'critical') into v_critical;
  v_score := case when v_critical then 0 else round(v_earned / v_total * 100, 2) end;

  insert into calibration_alignment (session_id, aligned_score_percent, aligned_critical_fail, aligned_by, aligned_at)
  values (p_session_id, v_score, v_critical, v_me, now())
  on conflict (session_id) do update
    set aligned_score_percent = excluded.aligned_score_percent,
        aligned_critical_fail = excluded.aligned_critical_fail,
        aligned_by = excluded.aligned_by,
        aligned_at = excluded.aligned_at;

  delete from calibration_alignment_params where session_id = p_session_id;
  insert into calibration_alignment_params (session_id, parameter_id, passed)
  select p_session_id, parameter_id, passed from _final_params;

  delete from calibration_alignment_fatals where session_id = p_session_id;
  insert into calibration_alignment_fatals (session_id, fatal_parameter_id)
  select p_session_id, fatal_parameter_id from _final_fatals where ticked;

  drop table _align_marks;
  drop table _final_params;
  drop table _final_fatals;
  return v_score;
end;
$$;
revoke all on function record_calibration_alignment(uuid, jsonb, uuid[]) from public;
grant execute on function record_calibration_alignment(uuid, jsonb, uuid[]) to authenticated;

-- ── Read: same visibility as calibration_results() (a participant, or QA Manager/Super Admin) ──
create or replace function calibration_alignment(p_session_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_me uuid := current_app_user_id();
  v_role text := current_app_role();
  v_participant boolean;
  v_admin boolean := (v_role in ('super_admin', 'qa_manager'));
  a calibration_alignment%rowtype;
  v_by_name text;
begin
  if not exists (select 1 from calibration_sessions where id = p_session_id) then return null; end if;
  select exists (select 1 from calibration_participants where session_id = p_session_id and user_id = v_me) into v_participant;
  if not v_participant and not v_admin then return null; end if;

  select * into a from calibration_alignment where session_id = p_session_id;
  if not found then
    return jsonb_build_object('recorded', false);
  end if;
  select name into v_by_name from users where id = a.aligned_by;

  return jsonb_build_object(
    'recorded', true,
    'aligned_score_percent', a.aligned_score_percent,
    'aligned_critical_fail', a.aligned_critical_fail,
    'aligned_by_name', v_by_name,
    'aligned_at', a.aligned_at,
    'params', (select coalesce(jsonb_agg(jsonb_build_object('parameter_id', p.parameter_id, 'passed', p.passed)), '[]'::jsonb)
                 from calibration_alignment_params p where p.session_id = p_session_id),
    'fatals', (select coalesce(jsonb_agg(f.fatal_parameter_id), '[]'::jsonb)
                 from calibration_alignment_fatals f where f.session_id = p_session_id)
  );
end;
$$;
revoke all on function calibration_alignment(uuid) from public;
grant execute on function calibration_alignment(uuid) to authenticated;
