-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 081 — PIP: admin cycle/candidate removal + manual add (Jamil, 2026-10-10).
-- Test in the Supabase SQL Editor before relying on it. Apply after 080.
--
-- Three new Super Admin / QA Manager-only functions, none of which existed before:
--
--   1. admin_delete_pip_cycle(cycle_id)      — hard-deletes a whole UNPUBLISHED cycle (and its
--      candidates) outright. Restricted to unpublished cycles only, by design: once a cycle is
--      published its candidates can be real, running PIPs (incentive downgrades already applied,
--      possibly notified) — the per-candidate remove below covers that case instead, one at a time,
--      deliberately, rather than this bulk tool reaching into real published history.
--
--   2. admin_delete_pip_candidate(candidate_id) — hard-deletes ONE candidate row, at ANY status,
--      including 'approved' (a currently-running/open PIP). This is a genuine delete, distinct from
--      pip_decide('exclude', ...) — exclude keeps the row (with a reason) as part of the audit trail;
--      this erases it, for a mistaken/test entry that should never have existed at all.
--
--   3. pip_add_candidate(cycle_id, agent_id) — a direct, unilateral add by Super Admin/QA Manager,
--      independent of generate_pip_candidates()'s benchmark/vintage suggestion run and independent of
--      the Manager-initiated pip_request_change('include', ...) + pip_decide_request() workflow
--      (schema_043/046) — this is a THIRD way a candidate can be added, for a judgment call that
--      doesn't fit either of the other two. Deliberately skips the benchmark/vintage/scoped-team
--      checks generate_pip_candidates() applies — that is the whole point of "manual": an override,
--      not a second automatic run. Only allowed pre-publish, same window as every other list-editing
--      action (exclude/restore/pip_request_change) — once published, the list is closed; use the
--      per-candidate remove above instead if a wrongly-published entry needs to go.
--
-- All three log nothing themselves — the app layer (src/lib/pip/actions.ts) snapshots the row(s)
-- into audit_log's before_data BEFORE calling these, the same way every other destructive action in
-- this system is recorded (§1 — "every write is logged", not just a successful write).
-- ============================================================

-- ── 1. Delete a whole cycle — unpublished only ──────────────────────────────────────────────────
create or replace function admin_delete_pip_cycle(p_cycle_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle pip_cycles%rowtype;
begin
  if current_app_role() not in ('super_admin', 'qa_manager') then
    raise exception 'Only a Super Admin or QA Manager can delete a PIP cycle.';
  end if;
  select * into v_cycle from pip_cycles where id = p_cycle_id for update;
  if not found then raise exception 'That PIP cycle does not exist.'; end if;
  if v_cycle.published_at is not null then
    raise exception 'This cycle has already been published and cannot be deleted — remove individual candidates instead, or mark them completed/failed.';
  end if;

  -- An unpublished cycle's candidates can only be 'suggested' or 'excluded' (approval only ever
  -- happens via pip_publish_cycle), so these three are defensive rather than ever actually hit —
  -- kept so this function stays correct even if that invariant ever changes.
  delete from pip_termination_flags where pip_candidate_id in (select id from pip_candidates where pip_cycle_id = p_cycle_id);
  delete from pip_trainings where pip_candidate_id in (select id from pip_candidates where pip_cycle_id = p_cycle_id);
  delete from pip_tl_feedback where pip_candidate_id in (select id from pip_candidates where pip_cycle_id = p_cycle_id);
  delete from pip_manager_requests where pip_cycle_id = p_cycle_id;
  delete from pip_candidates where pip_cycle_id = p_cycle_id;
  delete from pip_cycles where id = p_cycle_id;
end $$;
revoke all on function admin_delete_pip_cycle(uuid) from public;
grant execute on function admin_delete_pip_cycle(uuid) to authenticated;

