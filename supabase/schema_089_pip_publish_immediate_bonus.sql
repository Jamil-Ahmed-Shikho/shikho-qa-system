-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 089 — a PIP publish immediately grants this week's +1 bonus too,
-- instead of waiting for next week. Apply after 081 (the latest live body
-- of pip_publish_cycle(), from schema_045, is what this replaces).
-- Test in the Supabase SQL Editor before relying on it.
--
-- THE GAP (found 2026-10-11, live data): compute_weekly_audit_targets()
-- (schema_035) deliberately decides an agent's +1 bonus ONCE, the first
-- time a sales week's target row is computed, then freezes it for the rest
-- of the week — confirmed by Jamil 2026-09-27 so a QA auditor's weekly
-- number is knowable from day one, not something that silently shifts.
-- That's correct and unchanged for Red/Zero-Seller, whose own status only
-- ever updates via a weekly job anyway.
--
-- PIP is different: pip_publish_cycle() is a one-off manual action that can
-- happen ANY time — and in practice it happens AFTER a cycle's start date
-- (suggest -> manager review -> publish), which is almost always after that
-- week's target row has already been computed (the daily cron, or an
-- auditor's first dashboard load of the week). So the freeze rule, applied
-- literally, meant a freshly-published PIP cycle's +1 bonus never actually
-- landed in its own first week — only from the SECOND week of the PIP
-- onward. Verified live: 13 of 14 agents on the 2026-10-09 cycle (published
-- 2026-10-10, after that week's targets were already computed) showed
-- bonus_applied = false for PIP.
--
-- THE FIX: pip_publish_cycle() now also grants the bonus immediately, for
-- THIS SALES WEEK ONLY, to each newly-approved candidate whose target row
-- already exists and doesn't have a bonus yet. This does NOT touch the
-- general freeze rule — Red/Zero-Seller still only apply at the first
-- computation of a week, and a row already bonused (for any reason) is left
-- exactly as it is (the bonus never stacks, so nothing to add). A frozen
-- (discontinued) row is never touched either.
-- ============================================================

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
  v_week date;
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
      -- are a consecutive FAILURE, so the streak resets (see the open question in schema_045's header).
      v_consec := 1;
      v_lifetime := coalesce(v_prior.lifetime_pip_count, 0) + 1;
    end if;

    update pip_candidates
       set status = 'approved', approved_by = v_me, incentive_downgraded = true,
           consecutive_pip_count = v_consec, lifetime_pip_count = v_lifetime
     where id = v_row.id;
    v_n := v_n + 1;
  end loop;

  -- NEW: grant THIS WEEK's +1 bonus immediately, for a target row that already existed before
  -- publish (so it missed the PIP flag when its bonus was first decided). Only touches the current
  -- sales week, only a row not already frozen, only a row with no bonus applied yet -- never stacks,
  -- never re-derives Red/Zero-Seller, never touches a past or future week.
  if v_n > 0 then
    v_week := sales_week_start((now() at time zone 'Asia/Dhaka')::date);
    if v_cycle.start_date <= v_week + 6 and v_cycle.end_date >= v_week then
      update agent_weekly_audit_target t
         set bonus_applied = true,
             bonus_reasons = array['pip'],
             final_target = t.base_target + 1,
             computed_at = now()
        from pip_candidates pc
       where pc.pip_cycle_id = p_cycle_id and pc.status = 'approved'
         and t.agent_id = pc.agent_id and t.week_start = v_week
         and t.target_frozen = false and t.bonus_applied = false;
    end if;
  end if;

  -- The review window is closing: any request nobody acted on is closed out, not left pending forever.
  update pip_manager_requests set status = 'rejected', decided_by = v_me, decided_at = now(),
         decision_note = 'Cycle published without a decision on this request.'
   where pip_cycle_id = p_cycle_id and status = 'pending';

  update pip_cycles set published_at = now(), published_by = v_me where id = p_cycle_id;
  return v_n;
end $$;
revoke all on function pip_publish_cycle(uuid) from public;
grant execute on function pip_publish_cycle(uuid) to authenticated;
