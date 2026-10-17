-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 098 — switchable holidays (Jamil, 2026-10-17): "this week we will
-- have duty on Saturday instead of Thursday" / "we may work additional 1
-- day as Working day". Apply after 097.
--
-- Confirmed with Jamil directly (not guessed): applies to (1) §9.4 audit
-- targets and (2) §5 coaching-session scheduling, NOT revenue targets; only
-- a SAME-WEEK swap is needed, never a cross-week one.
--
-- WHAT THIS ADDS
--   * holidays.kind ('holiday' | 'working_day', default 'holiday' so the
--     2 existing rows are unaffected) — one calendar, one picker per date,
--     the opposite of a holiday instead of a second table.
--   * §9.4's available_days formula nets working_day entries against
--     holiday entries WITHIN THE SAME WEEK: greatest(least(7 - holidays +
--     working_days, 7), 0). A Claude-made call, flagged: this means a
--     working_day entry can only ever OFFSET a holiday that week, never
--     push capacity above the normal 7-day baseline — building genuine
--     above-baseline capacity (more than a full week's worth) is a
--     materially different, bigger feature Jamil didn't confirm asking for.
--   * briefings_valid_slot narrowed to the mechanical 15-min-grid/hour-
--     window shape only — day validity moves to a new trigger, since a
--     CHECK constraint can't query the holidays table. Fri/Sat open (or a
--     normally-open day closes) exactly when a working_day/holiday
--     override exists for the conducting auditor's own site (or an
--     all-sites entry) on that date; a site-specific entry wins over an
--     all-sites one for the same date.
--
-- A REAL, LIVE REGRESSION FIXED IN THE SAME MIGRATION: schema_094
-- (2026-10-12) rewrote compute_weekly_audit_targets() around the new
-- "red bonus looks at last week only" rule and, in doing so, silently
-- dropped the ENTIRE §9.4 holiday-adjustment block schema_063 had added —
-- confirmed against the live deployed function body (pg_get_functiondef),
-- not just file history. The two Durga Puja holidays already entered for
-- Oct 20-21 (inside the CURRENT sales week, which started today, Oct 17)
-- have had ZERO effect on this week's audit targets. This migration
-- restores the block into schema_094's current CTE shape (insert ... on
-- conflict do update, not 063's separate insert/update CTEs — they'd
-- diverged) rather than reverting to the old one, and extends it with the
-- working_day netting above.
-- ============================================================

alter table holidays add column kind text not null default 'holiday' check (kind in ('holiday', 'working_day'));

-- ── compute_weekly_audit_targets(): restore + extend the §9.4 step ─────
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
  v_last_start timestamptz := ((v_week - 7)::timestamp at time zone 'Asia/Dhaka');
  v_yellow_min numeric;
  v_written int;
  v_frozen int;
  v_norule int;
  v_holiday_trimmed int;
  v_has_rate boolean := exists (select 1 from currency_conversion_rates);
