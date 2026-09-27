-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 031 — Calibration sessions, Stage 1: scheduling (§5)
-- Test this in the Supabase SQL Editor before relying on it.
-- Requires schema_003 (rubrics), 007/008 (scoping helpers), 001 (touch_updated_at). Apply after 030.
--
-- A calibration session is a SCHEDULED team meeting (a real date/time), not an ad-hoc scoring
-- tool: someone picks a call (or chat / complaint), a rubric, the team/channel AND site it is for,
-- a date/time and specific invited participants; each participant later scores the call on their
-- own, and the group's variance is reported (Stages 3-4, later migrations). THIS migration is
-- scheduling only. NO email or notification is sent by anything here.
--
-- WHO SCHEDULES: QA Auditors, QA Managers and Super Admins — all three.
--
-- TWO KINDS (same scope + date/time; only who may be invited differs):
--   'team'     QA staff + specific Team Leads of the EXACT team/channel/site of the session
--   'qa_only'  QA staff only — a QA Auditor sharing a call with QA teammates, no Team Leads
--
-- PARTICIPANTS (the scheduler picks specific people — never "everyone"):
--   * the scheduler is ALWAYS a participant and scores like the others;
--   * at least one QA Auditor must be among them (the scheduler counts if they are one);
--   * at least two people in all (calibration is a group exercise);
--   * a Team Lead may be invited ONLY to a 'team' session and ONLY if their own team_name AND
--     site_name equal the session's team/site exactly (a Dhaka Telesales session can never include a
--     Jashore or CX Team Lead; a Team Lead with no site can't be invited to any);
--   * agents and Managers are never participants.
--
-- VISIBILITY (strict): QA Manager / Super Admin see every session; anyone else sees ONLY the
-- sessions they are a participant of (a QA Auditor: the ones they scheduled or are invited to;
-- a Team Lead: only the ones they were invited to — never a general window into calibration).
-- No write policy for anyone: sessions change only through the functions below.
-- ============================================================

create table calibration_sessions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('team', 'qa_only')),
  title text check (title is null or (length(btrim(title)) > 0 and length(title) <= 100)),

  -- The item everyone scores. A call carries the same structured CRM fields an audit does (§4, §10);
  -- a chat / complaint is a reference (link or ID) only.
  item_type text not null default 'call' check (item_type in ('call', 'chat', 'complaint')),
  item_reference text,
  crm_lead_id text,
  crm_call_id text,
  call_started_at timestamptz,
  call_ended_at timestamptz,
  call_recording_url text,           -- a recording FILENAME (see §10), streamed through our proxy — never stored
  call_status text,
  call_destination text,

  rubric_id uuid not null references rubrics(id),

  -- The team/channel AND site the session was created for. Both are required: site matters, not just channel.
  team_name text not null check (length(btrim(team_name)) > 0),
  site_name text not null check (length(btrim(site_name)) > 0),

  scheduled_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'closed', 'cancelled')),
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint calibration_item_present check (
    (item_type = 'call' and crm_call_id is not null and length(btrim(crm_call_id)) > 0)
    or (item_type <> 'call' and item_reference is not null and length(btrim(item_reference)) > 0)
  )
);
create index idx_calibration_sessions_when on calibration_sessions (scheduled_at desc);
create index idx_calibration_sessions_creator on calibration_sessions (created_by);

create table calibration_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references calibration_sessions(id),
  user_id uuid not null references users(id),
  role_at_invite text not null,                       -- snapshot: what they were when invited
  is_scheduler boolean not null default false,
  invited_at timestamptz not null default now(),
  unique (session_id, user_id)
);
create index idx_calibration_participants_user on calibration_participants (user_id);

create trigger trg_calibration_sessions_touch before update on calibration_sessions
  for each row execute function touch_updated_at();

-- ── Row-level security ──────────────────────────────────────
alter table calibration_sessions enable row level security;
alter table calibration_participants enable row level security;

-- The sessions a person takes part in. SECURITY DEFINER so the two tables' policies never call each
-- other (a policy on X that reads a table whose policy reads X recurses forever — see §14).
create or replace function calibration_my_session_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select session_id from calibration_participants where user_id = current_app_user_id()
$$;
revoke all on function calibration_my_session_ids() from public;
grant execute on function calibration_my_session_ids() to authenticated;

