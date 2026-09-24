-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 023 — "still in the CRM?" tracking for synced revenue events (§8)
-- Test this in the Supabase SQL Editor before relying on it.
-- Requires schema_018 already applied.
--
-- The daily sync re-fetches a rolling 15-day window and UPSERTS it. An
-- event that used to be in that window but stops appearing is probably a
-- cancellation or refund — but we don't know that, so we do NOT delete
-- our copy and do NOT guess a reason. We only FLAG it for a person to
-- review:
--   last_seen_at            when a sync/backfill last saw this event in the CRM
--   missing_from_crm_since  set the first time a complete window fetch did
--                           not return it; cleared automatically if it
--                           reappears (the next upsert writes null again)
-- Flagged rows keep counting in totals until someone decides otherwise.
-- ============================================================

alter table agent_revenue_transactions
  add column last_seen_at timestamptz,
  add column missing_from_crm_since timestamptz;

-- Rows loaded before this migration were, by definition, seen when synced.
update agent_revenue_transactions set last_seen_at = last_synced_at where last_seen_at is null;

alter table agent_revenue_transactions
  alter column last_seen_at set not null,
  alter column last_seen_at set default now();

create index idx_agent_revenue_transactions_missing
  on agent_revenue_transactions(missing_from_crm_since)
  where missing_from_crm_since is not null;

-- Flag events inside the window that a COMPLETE fetch did not return.
--   p_run_started : when this sync run began — anything seen since then was returned
--   p_window_from : only events created at/after this are eligible. The caller
--                   passes a point safely INSIDE the fetched window (the CRM's
--                   "last N days" edge is fuzzy), so an event near the edge that
--                   merely fell outside the window is never flagged by mistake.
-- Returns how many rows were newly flagged. Never deletes, never changes amounts.
-- The caller must only run this after a fetch that finished cleanly (every
-- page, no errors) — a partial fetch would wrongly flag everything unseen.
create or replace function flag_missing_revenue_events(p_run_started timestamptz, p_window_from timestamptz)
returns int
language sql
set search_path = public
as $$
  with flagged as (
    update agent_revenue_transactions
       set missing_from_crm_since = now()
     where source = 'crm_api'
       and purchase_created_at >= p_window_from
       and last_seen_at < p_run_started
       and missing_from_crm_since is null
    returning 1
  )
  select count(*)::int from flagged
$$;

revoke all on function flag_missing_revenue_events(timestamptz, timestamptz) from public;
grant execute on function flag_missing_revenue_events(timestamptz, timestamptz) to service_role;

-- The review list. Operator view (SQL editor / service role) — not granted to app roles.
--   select * from revenue_events_missing_from_crm;
create view revenue_events_missing_from_crm as
  select crm_event_id, agent_id, lead_owner_crm_id, revenue_amount, course_name,
         purchase_created_at, last_seen_at, missing_from_crm_since
    from agent_revenue_transactions
   where missing_from_crm_since is not null
   order by missing_from_crm_since desc, purchase_created_at desc;
revoke all on revenue_events_missing_from_crm from public, anon, authenticated;
grant select on revenue_events_missing_from_crm to service_role;