begin
  -- Same org-wide threshold RYG itself uses (schema_037) — the row in force when last week
  -- ended; fall back to the earliest recorded row if none existed that far back yet.
  select yellow_min into v_yellow_min
    from status_thresholds
   where rubric_id is null and effective_from <= v_start
   order by effective_from desc
   limit 1;
  if v_yellow_min is null then
    select yellow_min into v_yellow_min
      from status_thresholds
     where rubric_id is null
     order by effective_from asc
     limit 1;
  end if;

  with elig as (
    select a.id, a.team_name, (a.employment_stage = 'ojt') as is_ojt,
           vintage_label_for_week(a.employment_stage, a.joining_date, v_week) as label
      from users a
     where a.role = 'agent' and a.is_active and a.employment_stage in ('ojt', 'active')
  ), base as (
    select e.id, audit_target_for(e.is_ojt, e.label, e.team_name, v_week) as base_target from elig e
  ), last_week_audits as (
    -- The single most recently completed sales week's own submitted audits for each agent
    -- being considered for a target this week — a Sample Check never counts (check_mode).
    select b.id as agent_id,
           count(*) filter (where a2.status <> 'draft' and a2.check_mode = 'audit') as n,
           count(*) filter (where a2.status <> 'draft' and a2.check_mode = 'audit' and a2.critical_fail) as n_critical,
           avg(a2.score_percent) filter (where a2.status <> 'draft' and a2.check_mode = 'audit') as avg_score
      from base b
      left join audits a2 on a2.agent_id = b.id
        and a2.submitted_at >= v_last_start and a2.submitted_at < v_start
     group by b.id
  ), flagged as (
    select b.id, b.base_target,
           array_remove(array[
             case when exists (
                    select 1 from last_week_audits lw
                     where lw.agent_id = b.id
                       and (lw.n_critical > 0 or (lw.n > 0 and v_yellow_min is not null and lw.avg_score < v_yellow_min))
                  ) then 'red' end,
             case when exists (
                    select 1 from pip_candidates pc join pip_cycles c on c.id = pc.pip_cycle_id
                     where pc.agent_id = b.id and pc.status = 'approved' and c.start_date <= v_week + 6 and c.end_date >= v_week) then 'pip' end,
             case when exists (select 1 from agent_zero_seller_status z where z.agent_id = b.id and z.current_streak_weeks > 0) then 'zero_seller' end
           ], null) as reasons
      from base b where b.base_target is not null
  ), up as (
    insert into agent_weekly_audit_target (agent_id, week_start, base_target, bonus_applied, bonus_reasons, final_target)
    select f.id, v_week, f.base_target, cardinality(f.reasons) > 0, f.reasons,
           f.base_target + case when cardinality(f.reasons) > 0 then 1 else 0 end
      from flagged f
    on conflict (agent_id, week_start) do update
       set base_target = excluded.base_target, bonus_applied = excluded.bonus_applied, bonus_reasons = excluded.bonus_reasons,
           final_target = excluded.final_target, computed_at = now()
     where agent_weekly_audit_target.target_frozen = false
    returning 1
  )
  select count(*) into v_written from up;

  select count(*) into v_norule from users a
   where a.role = 'agent' and a.is_active and a.employment_stage in ('ojt', 'active')
     and audit_target_for(a.employment_stage = 'ojt', vintage_label_for_week(a.employment_stage, a.joining_date, v_week), a.team_name, v_week) is null;

  -- §9.4 holiday adjustment (+ same-week working-day offset, schema_098). Clear last run's
  -- flags first (a removed holiday/working-day must not leave a stale trim behind) —
  -- final_target was already reset to base+bonus by the `up` step above, so this starts clean.
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
           greatest(least(
             7
             - (select count(distinct h.holiday_date) from holidays h
                 where h.kind = 'holiday' and h.holiday_date >= v_week and h.holiday_date < v_week + 7
                   and (h.site_name = s.site_name or h.site_name is null))
             + (select count(distinct h.holiday_date) from holidays h
                 where h.kind = 'working_day' and h.holiday_date >= v_week and h.holiday_date < v_week + 7
                   and (h.site_name = s.site_name or h.site_name is null)),
             7), 0) as available_days
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
                                     where t.agent_id = a.agent_id and t.purchase_created_at >= v_last_start and t.purchase_created_at < v_start)
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
    'week_start', v_week, 'written', v_written, 'frozen', v_frozen,
    'agents_without_a_rule', v_norule, 'holiday_trimmed', v_holiday_trimmed
  );
end;
$$;
revoke all on function compute_weekly_audit_targets(timestamptz) from public;
grant execute on function compute_weekly_audit_targets(timestamptz) to service_role;

-- ── briefings: narrow the CHECK to pure mechanics, enforce day-openness via trigger ──
alter table briefings drop constraint briefings_valid_slot;
alter table briefings add constraint briefings_valid_slot check (
  (
    extract(hour from scheduled_at at time zone 'Asia/Dhaka') between 11 and 14
    or (extract(hour from scheduled_at at time zone 'Asia/Dhaka') = 15
        and extract(minute from scheduled_at at time zone 'Asia/Dhaka') = 0)
  )
  and extract(minute from scheduled_at at time zone 'Asia/Dhaka')::int in (0, 15, 30, 45)
  and extract(second from scheduled_at at time zone 'Asia/Dhaka') = 0
);

create or replace function check_briefing_day_open()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date := (new.scheduled_at at time zone 'Asia/Dhaka')::date;
  v_dow int := extract(dow from new.scheduled_at at time zone 'Asia/Dhaka');
  v_site text;
  v_kind text;
  v_open boolean;
begin
  select site_name into v_site from users where id = new.conducted_by;

  select kind into v_kind from holidays
   where holiday_date = v_date and (site_name = v_site or site_name is null)
   order by (site_name is null) asc  -- a site-specific row wins over an all-sites row for the same date
   limit 1;

  v_open := v_dow between 0 and 4;  -- default: Sun-Thu open, Fri/Sat closed
  if v_kind = 'holiday' then v_open := false;
  elsif v_kind = 'working_day' then v_open := true;
  end if;

  if not v_open then
    raise exception 'That date is not open for coaching sessions.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function check_briefing_day_open() from public;

create trigger enforce_briefing_day_open
  before insert or update of scheduled_at on briefings
  for each row execute function check_briefing_day_open();
