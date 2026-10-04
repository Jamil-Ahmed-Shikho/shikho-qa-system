-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 078 — Sample Checks still leaking into "audit" counts in two SQL
-- functions, found 2026-10-04 on Jamil's own report ("sample checks are
-- adding as audit count... no need to add as audit count or pass/fail").
--
-- schema_074 (2026-10-02) already closed this exact gap in qa_agent_queue(),
-- ojt_candidates(), manager_agent_stats() and compute_weekly_audit_targets()
-- — the four functions that existed AT THE TIME Sample Check was built. These
-- two did not exist yet then (they're from the QA Manager dashboard rebuild,
-- schema_050/051, 2026-09-30) and were never revisited when Sample Check
-- landed four days later (schema_073, 2026-10-04) — same root cause as the
-- schema_074 writeup, just two functions that missed that pass because they
-- were built in between the two events.
--
-- Also: schema_052 added a p_view argument to both via a NEW 3-argument
-- overload (`create or replace function foo(a, b, p_view default 'team')`)
-- without dropping the old 2-argument one first (§14's own lesson about
-- this) — so a stale, never-updated 2-arg copy has been sitting alongside
-- the real one ever since, confirmed unused by the app (it always calls
-- with p_view) via a full source grep. Dropped here as a matching cleanup.
-- ============================================================

drop function if exists qa_auditor_ranking(timestamptz, timestamptz);
drop function if exists qa_channel_progress(timestamptz, timestamptz);

create or replace function qa_auditor_ranking(p_from timestamptz, p_to timestamptz, p_view text default 'team')
returns table (
  auditor_id uuid, auditor_name text, agents_assigned int,
  audits_done int, audit_target int, audit_pct numeric,
  coaching_completed int, coaching_scheduled int, coaching_target_total int, coaching_pct numeric,
  sales_growth_pct numeric, vintage_target_met_pct numeric, zero_seller_recovery_pct numeric,
  pip_recovery_pct numeric, total_score numeric
)
language plpgsql
stable
security definer
set search_path = public
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

create or replace function qa_channel_progress(p_from timestamptz, p_to timestamptz, p_view text default 'team')
returns table (channel text, agents_count int, audits_done int, audit_target int, audits_pct numeric)
language plpgsql
stable
security definer
set search_path = public
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
revoke all on function qa_channel_progress(timestamptz, timestamptz, text) from public;
grant execute on function qa_channel_progress(timestamptz, timestamptz, text) to authenticated;

-- Defense in depth: a Sample Check has no score, so a Review Request against one is
-- nonsensical — found while tracing this same class of gap (a Manager's "audits to
-- request review for" list, fixed at the app layer in review-requests.service.ts,
-- had no check_mode filter either and could have shown one). Block it at the real
-- boundary too, not just by the UI never offering the option.
create or replace function file_review_request(p_audit_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := current_app_role();
  v_me uuid := current_app_user_id();
  v_audit audits%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_filer_role text;
  v_status text;
  v_id uuid;
begin
  if v_me is null then raise exception 'You are not signed in.'; end if;
  select * into v_audit from audits where id = p_audit_id;
  if not found then raise exception 'That audit does not exist.'; end if;
  if v_audit.status = 'draft' then raise exception 'This audit has not been submitted yet.'; end if;
  if v_audit.check_mode = 'sample_check' then raise exception 'A Sample Check has no score, so it cannot have a Review Request.'; end if;
  if v_audit.review_request_id is not null then raise exception 'This audit is itself a re-audit and cannot have its own Review Request.'; end if;
  if exists (select 1 from review_requests where audit_id = p_audit_id) then
    raise exception 'A Review Request has already been filed for this audit.';
  end if;
  if v_audit.submitted_at is null or now() > v_audit.submitted_at + interval '7 days' then
    raise exception 'The 7-day window to file a Review Request on this audit has passed.';
  end if;
  if v_reason = '' then raise exception 'Explain what you are requesting a review of.'; end if;
  if length(v_reason) > 2000 then raise exception 'The reason can be at most 2000 characters.'; end if;

  if v_role = 'agent' then
    if v_audit.agent_id <> v_me then raise exception 'You can only request a review of your own audits.'; end if;
    v_filer_role := 'agent'; v_status := 'with_team_lead';
  elsif v_role = 'team_lead' then
    if v_audit.agent_id not in (select a from team_agent_ids() as a) then
      raise exception 'You can only request a review for an agent on your own team.';
    end if;
    v_filer_role := 'team_lead'; v_status := 'with_qa_manager';
  elsif v_role = 'manager' then
    if v_audit.agent_id not in (select a from manager_chain_ids() as a) then
      raise exception 'You can only request a review for an agent in your own reporting chain.';
    end if;
    v_filer_role := 'manager'; v_status := 'with_qa_manager';
  else
    raise exception 'Only the agent, or their Team Lead or Manager on their behalf, can file a Review Request.';
  end if;

  insert into review_requests (audit_id, agent_id, raised_by, filer_role, reason, status)
  values (p_audit_id, v_audit.agent_id, v_me, v_filer_role, v_reason, v_status)
  returning id into v_id;
  return v_id;
end;
$$;
