-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 026 — Agent Status Engine, part 2: Red / Yellow / Green (§6.2)
-- Test this in the Supabase SQL Editor before relying on it.
-- Requires schema_011 (audits, status_thresholds) and schema_022
-- (sales_week_start). Apply after 025.
--
-- RULE (design §6.2): status = the score band the agent's AVERAGE audit
-- score falls in, overridden to RED whenever any CRITICAL fatal error
-- occurred in the period, regardless of score.
--
--   score >= green_min  -> green
--   score >= yellow_min -> yellow      (yellow_min = the 70% pass mark, confirmed)
--   otherwise           -> red
--   any audit in the period with critical_fail -> red, reason 'critical_fatal_override'
--
-- PERIOD: the last `p_window_weeks` COMPLETED sales weeks (Saturday-Friday,
-- Asia/Dhaka), ending on the most recent Friday that has passed. One row per
-- agent per period in agent_status_log, kept forever: a row for a finished
-- period is FROZEN once the next period begins (only the latest completed
-- period is refreshed by re-runs), so history is never rewritten by a later
-- threshold change (§1).
--
-- !! ASSUMPTIONS TO CONFIRM (see docs/questions-2026-09-25.md):
-- !!  - the window is 4 completed sales weeks (p_window_weeks, default 4);
-- !!  - green_min = 90 is still the design doc's "e.g." placeholder (only
-- !!    the 70 boundary is confirmed);
-- !!  - the org-wide threshold row is used for everyone (a rubric-specific
-- !!    row, if one exists, is not consulted — an agent's audits can span rubrics);
-- !!  - an agent with NO submitted audit in the window gets no row (no
-- !!    status is invented from nothing);
-- !!  - every non-draft audit counts (submitted / acknowledged / disputed /
-- !!    resolved), and a Critical fatal audit's stored score is 0.
-- ============================================================

create table agent_status_log (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references users(id),
  period_start date not null,             -- Saturday
  period_end date not null,               -- Friday
  avg_audit_score numeric,
  status text not null check (status in ('red', 'yellow', 'green')),
  status_reason text not null check (status_reason in ('score_threshold', 'critical_fatal_override')),
  -- What the number was built from, so a row explains itself later:
  audit_count int not null,
  critical_fatal_count int not null default 0,
  green_min_used numeric not null,
  yellow_min_used numeric not null,
  window_weeks int not null,
  computed_at timestamptz not null default now(),
  constraint agent_status_log_period check (period_end >= period_start),
  unique (agent_id, period_end)
);

create index idx_agent_status_log_agent on agent_status_log(agent_id, period_end desc);

alter table agent_status_log enable row level security;

-- Read scoped exactly like the agent's audits (§2): QA all, Team Lead own
-- team, Manager own chain, an agent their own. NO write policy for anyone:
-- rows are written only by compute_agent_status() (service role).
create policy agent_status_log_select_qa on agent_status_log
  for select to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager', 'qa_auditor'));
create policy agent_status_log_select_team_lead on agent_status_log
  for select to authenticated
  using (current_app_role() = 'team_lead' and agent_id in (select a from team_agent_ids() as a));
create policy agent_status_log_select_manager on agent_status_log
  for select to authenticated
  using (current_app_role() = 'manager' and agent_id in (select a from manager_chain_ids() as a));
create policy agent_status_log_select_self on agent_status_log
  for select to authenticated
  using (agent_id = current_app_user_id());

-- ── The computation ─────────────────────────────────────────
-- p_as_of: "today" for the computation (default: today, Dhaka). The period is
-- the p_window_weeks completed sales weeks ending on the latest Friday
-- STRICTLY BEFORE the current sales week began... i.e. the Friday just gone.
-- Returns how many agent rows were written or refreshed.
create or replace function compute_agent_status(
  p_as_of date default ((now() at time zone 'Asia/Dhaka')::date),
  p_window_weeks int default 4
)
returns int
language plpgsql
set search_path = public
as $$
declare
  v_period_end date;
  v_period_start date;
  v_today date := (now() at time zone 'Asia/Dhaka')::date;
  v_latest_end_today date;
  v_from_ts timestamptz;
  v_to_ts timestamptz;
  v_green numeric;
  v_yellow numeric;
  v_n int;
begin
  if p_window_weeks is null or p_window_weeks < 1 or p_window_weeks > 26 then
    raise exception 'The window must be between 1 and 26 weeks.';
  end if;

  -- The Friday just gone: the day before the current sales week began.
  v_period_end := sales_week_start(p_as_of) - 1;
  v_period_start := v_period_end - (7 * p_window_weeks - 1);
  v_latest_end_today := sales_week_start(v_today) - 1;

  -- Dhaka-midnight bounds of [period_start, period_end].
  v_from_ts := (v_period_start::timestamp) at time zone 'Asia/Dhaka';
  v_to_ts := ((v_period_end + 1)::timestamp) at time zone 'Asia/Dhaka';

  -- The org-wide bar in force at the END of the period (so a later threshold
  -- change never re-bands a finished period). If the period predates every
  -- row (the seeded row's effective_from is when it was created), use the earliest.
  select green_min, yellow_min into v_green, v_yellow
    from status_thresholds
   where rubric_id is null and effective_from <= v_to_ts
   order by effective_from desc
   limit 1;
  if v_green is null then
    select green_min, yellow_min into v_green, v_yellow
      from status_thresholds
     where rubric_id is null
     order by effective_from asc
     limit 1;
  end if;
  if v_green is null then
    raise exception 'There is no org-wide status threshold row — nothing to band scores against.';
  end if;

  with agg as (
    select a.agent_id,
           round(avg(a.score_percent), 2) as avg_score,
           count(*)::int as n_audits,
           count(*) filter (where a.critical_fail)::int as n_critical
      from audits a
      join users u on u.id = a.agent_id
     where a.status <> 'draft'
       and a.submitted_at >= v_from_ts and a.submitted_at < v_to_ts
       and a.score_percent is not null
       and u.role = 'agent' and u.is_active
     group by a.agent_id
  ),
  ins as (
    insert into agent_status_log (
      agent_id, period_start, period_end, avg_audit_score, status, status_reason,
      audit_count, critical_fatal_count, green_min_used, yellow_min_used, window_weeks
    )
    select agent_id, v_period_start, v_period_end, avg_score,
           case when n_critical > 0 then 'red'
                when avg_score >= v_green then 'green'
                when avg_score >= v_yellow then 'yellow'
                else 'red' end,
           case when n_critical > 0 then 'critical_fatal_override' else 'score_threshold' end,
           n_audits, n_critical, v_green, v_yellow, p_window_weeks
      from agg
    on conflict (agent_id, period_end) do update
      set period_start = excluded.period_start,
          avg_audit_score = excluded.avg_audit_score,
          status = excluded.status,
          status_reason = excluded.status_reason,
          audit_count = excluded.audit_count,
          critical_fatal_count = excluded.critical_fatal_count,
          green_min_used = excluded.green_min_used,
          yellow_min_used = excluded.yellow_min_used,
          window_weeks = excluded.window_weeks,
          computed_at = now()
      -- Only the latest completed period is ever refreshed; older rows are history.
      where agent_status_log.period_end = v_latest_end_today
    returning 1
  )
  select count(*) into v_n from ins;

  return v_n;
end;
$$;

revoke all on function compute_agent_status(date, int) from public;
revoke all on function compute_agent_status(date, int) from authenticated;
grant execute on function compute_agent_status(date, int) to service_role;

-- ── Convenience view: each agent's latest status ─────────────
create or replace view agent_current_status
with (security_invoker = true) as
  select distinct on (agent_id)
         agent_id, status, status_reason, avg_audit_score, audit_count, critical_fatal_count,
         period_start, period_end, computed_at
    from agent_status_log
   order by agent_id, period_end desc;

grant select on agent_current_status to authenticated;
