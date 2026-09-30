-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 053 — fix a bug in qa_channel_progress() (schema_051/052), caught
-- live while browser-verifying Stage 2: "column reference \"channel\" is
-- ambiguous". The function's own OUT parameter is named `channel`, which
-- collides with the CTEs' unqualified `channel` column reference inside the
-- plpgsql function body. Qualifying every reference with its CTE alias
-- fixes it. No behaviour change otherwise — same signature, same logic.
-- Apply after schema_052.
-- ============================================================

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
