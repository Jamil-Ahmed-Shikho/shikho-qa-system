-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 036 — Briefings: an agent cannot be double-booked (§5 bug fix, 2026-09-27)
-- Test this in the Supabase SQL Editor before relying on it. Apply after 024 (any time before/after 025-035).
--
-- BUG: scheduling only checked the AUDITOR's own slot (uq_briefings_conductor_slot, schema_021) — two different
-- QA Auditors could each book the SAME agent into the SAME date/time, because nothing checked the agent's side.
-- An agent physically cannot attend two sessions at once, so this is a HARD BLOCK at the database, same pattern
-- as the existing per-auditor slot-collision check, just keyed on agent_id instead of conducted_by. It is NOT the
-- existing "agent already has an upcoming session on a DIFFERENT audit" warn-don't-block confirm (that one is a
-- courtesy UI check for a different slot; this is the exact same slot, on any audit, and it cannot be overridden).
-- A cancelled row frees the slot, exactly like the auditor-side index.
-- ============================================================

create unique index uq_briefings_agent_slot
  on briefings(agent_id, scheduled_at)
  where status <> 'cancelled';
