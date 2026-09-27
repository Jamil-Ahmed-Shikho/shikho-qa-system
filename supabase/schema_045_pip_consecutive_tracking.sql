-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 045 — PIP rebuild, Stage 5: consecutive/lifetime PIP tracking (§6.4, Section C, Q14).
-- Test in the Supabase SQL Editor before relying on it. Apply after 044.
--
-- CONFIRMED by Jamil (2026-09-27, including a follow-up correction of the exact wording):
--   - A CONSECUTIVE count per agent: it increments when the agent's immediately-PRIOR PIP (the one
--     from the calendar month right before this cycle's month) FAILED and this is that very next
--     calendar month. A gap of a full calendar month with no PIP (or the prior one having PASSED —
--     see the open question below) resets it to a fresh 1.
--   - "The very next cycle" means the next CALENDAR MONTH specifically (settled earlier, Stage 3
--     answers) — comparing pip_cycles.month values, not "the next row ever created".
--   - A separate LIFETIME count per agent, total times ever put on a PIP, NEVER resets.
--   - 2 CONSECUTIVE FAILURES -> flags for termination review. The system ONLY flags this — it does
--     NOT execute anything (no auto-exclusion from future suggestion, no auto-block). HR/Manager
--     decide and act outside the system, exactly as Jamil specified.
--   - A MANAGER can request an exception at that point: dismiss the flag, or explicitly request
--     "another chance" (which itself starts the next, 3rd+, consecutive cycle) — recorded here as an
--     accountability trail, same "request, not a direct edit" shape as pip_manager_requests (§Stage 3).
--
-- OPEN QUESTION, NOT GUESSED (see docs/questions-2026-09-25.md / flagged again in CLAUDE.md):
-- Jamil's wording only describes two cases explicitly -- the prior PIP FAILED (adjacent month ->
-- increment) or a GAP (-> reset). It does not say what happens when the prior PIP in the immediately
-- adjacent month was actually COMPLETED (passed), or is still ONGOING ('approved', not yet resolved)
-- at the moment this new cycle publishes. This migration treats BOTH of those the same as a gap --
-- i.e. a completed/still-open prior PIP resets the consecutive count to 1 (a success, or an unresolved
-- outcome, is not a "consecutive failure") -- which is the conservative reading, but it is a Claude-made
-- assumption, not a confirmed rule. Flag for correction if the intent was different.
--
-- ALSO NOT BUILT HERE, on the same "only flags, doesn't execute" principle: generate_pip_candidates()
-- is UNCHANGED -- a flagged agent is not automatically excluded from a future cycle's suggestions, and
-- a Manager's "another chance" exception does not need to exist for the system to include them again.
-- The exception is recorded purely for the record; ask if you actually want it to gate re-suggestion.
-- ============================================================

alter table pip_candidates add column if not exists consecutive_pip_count int;
alter table pip_candidates add column if not exists lifetime_pip_count int;
alter table pip_candidates add constraint pip_candidates_counts_only_active
  check ((consecutive_pip_count is null and lifetime_pip_count is null) or status in ('approved', 'completed', 'failed'));

-- ── Termination review flags ─────────────────────────────────────────────────────────────────────
create table pip_termination_flags (
  id uuid primary key default gen_random_uuid(),
  pip_candidate_id uuid not null unique references pip_candidates(id),  -- the FAILED PIP that crossed the threshold
  agent_id uuid not null references users(id),
  consecutive_count_at_flag int not null,
  flagged_at timestamptz not null default now(),
  exception_type text check (exception_type in ('dismissed', 'another_chance')),
  exception_reason text check (exception_reason is null or length(btrim(exception_reason)) > 0),
  exception_by uuid references users(id),
  exception_at timestamptz,
  constraint pip_termination_flags_exception_together check (
    (exception_type is null) = (exception_reason is null)
    and (exception_type is null) = (exception_by is null)
    and (exception_type is null) = (exception_at is null)
  )
);
create index idx_pip_termination_flags_agent on pip_termination_flags(agent_id);

alter table pip_termination_flags enable row level security;
-- QA staff see every flag; a Manager sees only their own chain's. No write policy for anyone --
-- flagged only by pip_decide() below, decided only by pip_manager_termination_exception() below.
create policy pip_termination_flags_select_qa on pip_termination_flags for select to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager', 'qa_auditor'));
create policy pip_termination_flags_select_manager on pip_termination_flags for select to authenticated
  using (current_app_role() = 'manager' and agent_id in (select a from manager_chain_ids() as a));