create policy calibration_sessions_select_admin on calibration_sessions for select to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager'));
create policy calibration_sessions_select_participant on calibration_sessions for select to authenticated
  using (id in (select calibration_my_session_ids()));

create policy calibration_participants_select_admin on calibration_participants for select to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager'));
create policy calibration_participants_select_participant on calibration_participants for select to authenticated
  using (session_id in (select calibration_my_session_ids()));

-- ── The one rule for who may be invited (also mirrored in src/lib/calibration/validation.ts) ──
-- Returns null when the person may be invited, otherwise a plain-language reason.
create or replace function calibration_invite_problem(p_user_id uuid, p_kind text, p_team text, p_site text)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  u users%rowtype;
begin
  select * into u from users where id = p_user_id;
  if not found then return 'Someone invited does not exist.'; end if;
  if not u.is_active then return u.name || ' is not an active user.'; end if;
  if u.role in ('qa_auditor', 'qa_manager', 'super_admin') then return null; end if;
  if u.role = 'team_lead' then
    if p_kind <> 'team' then
      return u.name || ' is a Team Lead — a QA-only session can include QA staff only.';
    end if;
    if u.team_name is distinct from p_team or u.site_name is distinct from p_site then
      return u.name || ' is not a Team Lead of ' || p_team || ' · ' || p_site || ' — only that exact team and site can be invited.';
    end if;
    return null;
  end if;
  return u.name || ' cannot be a calibration participant (' || u.role || ').';
end;
$$;

-- Validate a full participant set (the scheduler is added by the caller). Raises on the first problem.
create or replace function calibration_check_participants(p_kind text, p_team text, p_site text, p_ids uuid[])
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  v_id uuid;
  v_problem text;
  v_auditors int;
begin
  if coalesce(array_length(p_ids, 1), 0) < 2 then
    raise exception 'A calibration session needs at least two participants (you and someone else).';
  end if;
  if array_length(p_ids, 1) > 30 then
    raise exception 'A calibration session can have at most 30 participants.';
  end if;
  foreach v_id in array p_ids loop
    v_problem := calibration_invite_problem(v_id, p_kind, p_team, p_site);
    if v_problem is not null then raise exception '%', v_problem; end if;
  end loop;
  select count(*) into v_auditors from users where id = any (p_ids) and role = 'qa_auditor';
  if v_auditors < 1 then
    raise exception 'At least one QA Auditor must take part.';
  end if;
end;
$$;

