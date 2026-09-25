-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 030 — Weekly-sales completeness guard: trust a week once a successful sync ran after it ended (§6.3)
-- Test this in the Supabase SQL Editor before relying on it.
-- Requires schema_022 (weekly sales) and schema_018 (revenue_sync_state). Apply after 029.
--
-- THE PROBLEM. recompute_weekly_sales() only counted a week once a loaded sale dated AFTER that week's
-- Friday existed (proof the data reached past the week). So the last completed week showed
-- "Not available yet" for EVERY agent until the first sale of the next week happened to be synced —
-- a day or two of lag, longer over a quiet weekend.
--
-- THE CHANGE. A week now also counts once a fully successful daily sync STARTED after the week ended:
-- that sync fetched everything the CRM had created up to its start, which is the real evidence the
-- week is complete. Recorded as revenue_sync_state.data_complete_through (the start time of the last
-- sync whose window was fully fetched); the running sync also passes its own start straight into the
-- recompute, because it recomputes BEFORE it records itself. The old evidence (a later sale) still counts;
-- the LATEST of the evidence wins. It is still capped at "now", so a week can never be counted before it
-- has ended, and a stale sync (none since the week ended) still leaves the week uncomputed.
--
-- NOT CHANGED: WHICH agents are counted for a week — weekly_sales_eligible() (active, certified, joined
-- on/before the Saturday, an agent) — the totals, the "oldest loaded day may be partial" start rule, and
-- the streak logic are carried over verbatim from schema_022.
--
-- Adding a parameter would create a second overload, so the old one-argument function is DROPPED first.
-- ============================================================

alter table revenue_sync_state add column if not exists data_complete_through timestamptz;

-- The existing daily row: its last run was a fully successful one. Use its recorded finish time minus a
-- 5-minute margin (the true start time wasn't stored), which errs on the side of "less complete".
update revenue_sync_state
   set data_complete_through = last_run_at - interval '5 minutes'
 where id = 'daily' and last_run_status = 'ok' and last_run_at is not null and data_complete_through is null;

drop function if exists recompute_weekly_sales(timestamptz);

create or replace function recompute_weekly_sales(p_as_of timestamptz default now(), p_synced_through timestamptz default null)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_min date;
  v_max date;
  v_max_ts timestamptz;
  v_stored_through timestamptz;
  v_data_through timestamptz;
  v_data_day date;
  v_today date := (p_as_of at time zone 'Asia/Dhaka')::date;
  v_first date;
  v_last date;
  v_limit date;
  v_rows int;
  v_zero int;
begin
  select (min(purchase_created_at) at time zone 'Asia/Dhaka')::date,
         (max(purchase_created_at) at time zone 'Asia/Dhaka')::date,
         max(purchase_created_at)
    into v_min, v_max, v_max_ts
    from agent_revenue_transactions;

  if v_min is null then
    return jsonb_build_object('weeks', 0, 'note', 'no revenue data loaded yet — nothing to compute');
  end if;

  v_first := sales_week_start(v_min) + 7;

  -- HOW FAR IS THE LOADED DATA KNOWN TO BE COMPLETE? (the completeness guard)
  -- Two kinds of evidence, the LATEST of which counts:
  --   (a) a loaded sale exists at that time (the original rule), and
  --   (b) a fully successful sync STARTED at that time — everything the CRM had created before it
  --       was fetched. p_synced_through is the running sync's own start (it calls this before it records
  --       itself); revenue_sync_state.data_complete_through is the last such start on file.
  -- Without (b) a week could not be trusted until the first sale of the FOLLOWING week happened to be
  -- loaded, which can be a day or two after it ends. It is still bounded by p_as_of below, so a week
  -- can never be counted before it has actually ended, and a stale sync (none since the week ended)
  -- still leaves the week uncomputed.
  select data_complete_through into v_stored_through from revenue_sync_state where id = 'daily';
  v_data_through := greatest(v_max_ts, coalesce(p_synced_through, v_max_ts), coalesce(v_stored_through, v_max_ts));
  v_data_day := (v_data_through at time zone 'Asia/Dhaka')::date;

  v_limit := least(v_today, v_data_day);
  v_last := sales_week_start(v_limit - 7); -- latest Saturday whose Friday is before v_limit

  if v_last < v_first then
    return jsonb_build_object(
      'weeks', 0,
      'data_from', v_min, 'data_to', v_max, 'data_complete_through', v_data_through,
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
    'data_from', v_min, 'data_to', v_max, 'data_complete_through', v_data_through
  );
end;
$$;
-- Callable by the service role (scripts / the daily sync) and the SQL editor's postgres role — never by a signed-in app user.
revoke all on function recompute_weekly_sales(timestamptz, timestamptz) from public;
grant execute on function recompute_weekly_sales(timestamptz, timestamptz) to service_role;
