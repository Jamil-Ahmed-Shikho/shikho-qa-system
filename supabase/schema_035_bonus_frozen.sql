-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 035 — the +1 bonus (Red / PIP / Zero-Seller) is computed ONCE per
-- agent per week and frozen, never re-evaluated mid-week (§9.2 correction,
-- Jamil 2026-09-27). Apply after 034.
--
-- THE CORRECTION: compute_weekly_audit_targets() (schema_034) re-derived
-- bonus_applied / bonus_reasons on every run, so an agent's daily target
-- could silently change mid-week as their Red/PIP/Zero-Seller status
-- changed. Jamil: "A QA's weekly number must be knowable and fixed from
-- day one, not something that silently shifts." Now:
--   * the FIRST computation of a sales week for an agent decides the bonus
--     for that whole week, using whatever status exists at that moment;
--   * every later run in the SAME week may still refresh base_target (an
--     admin's mid-week rule change still applies, per Jamil's earlier
--     answer that "target modification... doesn't affect previous
--     records" — only PAST weeks are protected, not the one in progress)
--     but leaves bonus_applied / bonus_reasons exactly as first set;
--   * a status change (newly Red, newly on a PIP, newly/no-longer a
--     zero-seller) is reflected starting the FOLLOWING week's first run.
-- §9.5 (discontinuation freezes the whole row) is unchanged.
-- ============================================================

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
  v_inserted int;
  v_updated int;
  v_frozen int;
  v_norule int;
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
