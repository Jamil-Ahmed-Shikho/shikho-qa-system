-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 055 — QA Manager dashboard, Stage 4: coaching impact (before vs.
-- after) and revenue growth broken down by channel.
-- Apply after schema_054. Test against the live database before relying on it.
--
-- Jamil, 2026-09-30, scoped via three short AskUserQuestion picks:
--   - Coaching impact = compare the agent's score on the audit that
--     triggered a coaching session (the "before") against their next
--     submitted audit afterward (the "after") — not attendance/completion
--     stats, which Stage 2 already shows.
--   - Summary + a per-session list (not summary-only), matching Stage 3's
--     counts-plus-list shape.
--   - Revenue growth broken down by channel/team (not a single company-wide
--     trend line) — the same channel grouping qa_channel_progress (Stage 2)
--     already uses, OJT its own group.
--
-- Both functions follow the standing shape from Stage 3 on: SECURITY
-- DEFINER, super_admin/qa_manager/qa_auditor, p_view ('mine'/'team').
-- ============================================================

-- ── Coaching impact: before/after score for every completed, attended coaching session in the period ──
-- "Before" = the linked audit's own score (briefings.audit_id — the audit that triggered the session).
-- "After" = the agent's next SUBMITTED audit following the session (chronologically nearest, not an average) —
-- null ('pending') when nothing has been audited for them since. A session with no linked audit can't happen
-- (briefings.audit_id is not-null, §5), and only status='completed' AND attended=true counts as coaching that
-- actually happened — a no-show or a cancelled session tells you nothing about coaching's effect.
create or replace function qa_coaching_impact(p_from timestamptz, p_to timestamptz, p_view text default 'team')
returns table (
  briefing_id uuid,
  agent_id uuid,
  agent_name text,
  team_name text,
  site_name text,
  coaching_date timestamptz,
  before_score numeric,
  after_score numeric,
  score_delta numeric,
  outcome text
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
  select
    b.id, u.id, u.name, u.team_name, u.site_name, b.scheduled_at,
    before_audit.score_percent,
    after_audit.score_percent,
    case when after_audit.score_percent is not null then after_audit.score_percent - before_audit.score_percent end,
    case when after_audit.score_percent is null then 'pending'
         when after_audit.score_percent > before_audit.score_percent then 'improved'
         when after_audit.score_percent < before_audit.score_percent then 'declined'
         else 'same' end
    from briefings b
    join users u on u.id = b.agent_id
    join audits before_audit on before_audit.id = b.audit_id
    left join lateral (
      select a2.score_percent
        from audits a2
       where a2.agent_id = b.agent_id and a2.status = 'submitted' and a2.submitted_at > b.scheduled_at
       order by a2.submitted_at asc
       limit 1
    ) after_audit on true
   where b.status = 'completed' and b.attended = true
     and b.scheduled_at >= p_from and b.scheduled_at < p_to
     and (v_role <> 'qa_auditor' or p_view = 'team' or u.quality_auditor_id = v_me)
   order by b.scheduled_at desc;
end;
$$;
revoke all on function qa_coaching_impact(timestamptz, timestamptz, text) from public;
grant execute on function qa_coaching_impact(timestamptz, timestamptz, text) to authenticated;

-- ── Revenue growth by channel: this period's USD revenue vs. the immediately preceding period of the same length ──
-- Same grouping as qa_channel_progress (Stage 2, schema_051/053): each team name, OJT broken out as its own
-- group. Every unqualified column reference below is qualified by its CTE alias throughout, to avoid the exact
-- "column reference is ambiguous" bug schema_053 fixed (this function's own OUT parameter is also `channel`).
create or replace function qa_revenue_growth_by_channel(p_from timestamptz, p_to timestamptz, p_view text default 'team')
returns table (
  channel text,
  agents_count int,
  revenue_now_usd numeric,
  revenue_prior_usd numeric,
  growth_pct numeric
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
revoke all on function qa_revenue_growth_by_channel(timestamptz, timestamptz, text) from public;
grant execute on function qa_revenue_growth_by_channel(timestamptz, timestamptz, text) to authenticated;
