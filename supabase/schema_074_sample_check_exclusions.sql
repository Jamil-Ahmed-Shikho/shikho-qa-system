-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 074 — exclude Sample Checks (schema_073) from every plain
-- count()/max() that means "a real, scored audit happened" — audit
-- targets/coverage, "done this week", "last audited", and the
-- discontinuation-freeze snapshot. Apply after schema_073.
--
-- WHY A SEPARATE MIGRATION, not folded into 073: every "avg(score_percent)"
-- in this system (RYG, auditor ranking, …) already ignores a Sample Check
-- for free, since it never gets a score_percent and avg() skips nulls —
-- nothing to fix there. What does NOT skip for free is a plain count() or
-- max(submitted_at) with no null to lean on: qa_agent_queue()'s
-- done_this_week/last_audited_at, ojt_candidates()'s ojt_calls_this_week/
-- last_audited_at/re_training_call_done, manager_agent_stats()'s
-- audits_completed, and compute_weekly_audit_targets()'s mid-cycle
-- discontinuation freeze. Each is redefined here with the same signature
-- (create or replace — no drop needed) and an added
-- `and <alias>.check_mode = 'audit'` wherever it counts "audits done",
-- so a logged Sample Check can never silently inflate a target/coverage
-- number or push "last audited" forward without a real audit having
-- happened. compute_agent_status() (RYG) needed no change — see above.
-- ============================================================

