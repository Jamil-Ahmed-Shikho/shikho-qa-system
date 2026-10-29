-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 103 — qa_agent_queue() / ojt_candidates(): add quality_auditor_id
-- + quality_auditor_name, denormalized the same way team_leader_id/name
-- already are. Apply after 102.
--
-- Jamil, 2026-10-29: the Manager dashboard can drill into "By Team Lead ->
-- agent-wise data", and a QA Auditor already sees their own agent-wise
-- queue — but QA Manager/Super Admin had no equivalent "By QA Auditor ->
-- agent-wise data" view. This migration is the data-side half of that
-- (groupable by auditor); the page itself (This Week's QA Progress) is an
-- app-code change only.
--
-- Output column sets change, so both functions are dropped and recreated
-- (§14 — a changed RETURNS TABLE needs a drop first). Role gate, scoping,
-- filters and ordering are otherwise byte-for-byte unchanged.
-- ============================================================

drop function if exists qa_agent_queue(text);

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
         coalesce((select z.current_streak_weeks from agent_zero_seller_status z where z.agent_id = u.id), 0)
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

drop function if exists ojt_candidates(text);

create or replace function ojt_candidates(p_view text default 'team')
returns table (
  agent_id uuid, name text, email text, team_name text, site_name text,
  team_leader_id uuid, team_leader_name text, trainer_name text, employment_stage text,
  quality_auditor_id uuid, quality_auditor_name text,
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
         u.quality_auditor_id, qa.name,
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
    left join users qa on qa.id = u.quality_auditor_id
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
