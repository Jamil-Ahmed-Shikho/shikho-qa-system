-- ============================================================
-- Extend qa_agent_queue() (schema_034, redefined by schema_066) for Jamil's
-- 2026-10-04 request: the same "Who to audit next" view, reused on the Team
-- Lead and Manager dashboards instead of each having its own, thinner agent
-- table. Three changes:
--   1. team_lead (own team, u.team_leader_id = caller — same pattern
--      ojt_candidates() already uses, schema_038/067) and manager (own
--      chain via manager_chain_ids(), schema_007) can now call this.
--      p_view is accepted but ignored for both, same as every other
--      function with this shape (§2: a Team Lead/Manager's scoping is
--      always the one view, never a toggle).
--   2. team_leader_id is now returned, so a Manager caller — whose scope
--      spans several Team Leads — can group rows client-side the exact
--      way manager_agent_stats() rows already do (rollup.ts).
--   3. last_week_avg_score / this_week_avg_score (the average score_percent
--      of submitted audits in each window, same windows done_this_week /
--      last_week_usd already use) — Jamil's own ask: "we can add last week
--      Avg Score and This week avg score with all QA, TL, Manager view."
--      Null when there is nothing to average, same convention as every
--      other "no data yet" figure here — never a false 0.
-- Apply after 069.
-- ============================================================

drop function if exists qa_agent_queue(text);

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
         (select count(*)::int from audits au where au.agent_id = u.id and au.status <> 'draft' and au.submitted_at >= v_start and au.submitted_at < v_end),
         (select max(au.submitted_at) from audits au where au.agent_id = u.id and au.status <> 'draft'),
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
