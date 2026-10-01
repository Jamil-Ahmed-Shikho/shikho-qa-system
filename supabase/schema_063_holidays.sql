-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 063 — Holiday calendar + §9.4 holiday-adjusted targets.
-- Apply after 062. Jamil, 2026-10-02: "Build it. should give a google
-- calendar view type where i can select date and mark holiday with note."
--
-- WHAT THIS ADDS
--   * holidays (§9's own sketch) — a date + name + optional note + site
--     (null = every site). Simple admin CRUD, not versioned: unlike a
--     rubric or threshold, a holiday never changes what already happened
--     (compute_weekly_audit_targets only ever writes the CURRENT sales
--     week, same "never rewrite a frozen past week" principle used
--     throughout this system), so there is nothing to supersede.
--   * compute_weekly_audit_targets() gains the §9.4 algorithm as its final
--     step, applied only to the CURRENT week's not-yet-frozen rows:
--       adjusted_total = round(sum(final_target) * available / 7)
--       shortfall absorbed from the BOTTOM of the §9.3 priority order first
--       (no critical fatal, not on a PIP, no zero-seller streak, best RYG,
--       best revenue achievement — i.e. the healthiest agents), each down
--       to a floor of 1, moving up the tiers only if still short.
--
-- A CLAUDE-MADE CALL, flagged rather than guessed: §9.4 says "sum of
-- base_targets" and "every agent keeps a floor of 1" / "Red / PIP /
-- Zero-Seller / low-revenue-achievement agents keep their full target as
-- long as mathematically possible". Read literally against just the
-- `base_target` column, that would mean cutting a Red/PIP/zero-seller
-- agent's BONUS (the +1 they get specifically for being Red/PIP/zero-
-- seller) before touching a healthy agent's base target at all — the
-- opposite of what the rule is clearly trying to protect. This instead
-- sums and trims FINAL_TARGET (base + bonus, i.e. what's actually owed
-- that week), which is consistent with "keep their full target" meaning
-- the number they'd otherwise owe. Flag if this reading is wrong.
--
-- "Normal working days" = 7 (the full Sat-Fri sales week) — not QA's own
-- Sun-Thu office week (§5) — since audits are scored against calls that
-- happen every day of the sales week, not QA's own attendance days.
-- available_working_days = 7 minus the count of DISTINCT holiday dates in
-- that week applying to the agent's site (site-specific, or site_name is
-- null = every site). A floor of 1 per agent falls out naturally (the cut
-- is capped at final_target - 1 per agent), so it needs no special case.
--
-- Reapplied IN FULL on every run within the week, same as the base target
-- (schema_034) — only the bonus is frozen (schema_035). Adding or removing
-- a holiday mid-week changes the adjustment for the rest of that week,
-- never a finished one.
-- ============================================================

-- ── The calendar ──────────────────────────────────────────────
create table holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null,
  name text not null check (length(trim(name)) > 0 and length(name) <= 100),
  note text check (note is null or length(note) <= 500),
  site_name text check (site_name is null or site_name in ('Dhaka', 'Jashore')),  -- null = every site
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create unique index uq_holidays on holidays (holiday_date, coalesce(site_name, ''));
create index idx_holidays_date on holidays (holiday_date);

alter table holidays enable row level security;
-- Read: the same QA roles that can already see target rules (§9) — this is operational planning data,
-- not something every role needs. Write: Super Admin / QA Manager only, same as every other target/policy table.
create policy holidays_select on holidays for select to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager', 'qa_auditor'));
create policy holidays_insert on holidays for insert to authenticated
  with check (current_app_role() in ('super_admin', 'qa_manager') and created_by = current_app_user_id());
create policy holidays_update on holidays for update to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager'))
  with check (current_app_role() in ('super_admin', 'qa_manager'));
create policy holidays_delete on holidays for delete to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager'));

