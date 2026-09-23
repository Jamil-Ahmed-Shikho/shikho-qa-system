-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 020 — Profile-only accounts (§2 addendum)
-- Test this in the Supabase SQL Editor before relying on it.
-- Requires schema_001 (users) already applied.
--
-- Why: the system is still local/in development. Bulk-importing the real
-- ~300-person roster the normal way (§2, createAccount) creates a live
-- Supabase Auth login AND emails a temporary password to every person —
-- not appropriate before the system is actually ready for them to use.
-- What's needed instead: import PROFILE data (name, email, team, site,
-- CRM matching fields) so revenue/call matching works immediately,
-- without creating a login or sending anything, until an admin later
-- explicitly activates that person.
--
-- No RLS/matching change needed: users.auth_id (schema_001) was already
-- nullable (`unique references auth.users(id) on delete set null`), and
-- every RLS helper (current_app_user_id/current_app_role, schema_001-002)
-- matches on `auth_id = auth.uid()` — a null auth_id simply never matches
-- any caller, so a profile-only row is inert for login purposes with zero
-- schema changes there. Agent-matching (src/lib/audits/agent-matching.ts,
-- scripts/backfill-revenue.mjs) reads users.email / users.crm_agent_id
-- only — neither reads account_status or auth_id — so matching is
-- unaffected regardless of activation state, confirming there's no
-- technical complication on that side either.
-- ============================================================

alter table users add column account_status text not null default 'active'
  check (account_status in ('profile_only', 'active'));

-- Every row created before this migration already has a real login
-- (the only way accounts were ever created up to now) — the 'active'
-- default backfills them correctly with no separate UPDATE needed.

comment on column users.account_status is
  'profile_only = no Supabase Auth login exists yet (auth_id is null); '
  'active = has a real login (created at signup, or later via "Activate & invite").';
