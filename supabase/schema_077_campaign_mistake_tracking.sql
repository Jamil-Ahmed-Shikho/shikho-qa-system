-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 077 — Campaign mistake tracking (§4 Part B3 extension, 2026-10-04,
-- Jamil's own request): tag an Option as "Mistake / Not a mistake", then show
-- a per-agent breakdown of who picked a mistake-tagged answer, their Team
-- Leader, and how many times (both in the report's current filters and
-- lifetime) — so the Campaign Report can answer "whose agents should I take
-- care of", not just "what did everyone answer".
--
-- Deliberately NOT a new automatic tracking table like capa_repeat_mistakes
-- (§4 Part 2a) — Special Check usage is comparatively low-volume (opt-in,
-- ticked per audit) and the Campaign Report itself already computes every
-- number live (campaign_report(), schema_017), so a live aggregate here
-- keeps the same shape instead of adding a cache that needs its own
-- recompute/backfill story.
--
-- Apply after schema_017 (reuses campaign_report_scope()) and schema_073+
-- (Sample Check reuses the same audit_campaign_answers rows, so this
-- automatically covers Sample Check "mistakes" too — no separate handling).
-- ============================================================

-- One admin-set fact per option, defaulting to false so nothing already
-- defined changes meaning until an admin deliberately tags it. Writable only
-- by Super Admin / QA Manager, via the EXISTING campaign_check_values_write_admin
-- RLS policy (schema_014) — no new policy needed, this is just another column
-- on an already-admin-only-writable table.
alter table campaign_check_values add column if not exists is_mistake boolean not null default false;
comment on column campaign_check_values.is_mistake is
  'Picking this answer is a mistake worth flagging in the Campaign Report''s agent breakdown. Admin-set, defaults to false.';

-- Per-agent breakdown of who picked a mistake-tagged answer, for the Campaign
-- Report's "who to take care of" section.
--
--   p_value_ids  the specific mistake-tagged options to count this run (the
--                report's own "count as a mistake" checklist filter) — null
--                means every option in this campaign tagged is_mistake=true.
--                An explicit empty array means nothing is selected: returns
--                no rows, same as "nothing tagged yet".
--
-- mistake_count  = how many flagged answers match the SAME filters as the
--                  rest of the report (team/site/agent/auditor/date range) —
--                  one audit with two different flagged answers counts as 2.
-- lifetime_count = the same agent, the same set of mistake-tagged options,
--                  but EVERY submitted audit ever — ignores the report's own
--                  date range and other filters, so a repeat pattern shows
--                  even when today's view is narrow. Still campaign-scoped
--                  and still only the currently-selected options, so the
--                  two counts are always measuring "the same kind of mistake".
--
-- Same role/chain scoping as campaign_report() (super_admin/qa_manager/
-- qa_auditor company-wide + manager-chain picker; manager own chain; team_lead
-- own team) via the existing campaign_report_scope() — not re-derived here.
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
    select au.agent_id, count(*)::bigint as n
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
    count(*)::bigint as mistake_count,
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
