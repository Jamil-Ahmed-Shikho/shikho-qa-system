-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 029 — Revenue in USD, converted per sale (§8)
-- Test this in the Supabase SQL Editor before relying on it.
-- Requires schema_018 (revenue) and schema_019 (currency rates). Apply after 028.
--
-- Revenue is STORED in BDT (cf_amount, unchanged). To show US dollars, each
-- sale is converted at the rate that was in force ON THAT SALE'S OWN DATE
-- (currency_rate_at(purchase_created_at)) — never today's rate applied
-- retroactively, so a later rate change cannot rewrite what a past week
-- was worth (§1, §8).
--
-- 1. FIX: currency_rate_at() promised (schema_019's own comment) to fall back
--    to the earliest known rate for a time before any rate row begins, but the
--    code did not: the seeded rate starts on the day the table was created, so a
--    sale from before that date converted to NULL — and a NULL inside sum() is
--    silently DROPPED, understating the total. Now it falls back as documented.
--    (With one rate on file today this changes nothing else.)
-- 2. NEW: agent_revenue_usd(agent, from, to) — the USD total of one agent's
--    attributed sales in [from, to), summed per sale. Runs with the CALLER's
--    rights, so it sees exactly the revenue rows the caller may already see
--    (QA all, a Team Lead their team, a Manager their chain, the agent their own).
-- ============================================================

create or replace function currency_rate_at(p_at timestamptz)
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce(
    -- the rate in force at that moment
    (select bdt_per_usd
       from currency_conversion_rates
      where effective_from <= p_at
        and (effective_to is null or effective_to > p_at)
      order by effective_from desc
      limit 1),
    -- before any rate began: the earliest rate we know
    (select bdt_per_usd
       from currency_conversion_rates
      order by effective_from asc
      limit 1)
  );
$$;

revoke all on function currency_rate_at(timestamptz) from public;
grant execute on function currency_rate_at(timestamptz) to authenticated, service_role;

create or replace function agent_revenue_usd(p_agent_id uuid, p_from timestamptz, p_to timestamptz default null)
returns numeric
language plpgsql
stable
set search_path = public
as $$
declare
  v_total numeric;
begin
  if not exists (select 1 from currency_conversion_rates) then
    raise exception 'No BDT/USD conversion rate is configured, so revenue cannot be shown in dollars.';
  end if;

  select coalesce(sum(t.revenue_amount / currency_rate_at(t.purchase_created_at)), 0)
    into v_total
    from agent_revenue_transactions t
   where t.agent_id = p_agent_id
     and t.purchase_created_at >= p_from
     and (p_to is null or t.purchase_created_at < p_to);

  return v_total;
end;
$$;

revoke all on function agent_revenue_usd(uuid, timestamptz, timestamptz) from public;
grant execute on function agent_revenue_usd(uuid, timestamptz, timestamptz) to authenticated, service_role;
