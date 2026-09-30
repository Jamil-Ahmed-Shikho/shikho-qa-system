-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 050 — QA Manager dashboard, Stage 1: Auditor performance ranking
-- Apply after schema_049. Test against the live database before relying on it.
--
-- What this adds
--   qa_auditor_ranking(p_from, p_to) — one row per active QA Auditor, seven
--   percentage metrics (Jamil's own list, confirmed 2026-09-30) plus a Total
--   Score (the plain average of whichever metrics actually apply to that
--   auditor — a metric with nothing to measure is EXCLUDED from the average,
--   not counted as 0; "if any" was Jamil's own wording for PIP Recovery, and
--   the same principle is applied to every metric here for consistency):
--     Audit %                 — audits they personally submitted this period
--                                ÷ the audit target of the agents assigned to
--                                them (quality_auditor_id) for that period.
--     Coaching %               — completed coaching sessions ÷ a Jamil-set
--                                weekly coaching target × weeks in the period
--                                (both the scheduled and completed COUNTS are
--                                also returned, per Jamil's request to see
--                                both, not just the one blended percentage).
--     Sales Growth %           — their assigned agents' combined USD revenue
--                                this period vs. the immediately preceding
--                                period of the same length.
--     Agent Met Vintage-wise
--       Target %               — of their assigned agents' (agent, week)
--                                target rows in this period, what % actually
--                                met that week's own final_target.
--     Zero-Seller Recovery %   — of their assigned agents who were on a
--                                zero-seller week just before this period
--                                started, what % were NOT zero-sellers by
--                                the most recent week within this period.
--     PIP Recovery %           — of their assigned agents whose PIP concluded
--                                (completed/failed) within this period, what
--                                % completed (passed) rather than failed.
--
--   FIXED CALCULATION FOR NOW, not a configurable scoring system (Jamil's own
--   choice, 2026-09-30) — ship this, make it configurable later once it's
--   been used for a while and it's clearer what actually needs adjusting.
--   The one genuinely new setting, `qa_coaching_targets`, still needs to
--   exist (there is no existing "coaching quota" concept anywhere), so it is
--   versioned the same way as `pip_policies` (schema_027) — a single current
--   row, closed and superseded rather than edited, admin-only.
--
--   Which agents "belong to" an auditor: `users.quality_auditor_id`
--   (confirmed 2026-09-30) — already exists, and until now was purely
--   informational everywhere it appears; this is its first real use as a
--   scoping key. Nothing about its existing (non-)use elsewhere changes.
--
--   Access: restricted to super_admin/qa_manager only, the same way
--   `campaign_report()`/`repeat_mistake_report()` do their own role check
--   rather than relying on row-level security (this report crosses every
--   agent and every table regardless of caller, so RLS alone can't scope it) —
--   though unlike those two, this doesn't strictly need SECURITY DEFINER for
--   access reasons (both allowed roles already have unrestricted RLS read on
--   every table this touches); it's used anyway, for consistency with the
--   rest of this codebase's cross-cutting reports.
--
--   A known simplification, flagged rather than silently accepted: PIP
--   Recovery uses `pip_candidates.updated_at` as "when the outcome happened"
--   — there's no dedicated `decided_at` column, and `updated_at` only stays
--   accurate because completed/failed are terminal states nothing currently
--   rewrites. Fine for now; revisit if that ever changes.
-- ============================================================

create table qa_coaching_targets (
  id uuid primary key default gen_random_uuid(),
  weekly_target int not null check (weekly_target > 0),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_by uuid references users(id),
  constraint qa_coaching_targets_period check (effective_to is null or effective_to >= effective_from)
);
-- At most one current row, ever — same "((true)) where effective_to is null" shape as pip_policies (schema_027).
create unique index uq_qa_coaching_targets_open on qa_coaching_targets ((true)) where effective_to is null;

alter table qa_coaching_targets enable row level security;
create policy qa_coaching_targets_select_qa on qa_coaching_targets for select to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager'));
-- No write policy for anyone — set_qa_coaching_target() is the only writer, security definer with its own role check.

create or replace function set_qa_coaching_target(p_weekly_target int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if current_app_role() not in ('super_admin', 'qa_manager') then
    raise exception 'Only a Super Admin or QA Manager can set the coaching target.';
  end if;
  if p_weekly_target is null or p_weekly_target <= 0 then
    raise exception 'The weekly coaching target must be a positive number.';
  end if;

  update qa_coaching_targets set effective_to = now() where effective_to is null;

  insert into qa_coaching_targets (weekly_target, effective_from, created_by)
  values (p_weekly_target, now(), current_app_user_id())
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function set_qa_coaching_target(int) from public;
grant execute on function set_qa_coaching_target(int) to authenticated;

create or replace function qa_auditor_ranking(p_from timestamptz, p_to timestamptz)
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
  v_prior_from timestamptz;
  v_weeks numeric;
  v_coaching_weekly_target int;
begin
  if v_role not in ('super_admin', 'qa_manager') then
    return;
  end if;
  if p_to <= p_from then
    raise exception 'The period''s end must be after its start.';
  end if;

  v_prior_from := p_from - (p_to - p_from);
  v_weeks := greatest(1, extract(epoch from (p_to - p_from)) / (7 * 24 * 3600));

  select t.weekly_target into v_coaching_weekly_target from qa_coaching_targets t where t.effective_to is null;

  return query
  with auditors as (
    select u.id, u.name from users u where u.role = 'qa_auditor' and u.is_active
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
revoke all on function qa_auditor_ranking(timestamptz, timestamptz) from public;
grant execute on function qa_auditor_ranking(timestamptz, timestamptz) to authenticated;
