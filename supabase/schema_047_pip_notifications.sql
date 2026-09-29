-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 047 — PIP rebuild, Stage 7: publish notification emails (§6.4, Section C).
-- Test in the Supabase SQL Editor before relying on it. Apply after 046.
--
-- Deliberately LAST, per Jamil's own instruction: "off by default behind an explicit
-- mode setting, test sends only to plus-addressed test accounts, and going live is a
-- deliberate separate step Jamil sets himself — never automatic-on-publish."
--
-- Only two columns are needed -- everything else (recipients, content) is computed on
-- read by a QA Manager/Super Admin's own already-unrestricted RLS access to pip_candidates
-- (pip_candidates_select_qa) and users (users_select_qa_roles), exactly like every other
-- QA-only screen in this system; no new SECURITY DEFINER function was needed for reading.
-- The write (recording that a send happened) goes through the service role from the
-- server action, the same way Calibration's report_sent_at/by is recorded
-- (src/lib/calibration/report-actions.ts) -- pip_cycles has no write policy for any
-- signed-in role (schema_027), so this can't be done as a plain session-client UPDATE.
-- ============================================================

alter table pip_cycles add column if not exists notifications_sent_at timestamptz;
alter table pip_cycles add column if not exists notifications_sent_by uuid references users(id);
alter table pip_cycles add constraint pip_cycles_notifications_sent_together
  check ((notifications_sent_at is null) = (notifications_sent_by is null));
