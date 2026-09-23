-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 007 — Manager role + reporting-chain scoping
-- Test this in the Supabase SQL Editor before relying on it.
-- Requires schema_001 … 006 already applied.
--
-- "Manager" is a business/ops role (distinct from qa_manager, who runs
-- the QA function). Team Leads report to a Manager via users.manager_id;
-- a Manager is NOT tied to one team or site. A Manager's reporting
-- chain is:
--     their Team Leads   = users with role 'team_lead' AND manager_id = manager
--     those TLs' agents  = users whose team_leader_id is in the chain
-- (walked recursively). Access is scoped to that chain and nothing else.
--
-- Everything below that reads `users` from a function used by a
-- `users` policy is SECURITY DEFINER with a locked search_path —
-- CLAUDE.md §14 (RLS recursion lesson).
-- ============================================================

-- ── 1. Allow the new role value ─────────────────────────────
-- The role check was created inline in schema_001, so drop whatever it
-- was auto-named (found by definition, not by guessing the name).
do $$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'users'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%role%'
      and pg_get_constraintdef(oid) not like '%employment_stage%'
  loop
    execute format('alter table users drop constraint %I', r.conname);
  end loop;
end $$;

alter table users add constraint users_role_check
  check (role in ('super_admin','qa_manager','manager','qa_auditor','team_lead','agent'));

-- ── 2. Reporting-chain function ─────────────────────────────
-- Returns the ids of everyone in a manager's chain (their Team Leads
-- and those Team Leads' agents). With no argument it means "me".
--
-- Authorization lives inside the function: a caller may only ask for
-- their own chain, unless they are super_admin / qa_manager (who can
-- view any manager's dashboard). Anyone else asking for someone else's
-- chain gets an empty set — the function never reveals org structure
-- the caller isn't entitled to.
--
-- `union` (not `union all`) dedupes, so a bad cycle in team_leader_id
-- data terminates instead of looping forever.
create or replace function manager_chain_ids(p_manager_id uuid default null)
returns setof uuid
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_caller uuid := current_app_user_id();
  v_role text := current_app_role();
  v_target uuid := coalesce(p_manager_id, current_app_user_id());
begin
  if v_target is null then
    return;
  end if;

  if v_target is distinct from v_caller and coalesce(v_role, '') not in ('super_admin', 'qa_manager') then
    return;
  end if;

  return query
  with recursive chain as (
    select u.id
    from users u
    where u.manager_id = v_target
      and u.role = 'team_lead'
    union
    select u.id
    from users u
    join chain c on u.team_leader_id = c.id
  )
  select chain.id from chain;
end;
$$;

revoke all on function manager_chain_ids(uuid) from public;
grant execute on function manager_chain_ids(uuid) to authenticated;

-- ── 3. Per-agent audit rollup for the Manager dashboard ─────
-- One row per agent in the chain, with audit totals for the period.
-- Team-lead and overall rollups are done in the app from these rows,
-- so every number reconciles. Only submitted-or-later audits count —
-- drafts are an auditor's work in progress, not performance.
-- score_sum (not a pre-rounded average) so weighted averages across
-- agents / teams are exact.
create or replace function manager_agent_stats(
  p_manager_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  agent_id uuid,
  agent_name text,
  agent_email text,
  team_name text,
  site_name text,
  employment_stage text,
  is_active boolean,
  team_leader_id uuid,
  audits_completed bigint,
  score_sum numeric,
  audits_passed bigint,
  critical_fails bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    u.id,
    u.name,
    u.email,
    u.team_name,
    u.site_name,
    u.employment_stage,
    u.is_active,
    u.team_leader_id,
    count(a.id),
    coalesce(sum(a.score_percent), 0),
    count(a.id) filter (where a.passed),
    count(a.id) filter (where a.critical_fail)
  from users u
  left join audits a
    on a.agent_id = u.id
   and a.status <> 'draft'
   and (p_from is null or a.submitted_at >= p_from)
   and (p_to is null or a.submitted_at < p_to)
  where u.role = 'agent'
    and u.id in (select c from manager_chain_ids(p_manager_id) as c)
  group by u.id, u.name, u.email, u.team_name, u.site_name, u.employment_stage, u.is_active, u.team_leader_id
  order by u.name
$$;

revoke all on function manager_agent_stats(uuid, timestamptz, timestamptz) from public;
grant execute on function manager_agent_stats(uuid, timestamptz, timestamptz) to authenticated;

-- ── 4. Row-level scoping for the manager role ───────────────
-- A manager can read only users in their chain, and only the
-- submitted-or-later audits of agents in their chain. They are NOT in
-- users_select_qa_roles / audits_select_qa (schema_003 / 005), so they
-- get nothing company-wide. Any later feature (drill-downs, disputes,
-- revenue, targets) should scope managers with manager_chain_ids() too.
--
-- Note: as first written, the users_select_self policy (schema_001) also
-- let a manager read anyone tagged manager_id = them, even outside their
-- Team Leader chain. schema_009 removes that branch — a Manager tag now
-- grants no read access on its own.
create policy users_select_manager_chain on users
  for select
  using (
    current_app_role() = 'manager'
    and id in (select c from manager_chain_ids() as c)
  );

create policy audits_select_manager_chain on audits
  for select
  using (
    current_app_role() = 'manager'
    and status <> 'draft'
    and agent_id in (select c from manager_chain_ids() as c)
  );

-- ── How to test in the SQL Editor ───────────────────────────
-- The editor runs as a superuser with no login session, so
-- auth.uid() is null and the functions return nothing. Impersonate a
-- user inside a transaction instead (use their auth_id, not users.id):
--
--   begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims',
--     json_build_object('sub', '<manager auth_id>', 'role', 'authenticated')::text, true);
--   select * from manager_chain_ids();
--   select agent_name, team_leader_id, audits_completed from manager_agent_stats();
--   select count(*) from audits;   -- only chain agents' submitted audits
--   rollback;
