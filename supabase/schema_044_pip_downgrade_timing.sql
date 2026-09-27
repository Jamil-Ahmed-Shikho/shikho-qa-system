-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 044 — PIP rebuild, Stage 4: incentive downgrade timing (§6.4, Section C, Q13).
-- Test in the Supabase SQL Editor before relying on it. Apply after 043.
--
-- CONFIRMED by Jamil, 2026-09-27: the incentive downgrade applies IMMEDIATELY when the 3-week PIP
-- period starts (on approval/publish), matching the original SOP wording — NOT on failure, which is
-- what §6.4/schema_027 originally built (incentive_downgraded was settable only via pip_decide('fail',
-- ..., p_downgrade)). The actual $ incentive calculation happens OUTSIDE this system; this system's
-- job is only to (a) record that the downgrade applies to this PIP and (b) show the agent a clear
-- message, alongside their period/target/achievement (Stage 6).
--
-- CHANGES:
--   1. The old CHECK (downgraded only when status = 'failed') is wrong under the new timing and is
--      replaced with one that matches: downgraded only once a candidate has actually been on a PIP
--      at all (status in approved/completed/failed) — never while merely suggested/excluded.
--   2. pip_publish_cycle() now sets incentive_downgraded = true on every row it flips to 'approved'
--      — the single place a candidate becomes 'approved' since schema_043 removed the old per-
--      candidate approve action, so this is the one correct place for the timing to live.
--   3. pip_decide()'s 'fail' action no longer sets incentive_downgraded (it is already true from
--      publish, by the time a candidate can even be marked failed) — the p_downgrade parameter is
--      REMOVED (a genuine signature change, so the old 4-argument function is DROPPED first, §14).
--   4. A one-time backfill: any EXISTING approved/completed/failed candidate (from testing under the
--      old rule) is corrected to incentive_downgraded = true, since under the new rule their PIP
--      period already started and the downgrade already applied in reality — a real data correction,
--      the same principle as schema_039's team consolidation, not just an app-logic change going
--      forward. RAISE NOTICE reports how many rows were touched.
-- ============================================================

-- ── 1. The CHECK constraint ──────────────────────────────────────────────────────────────────────
alter table pip_candidates drop constraint if exists pip_candidates_downgrade_only_failed;
alter table pip_candidates add constraint pip_candidates_downgrade_only_active
  check (not incentive_downgraded or status in ('approved', 'completed', 'failed'));

-- ── 2. Backfill existing rows (a real data correction, not just a future-facing rule change) ───────
do $$
declare
  v_n int;
begin
  update pip_candidates set incentive_downgraded = true
   where status in ('approved', 'completed', 'failed') and not incentive_downgraded;
  get diagnostics v_n = row_count;
  raise notice 'schema_044: backfilled incentive_downgraded = true on % existing approved-or-later PIP candidate(s)', v_n;
end $$;

-- ── 3. pip_publish_cycle(): downgrade applies AT publish, alongside the approval itself ────────────
create or replace function pip_publish_cycle(p_cycle_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := current_app_user_id();
  v_cycle pip_cycles%rowtype;
  v_n int;
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

  -- The incentive downgrade applies the moment the PIP period starts, i.e. right here — never on
  -- failure (schema_044, Q13).
  update pip_candidates set status = 'approved', approved_by = v_me, incentive_downgraded = true
   where pip_cycle_id = p_cycle_id and status = 'suggested';
  get diagnostics v_n = row_count;

  -- The review window is closing: any request nobody acted on is closed out, not left pending forever.
  update pip_manager_requests set status = 'rejected', decided_by = v_me, decided_at = now(),
         decision_note = 'Cycle published without a decision on this request.'
   where pip_cycle_id = p_cycle_id and status = 'pending';

  update pip_cycles set published_at = now(), published_by = v_me where id = p_cycle_id;
  return v_n;
end $$;
revoke all on function pip_publish_cycle(uuid) from public;
grant execute on function pip_publish_cycle(uuid) to authenticated;

-- ── 4. pip_decide(): the p_downgrade parameter is REMOVED (signature change -> drop first, §14) ────
drop function if exists pip_decide(uuid, text, text, boolean);
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
    -- incentive_downgraded is NOT set here any more -- it was already set true at publish (Q13).
    update pip_candidates set status = 'failed', decision_note = v_note where id = p_candidate_id;
  else
    raise exception 'Unknown action "%" (use exclude, restore, complete or fail — approval is now done by publishing the whole cycle).', p_action;
  end if;
  return (select status from pip_candidates where id = p_candidate_id);
end $$;
revoke all on function pip_decide(uuid, text, text) from public;
grant execute on function pip_decide(uuid, text, text) to authenticated;
