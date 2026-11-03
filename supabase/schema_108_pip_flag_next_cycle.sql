-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 108 — PIP: "Flag for next PIP cycle" on a failed candidate (Jamil, 2026-11-03).
-- Test in the Supabase SQL Editor before relying on it. Apply after 107.
--
-- CONFIRMED by Jamil, after reviewing two rounds of proposed options:
--   - No new HR-forwarding action. The existing automatic 2-CONSECUTIVE-failure termination-review
--     flag (pip_termination_flags, schema_045) stays exactly as it is — untouched by this migration.
--   - "Mark failed" gains one plain marker: an admin/QA Manager can tick "flag for next PIP cycle"
--     at the moment they fail a candidate. This does NOT force re-inclusion in next month's
--     suggestion run — generate_pip_candidates() already naturally reconsiders a failed agent if
--     they're still below the benchmark (it only ever excludes someone on a currently-RUNNING
--     approved PIP, never a past failed one) — so forcing it would be a new, unasked-for rule. This
--     keeps the system's own standing "only flag, don't execute" principle (schema_045's own header).
--   - Every candidate's prior PIP history (first time / completed / failed / still running, and
--     whether their last failure was flagged) should show as a plain remark wherever they appear —
--     most useful right on the suggestion list, before publishing. This is deliberately NOT computed
--     or stored here: it's read live, in src/lib/pip/pip.service.ts, the same way achievementUsd
--     already is (2026-11-03) — a derived fact, not a snapshot, so it can never go stale and needs no
--     insert-time logic duplicated across generate_pip_candidates() / pip_add_candidate() /
--     pip_decide_request()'s include branch (three separate insert points, §14's "don't duplicate
--     across call sites" lesson).
--   - The agent's own Manager should see a "needs your attention" note, in-app only, no email, when
--     one of their own agents gets flagged — same low-key, read-only pattern already used for the
--     termination-review flag (pip_candidates_select_manager, schema_027, already covers a 'failed'
--     row in their chain — no RLS change needed here, just a new query in manager-overview.service.ts).
-- ============================================================

alter table pip_candidates add column if not exists flagged_for_next_pip boolean not null default false;
comment on column pip_candidates.flagged_for_next_pip is
  'Set only via pip_decide(''fail'', ..., true) — a plain marker that QA wants this agent reconsidered '
  'next cycle. Informational only: does not change who generate_pip_candidates() suggests.';

-- pip_decide() gains a 4th parameter (p_flag_next_pip) -- a genuine signature change, so the old
-- 3-argument function is dropped first rather than left as a silently-created overload (§14).
drop function if exists pip_decide(uuid, text, text);

create or replace function pip_decide(p_candidate_id uuid, p_action text, p_note text default null, p_flag_next_pip boolean default false)
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
    update pip_candidates set status = 'failed', decision_note = v_note, flagged_for_next_pip = coalesce(p_flag_next_pip, false) where id = p_candidate_id;
    if coalesce(v_c.consecutive_pip_count, 1) >= 2 then
      insert into pip_termination_flags (pip_candidate_id, agent_id, consecutive_count_at_flag)
      values (p_candidate_id, v_c.agent_id, v_c.consecutive_pip_count);
    end if;
  else
    raise exception 'Unknown action "%" (use exclude, restore, complete or fail — approval is now done by publishing the whole cycle).', p_action;
  end if;
  return (select status from pip_candidates where id = p_candidate_id);
end $$;
revoke all on function pip_decide(uuid, text, text, boolean) from public;
grant execute on function pip_decide(uuid, text, text, boolean) to authenticated;
