-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 113 — Auditor's Impact Report: expose the real numbers behind Growth % and Zero-Seller %
-- (Jamil, 2026-11-08: "What was the calculation of growth%? ... if i keep my cursor in the number it
-- usually show the formula but for growth% & Zero seller percentage, doesn't showing anything").
-- Apply after 112. Test in the Supabase SQL Editor before relying on it.
--
-- The formulas themselves were already correct, just not visible anywhere:
--   Growth % = (this period's combined USD revenue − the immediately preceding period of the SAME
--     length) ÷ that prior period's revenue × 100, summed across the auditor's assigned agents.
--     "Last sales week" picked → prior period is the sales week before that, same 7-day span.
--   Zero-Seller % = of this auditor's agents who were ALREADY on a zero-seller streak just before
--     the period started, what % are no longer a zero-seller as of their most recent status within
--     the period — same "early vs. later snapshot" shape Agent Recovery % already uses, just against
--     the zero-seller flag instead of RYG status.
--
-- Two columns most of this page's others already had (Audit %, Coaching %, PIP Recovery % all show
-- the real counts behind the number on hover) — Growth % and Zero-Seller % never got the same
-- treatment when they were built, so this adds the missing raw numbers: revenue_now_usd /
-- revenue_prior_usd (what Growth % was actually computed from) and zero_seller_was_count /
-- zero_seller_recovered_count (what Zero-Seller % was actually computed from). Nullable exactly
-- where the % itself is null (an auditor with no agents, or no one in the relevant cohort) — never a
-- misleading $0.00/0 standing in for "nothing to measure".
--
-- A genuine return-shape change (new output columns) — CREATE OR REPLACE can't do that, so the old
-- function is dropped first (§14).
-- ============================================================

drop function if exists qa_auditor_ranking(timestamptz, timestamptz, text);

create or replace function qa_auditor_ranking(p_from timestamptz, p_to timestamptz, p_view text default 'team')
returns table (
  auditor_id uuid, auditor_name text, agents_assigned int, audits_done int, audit_target int, audit_pct numeric,
  coaching_completed int, coaching_scheduled int, coaching_target_total int, coaching_pct numeric,
  sales_growth_pct numeric, revenue_now_usd numeric, revenue_prior_usd numeric,
  vintage_target_met_pct numeric, agent_recovery_pct numeric,
  zero_seller_recovery_pct numeric, zero_seller_was_count int, zero_seller_recovered_count int,
  pip_recovery_pct numeric, pip_concluded_this_month int, total_score numeric
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
    rn.rev as revenue_now_usd,
    rp.rev as revenue_prior_usd,
    case when vr.agents_with_target > 0 then round(vr.agents_met::numeric / vr.agents_with_target * 100, 1) else null end as vintage_target_met_pct,
    case when ar.was_red_yellow > 0 then round(ar.recovered::numeric / ar.was_red_yellow * 100, 1) else null end as agent_recovery_pct,
    case when zs.was_zero > 0 then round(zs.recovered::numeric / zs.was_zero * 100, 1) else null end as zero_seller_recovery_pct,
    zs.was_zero::int as zero_seller_was_count,
    zs.recovered::int as zero_seller_recovered_count,
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
