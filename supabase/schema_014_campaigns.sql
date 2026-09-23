-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 014 — Special Checks / Campaigns, part B1: definitions + admin
-- Test this in the Supabase SQL Editor before relying on it.
-- Requires schema_013 already applied.
--
-- What a campaign is
--   A lightweight, admin-configurable layer for ad-hoc management checks
--   ("is the agent mentioning the new course launch?") that don't belong in
--   the permanent scoring rubrics. It NEVER touches score_percent, passed or
--   critical_fail — same principle as a Major fatal error.
--
--     campaigns              name, description, archived flag, team scope
--       campaign_check_types   the things to check under a campaign
--         campaign_check_values  2–10 predefined answers per check (a CLOSED
--                                list — no free-text "Other")
--
--   Unlike rubrics these are not versioned; instead nothing that has been
--   used is ever destroyed:
--     - anything can be ARCHIVED (hidden from new audits, kept on old audits
--       and reports) and un-archived;
--     - anything referenced by ANY audit can't be deleted (foreign keys);
--     - an answer's TEXT can't be changed once a submitted audit used it
--       (trigger) — archive it and add a new one, so past records keep
--       their meaning.
--
--   The tables that link an audit to its campaigns and answers are created
--   here too (empty until sub-step B2 writes to them) so those protections
--   exist from day one.
--
-- Access: Super Admin + QA Manager manage; QA roles, Team Leads and Managers
-- can read the definitions (the scorecard and the report need them); agents
-- can't. Every policy says `to authenticated` (schema_011 lesson).
-- ============================================================

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── campaigns ───────────────────────────────────────────────
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_archived boolean not null default false,
  -- Team scope: either every team, or a non-empty list of specific teams.
  all_teams boolean not null default false,
  team_names text[] not null default '{}',
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaigns_name_ok check (name = btrim(name) and char_length(name) between 1 and 100),
  constraint campaigns_description_ok check (description is null or (description = btrim(description) and char_length(description) between 1 and 500)),
  constraint campaigns_scope_ok check (
    (all_teams and cardinality(team_names) = 0) or (not all_teams and cardinality(team_names) > 0)
  )
);
create unique index uq_campaigns_name on campaigns (lower(name));

-- ── check types (the things to check) ───────────────────────
create table campaign_check_types (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  name text not null,
  description text,
  sort_order int not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_check_types_name_ok check (name = btrim(name) and char_length(name) between 1 and 200),
  constraint campaign_check_types_description_ok check (description is null or (description = btrim(description) and char_length(description) between 1 and 300)),
  unique (campaign_id, id)                                   -- lets an answer prove "this check belongs to this campaign"
);
create unique index uq_campaign_check_types_name on campaign_check_types (campaign_id, lower(name));

-- ── check values (the closed answer list) ───────────────────
create table campaign_check_values (
  id uuid primary key default gen_random_uuid(),
  check_type_id uuid not null references campaign_check_types(id) on delete cascade,
  label text not null,
  sort_order int not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_check_values_label_ok check (label = btrim(label) and char_length(label) between 1 and 100),
  unique (check_type_id, id)                                 -- lets an answer prove "this value belongs to this check"
);
create unique index uq_campaign_check_values_label on campaign_check_values (check_type_id, lower(label));

create index idx_campaign_check_types_campaign on campaign_check_types(campaign_id);
create index idx_campaign_check_values_type on campaign_check_values(check_type_id);

create trigger trg_campaigns_touch before update on campaigns for each row execute function touch_updated_at();
create trigger trg_campaign_check_types_touch before update on campaign_check_types for each row execute function touch_updated_at();
create trigger trg_campaign_check_values_touch before update on campaign_check_values for each row execute function touch_updated_at();

-- ── audit links (written from sub-step B2; empty for now) ───
-- An audit can be linked to several campaigns; each linked campaign's check
-- types each get exactly one answer. The composite foreign keys make it
-- impossible to store an answer whose value doesn't belong to its check, or
-- whose check doesn't belong to its campaign, or whose campaign the audit
-- isn't linked to.
create table audit_campaigns (
  audit_id uuid not null references audits(id) on delete cascade,
  campaign_id uuid not null references campaigns(id),         -- no cascade: a used campaign can't be deleted
  primary key (audit_id, campaign_id)
);

create table audit_campaign_answers (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null,
  campaign_id uuid not null,
  check_type_id uuid not null,
  value_id uuid not null,
  unique (audit_id, check_type_id),                            -- one answer per check per audit
  foreign key (audit_id, campaign_id) references audit_campaigns(audit_id, campaign_id) on delete cascade,
  foreign key (campaign_id, check_type_id) references campaign_check_types(campaign_id, id),   -- no cascade
  foreign key (check_type_id, value_id) references campaign_check_values(check_type_id, id)    -- no cascade
);
create index idx_audit_campaigns_campaign on audit_campaigns(campaign_id);
create index idx_audit_campaign_answers_audit on audit_campaign_answers(audit_id);
create index idx_audit_campaign_answers_type on audit_campaign_answers(check_type_id);
create index idx_audit_campaign_answers_value on audit_campaign_answers(value_id);

