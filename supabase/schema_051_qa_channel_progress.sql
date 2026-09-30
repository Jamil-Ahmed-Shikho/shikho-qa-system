-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 051 — QA Manager dashboard, Stage 2: channel-wise audit target vs completion
-- Apply after schema_050. Test against the live database before relying on it.
--
-- What this adds
--   qa_channel_progress(p_from, p_to) — audits done vs. audit target, summed
--   across every eligible agent, grouped by channel: each team name
--   (Telesales, CX Non-Voice, CX Inbound, Engagement, Retention, TS3P), with
--   OJT broken out as its OWN group rather than folded into an OJT agent's
--   team — matching the grouping the QA queue already uses (qa_agent_queue(),
--   schema_034: "by team/channel with OJT as its own group"). Re-training
--   agents are not included (they were deliberately excluded from
--   agent_weekly_audit_target from the start, §7 — their target is "1 call
--   total for a 3-day window", not a weekly count, and stays tracked through
--   ojt_status_history / ojt_candidates() instead).
--
--   Per-auditor audit/coaching progress (the other half of Stage 2) is NOT a
--   new function — it reuses qa_auditor_ranking() (schema_050) as-is, since
--   that function already returns exactly those columns for the same period.
--   The OJT pipeline overview reuses ojt_candidates() (schema_038) as-is too.
--   Nothing here duplicates logic that already exists.
--
--   A known simplification, flagged rather than silently accepted: an
--   agent's channel is their CURRENT team_name/employment_stage, not what it
--   was on each historical week being summed — agent_weekly_audit_target
--   doesn't record employment_stage or team_name as it was at computation
--   time, only the resulting final_target. Fine while stage/team changes are
--   rare relative to how often this page is read; revisit if that changes.
--
--   Access: same shape as qa_auditor_ranking() — SECURITY DEFINER doing its
--   own role check (super_admin/qa_manager only), for consistency with the
--   rest of this dashboard's cross-cutting reports, even though both allowed
--   roles already have unrestricted RLS read on every table this touches.
-- ============================================================

create or replace function qa_channel_progress(p_from timestamptz, p_to timestamptz)
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
begin
  if v_role not in ('super_admin', 'qa_manager') then
    return;
  end if;
  if p_to <= p_from then
    raise exception 'The period''s end must be after its start.';
  end if;

  return query
  with elig as (
    select u.id, case when u.employment_stage = 'ojt' then 'OJT' else u.team_name end as channel
      from users u
     where u.role = 'agent' and u.is_active and u.employment_stage in ('ojt', 'active')
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
revoke all on function qa_channel_progress(timestamptz, timestamptz) from public;
grant execute on function qa_channel_progress(timestamptz, timestamptz) to authenticated;
