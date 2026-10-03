-- ============================================================
-- Fix: a mid-week joiner's real "last week" revenue was hidden (2026-10-03)
--
-- loadAgentRevenue() (src/lib/audits/audit-context.service.ts) only showed
-- an agent their own last-sales-week revenue when a row for THEM existed in
-- agent_weekly_sales for that week — using that row's mere presence as a
-- cheap proxy for "has the system finished computing this week yet".
--
-- That proxy was wrong: agent_weekly_sales deliberately excludes agents who
-- weren't active/certified for the WHOLE week (mid-week joiners, OJT,
-- leavers — §6.3's own eligibility rule, there to keep the zero-seller
-- STREAK fair). A mid-week joiner never gets a row for that week, no matter
-- how long the system has been running or how real their sales were — so
-- their own real revenue (correctly computed by agent_revenue_usd(), which
-- has no such eligibility gate) was being thrown away and shown as "Not
-- available yet" instead. Found 2026-10-03: 4 of 5 newly-joined TS3P agents
-- had real last-week USD revenue ($31–$413) sitting unused behind this gate.
--
-- Fix: replace the per-agent existence check with a genuinely global one —
-- has ANY agent_weekly_sales row been written for this week at all (i.e.
-- has recompute_weekly_sales() actually reached this week), regardless of
-- whether THIS agent was eligible to get one. revenue_coverage already
-- tracks this exact fact but is service-role only (an operator's health
-- check, schema_022) — agent_weekly_sales' own RLS also can't answer "does
-- any row exist for week X" from an ordinary session (self-scoped only), so
-- this needs its own narrow, agent-data-free SECURITY DEFINER function.
-- ============================================================

create or replace function revenue_week_computed(p_week_start date)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists(select 1 from agent_weekly_sales where week_start = p_week_start)
$$;

-- Reveals only a yes/no about whether a week's rollup has run — no agent-specific
-- data — safe for any signed-in user, same trust level as agent_revenue_usd() itself.
revoke all on function revenue_week_computed(date) from public;
grant execute on function revenue_week_computed(date) to authenticated;
