-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 041 — PIP rebuild: the revenue window is a FIXED calendar rule, not a policy setting
-- (2026-09-27, Jamil, a correction to Stage 2/schema_040). Apply after 040.
--
-- CONFIRMED: the revenue window is no longer an admin-configurable number of weeks. It is always
-- the PREVIOUS FULL CALENDAR MONTH relative to whichever month the cycle is for — a cycle for
-- October looks at all of September's revenue; a November cycle looks at all of October's.
-- `pip_policies.revenue_window_weeks` is dropped entirely (nothing left to set, so nothing left to
-- refuse-to-run without) — `generate_pip_candidates()` now always knows the window, derived from
-- `pip_cycles.month` (already "the 1st of the cycle's month"). Currency (USD, schema_040) unchanged.
-- ============================================================

alter table pip_policies drop constraint pip_policies_window;
alter table pip_policies drop column revenue_window_weeks;

-- ── set_pip_policy(): drop the old 8-argument shape first (§14 — the argument count changes) ──
drop function if exists set_pip_policy(numeric, int, int, numeric, int, int, text, text[]);
create or replace function set_pip_policy(
  p_revenue_benchmark numeric, p_vintage_min_weeks int, p_duration_weeks int,
  p_target_revenue numeric, p_bottom_n_per_site int,
  p_revenue_unit text default null, p_scoped_teams text[] default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_prev_scope text[];
  v_scope text[];
begin
  if current_app_role() not in ('super_admin', 'qa_manager') then
    raise exception 'Only a Super Admin or QA Manager can change the PIP policy.';
  end if;
  select scoped_teams into v_prev_scope from pip_policies where effective_to is null;
  v_scope := coalesce(p_scoped_teams, v_prev_scope, array['Telesales']);
  if cardinality(v_scope) = 0 then raise exception 'Choose at least one team/channel for PIP to apply to.'; end if;
  if not (v_scope <@ array['Telesales', 'CX Non-Voice', 'CX Inbound', 'Engagement', 'Retention', 'TS3P']) then
    raise exception 'Unknown team/channel in the PIP scope.';
  end if;

  update pip_policies set effective_to = now() where effective_to is null;
  insert into pip_policies (revenue_benchmark, vintage_min_weeks, duration_weeks, target_revenue, bottom_n_per_site,
                            revenue_unit, scoped_teams, created_by)
  values (p_revenue_benchmark, p_vintage_min_weeks, p_duration_weeks, p_target_revenue, p_bottom_n_per_site,
          coalesce(nullif(btrim(p_revenue_unit), ''), 'USD'), v_scope, current_app_user_id())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function set_pip_policy(numeric, int, int, numeric, int, text, text[]) from public;
grant execute on function set_pip_policy(numeric, int, int, numeric, int, text, text[]) to authenticated;

-- ── generate_pip_candidates(): the window is ALWAYS the calendar month before the cycle's month ──
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

  -- The previous FULL CALENDAR MONTH relative to the cycle's own month (v_cycle.month is always the
  -- 1st of that month) — e.g. an October cycle (month = 2026-10-01) looks at all of September.
  v_w_start := (v_cycle.month - interval '1 month')::date;   -- the 1st of the previous month
  v_w_end := v_cycle.month - 1;                              -- the last day of the previous month
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
           coalesce(sum(case v_policy.revenue_unit
                          when 'USD' then t.revenue_amount / currency_rate_at(t.purchase_created_at)
                          else t.revenue_amount end), 0) as rev
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
                                revenue_window_start, revenue_window_end, vintage_weeks_at_selection, status)
    select p_cycle_id, agent_id, team_name, site_name, round(rev, 2), v_policy.revenue_unit, v_w_start, v_w_end,
           tenure_weeks, 'suggested'
      from ranked where rn <= v_policy.bottom_n_per_site
    returning 1
  )
  select count(*) into v_inserted from ins;

  return jsonb_build_object('inserted', v_inserted, 'attributed_share_pct', v_share, 'sales_in_window', v_events,
                            'window_start', v_w_start, 'window_end', v_w_end);
end $$;
revoke all on function generate_pip_candidates(uuid, boolean) from public;
grant execute on function generate_pip_candidates(uuid, boolean) to authenticated;
