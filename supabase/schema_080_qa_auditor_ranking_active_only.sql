-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 080 — fix qa_auditor_ranking() to drop a deactivated agent from
-- every one of its figures, not just the queue (2026-10-09, Jamil's own
-- report: "This Week's QA Progress is not updating after we deactivated
-- the resign employee... Auditor wise This week's audit target and This
-- Week's QA Progress should show same data. now have mismatch in agent's
-- count, target etc").
--
-- Root cause, confirmed against real data before writing this: this
-- function's own `agents` CTE was
--   select a.id as agent_id, a.quality_auditor_id
--   from users a
--   where a.role = 'agent' and a.quality_auditor_id is not null
-- — no `is_active` / `employment_stage` check at all, unlike every other
-- eligible-agent query in this system (qa_agent_queue(), schema_034;
-- qa_channel_progress(), schema_060 — both already filter
-- `is_active and employment_stage in ('ojt','active')`, §6.2's Q7
-- eligibility rule). Confirmed live: 20 agents are currently deactivated
-- (is_active=false) while still carrying a `quality_auditor_id` — every
-- one of them was still being counted into agents_assigned, audit_target
-- (via agent_weekly_audit_target), sales growth, vintage-target-met %,
-- zero-seller recovery % and PIP recovery % on /reports/qa-team-progress's
-- "Per-auditor progress" table, while the SAME page's "Channel-wise audit
-- target vs. completion" table (qa_channel_progress()) and the auditor's
-- own "This week's audit target" (qa_agent_queue(), QueueSection) already
-- excluded them correctly — hence the mismatch Jamil saw between the two.
--
-- Fixed: `agents` now applies the identical eligibility filter the other
-- two functions already use. Nothing else about this function (the six
-- metric calculations, My View/Team View scoping, the period math)
-- changes — this is a one-CTE fix, not a redesign.
-- ============================================================

create or replace function qa_auditor_ranking(
  p_from timestamptz,
  p_to timestamptz,
  p_view text default 'team'
)
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
  zero_seller_recovery_pct numeric,
  pip_recovery_pct numeric,
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

  return query
  with auditors as (
    select u.id, u.name from users u where u.role = 'qa_auditor' and u.is_active
      and (v_role <> 'qa_auditor' or p_view = 'team' or u.id = v_me)
  ),
  agents as (
    -- Same eligibility rule as qa_agent_queue() / qa_channel_progress() (§6.2's Q7) — a
    -- deactivated or discontinued agent is never "assigned" to anyone's live numbers,
    -- however their quality_auditor_id still happens to read.
    select a.id as agent_id, a.quality_auditor_id
    from users a
    where a.role = 'agent' and a.quality_auditor_id is not null
      and a.is_active and a.employment_stage in ('ojt', 'active')
  ),
  audit_counts as (
    -- check_mode = 'audit' — a Sample Check is not scored and must not count toward an
    -- auditor's "audits done" (and therefore Audit %), same fix as schema_074's four functions.
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
  vintage_weeks as (
    select ag.quality_auditor_id as auditor_id,
           count(*) as total_weeks,
           count(*) filter (where coalesce(done.n, 0) >= t.final_target) as met_weeks
    from agent_weekly_audit_target t
    join agents ag on ag.agent_id = t.agent_id
    left join lateral (
      -- same fix: a Sample Check does not count toward meeting a week's audit target.
      select count(*) as n from audits a2
      where a2.agent_id = t.agent_id and a2.status = 'submitted' and a2.check_mode = 'audit'
        and a2.submitted_at >= t.week_start::timestamptz
        and a2.submitted_at < (t.week_start + 7)::timestamptz
    ) done on true
    where t.week_start >= p_from::date and t.week_start < p_to::date
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
  pip_outcomes as (
    select ag.quality_auditor_id as auditor_id,
           count(*) as concluded,
           count(*) filter (where pc.status = 'completed') as recovered
    from pip_candidates pc
    join agents ag on ag.agent_id = pc.agent_id
    where pc.status in ('completed', 'failed') and pc.updated_at >= p_from and pc.updated_at < p_to
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
    case when vw.total_weeks > 0 then round(vw.met_weeks::numeric / vw.total_weeks * 100, 1) else null end as vintage_target_met_pct,
    case when zs.was_zero > 0 then round(zs.recovered::numeric / zs.was_zero * 100, 1) else null end as zero_seller_recovery_pct,
    case when po.concluded > 0 then round(po.recovered::numeric / po.concluded * 100, 1) else null end as pip_recovery_pct,
    (
      select round(avg(x), 1) from unnest(array[
        case when coalesce(at_.target, 0) > 0 then coalesce(ac.n, 0)::numeric / at_.target * 100 else null end,
        case when v_coaching_weekly_target is not null and v_coaching_weekly_target * v_weeks > 0
             then coalesce(cc.completed, 0)::numeric / (v_coaching_weekly_target * v_weeks) * 100 else null end,
        case when rp.rev > 0 then (rn.rev - rp.rev) / rp.rev * 100 else null end,
        case when vw.total_weeks > 0 then vw.met_weeks::numeric / vw.total_weeks * 100 else null end,
        case when zs.was_zero > 0 then zs.recovered::numeric / zs.was_zero * 100 else null end,
        case when po.concluded > 0 then po.recovered::numeric / po.concluded * 100 else null end
      ]) as x where x is not null
    ) as total_score
  from auditors au
  left join audit_counts ac on ac.auditor_id = au.id
  left join audit_targets at_ on at_.auditor_id = au.id
  left join coaching_counts cc on cc.auditor_id = au.id
  left join revenue_now rn on rn.auditor_id = au.id
  left join revenue_prior rp on rp.auditor_id = au.id
  left join vintage_weeks vw on vw.auditor_id = au.id
  left join zero_seller zs on zs.auditor_id = au.id
  left join pip_outcomes po on po.auditor_id = au.id
  order by au.name;
end;
$$;
revoke all on function qa_auditor_ranking(timestamptz, timestamptz, text) from public;
grant execute on function qa_auditor_ranking(timestamptz, timestamptz, text) to authenticated;
