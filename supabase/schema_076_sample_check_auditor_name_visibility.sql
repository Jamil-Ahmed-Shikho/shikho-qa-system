-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 076 — the same "agent never" fix as schema_075, for the one
-- policy that was missed there: users_select_auditor_for_agent
-- (schema_059) lets an agent read the NAME of whoever audited them — it
-- should not do that for a Sample Check either (the agent would see a
-- name with no audit to explain it, since schema_075 already hides the
-- Sample Check itself). Apply after schema_075.
-- ============================================================

drop policy if exists users_select_auditor_for_agent on users;
create policy users_select_auditor_for_agent on users for select
to authenticated
using (
  current_app_role() = 'agent'
  and exists (
    select 1 from audits a
    where a.auditor_id = users.id
      and a.agent_id = current_app_user_id()
      and a.status <> 'draft'
      and a.check_mode = 'audit'
  )
);
