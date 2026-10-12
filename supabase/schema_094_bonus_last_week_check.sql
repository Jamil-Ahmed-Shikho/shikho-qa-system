-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 094 — the +1 bonus audit's "red" reason now looks at only the
-- single most recently completed sales week, not the 4-week rolling RYG
-- status (§9.2/§6.2). Apply after schema_092. Test in the SQL Editor first.
--
-- WHY (Jamil + his team, 2026-10-12): a critical fatal stays inside the
-- RYG engine's 4-week rolling window for up to 4 weeks (compute_agent_status,
-- schema_037), so an agent whose fatal happened 3 weeks ago but had a clean
-- week since could still read "Red" today — and the +1 bonus (schema_034)
-- was simply following that same 4-week-stale Red label every week it
-- lasted. That gives an auditor an incentive NOT to flag a fatal (it keeps
-- inflating their own weekly target for weeks afterward) — exactly the bias
-- Jamil's team flagged.
--
-- WHAT CHANGES, AND WHAT DOESN'T:
--   * RYG itself (agent_current_status / agent_status_log) is UNTOUCHED —
--     still the confirmed 4-week rolling window, still shown everywhere else
--     (dashboards, the QA Manager's RYG breakdown, the priority queue, etc).
--   * Only the "red" bonus reason inside compute_weekly_audit_targets() now
--     looks ONLY at the agent's own submitted (non-draft, check_mode='audit'
--     — a Sample Check never counts, same fix as schema_074/080) audits in
--     the single sales week just gone:
--       - a critical fatal in that one week -> red applies
--       - no critical fatal, but that week's average score was below the
--         org's Red/Yellow line -> red still applies (same "Red = fatal OR
--         low score" rule as RYG itself, just windowed to 1 week not 4)
--       - no audits at all that week -> no red reason (nothing to judge,
--         same "don't invent a status with no data" principle RYG itself
--         uses for 'unrated')
--       - a clean week (no fatal, decent score) -> no red reason, even if
--         an older fatal elsewhere in the (unrelated) 4-week RYG window is
--         still keeping the agent's RYG label Red.
--   * PIP and Zero-Seller bonus reasons are unchanged — both already read
--     current state (an active PIP, an ongoing streak), not a lookback, so
--     there's no equivalent staleness problem there.
--   * The Red/Yellow threshold used is the same org-wide status_thresholds
--     row RYG itself reads (rubric_id is null), looked up as of the start of
--     the current week (i.e. the threshold in force when last week ended) —
--     same lookup pattern as compute_agent_status() (schema_037), just
--     anchored to a different timestamp.
-- ============================================================

create or replace function compute_weekly_audit_targets(p_as_of timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week date := sales_week_start((p_as_of at time zone 'Asia/Dhaka')::date);
  v_start timestamptz := (v_week::timestamp at time zone 'Asia/Dhaka');
  v_end timestamptz := ((v_week + 7)::timestamp at time zone 'Asia/Dhaka');
  v_last_start timestamptz := ((v_week - 7)::timestamp at time zone 'Asia/Dhaka');
  v_yellow_min numeric;
  v_written int;
  v_frozen int;
  v_norule int;
begin
  -- Same org-wide threshold RYG itself uses (schema_037) — the row in force when last week
  -- ended; fall back to the earliest recorded row if none existed that far back yet.
  select yellow_min into v_yellow_min
    from status_thresholds
   where rubric_id is null and effective_from <= v_start
   order by effective_from desc
   limit 1;
  if v_yellow_min is null then
    select yellow_min into v_yellow_min
      from status_thresholds
     where rubric_id is null
     order by effective_from asc
     limit 1;
  end if;

  with elig as (
    select a.id, a.team_name, (a.employment_stage = 'ojt') as is_ojt,
           vintage_label_for_week(a.employment_stage, a.joining_date, v_week) as label
      from users a
     where a.role = 'agent' and a.is_active and a.employment_stage in ('ojt', 'active')
  ), base as (
    select e.id, audit_target_for(e.is_ojt, e.label, e.team_name, v_week) as base_target from elig e
  ), last_week_audits as (
    -- The single most recently completed sales week's own submitted audits for each agent
    -- being considered for a target this week — a Sample Check never counts (check_mode).
    select b.id as agent_id,
           count(*) filter (where a2.status <> 'draft' and a2.check_mode = 'audit') as n,
           count(*) filter (where a2.status <> 'draft' and a2.check_mode = 'audit' and a2.critical_fail) as n_critical,
           avg(a2.score_percent) filter (where a2.status <> 'draft' and a2.check_mode = 'audit') as avg_score
      from base b
      left join audits a2 on a2.agent_id = b.id
        and a2.submitted_at >= v_last_start and a2.submitted_at < v_start
     group by b.id
  ), flagged as (
    select b.id, b.base_target,
           array_remove(array[
             case when exists (
                    select 1 from last_week_audits lw
                     where lw.agent_id = b.id
                       and (lw.n_critical > 0 or (lw.n > 0 and v_yellow_min is not null and lw.avg_score < v_yellow_min))
                  ) then 'red' end,
             case when exists (
                    select 1 from pip_candidates pc join pip_cycles c on c.id = pc.pip_cycle_id
                     where pc.agent_id = b.id and pc.status = 'approved' and c.start_date <= v_week + 6 and c.end_date >= v_week) then 'pip' end,
             case when exists (select 1 from agent_zero_seller_status z where z.agent_id = b.id and z.current_streak_weeks > 0) then 'zero_seller' end
           ], null) as reasons
      from base b where b.base_target is not null
  ), up as (
    insert into agent_weekly_audit_target (agent_id, week_start, base_target, bonus_applied, bonus_reasons, final_target)
    select f.id, v_week, f.base_target, cardinality(f.reasons) > 0, f.reasons,
           f.base_target + case when cardinality(f.reasons) > 0 then 1 else 0 end
      from flagged f
    on conflict (agent_id, week_start) do update
       set base_target = excluded.base_target, bonus_applied = excluded.bonus_applied, bonus_reasons = excluded.bonus_reasons,
           final_target = excluded.final_target, computed_at = now()
     where agent_weekly_audit_target.target_frozen = false
    returning 1
  )
  select count(*) into v_written from up;

  select count(*) into v_norule from users a
   where a.role = 'agent' and a.is_active and a.employment_stage in ('ojt', 'active')
     and audit_target_for(a.employment_stage = 'ojt', vintage_label_for_week(a.employment_stage, a.joining_date, v_week), a.team_name, v_week) is null;

  -- §9.5: an agent discontinued mid-week owes nothing more this week — the target freezes at what was already done.
  with fz as (
    update agent_weekly_audit_target w
       set final_target = (select count(*) from audits au where au.agent_id = w.agent_id and au.status <> 'draft'
                             and au.submitted_at >= v_start and au.submitted_at < v_end),
           target_frozen = true, adjustment_reason = 'agent_discontinued', computed_at = now()
      from users u
     where u.id = w.agent_id and u.employment_stage = 'discontinued'
       and w.week_start = v_week and w.target_frozen = false
    returning 1
  )
  select count(*) into v_frozen from fz;

  return jsonb_build_object('week_start', v_week, 'written', v_written, 'frozen', v_frozen, 'agents_without_a_rule', v_norule);
end;
$$;
revoke all on function compute_weekly_audit_targets(timestamptz) from public;
grant execute on function compute_weekly_audit_targets(timestamptz) to service_role;
