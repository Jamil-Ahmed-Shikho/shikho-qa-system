-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 061 — a QA Auditor with a team_name set on their own profile may
-- only audit agents on that same team (Jamil, 2026-10-02: "give access to
-- TS3P only" for naznin.mitu, the TS3P-only auditor — flagged as a real
-- gap in CLAUDE.md §2's real-roster-import notes: "the system does NOT
-- technically stop a QA Auditor from opening and scoring a call for any
-- agent on any team").
--
-- Most QA Auditors have no team_name set and are completely unaffected —
-- this only restricts someone whose own profile is explicitly tagged to
-- one team. Super Admin/QA Manager are never restricted (team_name is
-- purely informational for them, §2); a Team Lead already has its own,
-- separate restriction via team_agent_ids(), untouched here.
--
-- Mirrors the app-layer check added to startAudit() (src/lib/audits/
-- actions.ts) — the app check gives a clear error message, this is the
-- actual authorization boundary (this table's own established principle,
-- stated in that file's own header comment).
-- ============================================================

drop policy if exists audits_insert_own on audits;
create policy audits_insert_own on audits for insert
to authenticated
with check (
  auditor_id = current_app_user_id()
  and (
    current_app_role() = any (array['super_admin', 'qa_manager'])
    or (
      current_app_role() = 'qa_auditor'
      and (
        (select u.team_name from users u where u.id = current_app_user_id()) is null
        or (select u.team_name from users u where u.id = current_app_user_id())
           = (select u2.team_name from users u2 where u2.id = audits.agent_id)
      )
    )
    or (current_app_role() = 'team_lead' and agent_id in (select t.t from team_agent_ids() t(t)))
  )
);
