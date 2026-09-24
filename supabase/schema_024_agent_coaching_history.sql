-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 024 — An agent's coaching history, for the scheduler (§5)
-- Test this in the Supabase SQL Editor before relying on it.
-- Requires schema_021 (briefings) already applied.
--
-- Why a function: schema_021 lets a QA Auditor read only the briefings
-- THEY conduct ("My View" — their own coaching schedule). But the person
-- about to schedule coaching for an agent needs the agent's WHOLE
-- history — including sessions another auditor booked — to judge urgency
-- and to avoid double-booking someone who already has a session coming
-- up. That is a "Team View" question (§2 standing principle), so it gets
-- its own narrow, role-gated window rather than widening the briefings
-- read policy (which would also hand every QA Auditor everyone's whole
-- coaching schedule on the dashboard views).
--
-- Returns only what the "Schedule Coaching?" screen shows: when, status,
-- attendance, priority, and who conducted it. Cancelled sessions are left
-- out — they didn't happen and aren't upcoming. Newest first, capped.
-- Callable only by the scheduling roles; anyone else gets zero rows.
-- ============================================================

create or replace function agent_coaching_history(p_agent_id uuid)
returns table (
  briefing_id uuid,
  audit_id uuid,
  scheduled_at timestamptz,
  status text,
  attended boolean,
  priority text,
  conductor_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.audit_id, b.scheduled_at, b.status, b.attended, b.priority, u.name
    from briefings b
    join users u on u.id = b.conducted_by
   where b.agent_id = p_agent_id
     and b.status <> 'cancelled'
     and current_app_role() in ('super_admin', 'qa_manager', 'qa_auditor')
   order by b.scheduled_at desc
   limit 20
$$;

revoke all on function agent_coaching_history(uuid) from public;
grant execute on function agent_coaching_history(uuid) to authenticated;