-- ── rules that hold no matter which screen or script writes ─

-- New items go to the end of their list.
create or replace function campaign_assign_sort_order()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'campaign_check_types' then
    select coalesce(max(sort_order), 0) + 1 into new.sort_order from campaign_check_types where campaign_id = new.campaign_id;
  else
    select coalesce(max(sort_order), 0) + 1 into new.sort_order from campaign_check_values where check_type_id = new.check_type_id;
  end if;
  return new;
end;
$$;
create trigger trg_campaign_check_types_order before insert on campaign_check_types for each row execute function campaign_assign_sort_order();
create trigger trg_campaign_check_values_order before insert on campaign_check_values for each row execute function campaign_assign_sort_order();

-- An item never moves to a different parent (an answer's meaning depends on it).
-- (One function per table: a shared one would evaluate a column the other
-- table doesn't have.)
create or replace function campaign_check_type_parent_is_fixed()
returns trigger
language plpgsql
as $$
begin
  if new.campaign_id <> old.campaign_id then
    raise exception 'A check can''t be moved to a different campaign.';
  end if;
  return new;
end;
$$;
create or replace function campaign_check_value_parent_is_fixed()
returns trigger
language plpgsql
as $$
begin
  if new.check_type_id <> old.check_type_id then
    raise exception 'An option can''t be moved to a different check.';
  end if;
  return new;
end;
$$;
create trigger trg_campaign_check_types_parent before update on campaign_check_types for each row execute function campaign_check_type_parent_is_fixed();
create trigger trg_campaign_check_values_parent before update on campaign_check_values for each row execute function campaign_check_value_parent_is_fixed();

-- At most 10 ACTIVE options per check (archived ones don't count, so retiring
-- an option and adding its replacement always works).
create or replace function campaign_value_limit()
returns trigger
language plpgsql
as $$
declare
  n int;
begin
  if not new.is_archived then
    select count(*) into n from campaign_check_values
     where check_type_id = new.check_type_id and not is_archived and id is distinct from new.id;
    if n >= 10 then
      raise exception 'A check can have at most 10 active options — archive one first.';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_campaign_check_values_limit
  before insert or update of is_archived on campaign_check_values
  for each row execute function campaign_value_limit();

-- An option's TEXT is frozen once a SUBMITTED audit has used it: changing the
-- words would silently change what every past answer meant. Archive it and add
-- a new one instead. (Drafts don't count — a draft isn't a record yet.)
-- SECURITY DEFINER so the check always sees every audit, whoever is editing.
create or replace function campaign_value_text_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.label is distinct from old.label and exists (
    select 1 from audit_campaign_answers a
    join audits au on au.id = a.audit_id
    where a.value_id = old.id and au.status <> 'draft'
  ) then
    raise exception 'This option has been used in a submitted audit, so its text can''t be changed. Archive it and add a new option instead.';
  end if;
  return new;
end;
$$;
revoke all on function campaign_value_text_lock() from public;
create trigger trg_campaign_check_values_lock
  before update of label on campaign_check_values
  for each row execute function campaign_value_text_lock();

-- ── reordering, atomically ──────────────────────────────────
-- Runs with the caller's rights (RLS), plus an explicit role check so a
-- non-admin gets a message rather than a silent no-op.
create or replace function reorder_campaign_check_types(p_campaign_id uuid, p_ids uuid[])
returns void
language plpgsql
set search_path = public
as $$
begin
  if current_app_role() not in ('super_admin', 'qa_manager') then
    raise exception 'Only Super Admin / QA Manager can manage special checks.';
  end if;
  if coalesce(array_length(p_ids, 1), 0) <> (select count(*) from campaign_check_types where campaign_id = p_campaign_id)
     or (select count(distinct i) from unnest(p_ids) i) <> coalesce(array_length(p_ids, 1), 0)
     or exists (select 1 from unnest(p_ids) i where not exists (select 1 from campaign_check_types t where t.id = i and t.campaign_id = p_campaign_id)) then
    raise exception 'The list changed while you were reordering — reload the page and try again.';
  end if;
  update campaign_check_types t set sort_order = o.ord
    from unnest(p_ids) with ordinality as o(id, ord) where t.id = o.id;
end;
$$;

create or replace function reorder_campaign_check_values(p_check_type_id uuid, p_ids uuid[])
returns void
language plpgsql
set search_path = public
as $$
begin
  if current_app_role() not in ('super_admin', 'qa_manager') then
    raise exception 'Only Super Admin / QA Manager can manage special checks.';
  end if;
  if coalesce(array_length(p_ids, 1), 0) <> (select count(*) from campaign_check_values where check_type_id = p_check_type_id)
     or (select count(distinct i) from unnest(p_ids) i) <> coalesce(array_length(p_ids, 1), 0)
     or exists (select 1 from unnest(p_ids) i where not exists (select 1 from campaign_check_values v where v.id = i and v.check_type_id = p_check_type_id)) then
    raise exception 'The list changed while you were reordering — reload the page and try again.';
  end if;
  update campaign_check_values v set sort_order = o.ord
    from unnest(p_ids) with ordinality as o(id, ord) where v.id = o.id;
end;
$$;

revoke all on function reorder_campaign_check_types(uuid, uuid[]) from public;
revoke all on function reorder_campaign_check_values(uuid, uuid[]) from public;
grant execute on function reorder_campaign_check_types(uuid, uuid[]) to authenticated;
grant execute on function reorder_campaign_check_values(uuid, uuid[]) to authenticated;

-- ── usage counts for the admin screens ──────────────────────
-- How many audits used each campaign / check / option, split into submitted
-- vs still-draft. These run with the caller's rights: admins see every audit.
-- (Done in SQL, not by fetching rows, so a busy campaign can't silently
-- exceed the API's row limit and understate its use.)
create or replace function campaign_audit_counts()
returns table (campaign_id uuid, submitted_audits int, draft_audits int)
language sql
stable
set search_path = public
as $$
  select ac.campaign_id,
         (count(*) filter (where au.status <> 'draft'))::int,
         (count(*) filter (where au.status = 'draft'))::int
  from audit_campaigns ac
  join audits au on au.id = ac.audit_id
  group by ac.campaign_id
$$;

create or replace function campaign_item_usage(p_campaign_id uuid)
returns table (item_type text, item_id uuid, submitted_audits int, draft_audits int)
language sql
stable
set search_path = public
as $$
  select 'check_type'::text, a.check_type_id,
         (count(distinct a.audit_id) filter (where au.status <> 'draft'))::int,
         (count(distinct a.audit_id) filter (where au.status = 'draft'))::int
  from audit_campaign_answers a join audits au on au.id = a.audit_id
  where a.campaign_id = p_campaign_id
  group by a.check_type_id
  union all
  select 'value'::text, a.value_id,
         (count(distinct a.audit_id) filter (where au.status <> 'draft'))::int,
         (count(distinct a.audit_id) filter (where au.status = 'draft'))::int
  from audit_campaign_answers a join audits au on au.id = a.audit_id
  where a.campaign_id = p_campaign_id
  group by a.value_id
$$;

revoke all on function campaign_audit_counts() from public;
revoke all on function campaign_item_usage(uuid) from public;
grant execute on function campaign_audit_counts() to authenticated;
grant execute on function campaign_item_usage(uuid) to authenticated;

-- ── Row-level security ──────────────────────────────────────
alter table campaigns enable row level security;
alter table campaign_check_types enable row level security;
alter table campaign_check_values enable row level security;
alter table audit_campaigns enable row level security;
alter table audit_campaign_answers enable row level security;

-- Definitions: readable by the roles that score audits or read reports.
create policy campaigns_select on campaigns
  for select to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager', 'qa_auditor', 'team_lead', 'manager'));
create policy campaign_check_types_select on campaign_check_types
  for select to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager', 'qa_auditor', 'team_lead', 'manager'));
create policy campaign_check_values_select on campaign_check_values
  for select to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager', 'qa_auditor', 'team_lead', 'manager'));

-- Definitions: managed by Super Admin / QA Manager only.
create policy campaigns_write_admin on campaigns
  for all to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager'))
  with check (current_app_role() in ('super_admin', 'qa_manager'));
create policy campaign_check_types_write_admin on campaign_check_types
  for all to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager'))
  with check (current_app_role() in ('super_admin', 'qa_manager'));
create policy campaign_check_values_write_admin on campaign_check_values
  for all to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager'))
  with check (current_app_role() in ('super_admin', 'qa_manager'));

-- Audit links/answers: read exactly what the parent audit lets you read (the
-- exists() is itself subject to the audits policies — QA roles, a Team Lead's
-- own team, a Manager's chain). No write policies: they're written only by
-- write_audit_results() with the service role (sub-step B2), like the
-- scorecard tables, so nobody can alter a submitted audit's answers.
create policy audit_campaigns_select on audit_campaigns
  for select to authenticated
  using (exists (select 1 from audits a where a.id = audit_campaigns.audit_id));
create policy audit_campaign_answers_select on audit_campaign_answers
  for select to authenticated
  using (exists (select 1 from audits a where a.id = audit_campaign_answers.audit_id));
