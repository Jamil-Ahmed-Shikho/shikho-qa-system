-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 022 — Weekly sales rollup + Zero-Seller tracking (§6.3)
-- Test this in the Supabase SQL Editor before relying on it.
-- Requires schema_018 (agent_revenue_transactions) already applied.
--
-- recompute_weekly_sales() rolls agent_revenue_transactions up into one
-- agent_weekly_sales row per agent per SALES WEEK (Saturday-Friday,
-- Asia/Dhaka — same boundary as src/lib/dates/sales-week.ts), flags
-- zero-seller weeks, and derives each agent's current zero-seller streak.
--
-- IDEMPOTENT: every run recomputes the whole covered range from the
-- transactions as they are right now (upserts, then removes rows that no
-- longer belong), so it is safe to run repeatedly while the backfill
-- continues and while re-matching fills in agent_id over time.
--
-- Works on partial data by design — it aggregates whatever is there.
-- Three rules keep partial data from producing false zero-sellers where
-- the data simply isn't loaded yet (see recompute_weekly_sales below):
--   * only weeks the loaded data fully covers,
--   * only COMPLETED weeks,
--   * only agents who were actually employed and active for the week.
-- What it can NOT fix: revenue that is still unattributed (agent_id null)
-- counts for nobody, so until re-matching catches up an agent can look
-- like a zero-seller because their sales are unmatched. revenue_coverage
-- (view, below) shows how much of the revenue is attributed so the
-- streaks can be read with that in mind.
-- ============================================================

-- The Saturday on or before a calendar day = the start of that day's sales week.
-- dow: Sun=0 ... Sat=6, so days since Saturday = (dow + 1) % 7.
create or replace function sales_week_start(p_day date)
returns date
language sql
immutable
set search_path = public
as $$
  select p_day - (((extract(dow from p_day))::int + 1) % 7)
$$;

-- ── tables (from the §6.3 design) ────────────────────────────
create table agent_weekly_sales (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references users(id),
  week_start date not null,               -- Saturday
  week_end date not null,                 -- Friday
  total_revenue numeric not null default 0,
  target_revenue numeric,                 -- set by a later step; recompute never touches it
  is_zero_seller boolean not null default false,
  computed_at timestamptz not null default now(),
  unique (agent_id, week_start),
  constraint agent_weekly_sales_week_ok
    check (extract(dow from week_start) = 6 and week_end = week_start + 6),
  constraint agent_weekly_sales_revenue_ok check (total_revenue >= 0)
);
create index idx_agent_weekly_sales_week on agent_weekly_sales(week_start);

create table agent_zero_seller_status (
  agent_id uuid primary key references users(id),
  current_streak_weeks int not null default 0,
  streak_start_week date,                 -- Saturday the current streak began; null when streak is 0
  last_sale_date date,                    -- Dhaka date of the agent's most recent attributed sale in the data
  updated_at timestamptz not null default now(),
  constraint agent_zero_seller_streak_ok
    check (current_streak_weeks >= 0 and ((current_streak_weeks = 0) = (streak_start_week is null)))
);

-- ── access (mirrors agent_revenue_transactions, schema_018) ───
alter table agent_weekly_sales enable row level security;
alter table agent_zero_seller_status enable row level security;

create policy agent_weekly_sales_select_qa on agent_weekly_sales
  for select to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager', 'qa_auditor'));
create policy agent_weekly_sales_select_team_lead on agent_weekly_sales
  for select to authenticated
  using (current_app_role() = 'team_lead' and agent_id in (select t from team_agent_ids() as t));
create policy agent_weekly_sales_select_manager on agent_weekly_sales
  for select to authenticated
  using (current_app_role() = 'manager' and agent_id in (select c from manager_chain_ids() as c));
create policy agent_weekly_sales_select_self on agent_weekly_sales
  for select to authenticated
  using (agent_id = current_app_user_id());

create policy agent_zero_seller_status_select_qa on agent_zero_seller_status
  for select to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager', 'qa_auditor'));
create policy agent_zero_seller_status_select_team_lead on agent_zero_seller_status
  for select to authenticated
  using (current_app_role() = 'team_lead' and agent_id in (select t from team_agent_ids() as t));
