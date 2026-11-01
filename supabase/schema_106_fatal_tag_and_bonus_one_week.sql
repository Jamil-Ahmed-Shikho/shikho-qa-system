-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 106 — critical fatal: 1-week queue badge + bonus, RYG itself left
-- at its existing 4-week window. Apply after 105.
--
-- Jamil, 2026-11-01: a critical fatal was keeping an agent flagged
-- ("Critical fatal error" badge, top of the queue, +1 bonus audit) for up
-- to 4 weeks — it only cleared once the fatal aged out of the same
-- rolling 4-week window RYG itself uses. Confirmed: this should shrink to
-- roughly 1 week for the QUEUE BADGE and the BONUS specifically — RYG's
-- own Red/Yellow/Green status (and everything downstream of it — the
-- agent's own dashboard, PIP eligibility, every report) stays at 4 weeks,
-- unchanged, since that's a separately-confirmed rule (2026-09-27) used
-- in many more places than just this queue.
--
-- THE WINDOW: "last completed sales week + the current one" (the same
-- v_lstart..v_end boundaries qa_agent_queue() already computes for other
-- purposes) — a fatal that happens on day 1 of a sales week stays
-- flagged through the rest of that week plus all of next week (~2 weeks
-- max); one that happens on the last day stays flagged for ~1 week
-- (through next week only, once this week ends). No new "rolling N
-- calendar days" concept — reuses this system's existing sales-week
-- framing throughout.
--
-- THE BONUS SNAG, worked through with Jamil before building: "Red"
-- already grants the +1 bonus, and a fatal keeps someone Red for 4 weeks
-- (unchanged) — so shortening only the BADGE would not actually shorten
-- the BONUS, since it would keep firing via the existing 'red' reason for
-- the full 4 weeks regardless. Confirmed: the bonus should also
-- genuinely stop after ~1 week. Fixed by splitting the single 'red'
-- bonus reason into two:
--   'red_score' — Red driven PURELY by score_threshold (status_reason),
--     i.e. there is NO critical fatal anywhere in the 4-week RYG window
--     at all — unchanged behaviour, still 4-week, exactly as before.
--   'critical_fatal_recent' — a critical-fatal audit happened within the
--     same 1-week-ish window as the badge above — independent of RYG's
--     own 4-week Red determination.
-- An agent whose ONLY reason for being Red is a fatal that is now more
-- than ~1 week old (status_reason = 'critical_fatal_override', but no
-- fatal within the fresh window) gets NEITHER reason any more — they
-- still show Red on every RYG-driven screen (unchanged), they just no
-- longer carry the queue badge or the +1 bonus for it.
-- ============================================================

create or replace function qa_agent_queue(p_view text default 'mine')
returns table (
  agent_id uuid, name text, email text, team_name text, site_name text, employment_stage text, vintage_label text,
  team_leader_id uuid,
  quality_auditor_id uuid, quality_auditor_name text,
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
         u.quality_auditor_id, qa.name,
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
         -- 1-week-ish badge (schema_106): a critical fatal SUBMITTED in the trailing window, not a
         -- read of RYG's own 4-week critical_fatal_count any more.
         exists (
           select 1 from audits au where au.agent_id = u.id and au.status <> 'draft' and au.check_mode = 'audit'
             and au.critical_fail = true and au.submitted_at >= v_lstart and au.submitted_at < v_end
         ),
         exists (select 1 from pip_candidates pc join pip_cycles c on c.id = pc.pip_cycle_id
                  where pc.agent_id = u.id and pc.status = 'approved' and c.start_date <= v_week + 6 and c.end_date >= v_week),
         -- Zero-seller streak only means anything where a revenue target actually exists for this
         -- agent's team/vintage — a channel with no target configured (CX Non-Voice right now) has
         -- $0 revenue by design, not by underperformance (schema_104).
         case when revenue_target_for(u.employment_stage = 'ojt', vintage_label_for_week(u.employment_stage, u.joining_date, v_last), u.team_name, v_last) is not null
              then coalesce((select z.current_streak_weeks from agent_zero_seller_status z where z.agent_id = u.id), 0)
              else 0 end
    from users u
    left join agent_weekly_audit_target w on w.agent_id = u.id and w.week_start = v_week
    left join users qa on qa.id = u.quality_auditor_id
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
  v_bonus_lstart timestamptz := ((v_week - 7)::timestamp at time zone 'Asia/Dhaka');
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
             -- Red driven purely by score (no fatal anywhere in the 4-week RYG window) — unchanged,
             -- still a 4-week signal, since this has nothing to do with a fatal's own recency.
             case when exists (select 1 from agent_current_status s where s.agent_id = b.id and s.status = 'red' and s.status_reason = 'score_threshold') then 'red_score' end,
             -- A critical fatal submitted within the trailing ~1-week window (schema_106) — the
             -- bonus's own fatal-driven trigger, independent of how long RYG keeps them Red for it.
             case when exists (
                    select 1 from audits au where au.agent_id = b.id and au.status <> 'draft' and au.check_mode = 'audit'
                      and au.critical_fail = true and au.submitted_at >= v_bonus_lstart and au.submitted_at < v_end
                  ) then 'critical_fatal_recent' end,
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

-- One-time correction for the CURRENT sales week's still-open rows only (same reasoning as
-- schema_105's own correction — this is a bug fix, not a policy change, so it doesn't wait for
-- "next week" to apply; past weeks stay frozen as history; target_frozen rows are untouched).
-- Recomputes the full reasons set from scratch for every row that currently contains 'red',
-- using the exact logic above, and updates bonus_applied/final_target to match. Confirmed live
-- before writing this: 3 rows affected (Mst. Jubida Tasnim — bonus genuinely removed; Bristy
-- Khatun and Mekail Hossain — cosmetic relabel only, zero_seller already keeps their bonus).
with wk as (select sales_week_start((now() at time zone 'Asia/Dhaka')::date) as v_week),
bounds as (
  select v_week, (v_week - 7)::timestamp at time zone 'Asia/Dhaka' as v_lstart,
         ((v_week + 7)::timestamp at time zone 'Asia/Dhaka') as v_end
    from wk
),
affected as (
  select w.agent_id, w.base_target
    from agent_weekly_audit_target w, bounds b
   where w.week_start = b.v_week and w.target_frozen = false and 'red' = any(w.bonus_reasons)
),
recomputed as (
  select a.agent_id, a.base_target,
         array_remove(array[
           case when exists (select 1 from agent_current_status s where s.agent_id = a.agent_id and s.status = 'red' and s.status_reason = 'score_threshold') then 'red_score' end,
           case when exists (
                  select 1 from audits au, bounds b where au.agent_id = a.agent_id and au.status <> 'draft' and au.check_mode = 'audit'
                    and au.critical_fail = true and au.submitted_at >= b.v_lstart and au.submitted_at < b.v_end
                ) then 'critical_fatal_recent' end,
           case when exists (select 1 from pip_candidates pc join pip_cycles c on c.id = pc.pip_cycle_id
                               join bounds b on true
                              where pc.agent_id = a.agent_id and pc.status = 'approved' and c.start_date <= b.v_week + 6 and c.end_date >= b.v_week) then 'pip' end,
           case when exists (select 1 from agent_zero_seller_status z where z.agent_id = a.agent_id and z.current_streak_weeks > 0)
                 and exists (
                   select 1 from users u, bounds b
                    where u.id = a.agent_id
                      and revenue_target_for(u.employment_stage = 'ojt', vintage_label_for_week(u.employment_stage, u.joining_date, b.v_week - 7), u.team_name, b.v_week - 7) is not null
                 )
                then 'zero_seller' end
         ], null) as reasons
    from affected a
)
update agent_weekly_audit_target w
   set bonus_applied = cardinality(r.reasons) > 0,
       bonus_reasons = r.reasons,
       final_target = r.base_target + case when cardinality(r.reasons) > 0 then 1 else 0 end,
       computed_at = now()
  from recomputed r
 where w.agent_id = r.agent_id and w.week_start = (select v_week from wk);
