-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 104 — Zero-seller status should never be shown for a channel
-- that has no configured revenue target. Apply after 103.
--
-- Jamil, 2026-11-01: CX Non-Voice (and any other team with no
-- revenue_target_rules row at all — Retention, Engagement right now)
-- has never had a revenue target set, yet agents there were showing a
-- "Zero-seller" tag everywhere, purely because is_zero_seller /
-- current_streak_weeks is computed from ACTUAL revenue ($0) with no
-- regard to whether a target was ever configured (recompute_weekly_sales(),
-- schema_022/030 — left unchanged here on purpose, see below).
--
-- Confirmed live before writing this: revenue_target_rules has zero rows
-- for CX Non-Voice, zero org-wide-default rows (team_name is null) —
-- revenue_target_for() genuinely returns null for that whole channel, not
-- a missed edge case. 3 real agents (28/28/15-week "streaks") were a
-- direct consequence.
--
-- Deliberately NOT changed: agent_zero_seller_status /
-- agent_weekly_sales.is_zero_seller themselves, and recompute_weekly_sales()
-- — "had zero attributed revenue this week" stays a plain, objective fact
-- worth keeping regardless of whether a target exists yet (useful the
-- moment a target IS set later, and for any future reporting). Only the
-- user-facing SURFACES of that fact — the queue's priority tier/badge,
-- and the dedicated Zero-Seller lists — are gated here on a target
-- actually existing.
--
-- qa_agent_queue()/qa_zero_seller_overview() keep their existing
-- signatures and output columns, so both are a plain CREATE OR REPLACE —
-- no drop needed. agents_without_revenue_target() is new: a small, narrow
-- helper so the two TypeScript services with the same plain-query pattern
-- (Team Lead's, Manager's own zero-seller lists) can filter without
-- reimplementing revenue_target_for()'s own logic in JS.
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
         coalesce((select s.critical_fatal_count > 0 from agent_current_status s where s.agent_id = u.id), false),
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

create or replace function qa_zero_seller_overview(p_view text default 'team')
returns table (
  agent_id uuid,
  agent_name text,
  team_name text,
  site_name text,
  current_streak_weeks int,
  streak_start_week date,
  last_sale_date date,
  vintage_label text,
  vintage_days int,
  days_since_last_sale int,
  last_sale_revenue_usd numeric
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_role text := current_app_role();
  v_me uuid := current_app_user_id();
  v_today date := (now() at time zone 'Asia/Dhaka')::date;
  v_last_week date := sales_week_start(v_today) - 7;
begin
  if v_role not in ('super_admin', 'qa_manager', 'qa_auditor') then
    return;
  end if;
  if p_view not in ('mine', 'team') then
    raise exception 'Choose My view or Team view.';
  end if;

  return query
  select u.id, u.name, u.team_name, u.site_name, z.current_streak_weeks, z.streak_start_week, z.last_sale_date,
         vintage_slab_for(u.employment_stage, u.joining_date, v_today),
         case when u.employment_stage in ('ojt', 're_training') or u.joining_date is null then null
              else (v_today - u.joining_date) end,
         case when z.last_sale_date is null then null else (v_today - z.last_sale_date) end,
         case when z.last_sale_date is null then null
              else coalesce(agent_revenue_usd(
                     u.id,
                     (z.last_sale_date::timestamp) at time zone 'Asia/Dhaka',
                     ((z.last_sale_date + 1)::timestamp) at time zone 'Asia/Dhaka'
                   ), 0)
         end
    from agent_zero_seller_status z
    join users u on u.id = z.agent_id
   where z.current_streak_weeks > 0
     and u.role = 'agent' and u.is_active and u.employment_stage = 'active'
     -- Same rule as qa_agent_queue() (schema_104): don't surface a streak for a team with no
     -- configured revenue target — $0 there isn't a signal of anything. vintage_label_for_week(),
     -- not vintage_slab_for() — the correct "as of a specific past week" lookup revenue_target_for()
     -- itself expects (§9 Part 1), not today's display label used elsewhere in this function.
     and revenue_target_for(false, vintage_label_for_week(u.employment_stage, u.joining_date, v_last_week), u.team_name, v_last_week) is not null
     and (v_role <> 'qa_auditor' or p_view = 'team' or u.quality_auditor_id = v_me)
   order by z.current_streak_weeks desc, u.name;
end;
$$;
revoke all on function qa_zero_seller_overview(text) from public;
grant execute on function qa_zero_seller_overview(text) to authenticated;

-- A small, narrow helper for the two services that build a zero-seller list via a plain query on
-- agent_zero_seller_status rather than a SECURITY DEFINER report function (Team Lead's and
-- Manager's own dashboards) — tells them which of a list of agent ids they ALREADY have legitimate
-- access to currently lack a configured revenue target, so they can filter without reimplementing
-- revenue_target_for()'s own vintage/team-matching logic in TypeScript. Only ever echoes back a
-- subset of ids the caller already supplied — nothing is discoverable beyond that, so no role gate.
create or replace function agents_without_revenue_target(p_agent_ids uuid[])
returns table (agent_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select u.id
    from users u
   where u.id = any(p_agent_ids)
     and revenue_target_for(
           u.employment_stage = 'ojt',
           vintage_label_for_week(u.employment_stage, u.joining_date, sales_week_start((now() at time zone 'Asia/Dhaka')::date) - 7),
           u.team_name,
           sales_week_start((now() at time zone 'Asia/Dhaka')::date) - 7
         ) is null
$$;
revoke all on function agents_without_revenue_target(uuid[]) from public;
grant execute on function agents_without_revenue_target(uuid[]) to authenticated;
