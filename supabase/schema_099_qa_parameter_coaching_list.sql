-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 099 — Rubric Fail Trends: "who needs coaching" list, one row per
-- agent who failed a given rubric parameter in the CURRENT sales week.
--
-- Jamil asked for a last-week-vs-this-week view on /reports/qa-rubric-trends
-- that shows where performance is declining, plus the actual agent names
-- who need coaching — and explicitly asked for something simple, not a new
-- page/chart/root-cause breakdown. The last-week-vs-this-week numbers
-- themselves need no new SQL (the page already fetches 8 weeks of history
-- via qa_rubric_fail_trend_history, schema_091 — the last two points of
-- that series ARE last week and this week). This migration adds the one
-- genuinely missing piece: given a parameter, which agents failed it this
-- week, so a Team Lead/QA Manager knows exactly who to coach and on what.
--
-- Returns every parameter's coaching rows in one call (not one function
-- call per parameter) so the page can fetch it once and let the UI expand
-- a row client-side with no further network round trip.
--
-- Scoping mirrors qa_rubric_fail_trends() (schema_091) verbatim — same role
-- gate, same My View/Team View handling for qa_auditor, same
-- team_agent_ids()/manager_chain_ids() scoping for Team Lead/Manager.
-- ============================================================

create or replace function qa_parameter_coaching_list(
  p_view text default 'team', p_team_name text default null
)
returns table (
  parameter_id uuid,
  agent_id uuid,
  agent_name text,
  team_leader_name text,
  fail_count int
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_role text := current_app_role();
  v_me uuid := current_app_user_id();
  v_week_start date;
  v_from timestamptz;
begin
  if v_role not in ('super_admin', 'qa_manager', 'qa_auditor', 'team_lead', 'manager') then
    return;
  end if;
  if p_view not in ('mine', 'team') then
    raise exception 'Choose My view or Team view.';
  end if;

  v_week_start := sales_week_start((now() at time zone 'Asia/Dhaka')::date);
  v_from := (v_week_start::timestamp at time zone 'Asia/Dhaka');

  return query
  select apr.parameter_id, u.id, u.name, tl.name, count(*)::int as fail_count
    from audit_parameter_results apr
    join audits a on a.id = apr.audit_id
    join users u on u.id = a.agent_id
    left join users tl on tl.id = u.team_leader_id
   where apr.passed = false
     and a.status = 'submitted' and a.submitted_at >= v_from and a.submitted_at < now()
     and (
       (v_role in ('super_admin', 'qa_manager') and (p_team_name is null or u.team_name = p_team_name))
       or (v_role = 'qa_auditor' and (p_team_name is null or u.team_name = p_team_name) and (p_view = 'team' or u.quality_auditor_id = v_me))
       or (v_role = 'team_lead' and a.agent_id in (select x from team_agent_ids() as x))
       or (v_role = 'manager' and a.agent_id in (select x from manager_chain_ids() as x))
     )
   group by apr.parameter_id, u.id, u.name, tl.name
   order by apr.parameter_id, fail_count desc, u.name;
end;
$$;
revoke all on function qa_parameter_coaching_list(text, text) from public;
grant execute on function qa_parameter_coaching_list(text, text) to authenticated;
