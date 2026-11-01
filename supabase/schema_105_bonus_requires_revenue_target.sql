-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 105 — the weekly audit-target +1 bonus's "zero_seller" reason has
-- the exact same bug schema_104 just fixed for the zero-seller TAG: it
-- checked current_streak_weeks > 0 with no regard to whether a revenue
-- target is even configured for that agent's team/vintage. Apply after 104.
--
-- Found while fixing schema_104 (CX Non-Voice showing a Zero-Seller tag
-- with no revenue target ever set) — flagged as a separate, adjacent bug
-- (compute_weekly_audit_targets() is a different code path, not touched by
-- 104) and now closed on Jamil's "want to solve" follow-up.
--
-- Only the zero_seller REASON changes. 'red' and 'pip' are untouched —
-- being Red already has its own meaning independent of revenue (score/
-- fatal based, §6.2), and PIP approval is a deliberate QA decision, not a
-- side effect of an unset target.
--
-- Same signature/output as schema_035 — plain create or replace, no drop.
-- ============================================================

create or replace function compute_weekly_audit_targets(p_as_of timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week date := sales_week_start((p_as_of at time zone 'Asia/Dhaka')::date);
  v_last_week date := v_week - 7;
  v_start timestamptz := (v_week::timestamp at time zone 'Asia/Dhaka');
  v_end timestamptz := ((v_week + 7)::timestamp at time zone 'Asia/Dhaka');
  v_inserted int;
  v_updated int;
  v_frozen int;
  v_norule int;
begin
  with elig as (
    select a.id, a.team_name, a.employment_stage, a.joining_date, (a.employment_stage = 'ojt') as is_ojt,
           vintage_label_for_week(a.employment_stage, a.joining_date, v_week) as label
      from users a
     where a.role = 'agent' and a.is_active and a.employment_stage in ('ojt', 'active')
  ), base as (
    select e.id, e.team_name, e.employment_stage, e.joining_date, audit_target_for(e.is_ojt, e.label, e.team_name, v_week) as base_target from elig e
  ), flagged as (
    -- The bonus flags AS THEY STAND RIGHT NOW. Only ever used below for an agent's FIRST row of the week
    -- (the insert branch) — an existing row's bonus is left untouched (the update branch).
    select b.id, b.base_target,
           array_remove(array[
             case when exists (select 1 from agent_current_status s where s.agent_id = b.id and s.status = 'red') then 'red' end,
             case when exists (
                    select 1 from pip_candidates pc join pip_cycles c on c.id = pc.pip_cycle_id
                     where pc.agent_id = b.id and pc.status = 'approved' and c.start_date <= v_week + 6 and c.end_date >= v_week) then 'pip' end,
             -- Zero-seller only means anything where a revenue target actually exists for this agent's
             -- team/vintage — same rule as the Zero-Seller tag itself (schema_104).
             case when exists (select 1 from agent_zero_seller_status z where z.agent_id = b.id and z.current_streak_weeks > 0)
                   and revenue_target_for(b.employment_stage = 'ojt', vintage_label_for_week(b.employment_stage, b.joining_date, v_last_week), b.team_name, v_last_week) is not null
                  then 'zero_seller' end
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

  return jsonb_build_object('week_start', v_week, 'inserted', v_inserted, 'updated', v_updated, 'frozen', v_frozen, 'agents_without_a_rule', v_norule);
end;
$$;
revoke all on function compute_weekly_audit_targets(timestamptz) from public;
grant execute on function compute_weekly_audit_targets(timestamptz) to service_role;

-- One-time correction for the CURRENT sales week only — this was a bug, not a legitimate status
-- change, so it doesn't fall under schema_035's "a status change is reflected starting next week"
-- rule (that rule is for a REAL change in status; this never was zero-seller-eligible in the first
-- place). Past weeks are untouched — those stay frozen as history, same principle as everywhere
-- else in this system. target_frozen rows are untouched too (already locked, e.g. a discontinued
-- agent this week) — this only corrects a row still open to normal recompute.
-- Confirmed live before writing this: exactly 3 agents affected (Al Akram Hossen, Md. Jannatul Alam
-- Siam, Shadman Sakib Zaman — all CX Non-Voice, all base_target=2/final_target=3/bonus_reasons=
-- {zero_seller} only).
update agent_weekly_audit_target w
   set bonus_applied = false, bonus_reasons = '{}'::text[], final_target = w.base_target, computed_at = now()
  from users u
 where u.id = w.agent_id
   and w.week_start = sales_week_start((now() at time zone 'Asia/Dhaka')::date)
   and w.bonus_applied = true
   and w.bonus_reasons = array['zero_seller']::text[]
   and w.target_frozen = false
   and revenue_target_for(u.employment_stage = 'ojt',
         vintage_label_for_week(u.employment_stage, u.joining_date, sales_week_start((now() at time zone 'Asia/Dhaka')::date) - 7),
         u.team_name,
         sales_week_start((now() at time zone 'Asia/Dhaka')::date) - 7) is null;
