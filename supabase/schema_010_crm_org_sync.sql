-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 010 — remember what the CRM says about who reports to whom
-- Test this in the Supabase SQL Editor before relying on it.
-- Requires schema_001 … 009 already applied.
--
-- The CRM keeps its own reporting line (agent -> Team Leader -> Manager).
-- To spot where our org data and the CRM's disagree, we remember, per
-- person, WHO THE CRM SAYS THEY REPORT TO and when we last asked:
--   - on an agent row: the CRM's Team Leader for them
--   - on a team_lead row: the CRM's Manager for them
-- Whether that is "in sync" is NOT stored — it is worked out at read
-- time by comparing this against our current team_leader_id /
-- manager_id, so correcting our data in Users clears the flag at once,
-- with no new CRM call.
--
-- System-computed, like crm_agent_id: written only by the server with
-- the service-role client, only when a matched agent comes up on the
-- call list and their check is more than 24 hours old (no scheduled
-- sweep). No RLS change — the columns follow the row's existing policies.
-- ============================================================

alter table users
  add column crm_reporting_to_id integer,        -- the CRM user id they report to (null = CRM has none / not checked)
  add column crm_reporting_to_name text,
  add column crm_reporting_to_email text,         -- lets us tell who that is in OUR system
  add column crm_org_checked_at timestamptz;      -- null = never checked
