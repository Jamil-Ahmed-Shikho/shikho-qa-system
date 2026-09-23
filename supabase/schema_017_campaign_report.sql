-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 017 — Special Checks / Campaigns, part B3: Campaign Report
-- Test this in the Supabase SQL Editor before relying on it.
-- Requires schema_016 already applied.
--
-- Pick a campaign, see the distribution of answers per check — a table
-- (counts + %) and a chart — over SUBMITTED audits only, filterable by
-- team, site, agent, QA auditor and a submitted-date range.
--
-- Access (confirmed, corrected twice after the first build of this step —
-- see CLAUDE.md §2's "My View / Team View" note for the standing principle
-- this follows for later steps):
--   - Super Admin / QA Manager / QA Auditor all see every audit,
--     company-wide (Team View) — a QA Auditor is NOT scoped to their
--     assigned agents (users.quality_auditor_id is informational only
--     here, same as manager_id is informational on an agent, §2). Any of
--     these three may pass p_manager_id to narrow to one SPECIFIC
--     manager's chain, same as the Manager Dashboard's own admin picker
--     (manager_agent_stats, schema_007).
--   - A Manager sees only their own reporting chain, always.
--   - A Team Lead sees only their own team's agents, always — the exact
--     same scoping already used everywhere else Team Lead appears in the
--     app (team_agent_ids(), §2). Like a Manager, they have no drill-down
--     lever: p_manager_id is never consulted for this role.
--
-- Both functions are SECURITY DEFINER (so the aggregate query isn't
-- re-evaluating RLS per row) and do their OWN role/chain check rather than
-- relying on the caller — same reasoning, same pattern, as
-- manager_chain_ids()/manager_agent_stats(): a disallowed role, or a
-- Manager asking for someone else's chain, gets zero rows back, not an
-- error. `current_app_role()`/`current_app_user_id()` are already
-- SECURITY DEFINER (schema_001/002) so calling them from here is safe.
-- ============================================================

-- Which agents the report may be scoped to for this caller, given the
-- confirmed access rule. null = "no chain restriction" (super_admin /
-- qa_manager / qa_auditor with no p_manager_id — i.e. company-wide). An
-- array (possibly empty) = restricted to exactly that set — a Manager's
-- chain or a Team Lead's own team.
--
-- A QA Auditor narrowing to one manager's chain does NOT go through
-- manager_chain_ids() — that shared helper only trusts super_admin /
-- qa_manager to look up someone ELSE's chain, and it also backs
-- manager_agent_stats() (the Manager Dashboard's detailed per-agent stats).
-- Widening its trust would have handed a QA Auditor that too, as a side
-- effect, which nobody asked for. So the (small, read-only) chain walk is
-- duplicated here instead, kept deliberately local to this report.
create or replace function campaign_report_scope(p_manager_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_role text := current_app_role();
begin
  if v_role in ('super_admin', 'qa_manager') then
    if p_manager_id is null then
      return null;                                    -- no restriction: every agent
    end if;
    return (select coalesce(array_agg(c), '{}') from manager_chain_ids(p_manager_id) c);
  end if;

  if v_role = 'qa_auditor' then
    if p_manager_id is null then
      return null;                                    -- unrestricted, same as QA Manager
    end if;
    return (
      select coalesce(array_agg(chain.id), '{}')
      from (
        with recursive c as (
          select u.id from users u where u.manager_id = p_manager_id and u.role = 'team_lead'
          union
          select u.id from users u join c on u.team_leader_id = c.id
        )
        select id from c
      ) chain
    );
  end if;

  if v_role = 'manager' then
    -- A Manager always sees their OWN chain — manager_chain_ids() ignores
    -- p_manager_id from a non-admin caller anyway, but pass null explicitly
    -- so that is never in question here.
    return (select coalesce(array_agg(c), '{}') from manager_chain_ids(null) c);
  end if;

  if v_role = 'team_lead' then
    -- Own team's agents only, no drill-down lever at all — same scoping
    -- pattern as everywhere else Team Lead appears in the app (§2:
    -- team_agent_ids()). p_manager_id is simply never consulted here: a
    -- Team Lead has no manager-chain concept and no ability to view
    -- another team or another Team Lead's data. team_agent_ids(null)
    -- means "me" and, like manager_chain_ids(), refuses to resolve anyone
    -- else's team for a non-admin caller — so this is safe even if
    -- something upstream ever passed a foreign id by mistake.
    return (select coalesce(array_agg(c), '{}') from team_agent_ids(null) c);
  end if;

  return '{}'::uuid[];                                -- any other role: nothing
end;
$$;
revoke all on function campaign_report_scope(uuid) from public;
grant execute on function campaign_report_scope(uuid) to authenticated;

-- The answer distribution: one row per (check, option) with how many
-- matching submitted audits chose it. Includes archived checks/options —
-- their text is frozen once used (schema_014/015), so it still reads
-- correctly; hiding them would lose real history. A check/option with zero
-- matching answers simply doesn't appear (the app fills in "0" for options
-- it knows about from the campaign definition but this didn't return).
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
  join audits au on au.id = a.audit_id and au.status = 'submitted'
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
revoke all on function campaign_report(uuid, uuid, text, text, uuid, uuid, timestamptz, timestamptz) from public;
grant execute on function campaign_report(uuid, uuid, text, text, uuid, uuid, timestamptz, timestamptz) to authenticated;

-- How many distinct submitted audits (matching the same filters) have this
-- campaign attached — the report's header count and the base for "how many
-- have NOT yet answered a given check" (that total minus a check's own
-- sum of answer_count).
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
  join audits au on au.id = ac.audit_id and au.status = 'submitted'
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
revoke all on function campaign_report_audit_count(uuid, uuid, text, text, uuid, uuid, timestamptz, timestamptz) from public;
grant execute on function campaign_report_audit_count(uuid, uuid, text, text, uuid, uuid, timestamptz, timestamptz) to authenticated;

-- Agent / auditor dropdown options for the report's filters — only the
-- people who actually appear in this campaign's submitted audits, and only
-- within the caller's scope, so the list is short and never leaks names
-- outside what the caller may already see elsewhere.
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
  from (select distinct au.agent_id from audit_campaigns ac join audits au on au.id = ac.audit_id and au.status = 'submitted' where ac.campaign_id = p_campaign_id) x
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
    from audit_campaigns ac join audits au on au.id = ac.audit_id and au.status = 'submitted'
    where ac.campaign_id = p_campaign_id
      and (v_scope is null or au.agent_id = any (v_scope))
  ) x
  join users auditor on auditor.id = x.auditor_id
  order by 1, 3;
end;
$$;
revoke all on function campaign_report_participants(uuid, uuid) from public;
grant execute on function campaign_report_participants(uuid, uuid) to authenticated;

-- No separate "list of managers" function here: the app reuses
-- listManagerOptions() (src/lib/manager/dashboard.service.ts), the same
-- one the Manager Dashboard's admin picker already uses — it correctly
-- includes qa_manager rows too (a BPO Team Lead's manager_id may point at
-- a qa_manager, §2), which a from-scratch version here would have missed.