create policy agent_zero_seller_status_select_manager on agent_zero_seller_status
  for select to authenticated
  using (current_app_role() = 'manager' and agent_id in (select c from manager_chain_ids() as c));
create policy agent_zero_seller_status_select_self on agent_zero_seller_status
  for select to authenticated
  using (agent_id = current_app_user_id());
-- No write policies for anyone: written only by recompute_weekly_sales().

-- ── who counts, for which weeks ──────────────────────────────
-- An agent is judged for a week only if they were an active, certified
-- agent for the WHOLE week: role agent, is_active, employment_stage
-- 'active', joining_date on or before the week's Saturday. That keeps OJT
-- trainees, leavers and mid-week joiners out of the zero-seller list.
-- (Uses the agent's CURRENT stage/active flag — there is no stage history
-- to consult per week; someone deactivated later drops out of every week.)
create or replace function weekly_sales_eligible(p_first date, p_last date)
returns table (agent_id uuid, week_start date)
language sql
stable
set search_path = public
as $$
  select u.id, w::date
    from users u
    cross join generate_series(p_first::timestamp, p_last::timestamp, interval '7 days') as w
   where u.role = 'agent'
     and u.is_active
     and u.employment_stage = 'active'
     and u.joining_date is not null
     and u.joining_date <= w::date
$$;

-- ── the job ──────────────────────────────────────────────────
-- Weeks computed: from the first week whose Saturday is strictly AFTER the
-- oldest loaded sale's day (the oldest day can be partial — the backfill
-- cuts pages mid-day — so a week is only trusted once data reaches the day
-- before it starts) to the latest week that has both ENDED and is followed
-- by loaded data (a week is complete only if newer data exists past its
-- Friday, and it is in the past as of p_as_of).
create or replace function recompute_weekly_sales(p_as_of timestamptz default now())
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_min date;
  v_max date;
  v_today date := (p_as_of at time zone 'Asia/Dhaka')::date;
  v_first date;
  v_last date;
  v_limit date;
  v_rows int;
  v_zero int;