-- ── compute_weekly_audit_targets(), now with the §9.4 step ──────
create or replace function compute_weekly_audit_targets(p_as_of timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week date := sales_week_start((p_as_of at time zone 'Asia/Dhaka')::date);
  v_start timestamptz := (v_week::timestamp at time zone 'Asia/Dhaka');
  v_end timestamptz := ((v_week + 7)::timestamp at time zone 'Asia/Dhaka');
  v_last date := v_week - 7;
  v_lstart timestamptz := (v_last::timestamp at time zone 'Asia/Dhaka');
  v_inserted int;
  v_updated int;
  v_frozen int;
  v_norule int;
  v_holiday_trimmed int;
  v_has_rate boolean := exists (select 1 from currency_conversion_rates);
begin
  with elig as (
    select a.id, a.team_name, (a.employment_stage = 'ojt') as is_ojt,
           vintage_label_for_week(a.employment_stage, a.joining_date, v_week) as label
      from users a
     where a.role = 'agent' and a.is_active and a.employment_stage in ('ojt', 'active')
  ), base as (
    select e.id, audit_target_for(e.is_ojt, e.label, e.team_name, v_week) as base_target from elig e
  ), flagged as (
    -- The bonus flags AS THEY STAND RIGHT NOW. Only ever used below for an agent's FIRST row of the week
    -- (the insert branch) — an existing row's bonus is left untouched (the update branch).
    select b.id, b.base_target,
           array_remove(array[
             case when exists (select 1 from agent_current_status s where s.agent_id = b.id and s.status = 'red') then 'red' end,
             case when exists (
                    select 1 from pip_candidates pc join pip_cycles c on c.id = pc.pip_cycle_id
                     where pc.agent_id = b.id and pc.status = 'approved' and c.start_date <= v_week + 6 and c.end_date >= v_week) then 'pip' end,
             case when exists (select 1 from agent_zero_seller_status z where z.agent_id = b.id and z.current_streak_weeks > 0) then 'zero_seller' end
           ], null) as reasons
      from base b where b.base_target is not null
  ), ins as (
    -- This agent's FIRST row for this sales week: the bonus is decided now and will not be re-derived again this week.
    insert into agent_weekly_audit_target (agent_id, week_start, base_target, bonus_applied, bonus_reasons, final_target)
    select f.id, v_week, f.base_target, cardinality(f.reasons) > 0, f.reasons,
           f.base_target + case when cardinality(f.reasons) > 0 then 1 else 0 end
      from flagged f
     where not exists (select 1 from agent_weekly_audit_target w where w.agent_id = f.id and w.week_start = v_week)
    returning 1
  ), upd as (
    -- A row already exists for this week: only base_target (and so final_target) may move, e.g. an admin's
    -- mid-week rule change — bonus_applied / bonus_reasons are FROZEN at whatever the first computation set.
    update agent_weekly_audit_target w
       set base_target = f.base_target,
           final_target = f.base_target + case when w.bonus_applied then 1 else 0 end,
           computed_at = now()
      from flagged f
     where w.agent_id = f.id and w.week_start = v_week and w.target_frozen = false
    returning 1
  )
  select (select count(*) from ins), (select count(*) from upd) into v_inserted, v_updated;

  select count(*) into v_norule from users a
   where a.role = 'agent' and a.is_active and a.employment_stage in ('ojt', 'active')
     and audit_target_for(a.employment_stage = 'ojt', vintage_label_for_week(a.employment_stage, a.joining_date, v_week), a.team_name, v_week) is null;

  -- §9.4 holiday adjustment. Clear last run's flags first (a removed holiday must not leave a stale trim behind) —
  -- final_target was already reset to base+bonus by the `upd` step above, so this starts from a clean slate.
  update agent_weekly_audit_target
     set holiday_adjusted = false,
         adjustment_reason = case when adjustment_reason = 'holiday_adjustment' then null else adjustment_reason end
   where week_start = v_week and target_frozen = false and holiday_adjusted = true;

  with elig_sites as (
    select distinct u.site_name
      from agent_weekly_audit_target w
      join users u on u.id = w.agent_id
     where w.week_start = v_week and w.target_frozen = false and u.site_name is not null
  ), site_days as (
    select s.site_name,
           greatest(7 - (select count(distinct h.holiday_date) from holidays h
                          where h.holiday_date >= v_week and h.holiday_date < v_week + 7
                            and (h.site_name = s.site_name or h.site_name is null)), 0) as available_days
      from elig_sites s
  ), affected as (
    select w.id as target_id, w.agent_id, w.final_target, u.site_name, u.employment_stage, u.joining_date, u.team_name,
           sd.available_days
      from agent_weekly_audit_target w
      join users u on u.id = w.agent_id
      join site_days sd on sd.site_name = u.site_name
     where w.week_start = v_week and w.target_frozen = false and sd.available_days < 7
  ), ranked as (
    select a.*,
           coalesce((select s.status from agent_current_status s where s.agent_id = a.agent_id), 'unrated') as ryg,
           coalesce((select s.critical_fatal_count > 0 from agent_current_status s where s.agent_id = a.agent_id), false) as is_critical,
           exists (select 1 from pip_candidates pc join pip_cycles c on c.id = pc.pip_cycle_id
                    where pc.agent_id = a.agent_id and pc.status = 'approved' and c.start_date <= v_week + 6 and c.end_date >= v_week) as is_pip,
           coalesce((select z.current_streak_weeks from agent_zero_seller_status z where z.agent_id = a.agent_id), 0) as zero_streak,
           case when not v_has_rate then 1.0
                else coalesce((
                  select case when revenue_target_for(a.employment_stage = 'ojt',
                                 vintage_label_for_week(a.employment_stage, a.joining_date, v_last), a.team_name, v_last) > 0
                              then (select coalesce(sum(t.revenue_amount / currency_rate_at(t.purchase_created_at)), 0)
                                      from agent_revenue_transactions t
                                     where t.agent_id = a.agent_id and t.purchase_created_at >= v_lstart and t.purchase_created_at < v_start)
                                   / revenue_target_for(a.employment_stage = 'ojt',
                                       vintage_label_for_week(a.employment_stage, a.joining_date, v_last), a.team_name, v_last)
                         end
                ), 1.0)
           end as revenue_achievement
      from affected a
  ), trim_order as (
    -- Ascending "trim first" order (§9.3 reversed): protect_tier 0 = no flags (Green/no PIP/no streak/no fatal) —
    -- trimmed first, highest revenue achievement within that tier trimmed before lower achievement. Each higher
    -- tier (zero-seller streak, PIP, critical fatal) is only reached once every lower tier is exhausted.
    select r.*,
           case when is_critical then 4 when is_pip then 3 when zero_streak > 0 then 2
                when ryg = 'red' then 1 else 0 end as protect_tier,
           row_number() over (partition by r.site_name
             order by (case when is_critical then 4 when is_pip then 3 when zero_streak > 0 then 2
                            when ryg = 'red' then 1 else 0 end) asc,
                      revenue_achievement desc, r.agent_id) as trim_seq
      from ranked r
  ), capacity as (
    select t.target_id, t.agent_id, t.site_name, t.trim_seq, greatest(t.final_target - 1, 0) as cap
      from trim_order t
  ), running as (
    select c.*,
           coalesce(sum(c.cap) over (partition by c.site_name order by c.trim_seq rows between unbounded preceding and 1 preceding), 0) as cap_before
      from capacity c
  ), site_totals as (
    select a.site_name, sum(a.final_target) as sum_final, min(a.available_days) as available_days
      from affected a group by a.site_name
  ), shortfalls as (
    select site_name, greatest(sum_final - round(sum_final * available_days / 7.0)::int, 0) as shortfall from site_totals
  ), cuts as (
    select r.target_id, r.agent_id, least(r.cap, greatest(sf.shortfall - r.cap_before, 0)) as cut_amount
      from running r join shortfalls sf on sf.site_name = r.site_name
  ), applied as (
    update agent_weekly_audit_target w
       set final_target = w.final_target - c.cut_amount,
           holiday_adjusted = true,
           adjustment_reason = case when c.cut_amount > 0 then 'holiday_adjustment' else w.adjustment_reason end,
           computed_at = now()
      from cuts c
     where w.id = c.target_id
    returning (c.cut_amount > 0) as was_cut
  )
  select count(*) filter (where was_cut) into v_holiday_trimmed from applied;

  -- §9.5: an agent discontinued mid-week owes nothing more this week — the target freezes at what was already done.
  with fz as (
    update agent_weekly_audit_target w
       set final_target = (select count(*) from audits au where au.agent_id = w.agent_id and au.status <> 'draft'
                             and au.submitted_at >= v_start and au.submitted_at < v_end),
           target_frozen = true, adjustment_reason = 'agent_discontinued', computed_at = now()
      from users u
     where u.id = w.agent_id and u.employment_stage = 'discontinued'
       and w.week_start = v_week and w.target_frozen = false
    returning 1
  )
  select count(*) into v_frozen from fz;

  return jsonb_build_object(
    'week_start', v_week, 'inserted', v_inserted, 'updated', v_updated, 'frozen', v_frozen,
    'agents_without_a_rule', v_norule, 'holiday_trimmed', v_holiday_trimmed
  );
end;
$$;
revoke all on function compute_weekly_audit_targets(timestamptz) from public;
grant execute on function compute_weekly_audit_targets(timestamptz) to service_role;
