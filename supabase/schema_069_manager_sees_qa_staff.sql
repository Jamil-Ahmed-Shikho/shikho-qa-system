-- ============================================================
-- A Manager may now read QA staff names too — Jamil, 2026-10-04:
-- "give manager access to see auditor names too." The new
-- /dashboard/manager/agent/[agentId] profile/history pages (built
-- 2026-10-03) correctly showed "—" for Auditor because a Manager had
-- never had this grant (schema_008 gave it to team_lead only) — flagged
-- then as a real gap, not fixed, since it's an access-control decision;
-- now confirmed. Same reasoning as the Team Lead grant: QA staff are
-- colleagues, not team data, so a Manager needs to see who audited their
-- chain's agents ("audited by …") without that being "org-chart access".
-- ============================================================

create policy users_select_qa_staff_for_manager on users
  for select
  using (current_app_role() = 'manager' and role in ('qa_auditor', 'qa_manager'));
