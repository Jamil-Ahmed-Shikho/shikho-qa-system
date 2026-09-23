-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 009 — a Manager tag grants no read access on its own
-- Test this in the Supabase SQL Editor before relying on it.
-- Requires schema_001 … 008 already applied.
--
-- Gap being closed: schema_001's users_select_self let anyone read the
-- profile row of every user whose manager_id pointed at them. So tagging
-- an agent to a Manager who is NOT in that agent's Team Leader chain
-- (an orphan, or a cross-tag to another Manager's agent) still let that
-- Manager open the agent's profile — contradicting "Managers see people
-- only through the real Team Leader chain".
--
-- Now: a Manager sees people only via manager_chain_ids() (schema_007):
-- their Team Leads (role team_lead, manager_id = them) and those Team
-- Leads' agents. users.manager_id on an AGENT stays in the data as
-- informational only.
--
-- Nothing else relied on the branch being removed:
--   - a Manager's Team Leads are in the chain (users_select_manager_chain);
--   - super_admin / qa_manager read everyone (BPO Team Leads tagged to a
--     QA Manager are covered by that);
--   - Team Leads read their own agents via the team_leader_id branch,
--     which stays.
--
-- ALTER POLICY is a single atomic statement, so there is no window
-- without a policy (unlike drop + create).
-- ============================================================

alter policy users_select_self on users
  using (
    auth_id = auth.uid()
    or team_leader_id = current_app_user_id()
    or quality_auditor_id = current_app_user_id()
    or current_app_role() in ('super_admin', 'qa_manager')
  );