begin
  select (min(purchase_created_at) at time zone 'Asia/Dhaka')::date,
         (max(purchase_created_at) at time zone 'Asia/Dhaka')::date
    into v_min, v_max
    from agent_revenue_transactions;

  if v_min is null then
    return jsonb_build_object('weeks', 0, 'note', 'no revenue data loaded yet — nothing to compute');
  end if;

  v_first := sales_week_start(v_min) + 7;
  v_limit := least(v_today, v_max);
  v_last := sales_week_start(v_limit - 7); -- latest Saturday whose Friday is before v_limit

  if v_last < v_first then
    return jsonb_build_object(
      'weeks', 0,
      'data_from', v_min, 'data_to', v_max,
      'note', 'loaded data does not yet fully cover a completed sales week'
    );
  end if;

  with revenue as (
    select agent_id,
           sales_week_start((purchase_created_at at time zone 'Asia/Dhaka')::date) as week_start,
           sum(revenue_amount) as total
      from agent_revenue_transactions
     where agent_id is not null
     group by 1, 2
  ), computed as (
    select e.agent_id, e.week_start, coalesce(r.total, 0) as total
      from weekly_sales_eligible(v_first, v_last) e
      left join revenue r on r.agent_id = e.agent_id and r.week_start = e.week_start
  )
  insert into agent_weekly_sales (agent_id, week_start, week_end, total_revenue, is_zero_seller, computed_at)
  select agent_id, week_start, week_start + 6, total, total = 0, now() from computed
  on conflict (agent_id, week_start) do update
    set week_end = excluded.week_end,
        total_revenue = excluded.total_revenue,
        is_zero_seller = excluded.is_zero_seller,
        computed_at = excluded.computed_at;

  -- drop rows in the range that are no longer valid (e.g. agent deactivated since)
  delete from agent_weekly_sales w
   where w.week_start between v_first and v_last
     and not exists (
       select 1 from weekly_sales_eligible(v_first, v_last) e
        where e.agent_id = w.agent_id and e.week_start = w.week_start
     );

  -- streaks: leading run of zero-seller weeks counted back from each
  -- agent's most recent computed week (rn = 1 is the latest).
  with ranked as (
    select agent_id, week_start, is_zero_seller,
           row_number() over (partition by agent_id order by week_start desc) as rn
      from agent_weekly_sales
  ), streak as (
    select agent_id,
           coalesce(min(rn) filter (where not is_zero_seller), max(rn) + 1) - 1 as weeks
      from ranked
     group by agent_id
  ), start_week as (
    select r.agent_id, r.week_start
      from ranked r join streak s on s.agent_id = r.agent_id and r.rn = s.weeks and s.weeks > 0
  ), last_sale as (
    select agent_id, max((purchase_created_at at time zone 'Asia/Dhaka')::date) as d
      from agent_revenue_transactions
     where agent_id is not null
     group by agent_id
  )
  insert into agent_zero_seller_status (agent_id, current_streak_weeks, streak_start_week, last_sale_date, updated_at)
  select s.agent_id, s.weeks::int, sw.week_start, ls.d, now()
    from streak s
    left join start_week sw on sw.agent_id = s.agent_id
    left join last_sale ls on ls.agent_id = s.agent_id
  on conflict (agent_id) do update
    set current_streak_weeks = excluded.current_streak_weeks,
        streak_start_week = excluded.streak_start_week,
        last_sale_date = excluded.last_sale_date,
        updated_at = excluded.updated_at;

  delete from agent_zero_seller_status z
   where not exists (select 1 from agent_weekly_sales w where w.agent_id = z.agent_id);

  select count(*), count(*) filter (where is_zero_seller)
    into v_rows, v_zero
    from agent_weekly_sales where week_start between v_first and v_last;

  return jsonb_build_object(
    'first_week', v_first, 'last_week', v_last,
    'weeks', ((v_last - v_first) / 7) + 1,
    'agent_week_rows', v_rows, 'zero_seller_weeks', v_zero,
    'data_from', v_min, 'data_to', v_max
  );
end;
$$;

-- Callable by the service role (scripts / a future daily-sync cron) and by
-- the SQL editor's postgres role — never by a signed-in app user.
revoke all on function recompute_weekly_sales(timestamptz) from public;
grant execute on function recompute_weekly_sales(timestamptz) to service_role;

-- ── views ────────────────────────────────────────────────────
-- The "one-click" view from the design doc, with names attached. Runs
-- with the CALLER's rights (security_invoker), so each role sees only the
-- rows their access above allows — QA all, Team Lead their team, Manager
-- their chain, an agent themselves.
--   select * from zero_seller_leaderboard;
create view zero_seller_leaderboard with (security_invoker = true) as
  select u.name, u.email, u.team_name, u.site_name,
         z.current_streak_weeks, z.streak_start_week, z.last_sale_date, z.updated_at
    from agent_zero_seller_status z
    join users u on u.id = z.agent_id
   order by z.current_streak_weeks desc, z.last_sale_date asc nulls first, u.name;

-- How trustworthy are the numbers right now? Attributed vs unattributed
-- share of what's loaded, and the weeks the rollup covers. Aggregates only,
-- runs as its owner (so it works in the SQL editor), and is NOT granted to
-- app roles — it is an operator's health check, not an app feature.
create view revenue_coverage as
  select
    (select min(purchase_created_at) from agent_revenue_transactions) as data_from,
    (select max(purchase_created_at) from agent_revenue_transactions) as data_to,
    count(*) as events,
    count(*) filter (where agent_id is not null) as attributed_events,
    count(*) filter (where agent_id is null) as unattributed_events,
    round(100.0 * coalesce(sum(revenue_amount) filter (where agent_id is not null), 0)
          / nullif(sum(revenue_amount), 0), 1) as attributed_revenue_pct,
    (select min(week_start) from agent_weekly_sales) as first_week_computed,
    (select max(week_start) from agent_weekly_sales) as last_week_computed
  from agent_revenue_transactions;
revoke all on revenue_coverage from public, anon, authenticated;
grant select on revenue_coverage to service_role;
