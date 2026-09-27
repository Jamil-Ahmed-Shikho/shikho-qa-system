-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 040 — PIP rebuild, Stage 2: eligibility & benchmark settings (§6.4, Section C, Q8).
-- Test in the Supabase SQL Editor before relying on it. Requires 027 (PIP) and 039 (team
-- consolidation, so 'BPO' is gone from the team list). Apply after 039.
--
-- CONFIRMED (Jamil, 2026-09-27):
--   * Vintage check becomes 8 COMPLETED SALES WEEKS of tenure (not calendar days), checked at
--     cycle start — `vintage_min_days` is renamed `vintage_min_weeks` (60 -> 8).
--   * Benchmark $400 USD and pass target $300 USD — the currency question (previously left open,
--     "is 400 BDT or USD?") is SETTLED as USD. `revenue_unit` gets a NOT NULL DEFAULT 'USD' and
--     is decoupled from `revenue_window_weeks` (which stays independently nullable — HOW FAR BACK
--     to sum revenue is still a genuinely open number, not answered by this round of questions).
--     Both the benchmark and target numbers stay admin-modifiable (`set_pip_policy`, unchanged).
--   * Bottom-N groups by TEAM/CHANNEL, never raw site alone (schema_039's grouping rule) — the
--     actual key is (team_name, site_name), since Telesales genuinely differs by site (Dhaka vs
--     Jashore) while TS3P (site Dhaka) must never be pooled with Dhaka Telesales. Recording BOTH
--     on the candidate row (site_name already existed; team_name is new here).
--   * Scope (Q15): PIP applies only to an admin-configurable list of teams/channels — today just
--     Telesales (covering both Dhaka and Jashore), never hard-coded — so CX, Retention and TS3P
--     can be added later with no rebuild, the same shape as Campaigns' team scoping (§4 Part B1).
--   * Q10 (partial revenue): already satisfied by the existing bottom-N logic — a group with fewer
--     than N eligible agents (or zero) simply returns however many exist; nothing here needed to
--     change for that. Confirmed, not re-implemented.
-- ============================================================

-- ── Policy: rename + reinterpret the vintage column, settle the currency, add scope ──
-- The OLD constraints are dropped FIRST: the old `pip_policies_window` required revenue_window_weeks
-- and revenue_unit to be both-null-or-both-set, so setting unit='USD' below (while window stays
-- null, still genuinely unset) would violate it if it were still in force.
alter table pip_policies drop constraint pip_policies_window;
alter table pip_policies drop constraint pip_policies_ranges;

alter table pip_policies rename column vintage_min_days to vintage_min_weeks;
-- The untouched original default (60, meaning days) is corrected to the confirmed 8 (meaning
-- weeks) — any OTHER value was a deliberate admin change and is left exactly as it was, since it
-- now means weeks, not days (flagged here for whoever applies this to double-check that number).
update pip_policies set vintage_min_weeks = 8 where effective_to is null and vintage_min_weeks = 60;

update pip_policies set revenue_unit = 'USD' where effective_to is null and revenue_unit is null;
alter table pip_policies alter column revenue_unit set default 'USD';
alter table pip_policies alter column revenue_unit set not null;

alter table pip_policies add column if not exists scoped_teams text[];
update pip_policies set scoped_teams = '{Telesales}' where effective_to is null and scoped_teams is null;
alter table pip_policies alter column scoped_teams set default '{Telesales}';
alter table pip_policies alter column scoped_teams set not null;

alter table pip_policies add constraint pip_policies_window check (
  revenue_window_weeks is null or revenue_window_weeks between 1 and 26
);
alter table pip_policies add constraint pip_policies_ranges check (
  revenue_benchmark > 0 and vintage_min_weeks >= 0 and duration_weeks between 1 and 12
  and target_revenue >= 0 and bottom_n_per_site between 1 and 100
);
alter table pip_policies add constraint pip_policies_scope_ok check (
  cardinality(scoped_teams) > 0
  and scoped_teams <@ array['Telesales', 'CX Non-Voice', 'CX Inbound', 'Engagement', 'Retention', 'TS3P']
);

-- ── Candidates: rename to match, record team_name alongside the existing site_name ──
alter table pip_candidates rename column vintage_days_at_selection to vintage_weeks_at_selection;
alter table pip_candidates add column if not exists team_name text;

-- ── set_pip_policy(): the argument count changes (7 -> 8), so drop the old one first (§14) — a
-- CREATE OR REPLACE with a different signature would silently create an OVERLOAD instead of
-- replacing it, leaving the old 7-argument function callable and quietly out of step with this one.
-- p_scoped_teams = null means "keep the previous policy's scope unchanged" — an app-layer caller
-- upgraded to the new 8th argument sends its actual scope; nothing still calls the 7-arg shape.
drop function if exists set_pip_policy(numeric, int, int, numeric, int, int, text);
create or replace function set_pip_policy(
  p_revenue_benchmark numeric, p_vintage_min_weeks int, p_duration_weeks int,
  p_target_revenue numeric, p_bottom_n_per_site int,
  p_revenue_window_weeks int default null, p_revenue_unit text default null,
  p_scoped_teams text[] default null
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
                            revenue_window_weeks, revenue_unit, scoped_teams, created_by)
  values (p_revenue_benchmark, p_vintage_min_weeks, p_duration_weeks, p_target_revenue, p_bottom_n_per_site,
          p_revenue_window_weeks, coalesce(nullif(btrim(p_revenue_unit), ''), 'USD'), v_scope, current_app_user_id())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function set_pip_policy(numeric, int, int, numeric, int, int, text, text[]) from public;
grant execute on function set_pip_policy(numeric, int, int, numeric, int, int, text, text[]) to authenticated;

-- ── generate_pip_candidates(): 8-completed-sales-weeks vintage, team scope, (team,site) grouping ──
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

  if v_policy.revenue_window_weeks is null then
    raise exception 'Set the revenue window (how many completed sales weeks to sum) on the PIP policy before suggesting candidates — it decides who looks "lowest", so it is not guessed.';
  end if;
  if exists (select 1 from pip_candidates where pip_cycle_id = p_cycle_id) then
    raise exception 'Suggestions were already generated for this cycle.';
  end if;

  v_w_end := v_cycle.start_date - 1;                                   -- the Friday before the cycle
  v_w_start := v_cycle.start_date - 7 * v_policy.revenue_window_weeks;  -- a Saturday
  v_from := (v_w_start::timestamp) at time zone 'Asia/Dhaka';
  v_to := ((v_w_end + 1)::timestamp) at time zone 'Asia/Dhaka';

  select count(*), count(*) filter (where agent_id is not null) into v_events, v_attributed
    from agent_revenue_transactions where purchase_created_at >= v_from and purchase_created_at < v_to;
  v_share := case when v_events = 0 then 0 else round(100.0 * v_attributed / v_events, 1) end;
  if not coalesce(p_acknowledge_partial_revenue, false) then
    raise exception 'Only % %% of the % sales in this window are matched to an agent; the rest count for nobody, so agents can look lower than they really are. Confirm you understand this to continue.', v_share, v_events;
  end if;

  with revenue as (
    select a.id as agent_id, a.team_name, a.site_name, a.joining_date,
           -- 8 COMPLETED SALES WEEKS of tenure, checked at cycle start (Q8): the cycle always starts
           -- on a Saturday (pip_cycles_starts_saturday), so counting from the agent's first FULLY
           -- worked sales week (the Saturday on/after joining_date — a week only counts once they
           -- were employed for the whole Sat-Fri span) to the cycle's start divides evenly by 7.
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
       -- not already inside a PIP that is still running when this one starts
       and not exists (
         select 1 from pip_candidates pc join pip_cycles c on c.id = pc.pip_cycle_id
          where pc.agent_id = a.id and pc.status = 'approved' and c.end_date >= v_cycle.start_date)
     group by a.id, a.team_name, a.site_name, a.joining_date
  ),
  eligible as (
    select * from revenue where tenure_weeks >= v_policy.vintage_min_weeks
  ),
  -- (team_name, site_name) IS the group — never site alone (a team spanning two sites, like
  -- Telesales, is genuinely two groups; a team sharing a site with another team, like TS3P and
  -- Dhaka Telesales, must never merge just because the site matches).
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

  -- Q10: no blocking, no minimum match percentage beyond the acknowledgement above — `inserted` is
  -- simply however many were actually eligible (0, 1, 2, ...), never an error for a small/empty pool.
  return jsonb_build_object('inserted', v_inserted, 'attributed_share_pct', v_share, 'sales_in_window', v_events,
                            'window_start', v_w_start, 'window_end', v_w_end);
end $$;
revoke all on function generate_pip_candidates(uuid, boolean) from public;
grant execute on function generate_pip_candidates(uuid, boolean) to authenticated;
