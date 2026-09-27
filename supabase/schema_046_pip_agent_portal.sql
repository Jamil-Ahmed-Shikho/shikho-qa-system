-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 046 — PIP rebuild, Stage 6: the agent-facing portal view (§6.4, Section C).
-- Test in the Supabase SQL Editor before relying on it. Apply after 045.
--
-- "Once published, the agent sees their own PIP status in-app — period, target, achievement, and
-- the incentive-downgrade note (Stage 4)." Period and the downgrade note are already on the
-- candidate row; achievement is computed on read from agent_revenue_usd() (schema_029, unchanged),
-- reusing the existing pip_candidates_select_self RLS policy (agent, approved-or-later only) and
-- pip_cycles_select_via_candidates (dates, once a candidate is visible) — no new RLS was needed for
-- either of those. TARGET is the one thing missing: pip_policies.target_revenue is QA-staff-only
-- (pip_policies_select_qa), so an agent cannot read the target through the policy table at all.
--
-- Fix, the same "freeze it at the moment it was decided" pattern as revenue_at_selection /
-- vintage_weeks_at_selection / revenue_unit_used: pip_candidates.target_revenue records the
-- policy's target_revenue AT THE MOMENT the candidate was added to a cycle (generate_pip_candidates,
-- or a Manager-requested include accepted by QA) — readable by the agent through the same
-- pip_candidates_select_self policy already in place, and immune to a LATER policy change the same
-- way every other "at_selection" field already is (§6.4's "never rewrite history" principle).
-- ============================================================

alter table pip_candidates add column if not exists target_revenue numeric;

-- ── Backfill: every existing approved-or-later candidate gets the target_revenue their cycle's
-- policy actually specified, since that already applied to them in reality ────────────────────────
do $$
declare
  v_n int;
begin
  update pip_candidates pc set target_revenue = pol.target_revenue
    from pip_cycles c join pip_policies pol on pol.id = c.policy_id
   where c.id = pc.pip_cycle_id and pc.target_revenue is null
     and pc.status in ('suggested', 'excluded', 'approved', 'completed', 'failed');
  get diagnostics v_n = row_count;
  raise notice 'schema_046: backfilled target_revenue on % existing PIP candidate(s)', v_n;
end $$;

-- ── generate_pip_candidates(): record the target at the moment of suggestion ────────────────────
create or replace function generate_pip_candidates(p_cycle_id uuid, p_acknowledge_partial_revenue boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle pip_cycles%rowtype;
  v_policy pip_policies%rowtype;
  v_w_start date;
  v_w_end date;
  v_from timestamptz;
  v_to timestamptz;
  v_events bigint;
  v_attributed bigint;
  v_share numeric;
  v_inserted int;
begin
  if current_app_role() not in ('super_admin', 'qa_manager') then
    raise exception 'Only a Super Admin or QA Manager can generate PIP suggestions.';
  end if;
  select * into v_cycle from pip_cycles where id = p_cycle_id;
  if not found then raise exception 'That PIP cycle does not exist.'; end if;
  select * into v_policy from pip_policies where id = v_cycle.policy_id;

  if exists (select 1 from pip_candidates where pip_cycle_id = p_cycle_id) then
    raise exception 'Suggestions were already generated for this cycle.';
  end if;

  v_w_start := (v_cycle.month - interval '1 month')::date;
  v_w_end := v_cycle.month - 1;
  v_from := (v_w_start::timestamp) at time zone 'Asia/Dhaka';
  v_to := (v_cycle.month::timestamp) at time zone 'Asia/Dhaka';

  select count(*), count(*) filter (where agent_id is not null) into v_events, v_attributed
    from agent_revenue_transactions where purchase_created_at >= v_from and purchase_created_at < v_to;
  v_share := case when v_events = 0 then 0 else round(100.0 * v_attributed / v_events, 1) end;
  if not coalesce(p_acknowledge_partial_revenue, false) then
    raise exception 'Only % %% of the % sales in this window are matched to an agent; the rest count for nobody, so agents can look lower than they really are. Confirm you understand this to continue.', v_share, v_events;
  end if;

  with revenue as (
    select a.id as agent_id, a.team_name, a.site_name, a.joining_date,
           (v_cycle.start_date - (
              a.joining_date + case when extract(dow from a.joining_date)::int = 6 then 0
                                     else (6 - extract(dow from a.joining_date)::int + 7) % 7 end
            )) / 7 as tenure_weeks,
           coalesce(sum(t.revenue_amount / currency_rate_at(t.purchase_created_at)), 0) as rev
      from users a
      left join agent_revenue_transactions t
        on t.agent_id = a.id and t.purchase_created_at >= v_from and t.purchase_created_at < v_to
     where a.role = 'agent' and a.is_active and a.employment_stage = 'active'
       and a.joining_date is not null
       and a.team_name = any(v_policy.scoped_teams)
       and not exists (
         select 1 from pip_candidates pc join pip_cycles c on c.id = pc.pip_cycle_id
          where pc.agent_id = a.id and pc.status = 'approved' and c.end_date >= v_cycle.start_date)
     group by a.id, a.team_name, a.site_name, a.joining_date
  ),
  eligible as (
    select * from revenue where tenure_weeks >= v_policy.vintage_min_weeks
  ),
  ranked as (
    select e.*, row_number() over (partition by e.team_name, coalesce(e.site_name, '(no site)') order by e.rev asc, e.agent_id) as rn
      from eligible e
     where e.rev < v_policy.revenue_benchmark
  ),
  ins as (
    insert into pip_candidates (pip_cycle_id, agent_id, team_name, site_name, revenue_at_selection, revenue_unit_used,
                                revenue_window_start, revenue_window_end, vintage_weeks_at_selection, target_revenue, status)
    select p_cycle_id, agent_id, team_name, site_name, round(rev, 2), 'USD', v_w_start, v_w_end,
           tenure_weeks, v_policy.target_revenue, 'suggested'
      from ranked where rn <= v_policy.bottom_n_per_site
    returning 1
  )
  select count(*) into v_inserted from ins;

  return jsonb_build_object('inserted', v_inserted, 'attributed_share_pct', v_share, 'sales_in_window', v_events,
                            'window_start', v_w_start, 'window_end', v_w_end);
end $$;
revoke all on function generate_pip_candidates(uuid, boolean) from public;
grant execute on function generate_pip_candidates(uuid, boolean) to authenticated;

-- ── pip_decide_request(): a fresh row inserted via an accepted Manager include-request also
-- records the target (it was missing this before -- the only OTHER place a pip_candidates row is
-- ever inserted) ────────────────────────────────────────────────────────────────────────────────
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
      -- A previously-excluded row for this (cycle, agent) already exists (pip_candidates has a unique
      -- (pip_cycle_id, agent_id) key) — restore it rather than insert a duplicate.
      update pip_candidates set status = 'suggested', exclusion_reason = null, excluded_by = null
       where pip_cycle_id = v_req.pip_cycle_id and agent_id = v_req.agent_id and status = 'excluded';
      if not found then
        select * into v_agent from users where id = v_req.agent_id;
        select * into v_policy from pip_policies where id = v_cycle.policy_id;
        insert into pip_candidates (pip_cycle_id, agent_id, team_name, site_name, vintage_weeks_at_selection, target_revenue, status)
        values (v_req.pip_cycle_id, v_req.agent_id, v_agent.team_name, v_agent.site_name,
                case when v_agent.joining_date is null then null else
                  (v_cycle.start_date - (
                     v_agent.joining_date + case when extract(dow from v_agent.joining_date)::int = 6 then 0
                                                 else (6 - extract(dow from v_agent.joining_date)::int + 7) % 7 end
                   )) / 7 end,
                v_policy.target_revenue,
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