-- ── 2. Delete one candidate — any status, including a currently-running ('approved') PIP ────────
create or replace function admin_delete_pip_candidate(p_candidate_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c pip_candidates%rowtype;
begin
  if current_app_role() not in ('super_admin', 'qa_manager') then
    raise exception 'Only a Super Admin or QA Manager can remove a PIP candidate.';
  end if;
  select * into v_c from pip_candidates where id = p_candidate_id for update;
  if not found then raise exception 'That PIP candidate does not exist.'; end if;

  delete from pip_termination_flags where pip_candidate_id = p_candidate_id;
  delete from pip_trainings where pip_candidate_id = p_candidate_id;
  delete from pip_tl_feedback where pip_candidate_id = p_candidate_id;
  delete from pip_candidates where id = p_candidate_id;
end $$;
revoke all on function admin_delete_pip_candidate(uuid) from public;
grant execute on function admin_delete_pip_candidate(uuid) to authenticated;

-- ── 3. Manually add an agent — pre-publish only, no benchmark/vintage/scope check (the override) ──
create or replace function pip_add_candidate(p_cycle_id uuid, p_agent_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := current_app_user_id();
  v_cycle pip_cycles%rowtype;
  v_policy pip_policies%rowtype;
  v_agent users%rowtype;
  v_id uuid;
begin
  if current_app_role() not in ('super_admin', 'qa_manager') then
    raise exception 'Only a Super Admin or QA Manager can manually add a PIP candidate.';
  end if;
  select * into v_cycle from pip_cycles where id = p_cycle_id for update;
  if not found then raise exception 'That PIP cycle does not exist.'; end if;
  if v_cycle.published_at is not null then raise exception 'This cycle has already been published — the list is closed.'; end if;

  select * into v_agent from users where id = p_agent_id;
  if not found or v_agent.role <> 'agent' then raise exception 'That person is not an agent.'; end if;
  if not v_agent.is_active then raise exception 'This agent is not active.'; end if;

  if exists (select 1 from pip_candidates where pip_cycle_id = p_cycle_id and agent_id = p_agent_id and status in ('suggested', 'approved')) then
    raise exception 'This person is already on this cycle''s list.';
  end if;
  if exists (
    select 1 from pip_candidates pc join pip_cycles c on c.id = pc.pip_cycle_id
     where pc.agent_id = p_agent_id and pc.status = 'approved' and c.end_date >= v_cycle.start_date
  ) then
    raise exception 'This agent is already inside a PIP that is still running.';
  end if;

  select * into v_policy from pip_policies where id = v_cycle.policy_id;

  -- A previously-excluded row for this (cycle, agent) already exists (pip_candidates has a unique
  -- (pip_cycle_id, agent_id) key) — restore it rather than insert a duplicate, same as
  -- pip_decide_request()'s include-accept branch (schema_043/046).
  update pip_candidates set status = 'suggested', exclusion_reason = null, excluded_by = null
   where pip_cycle_id = p_cycle_id and agent_id = p_agent_id and status = 'excluded'
   returning id into v_id;
  if v_id is not null then return v_id; end if;

  -- No revenue_at_selection / revenue_unit_used / revenue_window_* — this bypasses the benchmark
  -- check entirely, so there is no revenue figure that decided this; same as a Manager-requested
  -- include once accepted (schema_046), which leaves those fields unset for the identical reason.
  insert into pip_candidates (pip_cycle_id, agent_id, team_name, site_name, vintage_weeks_at_selection, target_revenue, status)
  values (p_cycle_id, p_agent_id, v_agent.team_name, v_agent.site_name,
          case when v_agent.joining_date is null then null else
            (v_cycle.start_date - (
               v_agent.joining_date + case when extract(dow from v_agent.joining_date)::int = 6 then 0
                                           else (6 - extract(dow from v_agent.joining_date)::int + 7) % 7 end
             )) / 7 end,
          v_policy.target_revenue,
          'suggested')
  returning id into v_id;
  return v_id;
end $$;
revoke all on function pip_add_candidate(uuid, uuid) from public;
grant execute on function pip_add_candidate(uuid, uuid) to authenticated;
