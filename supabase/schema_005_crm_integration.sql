-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 005 — CRM call-history integration (§10)
-- Test this whole file in the Supabase SQL Editor before relying on it.
-- Requires schema_001/002/003/004 already applied.
--
-- Creates the `audits` table from §4 early (Step 4 builds the actual
-- scoring workflow on top of it) because Step 3's call-list needs to
-- cross-check crm_call_id against it to compute available/taken/
-- audited status per call.
-- ============================================================

-- ── Agent identity bridge to the CRM ───────────────────────
-- The CRM's `created_by.id` on a call identifies the agent who took it.
-- We resolve that to an internal users row by email on first sight
-- (Shikho's CRM login is the agent's email), then cache the CRM id
-- here so later calls don't need the email lookup again.
alter table users add column crm_agent_id integer unique;

-- ── audits (§4) ─────────────────────────────────────────────
create table audits (
  id uuid primary key default gen_random_uuid(),
  audit_type text not null check (audit_type in ('call','chat','complaint')),
  agent_id uuid not null references users(id),
  auditor_id uuid not null references users(id),
  rubric_id uuid not null references rubrics(id),      -- locked at creation
  item_reference text,                                  -- chat link / complaint ID — calls use structured fields below

  -- Structured CRM call data (populated for audit_type = 'call'; §10)
  crm_lead_id text,
  crm_call_id text,
  call_started_at timestamptz,
  call_ended_at timestamptz,
  call_recording_url text,
  call_status text,
  call_destination text,

  score_percent numeric,
  passed boolean,
  critical_fail boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft','submitted','acknowledged','disputed','resolved')),
  re_audit_of uuid references audits(id),                -- CAPA linkage (§5)
  capa_status text check (capa_status in ('pending_reaudit','passed','failed_again')),
  created_at timestamptz not null default now(),
  submitted_at timestamptz
);

create unique index idx_audits_crm_call_id on audits(crm_call_id) where crm_call_id is not null;
create index idx_audits_agent on audits(agent_id);
create index idx_audits_auditor on audits(auditor_id);
create index idx_audits_status on audits(status);

-- ── RLS ─────────────────────────────────────────────────────
alter table audits enable row level security;

-- Any QA-capable role can see any audit row. This is broader than
-- "own queue" (role table in §2) but is required for the call-status
-- cross-check in Step 3: a qa_auditor must be able to tell that a call
-- is already claimed/audited by a DIFFERENT auditor, not just their
-- own — otherwise two auditors could silently duplicate the same
-- call. Column-level restriction of sensitive score fields (so one
-- auditor can't casually browse another's completed scores) is a
-- Step 12 (Dashboards) concern, not enforced at the RLS layer here.
create policy audits_select_qa on audits
  for select
  using (current_app_role() in ('super_admin','qa_manager','qa_auditor','team_lead'));

create policy audits_insert_own on audits
  for insert
  with check (
    current_app_role() in ('super_admin','qa_manager','qa_auditor','team_lead')
    and auditor_id = current_app_user_id()
  );

-- Owning auditor can update their own draft; admins can update any row
-- (needed once Step 4 adds scoring, and for corrections).
create policy audits_update_own_draft_or_admin on audits
  for update
  using (
    (auditor_id = current_app_user_id() and status = 'draft')
    or current_app_role() in ('super_admin','qa_manager')
  )
  with check (
    (auditor_id = current_app_user_id() and status = 'draft')
    or current_app_role() in ('super_admin','qa_manager')
  );

-- Owning auditor can delete (release) their own still-draft claim;
-- admins can delete any row. No delete policy exists for
-- submitted/acknowledged/disputed/resolved audits by anyone but
-- admins — matches the immutable-audit-trail principle in §1.
create policy audits_delete_own_draft_or_admin on audits
  for delete
  using (
    (auditor_id = current_app_user_id() and status = 'draft')
    or current_app_role() in ('super_admin','qa_manager')
  );

-- ── Broadened users visibility for QA roles ────────────────
-- Step 1's users_select_self policy only let a signed-in user see
-- their own row plus their direct org chart (their TL/manager/QA/
-- trainer, and people who report to them). That's too narrow for
-- this step: a qa_auditor or team_lead must be able to search/confirm
-- ANY agent system-wide when matching a CRM call to an internal user
-- (audits are not restricted to "your own team" per §2's role table —
-- only team_lead's own audit *queue* is team-scoped, not their ability
-- to look up who an agent is). RLS SELECT policies on the same table
-- are OR'd together, so this adds visibility without removing the
-- narrower self/org-chart policy agents still rely on.
create policy users_select_qa_roles on users
  for select
  using (current_app_role() in ('super_admin','qa_manager','qa_auditor','team_lead'));
