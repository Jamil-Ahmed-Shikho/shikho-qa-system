-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 033 — Calibration sessions, Stage 4: the results email (§5)
-- Test this in the Supabase SQL Editor before relying on it. Apply after 032.
--
-- The variance report is emailed to the session's participants ONLY when the scheduler (or a QA Manager /
-- Super Admin) presses "Send report" on a CLOSED session — never automatically. This migration adds:
--   * report_sent_at / report_sent_by on the session (a real send records itself; a test-mode send does not);
--   * calibration_report_recipients(): the participants' names and emails, released ONLY to the scheduler or a
--     QA Manager / Super Admin, and only once the session is closed (a QA Auditor cannot otherwise read a
--     Team Lead's email through this).
-- The email itself is sent by the app (SMTP); it is off unless CALIBRATION_REPORT_MODE is set.
-- ============================================================

alter table calibration_sessions
  add column if not exists report_sent_at timestamptz,
  add column if not exists report_sent_by uuid references users(id);

create or replace function calibration_report_recipients(p_id uuid)
returns table (user_id uuid, name text, email text, submitted boolean)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_me uuid := current_app_user_id();
  v_role text := current_app_role();
  s calibration_sessions%rowtype;
begin
  select * into s from calibration_sessions where id = p_id;
  if not found then return; end if;
  if v_role not in ('super_admin', 'qa_manager') and s.created_by is distinct from v_me then return; end if;
  if s.status <> 'closed' then return; end if;
  return query
    select p.user_id, u.name, u.email,
           exists (select 1 from calibration_scores c where c.session_id = p_id and c.user_id = p.user_id)
      from calibration_participants p join users u on u.id = p.user_id
     where p.session_id = p_id
     order by u.name;
end;
$$;
revoke all on function calibration_report_recipients(uuid) from public;
grant execute on function calibration_report_recipients(uuid) to authenticated;
