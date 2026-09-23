-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 008 — Team Lead scoping + "every agent has a Team Leader"
-- Test this in the Supabase SQL Editor before relying on it.
-- Requires schema_001 … 007 already applied.
--
-- 1. Team Leads are scoped to their own team, matching Manager scoping
--    (schema_007). A Team Lead's team = the agents whose team_leader_id
--    is them. Step 3 had (wrongly) let team_lead read every user and
--    every audit company-wide.
-- 2. An active agent must always have a Team Leader. There is no
--    "agent reports straight to a Manager" case, so an agent with no
--    Team Leader is a data-entry error and is rejected by the database.
--
-- Function is SECURITY DEFINER with a locked search_path — CLAUDE.md
-- §14 (RLS recursion lesson): it reads `users`, and is used by policies.
-- ============================================================

-- ── 1. A Team Lead's own agents ─────────────────────────────
-- With no argument it means "me". A caller may only ask for their own
-- team, unless they are super_admin / qa_manager. Anyone else asking
-- about someone else's team gets an empty set.
create or replace function team_agent_ids(p_team_lead_id uuid default null)
returns setof uuid
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_caller uuid := current_app_user_id();
  v_role text := current_app_role();
  v_target uuid := coalesce(p_team_lead_id, current_app_user_id());
begin
  if v_target is null then
    return;
  end if;

  if v_target is distinct from v_caller and coalesce(v_role, '') not in ('super_admin', 'qa_manager') then
    return;
  end if;

  return query
  select u.id
  from users u
  where u.team_leader_id = v_target
    and u.role = 'agent';
end;
$$;

revoke all on function team_agent_ids(uuid) from public;
grant execute on function team_agent_ids(uuid) to authenticated;

-- ── 2. users: team_lead no longer reads everyone ────────────
-- A Team Lead still sees themselves and their own agents through
-- users_select_self (schema_001: team_leader_id = me). Removing them
-- from users_select_qa_roles is what closes the company-wide read.
drop policy users_select_qa_roles on users;
create policy users_select_qa_roles on users
  for select
  using (current_app_role() in ('super_admin', 'qa_manager', 'qa_auditor'));

-- QA staff are colleagues, not team data — a Team Lead needs to see who
-- audited their agents ("audited by …"), so let them read QA staff rows.
create policy users_select_qa_staff_for_team_lead on users
  for select
  using (current_app_role() = 'team_lead' and role in ('qa_auditor', 'qa_manager'));

-- ── 3. audits: team_lead sees / creates only for their own team ──
drop policy audits_select_qa on audits;
create policy audits_select_qa on audits
  for select
  using (current_app_role() in ('super_admin', 'qa_manager', 'qa_auditor'));

-- Their own team's audits (any status — a draft on their agent is worth
-- knowing about), plus audits they conducted themselves.
create policy audits_select_team_lead on audits
  for select
  using (
    current_app_role() = 'team_lead'
    and (
      auditor_id = current_app_user_id()
      or agent_id in (select t from team_agent_ids() as t)
    )
  );

-- A Team Lead may audit only agents on their own team (§2: "Audits own team").
drop policy audits_insert_own on audits;
create policy audits_insert_own on audits
  for insert
  with check (
    auditor_id = current_app_user_id()
    and (
      current_app_role() in ('super_admin', 'qa_manager', 'qa_auditor')
      or (
        current_app_role() = 'team_lead'
        and agent_id in (select t from team_agent_ids() as t)
      )
    )
  );

-- WITH CHECK also pins a Team Lead's draft to their own team, so they
-- can't edit agent_id to move an audit onto someone else's agent.
drop policy audits_update_own_draft_or_admin on audits;
create policy audits_update_own_draft_or_admin on audits
  for update
  using (
    (auditor_id = current_app_user_id() and status = 'draft')
    or current_app_role() in ('super_admin', 'qa_manager')
  )
  with check (
    (
      auditor_id = current_app_user_id()
      and status = 'draft'
      and (
        current_app_role() <> 'team_lead'
        or agent_id in (select t from team_agent_ids() as t)
      )
    )
    or current_app_role() in ('super_admin', 'qa_manager')
  );

-- ── 4. Every active agent has a Team Leader ─────────────────
-- NOT VALID: applies to every new insert and every update from now on,
-- but doesn't validate rows that already exist — so this migration
-- can't fail on agents you created before the rule. It also means an
-- old orphan can't be edited or reactivated until it is given a Team
-- Leader (deactivating it is allowed: leavers need no Team Leader).
--
-- Find existing offenders, fix them in Users → Edit, then validate:
--
--   select name, email from users
--   where role = 'agent' and is_active and team_leader_id is null;
--
--   alter table users validate constraint users_agent_requires_team_leader;
alter table users add constraint users_agent_requires_team_leader
  check (role <> 'agent' or not is_active or team_leader_id is not null) not valid;
