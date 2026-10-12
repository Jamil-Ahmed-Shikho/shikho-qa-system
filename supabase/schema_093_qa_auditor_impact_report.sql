-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 093 — "Auditor Ranking" becomes "Auditor's Impact Report" (§11),
-- rebuilt against Jamil's 2026-10-12 review of the old (pre-system) Impact
-- Score design. Apply after schema_092. Test in the SQL Editor first.
--
-- WHAT CHANGES vs. schema_080's qa_auditor_ranking():
--   1. Total Score is now a WEIGHTED average (qa_impact_weights, admin-set,
--      versioned like qa_coaching_targets), not a plain average — a metric
--      with nothing to measure is still excluded entirely (never 0), and the
--      remaining weights are renormalized among whatever DOES apply, so one
--      missing metric never silently shrinks the maximum possible score.
--   2. NEW metric: Agent Recovery % — of an auditor's assigned agents who
--      were Red or Yellow (RYG) just before the period started, what % are
--      Green by the most recent status within the period. Same "only count
--      the ones who had something to recover from" shape as Zero-Seller
--      Recovery, just against agent_status_log instead of agent_weekly_sales.
--   3. Vintage Target Met % now measures REVENUE, not audit count — of an
--      auditor's assigned agents, what % had their total USD revenue across
--      the period's weeks meet or exceed their total vintage-wise weekly
--      revenue target (revenue_target_rules, schema_034) across those same
--      weeks. Confirmed by Jamil's own worked example (50 agents, 25 met ->
--      50%) and his follow-up pick for a multi-week period: total actual vs.
--      total target over the period, not a per-week pass/fail.
--   4. Sales Growth is BANDED before it's weighted into the Total Score
--      (though the raw % is still shown, unchanged, in its own column):
--      flat-or-declining growth scores 0 (no partial credit for shrinking
--      sales, Jamil's own correction to the old system's bands, which gave
--      e.g. a -15% decline 20 points); 0%-20% growth scales linearly 0-100;
--      20%+ scores 100 (same ceiling the old system used). An auditor whose
--      assigned agents had nothing to grow from (zero revenue in the PRIOR
--      period) is excluded from the growth score, not scored as 0% — the
--      existing rp.rev > 0 guard already did this, unchanged.
--   5. Audit % and Coaching % are capped at 100 when they feed the Total
--      Score (so an auditor who massively overshoots one metric can't drown
--      out the rest) — the RAW, uncapped % is still shown in its own column.
--   6. PIP Recovery % is DECOUPLED from the Total Score entirely and from
--      the page's period picker — it's always "this calendar month", shown
--      as its own separate figure, since a PIP only really resolves at
--      month-end and blending it into every week's average penalized/
--      rewarded auditors for a fact that isn't really about that week.
--
-- Column list changed (a new column in the middle), so the function is
-- dropped and recreated rather than create-or-replace'd (§14).
-- ============================================================

-- ── Impact weights (admin-set, versioned like qa_coaching_targets) ──
create table qa_impact_weights (
  id uuid primary key default gen_random_uuid(),
  w_audit numeric not null check (w_audit between 0 and 100),
  w_coaching numeric not null check (w_coaching between 0 and 100),
  w_sales_growth numeric not null check (w_sales_growth between 0 and 100),
  w_vintage_target numeric not null check (w_vintage_target between 0 and 100),
  w_agent_recovery numeric not null check (w_agent_recovery between 0 and 100),
  w_zero_seller numeric not null check (w_zero_seller between 0 and 100),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_by uuid references users(id),
  constraint qa_impact_weights_period check (effective_to is null or effective_to >= effective_from)
);
create unique index uq_qa_impact_weights_open on qa_impact_weights ((true)) where effective_to is null;

alter table qa_impact_weights enable row level security;
create policy qa_impact_weights_select_qa on qa_impact_weights for select to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager', 'qa_auditor'));
-- No write policy for anyone — set_qa_impact_weights() is the only writer.

-- A sensible starting default so the report never shows an all-null score before an admin
-- visits the settings panel — adapted from the old 5-component design (Audit 20 / Briefing 15 /
-- Growth 30 / Agent Recovery 20 / Zero-Seller 15) to make room for the new Vintage Target Met
-- component, and trimmed slightly off Growth since it's no longer the only "did the business
-- grow" signal once Vintage Target Met is revenue-based too.
insert into qa_impact_weights (w_audit, w_coaching, w_sales_growth, w_vintage_target, w_agent_recovery, w_zero_seller)
values (20, 15, 25, 15, 15, 10);

create or replace function set_qa_impact_weights(
  p_audit numeric, p_coaching numeric, p_sales_growth numeric,
  p_vintage_target numeric, p_agent_recovery numeric, p_zero_seller numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_sum numeric;
begin
  if current_app_role() not in ('super_admin', 'qa_manager') then
    raise exception 'Only a Super Admin or QA Manager can set the Impact Report weights.';
  end if;
  v_sum := coalesce(p_audit, 0) + coalesce(p_coaching, 0) + coalesce(p_sales_growth, 0)
         + coalesce(p_vintage_target, 0) + coalesce(p_agent_recovery, 0) + coalesce(p_zero_seller, 0);
  if abs(v_sum - 100) > 0.01 then
    raise exception 'The six weights must add up to 100 (got %).', v_sum;
  end if;

  update qa_impact_weights set effective_to = now() where effective_to is null;

  insert into qa_impact_weights (w_audit, w_coaching, w_sales_growth, w_vintage_target, w_agent_recovery, w_zero_seller, effective_from, created_by)
  values (p_audit, p_coaching, p_sales_growth, p_vintage_target, p_agent_recovery, p_zero_seller, now(), current_app_user_id())
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function set_qa_impact_weights(numeric, numeric, numeric, numeric, numeric, numeric) from public;
grant execute on function set_qa_impact_weights(numeric, numeric, numeric, numeric, numeric, numeric) to authenticated;

-- ── The report itself ──
drop function if exists qa_auditor_ranking(timestamptz, timestamptz, text);

create or replace function qa_auditor_ranking(p_from timestamptz, p_to timestamptz, p_view text default 'team')
returns table (
  auditor_id uuid,
  auditor_name text,
  agents_assigned int,
  audits_done int,
  audit_target int,
  audit_pct numeric,
  coaching_completed int,
  coaching_scheduled int,
  coaching_target_total int,
  coaching_pct numeric,
  sales_growth_pct numeric,
  vintage_target_met_pct numeric,
  agent_recovery_pct numeric,
  zero_seller_recovery_pct numeric,
  pip_recovery_pct numeric,
  pip_concluded_this_month int,
  total_score numeric
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
    -- Same eligibility rule as qa_agent_queue() / qa_channel_progress() (§6.2's Q7, schema_080).
    select a.id as agent_id, a.quality_auditor_id
    from users a
    where a.role = 'agent' and a.quality_auditor_id is not null
      and a.is_active and a.employment_stage in ('ojt', 'active')
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
revoke all on function qa_auditor_ranking(timestamptz, timestamptz, text) from public;
grant execute on function qa_auditor_ranking(timestamptz, timestamptz, text) to authenticated;