-- ── pip_publish_cycle(): compute consecutive/lifetime counts alongside approval + downgrade ─────────
create or replace function pip_publish_cycle(p_cycle_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := current_app_user_id();
  v_cycle pip_cycles%rowtype;
  v_n int := 0;
  v_row record;
  v_prior record;
  v_consec int;
  v_lifetime int;
begin
  if current_app_role() not in ('super_admin', 'qa_manager') then
    raise exception 'Only a Super Admin or QA Manager can publish a PIP cycle.';
  end if;
  select * into v_cycle from pip_cycles where id = p_cycle_id for update;
  if not found then raise exception 'That PIP cycle does not exist.'; end if;
  if v_cycle.published_at is not null then raise exception 'This cycle was already published.'; end if;
  if not exists (select 1 from pip_candidates where pip_cycle_id = p_cycle_id) then
    raise exception 'Generate suggestions before publishing.';
  end if;

  for v_row in select id, agent_id from pip_candidates where pip_cycle_id = p_cycle_id and status = 'suggested' loop
    -- The agent's most recent PRIOR PIP (any cycle whose month is before this one's) -- excluded/
    -- suggested-only candidates never count, since the agent was never actually put on a PIP.
    select pc.status, pc.consecutive_pip_count, pc.lifetime_pip_count, c.month
      into v_prior
      from pip_candidates pc join pip_cycles c on c.id = pc.pip_cycle_id
     where pc.agent_id = v_row.agent_id and pc.status in ('approved', 'completed', 'failed')
       and c.month < v_cycle.month
     order by c.month desc limit 1;

    if not found then
      v_consec := 1; v_lifetime := 1;
    elsif v_prior.status = 'failed' and (v_prior.month + interval '1 month')::date = v_cycle.month then
      v_consec := coalesce(v_prior.consecutive_pip_count, 0) + 1;
      v_lifetime := coalesce(v_prior.lifetime_pip_count, 0) + 1;
    else
      -- A gap, OR the prior PIP was completed (passed), OR it is still unresolved -- none of these
      -- are a consecutive FAILURE, so the streak resets (see the open question in this file's header).
      v_consec := 1;
      v_lifetime := coalesce(v_prior.lifetime_pip_count, 0) + 1;
    end if;

    update pip_candidates
       set status = 'approved', approved_by = v_me, incentive_downgraded = true,
           consecutive_pip_count = v_consec, lifetime_pip_count = v_lifetime
     where id = v_row.id;
    v_n := v_n + 1;
  end loop;

  -- The review window is closing: any request nobody acted on is closed out, not left pending forever.
  update pip_manager_requests set status = 'rejected', decided_by = v_me, decided_at = now(),
         decision_note = 'Cycle published without a decision on this request.'
   where pip_cycle_id = p_cycle_id and status = 'pending';

  update pip_cycles set published_at = now(), published_by = v_me where id = p_cycle_id;
  return v_n;
end $$;
revoke all on function pip_publish_cycle(uuid) from public;
grant execute on function pip_publish_cycle(uuid) to authenticated;

-- ── pip_decide(): 'fail' now also raises a termination flag once the agent has FAILED 2 (or more)
-- CONSECUTIVE PIPs in a row ─────────────────────────────────────────────────────────────────────
create or replace function pip_decide(p_candidate_id uuid, p_action text, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c pip_candidates%rowtype;
  v_cycle pip_cycles%rowtype;
  v_actor uuid := current_app_user_id();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if current_app_role() not in ('super_admin', 'qa_manager') then
    raise exception 'Only a Super Admin or QA Manager can change a PIP candidate.';
  end if;
  select * into v_c from pip_candidates where id = p_candidate_id for update;
  if not found then raise exception 'That PIP candidate does not exist.'; end if;
  select * into v_cycle from pip_cycles where id = v_c.pip_cycle_id;

  if p_action = 'exclude' then
    if v_cycle.published_at is not null then raise exception 'This cycle has already been published.'; end if;
    if v_c.status <> 'suggested' then raise exception 'Only a suggested candidate can be excluded (this one is %).', v_c.status; end if;
    if v_note is null then raise exception 'A reason is required to exclude a candidate.'; end if;
    update pip_candidates set status = 'excluded', exclusion_reason = v_note, excluded_by = v_actor where id = p_candidate_id;
  elsif p_action = 'restore' then
    if v_cycle.published_at is not null then raise exception 'This cycle has already been published.'; end if;
    if v_c.status <> 'excluded' then raise exception 'Only an excluded candidate can be restored (this one is %).', v_c.status; end if;
    update pip_candidates set status = 'suggested', exclusion_reason = null, excluded_by = null where id = p_candidate_id;
  elsif p_action = 'complete' then
    if v_c.status <> 'approved' then raise exception 'Only an approved PIP can be completed (this one is %).', v_c.status; end if;
    update pip_candidates set status = 'completed', decision_note = v_note where id = p_candidate_id;
  elsif p_action = 'fail' then
    if v_c.status <> 'approved' then raise exception 'Only an approved PIP can be marked failed (this one is %).', v_c.status; end if;
    update pip_candidates set status = 'failed', decision_note = v_note where id = p_candidate_id;
    if coalesce(v_c.consecutive_pip_count, 1) >= 2 then
      insert into pip_termination_flags (pip_candidate_id, agent_id, consecutive_count_at_flag)
      values (p_candidate_id, v_c.agent_id, v_c.consecutive_pip_count);
    end if;
  else
    raise exception 'Unknown action "%" (use exclude, restore, complete or fail — approval is now done by publishing the whole cycle).', p_action;
  end if;
  return (select status from pip_candidates where id = p_candidate_id);
end $$;
revoke all on function pip_decide(uuid, text, text) from public;
grant execute on function pip_decide(uuid, text, text) to authenticated;

-- ── A Manager records an exception on a flag concerning their own chain ─────────────────────────
create or replace function pip_manager_termination_exception(p_flag_id uuid, p_type text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := current_app_user_id();
  v_flag pip_termination_flags%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if current_app_role() <> 'manager' then raise exception 'Only a Manager can record a termination-review exception.'; end if;
  if p_type not in ('dismissed', 'another_chance') then raise exception 'Choose dismissed or another_chance.'; end if;
  if v_reason is null then raise exception 'A reason is required.'; end if;
  select * into v_flag from pip_termination_flags where id = p_flag_id for update;
  if not found then raise exception 'That flag does not exist.'; end if;
  if v_flag.agent_id not in (select a from manager_chain_ids() as a) then
    raise exception 'You can only act on a flag for someone in your own reporting chain.';
  end if;
  if v_flag.exception_type is not null then raise exception 'This flag already has a recorded decision.'; end if;

  update pip_termination_flags
     set exception_type = p_type, exception_reason = v_reason, exception_by = v_me, exception_at = now()
   where id = p_flag_id;
end $$;
revoke all on function pip_manager_termination_exception(uuid, text, text) from public;
grant execute on function pip_manager_termination_exception(uuid, text, text) to authenticated;
