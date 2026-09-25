-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 028 — Step 5: CAPA (re-audit linking) + Disputes (§4)
-- Test this in the Supabase SQL Editor before relying on it.
-- Requires schema_005/007/008/011 (audits, scoring, scoping) and 014-017
-- (campaign tables + report). Apply after 027.
--
-- NO email or notification is sent by anything here.
--
-- ── CAPA ────────────────────────────────────────────────────
-- A failed audit (audits.passed = false, incl. any Critical fatal) can be
-- FLAGGED by QA as needing a follow-up re-audit (capa_status = 'pending_reaudit').
-- A later audit of the SAME agent can then be linked back to it
-- (audits.re_audit_of). When that follow-up is SUBMITTED, the original's
-- capa_status becomes 'passed' or 'failed_again' by whether the follow-up
-- passed. capa_status lives on the audit that failed; a failed follow-up can
-- itself be flagged, so a chain is possible. Not tied to sampling yet.
--   - capa_status can ONLY change through flag_reaudit / unflag_reaudit or the
--     follow-up's submission (a guard trigger refuses any direct write);
--   - the link is validated by a trigger (same agent, original pending, not
--     itself) and fixed once the follow-up is submitted; one follow-up per audit.
--
-- ── DISPUTES ────────────────────────────────────────────────
-- The agent — or their Team Lead ON THEIR BEHALF, recorded as such — formally
-- disputes a submitted audit. QA Manager / Super Admin review and resolve it.
--   submitted -> [dispute filed] audits.status 'disputed' -> [resolved] 'resolved'
-- One dispute per audit. RESOLVING RECORDS A DECISION (outcome + note); it does
-- NOT change the audit's score — scorecards are immutable (§4). What an
-- "upheld" dispute should DO to the audit (re-score, void, re-audit) is an open
-- business question (docs/questions-2026-09-25.md) and is not guessed here.
--
-- Agents could not read audits before; they now read THEIR OWN non-draft audits
-- (needed to dispute one) — but NOT the Special Check answers (management-only).
-- ============================================================

-- ═══ 1. CAPA ═════════════════════════════════════════════════

-- 1a. capa_status is written only by the functions / trigger below.
create or replace function audits_guard_capa()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (tg_op = 'INSERT' and new.capa_status is not null)
     or (tg_op = 'UPDATE' and new.capa_status is distinct from old.capa_status) then
    if coalesce(current_setting('app.capa_write', true), '') <> 'on' then
      raise exception 'The re-audit (CAPA) status is set by flagging a failed audit for re-audit, or by submitting its follow-up — it cannot be edited directly.';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_audits_guard_capa before insert or update on audits
  for each row execute function audits_guard_capa();

-- 1b. The link: same agent, original is waiting, not itself; fixed once submitted.
create or replace function audits_validate_reaudit_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orig audits%rowtype;
begin
  if tg_op = 'UPDATE' and new.re_audit_of is not distinct from old.re_audit_of then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status <> 'draft' then
    raise exception 'The re-audit link of a submitted audit cannot be changed.';
  end if;
  if new.re_audit_of is null then
    return new;
  end if;

  select * into v_orig from audits where id = new.re_audit_of;
  if not found then raise exception 'That audit does not exist.'; end if;
  if v_orig.id = new.id then raise exception 'An audit cannot be the re-audit of itself.'; end if;
  if v_orig.agent_id <> new.agent_id then
    raise exception 'A re-audit must be for the same agent as the audit it follows up.';
  end if;
  if v_orig.capa_status is distinct from 'pending_reaudit' then
    raise exception 'That audit is not waiting for a re-audit.';
  end if;
  return new;
end;
$$;
create trigger trg_audits_validate_reaudit_link before insert or update of re_audit_of on audits
  for each row execute function audits_validate_reaudit_link();

