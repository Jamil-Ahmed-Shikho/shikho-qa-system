-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 082 — PIP: show the real revenue figure for a manually-added candidate (Jamil, 2026-10-10).
-- Test in the Supabase SQL Editor before relying on it. Apply after 081.
--
-- schema_081's pip_add_candidate() deliberately left revenue_at_selection/revenue_unit_used/
-- revenue_window_* NULL — the reasoning at the time was "a manual add bypasses the benchmark
-- check entirely, so there is no revenue figure that DECIDED this", mirroring the existing
-- Manager-include-accept branch of pip_decide_request() (schema_046), which has the identical gap.
-- Jamil's real-world use of the feature showed that reasoning was wrong in practice: the admin
-- screen just shows a blank "—" next to every manually-added agent, which is a real loss of
-- context when deciding whether to approve them — whether an agent's revenue happens to be above
-- or below the benchmark is still useful to see, even though it isn't what put them on the list.
--
-- Fixed by COMPUTING the figure (same window/conversion generate_pip_candidates() already uses —
-- the previous full calendar month relative to the cycle's own month, USD via currency_rate_at)
-- and storing it, WITHOUT using it as a selection/filter criterion — an agent above the benchmark
-- is still added if asked to be. Fixed in both places a candidate can be added without the
-- benchmark run: pip_add_candidate() (schema_081, the direct admin add) and pip_decide_request()'s
-- include-accept branch (schema_046, a Manager-requested include) — same root cause, same fix,
-- so the identical gap doesn't resurface the next time someone uses the Manager-request path.
--
-- Backfilled: the 9 real candidates already added this way on the live October 2026 cycle, all
-- still 'suggested' (not yet approved/completed/failed) — never touches a FINAL/historical row,
-- consistent with this system's own "never rewrite frozen history" principle; there are currently
-- no null-revenue rows at any later status to worry about.
-- ============================================================

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
  v_w_start date;
  v_w_end date;
  v_from timestamptz;
  v_to timestamptz;
  v_rev numeric;
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

  -- Same window/conversion generate_pip_candidates() uses (schema_041/046) — shown for context
  -- only, never used to decide whether this add is allowed (that's the whole point of a manual
  -- add, per schema_081's own header comment).
  v_w_start := (v_cycle.month - interval '1 month')::date;
  v_w_end := v_cycle.month - 1;
  v_from := (v_w_start::timestamp) at time zone 'Asia/Dhaka';
  v_to := (v_cycle.month::timestamp) at time zone 'Asia/Dhaka';
  select coalesce(sum(t.revenue_amount / currency_rate_at(t.purchase_created_at)), 0) into v_rev
    from agent_revenue_transactions t
   where t.agent_id = p_agent_id and t.purchase_created_at >= v_from and t.purchase_created_at < v_to;

  -- A previously-excluded row for this (cycle, agent) already exists (pip_candidates has a unique
  -- (pip_cycle_id, agent_id) key) — restore it rather than insert a duplicate, same as
  -- pip_decide_request()'s include-accept branch — now also recording the computed revenue rather
  -- than leaving whatever (likely null) it had from before.
  update pip_candidates set status = 'suggested', exclusion_reason = null, excluded_by = null,
         revenue_at_selection = round(v_rev, 2), revenue_unit_used = 'USD',
         revenue_window_start = v_w_start, revenue_window_end = v_w_end
   where pip_cycle_id = p_cycle_id and agent_id = p_agent_id and status = 'excluded'
   returning id into v_id;
  if v_id is not null then return v_id; end if;

  insert into pip_candidates (pip_cycle_id, agent_id, team_name, site_name, vintage_weeks_at_selection, target_revenue,
                              revenue_at_selection, revenue_unit_used, revenue_window_start, revenue_window_end, status)
  values (p_cycle_id, p_agent_id, v_agent.team_name, v_agent.site_name,
          case when v_agent.joining_date is null then null else
            (v_cycle.start_date - (
               v_agent.joining_date + case when extract(dow from v_agent.joining_date)::int = 6 then 0
                                           else (6 - extract(dow from v_agent.joining_date)::int + 7) % 7 end
             )) / 7 end,
          v_policy.target_revenue,
          round(v_rev, 2), 'USD', v_w_start, v_w_end,
          'suggested')
  returning id into v_id;
  return v_id;
end $$;
revoke all on function pip_add_candidate(uuid, uuid) from public;
grant execute on function pip_add_candidate(uuid, uuid) to authenticated;

-- ── Same fix for the Manager-requested include path (schema_046's identical gap) ────────────────
create or replace function pip_decide_request(p_request_id uuid, p_action text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := current_app_user_id();
  v_req pip_manager_requests%rowtype;
  v_cycle pip_cycles%rowtype;
  v_policy pip_policies%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_agent users%rowtype;
  v_w_start date;
  v_w_end date;
  v_from timestamptz;
  v_to timestamptz;
  v_rev numeric;
begin
  if current_app_role() not in ('super_admin', 'qa_manager') then
    raise exception 'Only a Super Admin or QA Manager can decide a Manager''s request.';
  end if;
  if p_action not in ('accept', 'reject') then raise exception 'Choose accept or reject.'; end if;
  select * into v_req from pip_manager_requests where id = p_request_id for update;
  if not found then raise exception 'That request does not exist.'; end if;
  if v_req.status <> 'pending' then raise exception 'This request was already decided.'; end if;
  select * into v_cycle from pip_cycles where id = v_req.pip_cycle_id;
  if v_cycle.published_at is not null then raise exception 'This cycle has already been published.'; end if;

  if p_action = 'accept' then
    if v_req.request_type = 'exclude' then
      update pip_candidates set status = 'excluded', exclusion_reason = v_req.reason, excluded_by = v_me
       where pip_cycle_id = v_req.pip_cycle_id and agent_id = v_req.agent_id and status = 'suggested';
      if not found then raise exception 'This person is no longer a suggested candidate — someone else already changed their status.'; end if;
    else -- include
      if exists (select 1 from pip_candidates where pip_cycle_id = v_req.pip_cycle_id and agent_id = v_req.agent_id and status in ('suggested', 'approved')) then
        raise exception 'This person is already on the list.';
      end if;

      v_w_start := (v_cycle.month - interval '1 month')::date;
      v_w_end := v_cycle.month - 1;
      v_from := (v_w_start::timestamp) at time zone 'Asia/Dhaka';
      v_to := (v_cycle.month::timestamp) at time zone 'Asia/Dhaka';
      select coalesce(sum(t.revenue_amount / currency_rate_at(t.purchase_created_at)), 0) into v_rev
        from agent_revenue_transactions t
       where t.agent_id = v_req.agent_id and t.purchase_created_at >= v_from and t.purchase_created_at < v_to;

      -- A previously-excluded row for this (cycle, agent) already exists (pip_candidates has a unique
      -- (pip_cycle_id, agent_id) key) — restore it rather than insert a duplicate.
      update pip_candidates set status = 'suggested', exclusion_reason = null, excluded_by = null,
             revenue_at_selection = round(v_rev, 2), revenue_unit_used = 'USD',
             revenue_window_start = v_w_start, revenue_window_end = v_w_end
       where pip_cycle_id = v_req.pip_cycle_id and agent_id = v_req.agent_id and status = 'excluded';
      if not found then
        select * into v_agent from users where id = v_req.agent_id;
        select * into v_policy from pip_policies where id = v_cycle.policy_id;
        insert into pip_candidates (pip_cycle_id, agent_id, team_name, site_name, vintage_weeks_at_selection, target_revenue,
                                    revenue_at_selection, revenue_unit_used, revenue_window_start, revenue_window_end, status)
        values (v_req.pip_cycle_id, v_req.agent_id, v_agent.team_name, v_agent.site_name,
                case when v_agent.joining_date is null then null else
                  (v_cycle.start_date - (
                     v_agent.joining_date + case when extract(dow from v_agent.joining_date)::int = 6 then 0
                                                 else (6 - extract(dow from v_agent.joining_date)::int + 7) % 7 end
                   )) / 7 end,
                v_policy.target_revenue,
                round(v_rev, 2), 'USD', v_w_start, v_w_end,
                'suggested');
      end if;
    end if;
  end if;

  update pip_manager_requests
     set status = case p_action when 'accept' then 'accepted' else 'rejected' end,
         decided_by = v_me, decided_at = now(), decision_note = v_note
   where id = p_request_id;
end $$;
revoke all on function pip_decide_request(uuid, text, text) from public;
grant execute on function pip_decide_request(uuid, text, text) to authenticated;

-- ── Backfill: the real, currently-'suggested' candidates already added without a revenue figure ──
do $$
declare
  v_n int;
begin
  update pip_candidates pc
     set revenue_at_selection = round((
           select coalesce(sum(t.revenue_amount / currency_rate_at(t.purchase_created_at)), 0)
             from agent_revenue_transactions t
            where t.agent_id = pc.agent_id
              and t.purchase_created_at >= (((c.month - interval '1 month')::date)::timestamp) at time zone 'Asia/Dhaka'
              and t.purchase_created_at < ((c.month::timestamp) at time zone 'Asia/Dhaka')
         ), 2),
         revenue_unit_used = 'USD',
         revenue_window_start = (c.month - interval '1 month')::date,
         revenue_window_end = c.month - 1
    from pip_cycles c
   where c.id = pc.pip_cycle_id
     and pc.revenue_at_selection is null
     and pc.status in ('suggested', 'excluded');
  get diagnostics v_n = row_count;
  raise notice 'schema_082: backfilled revenue_at_selection on % existing PIP candidate(s)', v_n;
end $$;
