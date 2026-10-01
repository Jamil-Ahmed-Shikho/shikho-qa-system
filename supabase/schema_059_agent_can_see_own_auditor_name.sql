-- ============================================================
-- SHIKHO QA SYSTEM — schema_059
-- An agent can read the profile of whoever has audited them.
--
-- BUG FOUND 2026-10-02: the agent's own audit pages (`/my-audits/[id]`,
-- and the agent dashboard's recent-audits list) select
-- `auditor:users!audits_auditor_id_fkey(name)` on the `audits` table,
-- but `users_select_self` only grants a role='agent' reader their OWN
-- row (auth_id = auth.uid()) — never the auditor's row. PostgREST
-- silently returns null for an embed the RLS layer refuses, so the
-- "audited by {name}" line and any auditor-name column have always
-- been blank for a real agent, despite CLAUDE.md (§4, Section D, Q22)
-- documenting "the auditor's name is now selected and displayed" as
-- shipped. Caught while browser-verifying the dashboard redesign.
--
-- Scoped narrowly, same shape as `quality_auditor_id = current_app_user_id()`
-- in `users_select_self`: an agent may read a user's row only when that
-- user has audited them at least once (any non-draft audit, so a CAPA
-- re-audit that hasn't been submitted yet doesn't count either).
-- ============================================================

create policy users_select_auditor_for_agent on users for select
to authenticated
using (
  current_app_role() = 'agent'
  and exists (
    select 1 from audits a
    where a.auditor_id = users.id
      and a.agent_id = current_app_user_id()
      and a.status <> 'draft'
  )
);
