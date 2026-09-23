-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 019 — Currency conversion rate for revenue reporting (§8 addendum)
-- Test this in the Supabase SQL Editor before relying on it.
-- Requires schema_018 already applied.
--
-- cf_amount (agent_revenue_transactions.revenue_amount, schema_018) is BDT,
-- confirmed, and is stored as the raw BDT figure at ingestion — no
-- conversion happens on write. A USD display anywhere (dashboard, report)
-- converts at READ time, using whichever rate was in force on that
-- transaction's purchase_created_at — never today's rate applied
-- retroactively — same "never rewrite history with a later policy change"
-- principle as status_thresholds (schema_011) and rubric versions.
-- ============================================================

create table currency_conversion_rates (
  id uuid primary key default gen_random_uuid(),
  bdt_per_usd numeric not null,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,                   -- null = the current row
  created_by uuid references users(id),
  constraint currency_conversion_rates_rate_ok check (bdt_per_usd > 0),
  constraint currency_conversion_rates_period
    check (effective_to is null or effective_to >= effective_from)
);

-- At most one open (current) rate at a time.
create unique index uq_currency_conversion_rates_open
  on currency_conversion_rates ((true)) where effective_to is null;

alter table currency_conversion_rates enable row level security;

-- Readable by anyone signed in — a USD display could appear on any role's
-- dashboard (agent's own score card, Team Lead rollups, etc.), and the rate
-- itself carries no sensitive information.
create policy currency_conversion_rates_select on currency_conversion_rates
  for select to authenticated using (true);

create policy currency_conversion_rates_write_admin on currency_conversion_rates
  for all to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager'))
  with check (current_app_role() in ('super_admin', 'qa_manager'));

-- Confirmed current rate (per the user, 2026-09-23): 110 BDT = 1 USD.
insert into currency_conversion_rates (bdt_per_usd) values (110);

-- Changing the rate = supersede, never edit in place — same pattern as
-- set_status_thresholds(). Runs with the caller's rights, so only
-- super_admin / qa_manager can use it (the table's write policy).
--   select set_currency_conversion_rate(112);
create or replace function set_currency_conversion_rate(p_bdt_per_usd numeric)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid;
begin
  update currency_conversion_rates
     set effective_to = now()
   where effective_to is null;

  insert into currency_conversion_rates (bdt_per_usd, effective_from, created_by)
  values (p_bdt_per_usd, now(), current_app_user_id())
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function set_currency_conversion_rate(numeric) from public;
grant execute on function set_currency_conversion_rate(numeric) to authenticated;

-- The rate in force at a given moment — what any USD display should use,
-- keyed off the transaction's own purchase_created_at, not "now". Falls
-- back to the earliest known rate if asked about a time before any row's
-- effective_from (defensive; shouldn't happen once the seed row exists).
create or replace function currency_rate_at(p_at timestamptz)
returns numeric
language sql
stable
set search_path = public
as $$
  select bdt_per_usd
    from currency_conversion_rates
   where effective_from <= p_at
     and (effective_to is null or effective_to > p_at)
   order by effective_from desc
   limit 1;
$$;

revoke all on function currency_rate_at(timestamptz) from public;
grant execute on function currency_rate_at(timestamptz) to authenticated;
