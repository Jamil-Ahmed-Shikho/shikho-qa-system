-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 111 — Don't count an agent toward audit targets before they've actually started
-- (Jamil, 2026-11-05: created OJT candidates with ojt_start_date = 7 Nov 2026, a future Saturday,
-- but they were already showing up in every QA Auditor's weekly target). Apply after 110.
-- Test in the Supabase SQL Editor before relying on it.
--
-- ROOT CAUSE: every function that decides "is this agent eligible for a target/workload figure"
-- uses the same fragment — role='agent', is_active, employment_stage in ('ojt','active') — with NO
-- check on whether the agent's OJT/employment has actually BEGUN yet. An OJT candidate's row is
-- created at ID-creation time with employment_stage='ojt' straight away (§2/§7), often days or
-- weeks before their real ojt_start_date, so the moment the row exists they were already being
-- counted. Checked every function in this codebase sharing that exact fragment (grepped every live
-- function body, not just the one screen Jamil was looking at — the §14 lesson about one root cause
-- needing to be found everywhere it's duplicated, not just where it was first noticed):
--
--   compute_weekly_audit_targets()   — the root writer: this is what created the wrong row at all.
--   qa_agent_queue()                 — "Who to audit next": would still have LISTED the agent as a
--                                       row even after the fix above, just with no target — not
--                                       what "don't add them yet" means, so fixed too.
--   qa_channel_progress()            — channel-wise target vs completion (QA Team Progress report).
--     Its own "audit_target" number would already have come out correct once compute_weekly_audit_
--     targets() stops writing the row (it SUMS agent_weekly_audit_target, nothing to sum) — fixed
--     anyway so "agents_count" (headcount) and the target/workload picture stay one consistent rule
--     everywhere, rather than two functions enforcing it and others quietly not.
--   qa_revenue_growth_by_channel()   — same "agents_count" headcount reasoning (revenue itself is
--     unaffected either way — a not-yet-started agent has none).
--   qa_auditor_ranking()             — Audit % and "agents_assigned": same reasoning as above.
--
-- For the current-single-week functions (compute_weekly_audit_targets, qa_agent_queue), eligible =
-- their start date falls on or before the LAST DAY of the week being computed (v_week + 6) — so
-- starting ANY day within that week still counts them from that week, only a start date in a FUTURE
-- week is excluded. For the period-range functions (qa_channel_progress, qa_revenue_growth_by_channel,
-- qa_auditor_ranking), the equivalent is "started before the period's own (exclusive) end, p_to" —
-- the same exclusive-upper-bound convention their own date filters already use throughout.
--
-- A null start date is treated as ELIGIBLE (no change from today), not excluded — defensive only:
-- confirmed live that every current 'ojt' row already has ojt_start_date set and every 'active' row
-- already has joining_date set (certification requires a non-future joining date, §7), so this
-- never actually fires today; it just means a future data-entry gap fails safe instead of silently
-- hiding someone.
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
       and (
         (a.employment_stage = 'active' and (a.joining_date is null or a.joining_date <= v_week + 6))
         or (a.employment_stage = 'ojt' and (a.ojt_start_date is null or a.ojt_start_date <= v_week + 6))
       )
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
     and (
       (a.employment_stage = 'active' and (a.joining_date is null or a.joining_date <= v_week + 6))
       or (a.employment_stage = 'ojt' and (a.ojt_start_date is null or a.ojt_start_date <= v_week + 6))
     )
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

create or replace function qa_agent_queue(p_view text default 'mine')
returns table (
  agent_id uuid, name text, email text, team_name text, site_name text, employment_stage text, vintage_label text,
  team_leader_id uuid, quality_auditor_id uuid, quality_auditor_name text, has_target boolean, base_target int,
  bonus_applied boolean, bonus_reasons text[], final_target int, target_frozen boolean, done_this_week int,
  last_audited_at timestamptz, last_coached_at timestamptz, last_week_usd numeric, this_week_usd numeric,
  last_week_computed boolean, last_week_revenue_target_usd numeric, last_week_avg_score numeric, this_week_avg_score numeric,
  ryg text, critical_recent boolean, on_pip boolean, zero_streak int
)
language plpgsql
security definer
set search_path = public
stable
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
       (u.employment_stage = 'active' and (u.joining_date is null or u.joining_date <= v_week + 6))
       or (u.employment_stage = 'ojt' and (u.ojt_start_date is null or u.ojt_start_date <= v_week + 6))
     )
     and (
       v_role in ('super_admin', 'qa_manager')
       or (v_role = 'qa_auditor' and (p_view = 'team' or u.quality_auditor_id = v_me))
       or (v_role = 'team_lead' and u.team_leader_id = v_me)
       or (v_role = 'manager' and u.id in (select a from manager_chain_ids() as a))
     )
   order by u.name;
end;
$$;

create or replace function qa_channel_progress(p_from timestamptz, p_to timestamptz, p_view text default 'team')
returns table (channel text, agents_count int, audits_done int, audit_target int, audits_pct numeric)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_role text := current_app_role();
  v_me uuid := current_app_user_id();
begin
  if v_role not in ('super_admin', 'qa_manager', 'qa_auditor') then
    return;
  end if;
  if p_to <= p_from then
    raise exception 'The period''s end must be after its start.';
  end if;
  if p_view not in ('mine', 'team') then
    raise exception 'Choose My view or Team view.';
  end if;

  return query
  with elig as (
    select u.id, case when u.employment_stage = 'ojt' then 'OJT' else u.team_name end as channel
      from users u
     where u.role = 'agent' and u.is_active and u.employment_stage in ('ojt', 'active')
       and (
         (u.employment_stage = 'active' and (u.joining_date is null or u.joining_date < p_to::date))
         or (u.employment_stage = 'ojt' and (u.ojt_start_date is null or u.ojt_start_date < p_to::date))
       )
       and (v_role <> 'qa_auditor' or p_view = 'team' or u.quality_auditor_id = v_me)
  ),
  channels as (
    select distinct elig.channel from elig where elig.channel is not null
  ),
  agents_count as (
    select elig.channel, count(*)::int as n from elig where elig.channel is not null group by elig.channel
  ),
  targets as (
    select e.channel, coalesce(sum(t.final_target), 0)::int as target
      from agent_weekly_audit_target t
      join elig e on e.id = t.agent_id
     where t.week_start >= p_from::date and t.week_start < p_to::date
     group by e.channel
  ),
  done as (
    -- check_mode = 'audit' — same fix as qa_auditor_ranking() above: a channel's "audits done"
    -- must not include Sample Checks.
    select e.channel, count(*)::int as n
      from audits a
      join elig e on e.id = a.agent_id
     where a.status = 'submitted' and a.check_mode = 'audit' and a.submitted_at >= p_from and a.submitted_at < p_to
     group by e.channel
  )
  select
    c.channel,
    coalesce(ac.n, 0),
    coalesce(d.n, 0),
    coalesce(tg.target, 0),
    case when coalesce(tg.target, 0) > 0
      then round(coalesce(d.n, 0)::numeric / tg.target * 100, 1)
      else null end
    from channels c
    left join agents_count ac on ac.channel = c.channel
    left join targets tg on tg.channel = c.channel
    left join done d on d.channel = c.channel
   order by c.channel;
end;
$$;

create or replace function qa_revenue_growth_by_channel(p_from timestamptz, p_to timestamptz, p_view text default 'team')
returns table (channel text, agents_count int, revenue_now_usd numeric, revenue_prior_usd numeric, growth_pct numeric)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_role text := current_app_role();
  v_me uuid := current_app_user_id();
  v_prior_from timestamptz;
begin
  if v_role not in ('super_admin', 'qa_manager', 'qa_auditor') then
    return;
  end if;
  if p_to <= p_from then
    raise exception 'The period''s end must be after its start.';
  end if;
  if p_view not in ('mine', 'team') then
    raise exception 'Choose My view or Team view.';
  end if;

  v_prior_from := p_from - (p_to - p_from);

  return query
  with elig as (
    select u.id, case when u.employment_stage = 'ojt' then 'OJT' else u.team_name end as channel
      from users u
     where u.role = 'agent' and u.is_active and u.employment_stage in ('ojt', 'active')
       and (
         (u.employment_stage = 'active' and (u.joining_date is null or u.joining_date < p_to::date))
         or (u.employment_stage = 'ojt' and (u.ojt_start_date is null or u.ojt_start_date < p_to::date))
       )
       and (v_role <> 'qa_auditor' or p_view = 'team' or u.quality_auditor_id = v_me)
  ),
  channels as (
    select distinct elig.channel from elig where elig.channel is not null
  ),
  agents_count as (
    select elig.channel, count(*)::int as n from elig where elig.channel is not null group by elig.channel
  ),
  now_rev as (
    select e.channel, coalesce(sum(agent_revenue_usd(e.id, p_from, p_to)), 0) as rev
      from elig e where e.channel is not null group by e.channel
  ),
  prior_rev as (
    select e.channel, coalesce(sum(agent_revenue_usd(e.id, v_prior_from, p_from)), 0) as rev
      from elig e where e.channel is not null group by e.channel
  )
  select
    c.channel,
    coalesce(ac.n, 0),
    coalesce(nr.rev, 0),
    coalesce(pr.rev, 0),
    case when coalesce(pr.rev, 0) > 0 then round((coalesce(nr.rev, 0) - pr.rev) / pr.rev * 100, 1) else null end
    from channels c
    left join agents_count ac on ac.channel = c.channel
    left join now_rev nr on nr.channel = c.channel
    left join prior_rev pr on pr.channel = c.channel
   order by c.channel;
end;
$$;

create or replace function qa_auditor_ranking(p_from timestamptz, p_to timestamptz, p_view text default 'team')
returns table (
  auditor_id uuid, auditor_name text, agents_assigned int, audits_done int, audit_target int, audit_pct numeric,
  coaching_completed int, coaching_scheduled int, coaching_target_total int, coaching_pct numeric,
  sales_growth_pct numeric, vintage_target_met_pct numeric, agent_recovery_pct numeric,
  zero_seller_recovery_pct numeric, pip_recovery_pct numeric, pip_concluded_this_month int, total_score numeric
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_role text := current_app_role();
  v_me uuid := current_app_user_id();
  v_prior_from timestamptz;
  v_weeks numeric;
  v_coaching_weekly_target int;
  v_w_audit numeric; v_w_coaching numeric; v_w_growth numeric;
  v_w_vintage numeric; v_w_recovery numeric; v_w_zero numeric;
  v_month_start timestamptz; v_month_end timestamptz;
begin
  if v_role not in ('super_admin', 'qa_manager', 'qa_auditor') then
    return;
  end if;
  if p_to <= p_from then
    raise exception 'The period''s end must be after its start.';
  end if;
  if p_view not in ('mine', 'team') then
    raise exception 'Choose My view or Team view.';
  end if;

  v_prior_from := p_from - (p_to - p_from);
  v_weeks := greatest(1, extract(epoch from (p_to - p_from)) / (7 * 24 * 3600));

  select t.weekly_target into v_coaching_weekly_target from qa_coaching_targets t where t.effective_to is null;
  select w.w_audit, w.w_coaching, w.w_sales_growth, w.w_vintage_target, w.w_agent_recovery, w.w_zero_seller
    into v_w_audit, v_w_coaching, v_w_growth, v_w_vintage, v_w_recovery, v_w_zero
    from qa_impact_weights w where w.effective_to is null;

  -- PIP Recovery is always "this calendar month", independent of the page's own period picker (see header note).
  v_month_start := date_trunc('month', now() at time zone 'Asia/Dhaka') at time zone 'Asia/Dhaka';
  v_month_end := (date_trunc('month', now() at time zone 'Asia/Dhaka') + interval '1 month') at time zone 'Asia/Dhaka';

  return query
  with auditors as (
    select u.id, u.name from users u where u.role = 'qa_auditor' and u.is_active
      and (v_role <> 'qa_auditor' or p_view = 'team' or u.id = v_me)
  ),
  agents as (
    -- Same eligibility rule as qa_agent_queue() / qa_channel_progress() (§6.2's Q7, schema_080;
    -- the not-yet-started OJT/joining-date exclusion, schema_111).
    select a.id as agent_id, a.quality_auditor_id
    from users a
    where a.role = 'agent' and a.quality_auditor_id is not null
      and a.is_active and a.employment_stage in ('ojt', 'active')
      and (
        (a.employment_stage = 'active' and (a.joining_date is null or a.joining_date < p_to::date))
        or (a.employment_stage = 'ojt' and (a.ojt_start_date is null or a.ojt_start_date < p_to::date))
      )
  ),
  audit_counts as (
    select ad.auditor_id, count(*)::int as n
    from audits ad
    where ad.status = 'submitted' and ad.check_mode = 'audit' and ad.submitted_at >= p_from and ad.submitted_at < p_to
    group by ad.auditor_id
  ),
  audit_targets as (
    select ag.quality_auditor_id as auditor_id, coalesce(sum(t.final_target), 0)::int as target
    from agent_weekly_audit_target t
    join agents ag on ag.agent_id = t.agent_id
    where t.week_start >= p_from::date and t.week_start < p_to::date
    group by ag.quality_auditor_id
  ),
  coaching_counts as (
    select b.conducted_by as auditor_id,
           count(*) filter (where b.status = 'completed')::int as completed,
           count(*) filter (where b.status <> 'cancelled')::int as scheduled
    from briefings b
    where b.scheduled_at >= p_from and b.scheduled_at < p_to
    group by b.conducted_by
  ),
  revenue_now as (
    select ag.quality_auditor_id as auditor_id, coalesce(sum(agent_revenue_usd(ag.agent_id, p_from, p_to)), 0) as rev
    from agents ag
    group by ag.quality_auditor_id
  ),
  revenue_prior as (
    select ag.quality_auditor_id as auditor_id, coalesce(sum(agent_revenue_usd(ag.agent_id, v_prior_from, p_from)), 0) as rev
    from agents ag
    group by ag.quality_auditor_id
  ),
  -- Vintage Target Met % (REVENUE-based, schema_093): one row per (agent, week) this auditor's
  -- agents had an audit-target row in the period (reused purely as "which weeks this agent was
  -- eligible in", not for its audit-count content) -> that week's vintage-wise USD revenue target
  -- (revenue_target_for, schema_034) and that week's actual USD revenue. Summed per agent across
  -- the whole period, then "met" = total actual >= total target (Jamil's confirmed aggregation,
  -- 2026-10-12) -> the auditor's % is agents-who-met ÷ agents-with-any-target-bearing-week.
  agent_weeks as (
    select distinct t.agent_id, t.week_start
      from agent_weekly_audit_target t
      join agents ag on ag.agent_id = t.agent_id
     where t.week_start >= p_from::date and t.week_start < p_to::date
  ),
  agent_week_revenue as (
    -- The Dhaka-midnight conversion matters: a bare date::timestamptz cast interprets the date
    -- in the session's own time zone (not necessarily Dhaka), the exact class of bug §14 warns
    -- about — use the same explicit (date::timestamp at time zone 'Asia/Dhaka') pattern every
    -- other sales-week boundary in this codebase uses (e.g. qa_agent_queue(), schema_034).
    select aw.agent_id, aw.week_start,
           revenue_target_for(u.employment_stage = 'ojt', vintage_label_for_week(u.employment_stage, u.joining_date, aw.week_start), u.team_name, aw.week_start) as wk_target,
           agent_revenue_usd(aw.agent_id, (aw.week_start::timestamp at time zone 'Asia/Dhaka'), ((aw.week_start + 7)::timestamp at time zone 'Asia/Dhaka')) as wk_actual
      from agent_weeks aw
      join users u on u.id = aw.agent_id
  ),
  agent_revenue_totals as (
    select agent_id,
           sum(wk_target) filter (where wk_target is not null) as total_target,
           sum(wk_actual) filter (where wk_target is not null) as total_actual,
           count(*) filter (where wk_target is not null) as target_weeks
      from agent_week_revenue
     group by agent_id
  ),
  vintage_revenue as (
    select ag.quality_auditor_id as auditor_id,
           count(*) filter (where art.target_weeks > 0) as agents_with_target,
           count(*) filter (where art.target_weeks > 0 and art.total_actual >= art.total_target) as agents_met
      from agents ag
      join agent_revenue_totals art on art.agent_id = ag.agent_id
     group by ag.quality_auditor_id
  ),
  -- Agent Recovery % (NEW, schema_093): of this auditor's agents who were Red or Yellow just
  -- before the period started, what % are Green as of their most recent status within the
  -- period — identical shape to Zero-Seller Recovery below, against RYG instead of sales.
  agent_recovery as (
    select ag.quality_auditor_id as auditor_id,
           count(*) as was_red_yellow,
           count(*) filter (where later.status = 'green') as recovered
      from agents ag
      join lateral (
        select s.status from agent_status_log s
        where s.agent_id = ag.agent_id and s.period_end < p_from::date
        order by s.period_end desc limit 1
      ) early on true
      left join lateral (
        select s2.status from agent_status_log s2
        where s2.agent_id = ag.agent_id and s2.period_end < p_to::date
        order by s2.period_end desc limit 1
      ) later on true
      where early.status in ('red', 'yellow')
      group by ag.quality_auditor_id
  ),
  zero_seller as (
    select ag.quality_auditor_id as auditor_id,
           count(*) as was_zero,
           count(*) filter (where later.is_zero_seller is false) as recovered
    from agents ag
    join lateral (
      select s.is_zero_seller from agent_weekly_sales s
      where s.agent_id = ag.agent_id and s.week_start < p_from::date
      order by s.week_start desc limit 1
    ) early on true
    left join lateral (
      select s2.is_zero_seller from agent_weekly_sales s2
      where s2.agent_id = ag.agent_id and s2.week_start < p_to::date
      order by s2.week_start desc limit 1
    ) later on true
    where early.is_zero_seller
    group by ag.quality_auditor_id
  ),
  -- PIP Recovery % — DECOUPLED from the page's period picker (always this calendar month, schema_093).
  pip_outcomes as (
    select ag.quality_auditor_id as auditor_id,
           count(*) as concluded,
           count(*) filter (where pc.status = 'completed') as recovered
    from pip_candidates pc
    join agents ag on ag.agent_id = pc.agent_id
    where pc.status in ('completed', 'failed') and pc.updated_at >= v_month_start and pc.updated_at < v_month_end
    group by ag.quality_auditor_id
  )
  select
    au.id,
    au.name,
    (select count(*) from agents ag2 where ag2.quality_auditor_id = au.id)::int as agents_assigned,
    coalesce(ac.n, 0) as audits_done,
    coalesce(at_.target, 0) as audit_target,
    case when coalesce(at_.target, 0) > 0 then round(coalesce(ac.n, 0)::numeric / at_.target * 100, 1) else null end as audit_pct,
    coalesce(cc.completed, 0) as coaching_completed,
    coalesce(cc.scheduled, 0) as coaching_scheduled,
    case when v_coaching_weekly_target is not null then round(v_coaching_weekly_target * v_weeks)::int else null end as coaching_target_total,
    case when v_coaching_weekly_target is not null and v_coaching_weekly_target * v_weeks > 0
         then round(coalesce(cc.completed, 0)::numeric / (v_coaching_weekly_target * v_weeks) * 100, 1) else null end as coaching_pct,
    case when rp.rev > 0 then round((rn.rev - rp.rev) / rp.rev * 100, 1) else null end as sales_growth_pct,
    case when vr.agents_with_target > 0 then round(vr.agents_met::numeric / vr.agents_with_target * 100, 1) else null end as vintage_target_met_pct,
    case when ar.was_red_yellow > 0 then round(ar.recovered::numeric / ar.was_red_yellow * 100, 1) else null end as agent_recovery_pct,
    case when zs.was_zero > 0 then round(zs.recovered::numeric / zs.was_zero * 100, 1) else null end as zero_seller_recovery_pct,
    case when po.concluded > 0 then round(po.recovered::numeric / po.concluded * 100, 1) else null end as pip_recovery_pct,
    coalesce(po.concluded, 0)::int as pip_concluded_this_month,
    (
      select case when sum(x.weight) > 0 then round(sum(x.weight * x.value) / sum(x.weight), 1) else null end
      from (values
        (v_w_audit, case when coalesce(at_.target, 0) > 0 then least(100, coalesce(ac.n, 0)::numeric / at_.target * 100) else null end),
        (v_w_coaching, case when v_coaching_weekly_target is not null and v_coaching_weekly_target * v_weeks > 0
             then least(100, coalesce(cc.completed, 0)::numeric / (v_coaching_weekly_target * v_weeks) * 100) else null end),
        (v_w_growth, case when rp.rev > 0 then
             case
               when (rn.rev - rp.rev) / rp.rev * 100 <= 0 then 0
               when (rn.rev - rp.rev) / rp.rev * 100 >= 20 then 100
               else round(((rn.rev - rp.rev) / rp.rev * 100) / 20 * 100, 1)
             end
           else null end),
        (v_w_vintage, case when vr.agents_with_target > 0 then vr.agents_met::numeric / vr.agents_with_target * 100 else null end),
        (v_w_recovery, case when ar.was_red_yellow > 0 then ar.recovered::numeric / ar.was_red_yellow * 100 else null end),
        (v_w_zero, case when zs.was_zero > 0 then zs.recovered::numeric / zs.was_zero * 100 else null end)
      ) as x(weight, value)
      where x.value is not null
    ) as total_score
  from auditors au
  left join audit_counts ac on ac.auditor_id = au.id
  left join audit_targets at_ on at_.auditor_id = au.id
  left join coaching_counts cc on cc.auditor_id = au.id
  left join revenue_now rn on rn.auditor_id = au.id
  left join revenue_prior rp on rp.auditor_id = au.id
  left join vintage_revenue vr on vr.auditor_id = au.id
  left join agent_recovery ar on ar.auditor_id = au.id
  left join zero_seller zs on zs.auditor_id = au.id
  left join pip_outcomes po on po.auditor_id = au.id
  order by au.name;
end;
$$;

-- ── One-time correction: remove the wrongly-created rows that already exist ───────────────────────
-- Generic (not hardcoded to specific agents), so it also cleans up any other case of the same
-- shape, and is safe to re-run (a no-op once nothing violates the rule any more).
delete from agent_weekly_audit_target t
using users u
where t.agent_id = u.id
  and t.target_frozen = false
  and u.employment_stage = 'ojt'
  and u.ojt_start_date is not null
  and u.ojt_start_date > t.week_start + 6;
