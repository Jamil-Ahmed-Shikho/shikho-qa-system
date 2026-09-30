-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 052 — QA Manager dashboard: open Stage 1 (Auditor Ranking) and
-- Stage 2 (Channel Progress) to QA Auditors too, with a My View / Team View
-- toggle (§2's standing "My View / Team View" principle — the same shape
-- qa_agent_queue() already uses).
-- Apply after schema_051. Test against the live database before relying on it.
--
-- Jamil, 2026-09-30: "everything we are designing for QA manager should be
-- available in Admin access" (already true — super_admin was always one of
-- the two allowed roles) "...QA auditor should able to see this reports
-- where my view and team view can be applied."
--
-- What changes
--   qa_auditor_ranking(p_from, p_to, p_view default 'team') — a QA Auditor
--   may now call this too. Team View (the default) is unchanged: everyone,
--   company-wide, exactly what a QA Manager sees. My View restricts the
--   result to the caller's OWN row only — their own six metrics, nothing
--   about anyone else. p_view is ignored for super_admin/qa_manager (always
--   company-wide — they have no "own" row to restrict to).
--
--   qa_channel_progress(p_from, p_to, p_view default 'team') — same shape.
--   Team View is unchanged: every eligible agent, company-wide. My View
--   restricts the eligible-agent set to just the caller's own assigned
--   agents (quality_auditor_id = caller) before grouping by channel — so an
--   auditor whose agents span more than one team still sees a per-channel
--   breakdown, just of their own portfolio.
--
--   Both functions keep their existing 2-argument call sites working
--   unchanged (a new trailing parameter with a default doesn't break an
--   existing shorter call — unlike removing/renaming an argument, §14,
--   which does need the old function dropped first).
--
--   Deliberately NOT extended to Team Lead / Manager — Jamil asked
--   specifically for QA Auditor access here; Team Lead/Manager access to
--   these two reports wasn't asked for, so it isn't added.
-- ============================================================

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
    select a.id as agent_id, a.quality_auditor_id
    from users a
    where a.role = 'agent' and a.quality_auditor_id is not null
  ),
  audit_counts as (
    select ad.auditor_id, count(*)::int as n
    from audits ad
    where ad.status = 'submitted' and ad.submitted_at >= p_from and ad.submitted_at < p_to
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
      select count(*) as n from audits a2
      where a2.agent_id = t.agent_id and a2.status = 'submitted'
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

create or replace function qa_channel_progress(p_from timestamptz, p_to timestamptz, p_view text default 'team')
returns table (
  channel text,
  agents_count int,
  audits_done int,
  audit_target int,
  audits_pct numeric
)
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
       and (v_role <> 'qa_auditor' or p_view = 'team' or u.quality_auditor_id = v_me)
  ),
  channels as (
    select distinct channel from elig where channel is not null
  ),
  agents_count as (
    select channel, count(*)::int as n from elig where channel is not null group by channel
  ),
  targets as (
    select e.channel, coalesce(sum(t.final_target), 0)::int as target
      from agent_weekly_audit_target t
      join elig e on e.id = t.agent_id
     where t.week_start >= p_from::date and t.week_start < p_to::date
     group by e.channel
  ),
  done as (
    select e.channel, count(*)::int as n
      from audits a
      join elig e on e.id = a.agent_id
     where a.status = 'submitted' and a.submitted_at >= p_from and a.submitted_at < p_to
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
revoke all on function qa_channel_progress(timestamptz, timestamptz, text) from public;
grant execute on function qa_channel_progress(timestamptz, timestamptz, text) to authenticated;