-- ── qa_agent_queue(): done_this_week, last_audited_at ─────────
create or replace function qa_agent_queue(p_view text default 'mine')
returns table (
  agent_id uuid, name text, email text, team_name text, site_name text, employment_stage text, vintage_label text,
  team_leader_id uuid,
  has_target boolean, base_target int, bonus_applied boolean, bonus_reasons text[], final_target int, target_frozen boolean,
  done_this_week int,
  last_audited_at timestamptz, last_coached_at timestamptz,
  last_week_usd numeric, this_week_usd numeric, last_week_computed boolean, last_week_revenue_target_usd numeric,
  last_week_avg_score numeric, this_week_avg_score numeric,
  ryg text, critical_recent boolean, on_pip boolean, zero_streak int
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_me uuid := current_app_user_id();
  v_role text := current_app_role();
  v_week date := sales_week_start((now() at time zone 'Asia/Dhaka')::date);
  v_last date := v_week - 7;
  v_start timestamptz := (v_week::timestamp at time zone 'Asia/Dhaka');
  v_end timestamptz := ((v_week + 7)::timestamp at time zone 'Asia/Dhaka');
  v_lstart timestamptz := ((v_week - 7)::timestamp at time zone 'Asia/Dhaka');
  v_has_rate boolean := exists (select 1 from currency_conversion_rates);
  v_last_week_computed boolean := revenue_week_computed(v_last);
begin
  if v_role not in ('super_admin', 'qa_manager', 'qa_auditor', 'team_lead', 'manager') then return; end if;
  if p_view not in ('mine', 'team') then raise exception 'Choose My view or Team view.'; end if;

  return query
  select u.id, u.name, u.email, u.team_name, u.site_name, u.employment_stage,
         vintage_label_for_week(u.employment_stage, u.joining_date, (now() at time zone 'Asia/Dhaka')::date),
         u.team_leader_id,
         (w.id is not null), w.base_target, coalesce(w.bonus_applied, false), coalesce(w.bonus_reasons, '{}'::text[]), w.final_target,
         coalesce(w.target_frozen, false),
         (select count(*)::int from audits au where au.agent_id = u.id and au.status <> 'draft' and au.check_mode = 'audit' and au.submitted_at >= v_start and au.submitted_at < v_end),
         (select max(au.submitted_at) from audits au where au.agent_id = u.id and au.status <> 'draft' and au.check_mode = 'audit'),
         (select max(b.scheduled_at) from briefings b where b.agent_id = u.id and b.status = 'completed'),
         case when v_has_rate then (select coalesce(sum(t.revenue_amount / currency_rate_at(t.purchase_created_at)), 0)
                                      from agent_revenue_transactions t where t.agent_id = u.id and t.purchase_created_at >= v_lstart and t.purchase_created_at < v_start) end,
         case when v_has_rate then (select coalesce(sum(t.revenue_amount / currency_rate_at(t.purchase_created_at)), 0)
                                      from agent_revenue_transactions t where t.agent_id = u.id and t.purchase_created_at >= v_start) end,
         v_last_week_computed,
         revenue_target_for(u.employment_stage = 'ojt', vintage_label_for_week(u.employment_stage, u.joining_date, v_last), u.team_name, v_last),
         (select round(avg(au.score_percent), 1) from audits au where au.agent_id = u.id and au.status <> 'draft' and au.submitted_at >= v_lstart and au.submitted_at < v_start),
         (select round(avg(au.score_percent), 1) from audits au where au.agent_id = u.id and au.status <> 'draft' and au.submitted_at >= v_start and au.submitted_at < v_end),
         (select s.status from agent_current_status s where s.agent_id = u.id),
         coalesce((select s.critical_fatal_count > 0 from agent_current_status s where s.agent_id = u.id), false),
         exists (select 1 from pip_candidates pc join pip_cycles c on c.id = pc.pip_cycle_id
                  where pc.agent_id = u.id and pc.status = 'approved' and c.start_date <= v_week + 6 and c.end_date >= v_week),
         coalesce((select z.current_streak_weeks from agent_zero_seller_status z where z.agent_id = u.id), 0)
    from users u
    left join agent_weekly_audit_target w on w.agent_id = u.id and w.week_start = v_week
   where u.role = 'agent' and u.is_active and u.employment_stage in ('ojt', 'active')
     and (
       v_role in ('super_admin', 'qa_manager')
       or (v_role = 'qa_auditor' and (p_view = 'team' or u.quality_auditor_id = v_me))
       or (v_role = 'team_lead' and u.team_leader_id = v_me)
       or (v_role = 'manager' and u.id in (select a from manager_chain_ids() as a))
     )
   order by u.name;
end;
$$;
revoke all on function qa_agent_queue(text) from public;
grant execute on function qa_agent_queue(text) to authenticated;

-- ── ojt_candidates(): ojt_calls_this_week, re_training_call_done, last_audited_at ──
create or replace function ojt_candidates(p_view text default 'team')
returns table (
  agent_id uuid, name text, email text, team_name text, site_name text,
  team_leader_id uuid, team_leader_name text, trainer_name text, employment_stage text,
  ojt_start_date date, days_in_stage int,
  re_training_start_date date, re_training_end_date date, re_training_days_left int,
  ojt_calls_this_week int, ojt_target int,
  re_training_call_done boolean,
  last_audited_at timestamptz, last_coached_at timestamptz,
  last_week_usd numeric, this_week_usd numeric, last_week_computed boolean,
  last_week_avg_score numeric, this_week_avg_score numeric
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_role text := current_app_role();
  v_me uuid := current_app_user_id();
  v_week date := sales_week_start((now() at time zone 'Asia/Dhaka')::date);
  v_last date := v_week - 7;
  v_wk_start timestamptz := (v_week::timestamp at time zone 'Asia/Dhaka');
  v_wk_end timestamptz := ((v_week + 7)::timestamp at time zone 'Asia/Dhaka');
  v_lstart timestamptz := ((v_week - 7)::timestamp at time zone 'Asia/Dhaka');
  v_today date := (now() at time zone 'Asia/Dhaka')::date;
  v_has_rate boolean := exists (select 1 from currency_conversion_rates);
  v_last_week_computed boolean := revenue_week_computed(v_last);
begin
  if v_role not in ('super_admin', 'qa_manager', 'qa_auditor', 'team_lead', 'manager') then return; end if;
  if p_view not in ('mine', 'team') then raise exception 'Choose My view or Team view.'; end if;

  return query
  select u.id, u.name, u.email, u.team_name, u.site_name,
         u.team_leader_id, tl.name, tr.name, u.employment_stage,
         u.ojt_start_date,
         (v_today - coalesce(
            case when u.employment_stage = 're_training' then h.re_training_start_date end,
            u.ojt_start_date, u.created_at::date))::int,
         h.re_training_start_date, h.re_training_end_date,
         case when u.employment_stage = 're_training' and h.re_training_end_date is not null
              then greatest(0, (h.re_training_end_date - v_today))::int end,
         (select count(*)::int from audits a where a.agent_id = u.id and a.status <> 'draft' and a.check_mode = 'audit'
           and a.submitted_at >= v_wk_start and a.submitted_at < v_wk_end),
         audit_target_for(true, null, u.team_name, v_week),
         case when u.employment_stage = 're_training' and h.re_training_start_date is not null then exists (
                select 1 from audits a where a.agent_id = u.id and a.status <> 'draft' and a.check_mode = 'audit'
                 and a.submitted_at >= (h.re_training_start_date::timestamp at time zone 'Asia/Dhaka')
                 and a.submitted_at < ((h.re_training_end_date + 1)::timestamp at time zone 'Asia/Dhaka')
              ) end,
         (select max(a.submitted_at) from audits a where a.agent_id = u.id and a.status <> 'draft' and a.check_mode = 'audit'),
         (select max(b.scheduled_at) from briefings b where b.agent_id = u.id and b.status = 'completed'),
         case when v_has_rate then (select coalesce(sum(t.revenue_amount / currency_rate_at(t.purchase_created_at)), 0)
                                      from agent_revenue_transactions t where t.agent_id = u.id and t.purchase_created_at >= v_lstart and t.purchase_created_at < v_wk_start) end,
         case when v_has_rate then (select coalesce(sum(t.revenue_amount / currency_rate_at(t.purchase_created_at)), 0)
                                      from agent_revenue_transactions t where t.agent_id = u.id and t.purchase_created_at >= v_wk_start) end,
         v_last_week_computed,
         (select round(avg(a.score_percent), 1) from audits a where a.agent_id = u.id and a.status <> 'draft' and a.submitted_at >= v_lstart and a.submitted_at < v_wk_start),
         (select round(avg(a.score_percent), 1) from audits a where a.agent_id = u.id and a.status <> 'draft' and a.submitted_at >= v_wk_start and a.submitted_at < v_wk_end)
    from users u
    left join users tl on tl.id = u.team_leader_id
    left join users tr on tr.id = u.trainer_id
    left join lateral (
      select h2.re_training_start_date, h2.re_training_end_date
        from ojt_status_history h2
       where h2.agent_id = u.id and h2.to_stage = 're_training'
       order by h2.changed_at desc limit 1
    ) h on true
   where u.role = 'agent' and u.is_active and u.employment_stage in ('ojt', 're_training')
     and (
       v_role in ('super_admin', 'qa_manager')
       or (v_role = 'qa_auditor' and (p_view = 'team' or u.quality_auditor_id = v_me))
       or (v_role = 'team_lead' and u.team_leader_id = v_me)
       or (v_role = 'manager' and u.id in (select a from manager_chain_ids() as a))
     )
   order by u.employment_stage, u.name;
end;
$$;
revoke all on function ojt_candidates(text) from public;
grant execute on function ojt_candidates(text) to authenticated;

-- ── manager_agent_stats(): audits_completed (and everything derived from the same join) ──
create or replace function manager_agent_stats(
  p_manager_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  agent_id uuid,
  agent_name text,
  agent_email text,
  team_name text,
  site_name text,
  employment_stage text,
  is_active boolean,
  team_leader_id uuid,
  audits_completed bigint,
  score_sum numeric,
  audits_passed bigint,
  critical_fails bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    u.id,
    u.name,
    u.email,
    u.team_name,
    u.site_name,
    u.employment_stage,
    u.is_active,
    u.team_leader_id,
    count(a.id),
    coalesce(sum(a.score_percent), 0),
    count(a.id) filter (where a.passed),
    count(a.id) filter (where a.critical_fail)
  from users u
  left join audits a
    on a.agent_id = u.id
   and a.status <> 'draft'
   and a.check_mode = 'audit'
   and (p_from is null or a.submitted_at >= p_from)
   and (p_to is null or a.submitted_at < p_to)
  where u.role = 'agent'
    and u.id in (select c from manager_chain_ids(p_manager_id) as c)
  group by u.id, u.name, u.email, u.team_name, u.site_name, u.employment_stage, u.is_active, u.team_leader_id
  order by u.name
$$;
revoke all on function manager_agent_stats(uuid, timestamptz, timestamptz) from public;
grant execute on function manager_agent_stats(uuid, timestamptz, timestamptz) to authenticated;

-- ── compute_weekly_audit_targets(): the §9.5 discontinuation-freeze snapshot ──
-- Reproduced in full from schema_063 (Postgres replaces a function whole,
-- not line-by-line) with exactly ONE change: the freeze snapshot's count
-- of "what was already done this week" now excludes a Sample Check, the
-- same way qa_agent_queue()/ojt_candidates() above do.
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
    insert into agent_weekly_audit_target (agent_id, week_start, base_target, bonus_applied, bonus_reasons, final_target)
    select f.id, v_week, f.base_target, cardinality(f.reasons) > 0, f.reasons,
           f.base_target + case when cardinality(f.reasons) > 0 then 1 else 0 end
      from flagged f
     where not exists (select 1 from agent_weekly_audit_target w where w.agent_id = f.id and w.week_start = v_week)
    returning 1
  ), upd as (
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

  -- §9.5, the one changed line: excludes a Sample Check from "what was already done" (check_mode = 'audit').
  with fz as (
    update agent_weekly_audit_target w
       set final_target = (select count(*) from audits au where au.agent_id = w.agent_id and au.status <> 'draft'
                             and au.check_mode = 'audit' and au.submitted_at >= v_start and au.submitted_at < v_end),
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