-- ── Create ──────────────────────────────────────────────────
create or replace function create_calibration_session(
  p_kind text, p_title text,
  p_item_type text, p_item_reference text,
  p_crm_lead_id text, p_crm_call_id text, p_call_started_at timestamptz, p_call_ended_at timestamptz,
  p_call_recording_url text, p_call_status text, p_call_destination text,
  p_rubric_id uuid, p_team_name text, p_site_name text,
  p_scheduled_at timestamptz, p_participant_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := current_app_user_id();
  v_role text := current_app_role();
  v_ids uuid[];
  v_id uuid;
  v_team text := btrim(coalesce(p_team_name, ''));
  v_site text := btrim(coalesce(p_site_name, ''));
begin
  if v_role not in ('qa_auditor', 'qa_manager', 'super_admin') then
    raise exception 'Only QA Auditors, QA Managers and Super Admins can schedule a calibration session.';
  end if;
  if p_kind not in ('team', 'qa_only') then raise exception 'Choose a kind of session.'; end if;
  if v_team = '' or v_site = '' then raise exception 'Choose the team/channel and the site this session is for.'; end if;
  if not exists (select 1 from rubrics where id = p_rubric_id and is_active) then
    raise exception 'Choose an active rubric.';
  end if;
  if p_scheduled_at is null then raise exception 'Choose a date and time.'; end if;
  if p_scheduled_at < now() - interval '5 minutes' then raise exception 'The date and time cannot be in the past.'; end if;

  -- the scheduler is always in; then the people they picked (de-duplicated)
  select array_agg(distinct x) into v_ids from unnest(array_append(coalesce(p_participant_ids, '{}'::uuid[]), v_me)) as x;
  perform calibration_check_participants(p_kind, v_team, v_site, v_ids);

  insert into calibration_sessions (
    kind, title, item_type, item_reference, crm_lead_id, crm_call_id, call_started_at, call_ended_at,
    call_recording_url, call_status, call_destination, rubric_id, team_name, site_name, scheduled_at, created_by
  ) values (
    p_kind, nullif(btrim(coalesce(p_title, '')), ''), p_item_type, nullif(btrim(coalesce(p_item_reference, '')), ''),
    nullif(btrim(coalesce(p_crm_lead_id, '')), ''), nullif(btrim(coalesce(p_crm_call_id, '')), ''), p_call_started_at, p_call_ended_at,
    nullif(btrim(coalesce(p_call_recording_url, '')), ''), p_call_status, p_call_destination, p_rubric_id, v_team, v_site, p_scheduled_at, v_me
  ) returning id into v_id;

  insert into calibration_participants (session_id, user_id, role_at_invite, is_scheduler)
  select v_id, u.id, u.role, (u.id = v_me) from users u where u.id = any (v_ids);

  return v_id;
end;
$$;
revoke all on function create_calibration_session(text, text, text, text, text, text, timestamptz, timestamptz, text, text, text, uuid, text, text, timestamptz, uuid[]) from public;
grant execute on function create_calibration_session(text, text, text, text, text, text, timestamptz, timestamptz, text, text, text, uuid, text, text, timestamptz, uuid[]) to authenticated;

-- ── Change the time / title / participants (the scheduler, or a QA Manager / Super Admin) ──
create or replace function update_calibration_session(p_id uuid, p_title text, p_scheduled_at timestamptz, p_participant_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := current_app_user_id();
  v_role text := current_app_role();
  s calibration_sessions%rowtype;
  v_ids uuid[];
begin
  select * into s from calibration_sessions where id = p_id for update;
  if not found then raise exception 'That calibration session does not exist.'; end if;
  if v_role not in ('super_admin', 'qa_manager') and s.created_by is distinct from v_me then
    raise exception 'Only the person who scheduled this session, or a QA Manager / Super Admin, can change it.';
  end if;
  if s.status <> 'scheduled' then raise exception 'Only a scheduled session can be changed (this one is %).', s.status; end if;
  if p_scheduled_at is null then raise exception 'Choose a date and time.'; end if;
  if p_scheduled_at is distinct from s.scheduled_at and p_scheduled_at < now() - interval '5 minutes' then
    raise exception 'The date and time cannot be in the past.';
  end if;

  -- the scheduler can never be removed from their own session
  select array_agg(distinct x) into v_ids from unnest(array_append(coalesce(p_participant_ids, '{}'::uuid[]), s.created_by)) as x;
  perform calibration_check_participants(s.kind, s.team_name, s.site_name, v_ids);

  update calibration_sessions
     set title = nullif(btrim(coalesce(p_title, '')), ''), scheduled_at = p_scheduled_at
   where id = p_id;

  delete from calibration_participants where session_id = p_id and not (user_id = any (v_ids));
  insert into calibration_participants (session_id, user_id, role_at_invite, is_scheduler)
  select p_id, u.id, u.role, (u.id = s.created_by) from users u
   where u.id = any (v_ids)
     and not exists (select 1 from calibration_participants p where p.session_id = p_id and p.user_id = u.id);
end;
$$;
revoke all on function update_calibration_session(uuid, text, timestamptz, uuid[]) from public;
grant execute on function update_calibration_session(uuid, text, timestamptz, uuid[]) to authenticated;

-- ── Cancel ──────────────────────────────────────────────────
create or replace function cancel_calibration_session(p_id uuid)
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
    raise exception 'Only the person who scheduled this session, or a QA Manager / Super Admin, can cancel it.';
  end if;
  if s.status <> 'scheduled' then raise exception 'Only a scheduled session can be cancelled (this one is %).', s.status; end if;
  update calibration_sessions set status = 'cancelled' where id = p_id;
end;
$$;
revoke all on function cancel_calibration_session(uuid) from public;
grant execute on function cancel_calibration_session(uuid) to authenticated;
