-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 003 — Rubric Engine (§3)
-- Test this whole file in the Supabase SQL Editor before relying on it.
-- Requires schema_001_foundation.sql and schema_002_fix_rls_recursion.sql
-- to already be applied (uses current_app_role()).
-- ============================================================

create table rubrics (
  id uuid primary key default gen_random_uuid(),
  name text not null,                 -- 'Telesales Scorecard' | 'CX Non-Voice' | 'CX Inbound & Engagement'
  version int not null default 1,
  total_points numeric not null default 100,
  is_active boolean not null default true,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table team_rubric_mapping (
  team_name text not null,
  rubric_id uuid not null references rubrics(id) on delete cascade,
  primary key (team_name, rubric_id)
);

create table rubric_categories (
  id uuid primary key default gen_random_uuid(),
  rubric_id uuid not null references rubrics(id) on delete cascade,
  name text not null,
  sort_order int not null
);

create table rubric_parameters (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references rubric_categories(id) on delete cascade,
  name text not null,
  points numeric not null,
  sort_order int not null
);

create table rubric_error_attributes (
  id uuid primary key default gen_random_uuid(),
  parameter_id uuid not null references rubric_parameters(id) on delete cascade,
  description text not null,
  sort_order int not null
);

-- Fatal errors: separate list per rubric, tiered Critical / Major, auto-zero on Critical
create table fatal_parameters (
  id uuid primary key default gen_random_uuid(),
  rubric_id uuid not null references rubrics(id) on delete cascade,
  description text not null,
  severity text not null check (severity in ('critical','major')),
  sort_order int not null
);

create index idx_team_rubric_mapping_rubric on team_rubric_mapping(rubric_id);
create index idx_rubric_categories_rubric on rubric_categories(rubric_id);
create index idx_rubric_parameters_category on rubric_parameters(category_id);
create index idx_rubric_error_attributes_parameter on rubric_error_attributes(parameter_id);
create index idx_fatal_parameters_rubric on fatal_parameters(rubric_id);

-- ── RLS ─────────────────────────────────────────────────────
-- Everyone signed in can read rubric definitions (auditors and team
-- leads need them to conduct audits in Step 4; agents can see what
-- they're scored against). Only super_admin / qa_manager can write —
-- matches the role table in CLAUDE.md §2 ("qa_manager: Rubrics, policies").
alter table rubrics enable row level security;
alter table team_rubric_mapping enable row level security;
alter table rubric_categories enable row level security;
alter table rubric_parameters enable row level security;
alter table rubric_error_attributes enable row level security;
alter table fatal_parameters enable row level security;

create policy rubrics_select_all on rubrics
  for select using (true);
create policy rubrics_write_admin on rubrics
  for all using (current_app_role() in ('super_admin','qa_manager'))
  with check (current_app_role() in ('super_admin','qa_manager'));

create policy team_rubric_mapping_select_all on team_rubric_mapping
  for select using (true);
create policy team_rubric_mapping_write_admin on team_rubric_mapping
  for all using (current_app_role() in ('super_admin','qa_manager'))
  with check (current_app_role() in ('super_admin','qa_manager'));

create policy rubric_categories_select_all on rubric_categories
  for select using (true);
create policy rubric_categories_write_admin on rubric_categories
  for all using (current_app_role() in ('super_admin','qa_manager'))
  with check (current_app_role() in ('super_admin','qa_manager'));

create policy rubric_parameters_select_all on rubric_parameters
  for select using (true);
create policy rubric_parameters_write_admin on rubric_parameters
  for all using (current_app_role() in ('super_admin','qa_manager'))
  with check (current_app_role() in ('super_admin','qa_manager'));

create policy rubric_error_attributes_select_all on rubric_error_attributes
  for select using (true);
create policy rubric_error_attributes_write_admin on rubric_error_attributes
  for all using (current_app_role() in ('super_admin','qa_manager'))
  with check (current_app_role() in ('super_admin','qa_manager'));

create policy fatal_parameters_select_all on fatal_parameters
  for select using (true);
create policy fatal_parameters_write_admin on fatal_parameters
  for all using (current_app_role() in ('super_admin','qa_manager'))
  with check (current_app_role() in ('super_admin','qa_manager'));
