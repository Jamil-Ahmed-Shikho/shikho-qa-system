-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 001 — Foundation: users, audit_log
-- Test this whole file in the Supabase SQL Editor before relying on it.
-- ============================================================

create extension if not exists "pgcrypto";

-- ── users ───────────────────────────────────────────────────
-- auth_id bridges this table to Supabase Auth (auth.users). Not part of
-- the original design doc's column list — added here because every
-- login needs it to resolve a Supabase session to an app-level profile.
create table users (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  email text unique not null,
  emp_id text unique,
  role text not null check (role in ('super_admin','qa_manager','qa_auditor','team_lead','agent')),
  joining_date date,                 -- null until OJT is certified
  employment_stage text not null default 'active'
    check (employment_stage in ('ojt','re_training','active','not_certified','discontinued')),
  ojt_start_date date,
  team_name text,                    -- 'Telesales','CX Non-Voice','CX Inbound','Engagement','Retention','TS3P','BPO'
  site_name text,                    -- 'Dhaka','Jashore'
  team_leader_id uuid references users(id),
  manager_id uuid references users(id),
  quality_auditor_id uuid references users(id),
  trainer_id uuid references users(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_users_role on users(role);
create index idx_users_team_leader on users(team_leader_id);
create index idx_users_manager on users(manager_id);
create index idx_users_employment_stage on users(employment_stage);

-- ── audit_log ───────────────────────────────────────────────
-- Immutable log covering every write in the system (§1) — not just
-- complaints/audits. Application code inserts here; nothing updates
-- or deletes rows.
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references users(id),
  action text not null,
  table_name text not null,
  record_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index idx_audit_log_table_record on audit_log(table_name, record_id);
create index idx_audit_log_actor on audit_log(actor_id);

-- ── RLS ─────────────────────────────────────────────────────
alter table users enable row level security;
alter table audit_log enable row level security;

-- Helper: current app-level user id and role for the logged-in session.
-- SECURITY DEFINER is required here, not optional: these functions query
-- `users`, and `users_select_self` below calls them — a plain (non
-- security definer) function would still be subject to RLS internally,
-- so its query would re-trigger the same policy, which calls the
-- function again, forever ("infinite recursion detected in policy for
-- relation users"). SECURITY DEFINER makes the internal lookup bypass
-- RLS, breaking the cycle. search_path is locked down as required
-- whenever a function is SECURITY DEFINER.
create or replace function current_app_user_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select id from users where auth_id = auth.uid()
$$;

create or replace function current_app_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from users where auth_id = auth.uid()
$$;

revoke all on function current_app_user_id() from public;
revoke all on function current_app_role() from public;
grant execute on function current_app_user_id() to authenticated;
grant execute on function current_app_role() to authenticated;

-- Everyone signed in can read their own row and their org chart
-- (their TL/manager/QA/trainer, and anyone who reports to them).
create policy users_select_self on users
  for select
  using (
    auth_id = auth.uid()
    or team_leader_id = current_app_user_id()
    or manager_id = current_app_user_id()
    or quality_auditor_id = current_app_user_id()
    or current_app_role() in ('super_admin','qa_manager')
  );

-- Only super_admin / qa_manager can write user records for now.
-- (team_lead-scoped writes, e.g. OJT actions, are added in §7's step.)
create policy users_write_admin on users
  for all
  using (current_app_role() in ('super_admin','qa_manager'))
  with check (current_app_role() in ('super_admin','qa_manager'));

-- audit_log: readable by super_admin/qa_manager only; inserts happen
-- via the service-role client from server-side code, bypassing RLS.
create policy audit_log_select_admin on audit_log
  for select
  using (current_app_role() in ('super_admin','qa_manager'));