-- One follow-up per audit (a second draft can't grab the same pending re-audit).
create unique index uq_audits_re_audit_of on audits (re_audit_of) where re_audit_of is not null;

-- 1c. When the follow-up is SUBMITTED, settle the original's status.
create or replace function audits_propagate_capa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'draft' and new.status <> 'draft' and new.re_audit_of is not null then
    perform set_config('app.capa_write', 'on', true);
    update audits
       set capa_status = case when coalesce(new.passed, false) then 'passed' else 'failed_again' end
     where id = new.re_audit_of and capa_status = 'pending_reaudit';
    perform set_config('app.capa_write', 'off', true);
  end if;
  return new;
end;
$$;
create trigger trg_audits_propagate_capa after update of status on audits
  for each row execute function audits_propagate_capa();

-- 1d. Flag / un-flag (QA only: Super Admin / QA Manager any; a QA Auditor only audits they conducted).
create or replace function flag_reaudit(p_audit_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := current_app_role();
  v_a audits%rowtype;
begin
  if v_role not in ('super_admin', 'qa_manager', 'qa_auditor') then
    raise exception 'Only QA staff can flag an audit for re-audit.';
  end if;
  select * into v_a from audits where id = p_audit_id;
  if not found then raise exception 'That audit does not exist.'; end if;
  if v_role = 'qa_auditor' and v_a.auditor_id is distinct from current_app_user_id() then
    raise exception 'You can only flag audits you conducted.';
  end if;
  if v_a.status = 'draft' then raise exception 'This audit has not been submitted yet.'; end if;
  if v_a.passed is distinct from false then
    raise exception 'Only an audit that did not pass can be flagged for re-audit.';
  end if;
  if v_a.capa_status is not null then
    raise exception 'This audit is already flagged (re-audit status: %).', v_a.capa_status;
  end if;

  perform set_config('app.capa_write', 'on', true);
  update audits set capa_status = 'pending_reaudit' where id = p_audit_id;
  perform set_config('app.capa_write', 'off', true);
end;
$$;
revoke all on function flag_reaudit(uuid) from public;
grant execute on function flag_reaudit(uuid) to authenticated;

create or replace function unflag_reaudit(p_audit_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := current_app_role();
  v_a audits%rowtype;
begin
  if v_role not in ('super_admin', 'qa_manager', 'qa_auditor') then
    raise exception 'Only QA staff can change a re-audit flag.';
  end if;
  select * into v_a from audits where id = p_audit_id;
  if not found then raise exception 'That audit does not exist.'; end if;
  if v_role = 'qa_auditor' and v_a.auditor_id is distinct from current_app_user_id() then
    raise exception 'You can only change flags on audits you conducted.';
  end if;
  if v_a.capa_status is distinct from 'pending_reaudit' then
    raise exception 'This audit is not waiting for a re-audit.';
  end if;
  if exists (select 1 from audits where re_audit_of = p_audit_id) then
    raise exception 'A follow-up audit is already linked — release or unlink it first.';
  end if;

  perform set_config('app.capa_write', 'on', true);
  update audits set capa_status = null where id = p_audit_id;
  perform set_config('app.capa_write', 'off', true);
end;
$$;
revoke all on function unflag_reaudit(uuid) from public;
grant execute on function unflag_reaudit(uuid) to authenticated;

-- 1e. Who is waiting for a re-audit (each reader sees only what their own audit access allows).
create or replace view pending_reaudits
with (security_invoker = true) as
  select a.id as audit_id, a.agent_id, a.auditor_id, a.score_percent, a.critical_fail, a.submitted_at,
         exists (select 1 from audits f where f.re_audit_of = a.id) as follow_up_started
    from audits a
   where a.capa_status = 'pending_reaudit';
grant select on pending_reaudits to authenticated;

-- ═══ 2. Agents read their OWN submitted audits ═══════════════
-- The scorecard tables inherit visibility from the audit (schema_011), so this
-- alone lets an agent read their own scorecard, feedback and fatal errors.
create policy audits_select_agent_own on audits
  for select to authenticated
  using (agent_id = current_app_user_id() and status <> 'draft');

-- ...but the Special Check answers are ad-hoc MANAGEMENT checks (§4 Part B), not
-- something the agent was assessed on — keep them out of an agent's reach.
drop policy audit_campaigns_select on audit_campaigns;
create policy audit_campaigns_select on audit_campaigns
  for select to authenticated
  using (coalesce(current_app_role(), '') <> 'agent'
         and exists (select 1 from audits a where a.id = audit_campaigns.audit_id));
drop policy audit_campaign_answers_select on audit_campaign_answers;
create policy audit_campaign_answers_select on audit_campaign_answers
  for select to authenticated
  using (coalesce(current_app_role(), '') <> 'agent'
         and exists (select 1 from audits a where a.id = audit_campaign_answers.audit_id));

-- ═══ 3. Disputes ═════════════════════════════════════════════
create table disputes (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null unique references audits(id),        -- one dispute per audit
  agent_id uuid not null references users(id),                -- whose audit it is
  raised_by uuid not null references users(id),               -- who actually filed it
  -- true when raised_by is NOT the agent: "filed by Team Lead on behalf of the agent".
  filed_on_behalf boolean not null,
  reason text not null,
  status text not null default 'open' check (status in ('open', 'under_review', 'resolved')),
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  outcome text check (outcome in ('upheld', 'partially_upheld', 'not_upheld')),
  resolution_note text,
  resolved_by uuid references users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint disputes_reason_text check (length(btrim(reason)) > 0 and length(reason) <= 2000),
  constraint disputes_on_behalf_consistent check (filed_on_behalf = (raised_by <> agent_id)),
  constraint disputes_review_recorded check (status <> 'under_review' or reviewed_by is not null),
  -- explicit IS NOT NULLs on every column: a NULL check result would PASS (see §14).
  constraint disputes_resolved_shape check (
    (status = 'resolved' and outcome is not null and resolved_by is not null and resolved_at is not null
       and resolution_note is not null and length(btrim(resolution_note)) > 0 and length(resolution_note) <= 2000)
    or (status <> 'resolved' and outcome is null and resolved_by is null and resolved_at is null and resolution_note is null)
  )
);
create index idx_disputes_agent on disputes(agent_id);
create index idx_disputes_status on disputes(status);

alter table disputes enable row level security;

-- Read: QA Manager / Super Admin all; a QA Auditor the disputes on audits they conducted;
-- a Team Lead their own team's; a Manager their chain's (§2: any table a Manager reads is
-- scoped through manager_chain_ids()); the agent their own. NO write policy for anyone —
-- every change goes through the functions below.
create policy disputes_select_admin on disputes for select to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager'));
create policy disputes_select_auditor on disputes for select to authenticated
  using (current_app_role() = 'qa_auditor'
         and audit_id in (select id from audits where auditor_id = current_app_user_id()));
create policy disputes_select_team_lead on disputes for select to authenticated
  using (current_app_role() = 'team_lead' and agent_id in (select a from team_agent_ids() as a));
create policy disputes_select_manager on disputes for select to authenticated
  using (current_app_role() = 'manager' and agent_id in (select a from manager_chain_ids() as a));
create policy disputes_select_self on disputes for select to authenticated
  using (agent_id = current_app_user_id());

-- 3a. File a dispute — the agent, or their Team Lead on their behalf.
create or replace function file_dispute(p_audit_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := current_app_role();
  v_me uuid := current_app_user_id();
  v_audit audits%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_id uuid;
begin
  if v_me is null then raise exception 'You are not signed in.'; end if;
  select * into v_audit from audits where id = p_audit_id;
  if not found then raise exception 'That audit does not exist.'; end if;

  if v_role = 'agent' then
    if v_audit.agent_id <> v_me then raise exception 'You can only dispute your own audits.'; end if;
  elsif v_role = 'team_lead' then
    if v_audit.agent_id not in (select a from team_agent_ids() as a) then
      raise exception 'You can only file a dispute for an agent on your own team.';
    end if;
  else
    raise exception 'Only the agent — or their Team Lead on their behalf — can file a dispute.';
  end if;

  if v_audit.status = 'draft' then raise exception 'This audit has not been submitted yet.'; end if;
  if v_audit.status <> 'submitted' or exists (select 1 from disputes where audit_id = p_audit_id) then
    raise exception 'This audit has already been disputed.';
  end if;
  if v_reason = '' then raise exception 'Explain what you are disputing.'; end if;
  if length(v_reason) > 2000 then raise exception 'The reason can be at most 2000 characters.'; end if;

  insert into disputes (audit_id, agent_id, raised_by, filed_on_behalf, reason)
  values (p_audit_id, v_audit.agent_id, v_me, v_me <> v_audit.agent_id, v_reason)
  returning id into v_id;

  update audits set status = 'disputed' where id = p_audit_id;
  return v_id;
end;
$$;
revoke all on function file_dispute(uuid, text) from public;
grant execute on function file_dispute(uuid, text) to authenticated;

-- 3b. Review + resolve (Super Admin / QA Manager only).
create or replace function start_dispute_review(p_dispute_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_d disputes%rowtype;
begin
  if current_app_role() not in ('super_admin', 'qa_manager') then
    raise exception 'Only a Super Admin or QA Manager can review a dispute.';
  end if;
  select * into v_d from disputes where id = p_dispute_id for update;
  if not found then raise exception 'That dispute does not exist.'; end if;
  if v_d.status <> 'open' then raise exception 'Only an open dispute can be taken into review (this one is %).', v_d.status; end if;
  update disputes set status = 'under_review', reviewed_by = current_app_user_id(), reviewed_at = now() where id = p_dispute_id;
end;
$$;
revoke all on function start_dispute_review(uuid) from public;
grant execute on function start_dispute_review(uuid) to authenticated;

create or replace function resolve_dispute(p_dispute_id uuid, p_outcome text, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_d disputes%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if current_app_role() not in ('super_admin', 'qa_manager') then
    raise exception 'Only a Super Admin or QA Manager can resolve a dispute.';
  end if;
  select * into v_d from disputes where id = p_dispute_id for update;
  if not found then raise exception 'That dispute does not exist.'; end if;
  if v_d.status = 'resolved' then raise exception 'This dispute is already resolved.'; end if;
  if p_outcome is null or p_outcome not in ('upheld', 'partially_upheld', 'not_upheld') then
    raise exception 'Choose an outcome: upheld, partially upheld or not upheld.';
  end if;
  if v_note = '' then raise exception 'A resolution note is required.'; end if;
  if length(v_note) > 2000 then raise exception 'The resolution note can be at most 2000 characters.'; end if;

  update disputes
     set status = 'resolved', outcome = p_outcome, resolution_note = v_note,
         resolved_by = current_app_user_id(), resolved_at = now(),
         reviewed_by = coalesce(reviewed_by, current_app_user_id()), reviewed_at = coalesce(reviewed_at, now())
   where id = p_dispute_id;
  update audits set status = 'resolved' where id = v_d.audit_id;
end;
$$;
revoke all on function resolve_dispute(uuid, text, text) from public;
grant execute on function resolve_dispute(uuid, text, text) to authenticated;

-- ═══ 4. A disputed / resolved audit is still a SUBMITTED audit ══
-- The Campaign Report counted only status = 'submitted'. Now that an audit can
-- move to 'disputed' / 'resolved' (its answers stand and its score is unchanged),
-- "submitted" must mean "not a draft" or those audits would silently vanish from
-- the report. Only the status test changes in the three functions below.

create or replace function campaign_report(
  p_campaign_id uuid,
  p_manager_id uuid default null,       -- super_admin/qa_manager only: view a specific manager's chain
  p_team_name text default null,
  p_site_name text default null,
  p_agent_id uuid default null,
  p_auditor_id uuid default null,
  p_from timestamptz default null,      -- submitted_at >=
  p_to timestamptz default null         -- submitted_at <
)
returns table (
  check_type_id uuid,
  check_type_name text,
  check_sort_order int,
  value_id uuid,
  value_label text,
  value_sort_order int,
  answer_count bigint
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_scope uuid[] := campaign_report_scope(p_manager_id);
begin
  if v_scope is not null and array_length(v_scope, 1) is null then
    return;                                            -- empty chain (or role not entitled at all)
  end if;

  return query
  select t.id, t.name, t.sort_order, v.id, v.label, v.sort_order, count(*)::bigint
  from audit_campaign_answers a
  join audits au on au.id = a.audit_id and au.status <> 'draft'
  join users agent on agent.id = au.agent_id
  join campaign_check_types t on t.id = a.check_type_id
  join campaign_check_values v on v.id = a.value_id
  where a.campaign_id = p_campaign_id
    and (v_scope is null or agent.id = any (v_scope))
    and (p_team_name is null or agent.team_name = p_team_name)
    and (p_site_name is null or agent.site_name = p_site_name)
    and (p_agent_id is null or au.agent_id = p_agent_id)
    and (p_auditor_id is null or au.auditor_id = p_auditor_id)
    and (p_from is null or au.submitted_at >= p_from)
    and (p_to is null or au.submitted_at < p_to)
  group by t.id, t.name, t.sort_order, v.id, v.label, v.sort_order
  order by t.sort_order, v.sort_order;
end;
$$;

create or replace function campaign_report_audit_count(
  p_campaign_id uuid,
  p_manager_id uuid default null,
  p_team_name text default null,
  p_site_name text default null,
  p_agent_id uuid default null,
  p_auditor_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns bigint
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_scope uuid[] := campaign_report_scope(p_manager_id);
  v_n bigint;
begin
  if v_scope is not null and array_length(v_scope, 1) is null then
    return 0;
  end if;

  select count(*) into v_n
  from audit_campaigns ac
  join audits au on au.id = ac.audit_id and au.status <> 'draft'
  join users agent on agent.id = au.agent_id
  where ac.campaign_id = p_campaign_id
    and (v_scope is null or agent.id = any (v_scope))
    and (p_team_name is null or agent.team_name = p_team_name)
    and (p_site_name is null or agent.site_name = p_site_name)
    and (p_agent_id is null or au.agent_id = p_agent_id)
    and (p_auditor_id is null or au.auditor_id = p_auditor_id)
    and (p_from is null or au.submitted_at >= p_from)
    and (p_to is null or au.submitted_at < p_to);

  return v_n;
end;
$$;

create or replace function campaign_report_participants(p_campaign_id uuid, p_manager_id uuid default null)
returns table (kind text, id uuid, name text)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_scope uuid[] := campaign_report_scope(p_manager_id);
begin
  if v_scope is not null and array_length(v_scope, 1) is null then
    return;
  end if;

  return query
  select 'agent'::text, agent.id, agent.name
  from (select distinct au.agent_id from audit_campaigns ac join audits au on au.id = ac.audit_id and au.status <> 'draft' where ac.campaign_id = p_campaign_id) x
  join users agent on agent.id = x.agent_id
  where v_scope is null or agent.id = any (v_scope)
  union all
  select 'auditor'::text, auditor.id, auditor.name
  from (
    -- the scope check happens INSIDE this subquery (on au.agent_id) before
    -- distinct collapses to one row per auditor — doing it after would keep
    -- one row per (auditor, agent) pair and duplicate an auditor who
    -- audited more than one agent in scope
    select distinct au.auditor_id
    from audit_campaigns ac join audits au on au.id = ac.audit_id and au.status <> 'draft'
    where ac.campaign_id = p_campaign_id
      and (v_scope is null or au.agent_id = any (v_scope))
  ) x
  join users auditor on auditor.id = x.auditor_id
  order by 1, 3;
end;
$$;
