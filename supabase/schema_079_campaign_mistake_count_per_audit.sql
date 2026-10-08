-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 079 — fix campaign_mistake_breakdown() to count DISTINCT AUDITS,
-- not individual mistake-tagged ANSWER ROWS (2026-10-08, Jamil's own
-- finding: Md Safayat Ul Islam Safin showed "6" but only had 2 real
-- submitted audits with a problem).
--
-- Root cause: one audit can carry several checks within the same Special
-- Check (e.g. "Current Year Free Benefit Pitch", "Exclusive Price
-- Pitching" and "Information Accuracy & Compliance" are three separate
-- checks on the same "Audit | Bundle Promotion" campaign). The original
-- schema_077 COUNT(*) over `filtered`/`lifetime` counted one row per
-- (audit, check) pair that matched a mistake-tagged option — so a single
-- audit that happened to fail three different checks in the same Special
-- Check counted as 3, not 1. Verified live: Safayat's two real audits
-- (05a41981…, baaeb909…) each had 3 mistake-tagged answers -> 2*3 = 6,
-- not 6 separate incidents.
--
-- Fixed: COUNT(DISTINCT audit_id) in both the current-filters count and
-- the lifetime count, so the figure now means "how many different
-- submitted audits had at least one mistake-tagged answer on this Special
-- Check" — the number that actually supports a REPEAT judgement (2+
-- SEPARATE calls, not 2+ answers on the same call). Nothing else about
-- scope, filters or the "same campaign only" rule changes — this is a
-- counting-granularity fix, not a scope fix (the scope was already
-- correct, confirmed by Jamil).
-- ============================================================

create or replace function campaign_mistake_breakdown(
  p_campaign_id uuid,
  p_manager_id uuid default null,
  p_team_name text default null,
  p_site_name text default null,
  p_agent_id uuid default null,
  p_auditor_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_value_ids uuid[] default null
)
returns table (
  agent_id uuid,
  agent_name text,
  team_leader_name text,
  mistake_count bigint,
  lifetime_count bigint,
  last_mistake_at timestamptz,
  last_audit_id uuid,
  last_check_name text,
  last_value_label text
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_scope uuid[] := campaign_report_scope(p_manager_id);
  v_values uuid[];
begin
  if v_scope is not null and array_length(v_scope, 1) is null then
    return;                                            -- empty chain, or role not entitled at all
  end if;

  if p_value_ids is not null then
    v_values := p_value_ids;
  else
    select coalesce(array_agg(v.id), '{}') into v_values
    from campaign_check_values v
    join campaign_check_types t on t.id = v.check_type_id
    where t.campaign_id = p_campaign_id and v.is_mistake;
  end if;

  if array_length(v_values, 1) is null then
    return;                                            -- nothing tagged as a mistake (or nothing selected)
  end if;

  return query
  with filtered as (
    select au.agent_id, au.id as audit_id, au.submitted_at,
           t.name as check_name, v.label as value_label
    from audit_campaign_answers a
    join audits au on au.id = a.audit_id and au.status = 'submitted'
    join users agent on agent.id = au.agent_id
    join campaign_check_types t on t.id = a.check_type_id
    join campaign_check_values v on v.id = a.value_id
    where a.campaign_id = p_campaign_id
      and a.value_id = any (v_values)
      and (v_scope is null or agent.id = any (v_scope))
      and (p_team_name is null or agent.team_name = p_team_name)
      and (p_site_name is null or agent.site_name = p_site_name)
      and (p_agent_id is null or au.agent_id = p_agent_id)
      and (p_auditor_id is null or au.auditor_id = p_auditor_id)
      and (p_from is null or au.submitted_at >= p_from)
      and (p_to is null or au.submitted_at < p_to)
  ),
  lifetime as (
    -- Same agent, same campaign, same selected options — but every submitted
    -- audit ever, not just the ones the report's own filters matched.
    -- COUNT(DISTINCT au.id): a single audit with several mistake-tagged
    -- answers (one per check) still only counts once.
    select au.agent_id, count(distinct au.id)::bigint as n
    from audit_campaign_answers a
    join audits au on au.id = a.audit_id and au.status = 'submitted'
    where a.campaign_id = p_campaign_id
      and a.value_id = any (v_values)
      and au.agent_id in (select distinct f.agent_id from filtered f)
    group by au.agent_id
  ),
  last_per_agent as (
    select distinct on (f.agent_id) f.agent_id, f.audit_id, f.check_name, f.value_label, f.submitted_at
    from filtered f
    order by f.agent_id, f.submitted_at desc
  )
  select
    f.agent_id,
    agent.name,
    tl.name,
    count(distinct f.audit_id)::bigint as mistake_count,
    coalesce(lt.n, 0)::bigint as lifetime_count,
    lp.submitted_at,
    lp.audit_id,
    lp.check_name,
    lp.value_label
  from filtered f
  join users agent on agent.id = f.agent_id
  left join users tl on tl.id = agent.team_leader_id
  left join lifetime lt on lt.agent_id = f.agent_id
  left join last_per_agent lp on lp.agent_id = f.agent_id
  group by f.agent_id, agent.name, tl.name, lt.n, lp.submitted_at, lp.audit_id, lp.check_name, lp.value_label
  order by mistake_count desc, lp.submitted_at desc;
end;
$$;
revoke all on function campaign_mistake_breakdown(uuid, uuid, text, text, uuid, uuid, timestamptz, timestamptz, uuid[]) from public;
grant execute on function campaign_mistake_breakdown(uuid, uuid, text, text, uuid, uuid, timestamptz, timestamptz, uuid[]) to authenticated;
