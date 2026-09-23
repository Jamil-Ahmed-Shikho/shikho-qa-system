-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 011 — Step 4: audit scoring (§4) + pass thresholds (§6.2)
-- Test this in the Supabase SQL Editor before relying on it.
-- Requires schema_001 … 010 already applied (uses the seeded rubrics).
--
-- What this adds
--   1. status_thresholds (§6.2) — the ONE definition of "passing".
--      audits.passed = no critical fatal AND score >= yellow_min. Versioned
--      (never edited in place, always superseded) so it can later be
--      changed from the admin dashboard without rewriting history.
--   2. audit_parameter_results / audit_error_ticks / audit_fatal_results (§4).
--   3. write_audit_results() — saves a draft scorecard or submits it, in ONE
--      transaction, and derives every number itself from the marks (points
--      per parameter, score, critical fail, passed). The database enforces
--      the confirmed scoring rule; the app cannot submit a score of its own.
--   4. Tightens Step 2's rubric read policies to signed-in users only.
-- ============================================================

-- ── 1. Pass thresholds (§6.2) ───────────────────────────────
create table status_thresholds (
  id uuid primary key default gen_random_uuid(),
  rubric_id uuid references rubrics(id),      -- null = org-wide default
  green_min numeric not null,
  yellow_min numeric not null,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,                   -- null = the current row
  created_by uuid references users(id),
  constraint status_thresholds_range
    check (green_min between 0 and 100 and yellow_min between 0 and 100 and yellow_min <= green_min),
  constraint status_thresholds_period
    check (effective_to is null or effective_to >= effective_from)
);

-- At most ONE current row per scope (per rubric, or the org-wide default).
create unique index uq_status_thresholds_open
  on status_thresholds ((coalesce(rubric_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  where effective_to is null;

alter table status_thresholds enable row level security;

create policy status_thresholds_select on status_thresholds
  for select to authenticated using (true);

create policy status_thresholds_write_admin on status_thresholds
  for all to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager'))
  with check (current_app_role() in ('super_admin', 'qa_manager'));

-- PLACEHOLDER org-wide bar — 90 / 70 are the design doc's "e.g." figures,
-- not confirmed policy. Correct them (see set_status_thresholds below)
-- before relying on audits.passed.
insert into status_thresholds (rubric_id, green_min, yellow_min) values (null, 90, 70);

-- Changing a threshold = supersede, never edit in place: closes the current
-- row for that scope and opens a new one, atomically. Runs with the
-- caller's rights, so only super_admin / qa_manager can use it (the
-- table's write policy). Pass rubric_id = null for the org-wide default.
--   select set_status_thresholds(null, 90, 75);
create or replace function set_status_thresholds(p_rubric_id uuid, p_green_min numeric, p_yellow_min numeric)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid;
begin
  update status_thresholds
     set effective_to = now()
   where effective_to is null
     and coalesce(rubric_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = coalesce(p_rubric_id, '00000000-0000-0000-0000-000000000000'::uuid);

  insert into status_thresholds (rubric_id, green_min, yellow_min, effective_from, created_by)
  values (p_rubric_id, p_green_min, p_yellow_min, now(), current_app_user_id())
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function set_status_thresholds(uuid, numeric, numeric) from public;
grant execute on function set_status_thresholds(uuid, numeric, numeric) to authenticated;

-- ── 2. Scorecard tables (§4) ────────────────────────────────
-- What the frozen pass mark was when this audit was submitted, so a later
-- threshold change never leaves an old audit unexplained (§1: history is
-- never rewritten by a future policy change).
alter table audits add column pass_mark_used numeric;

create table audit_parameter_results (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references audits(id) on delete cascade,
  parameter_id uuid not null references rubric_parameters(id),
  passed boolean not null,
  points_awarded numeric not null,
  unique (audit_id, parameter_id)
);

create table audit_error_ticks (
  id uuid primary key default gen_random_uuid(),
  audit_parameter_result_id uuid not null references audit_parameter_results(id) on delete cascade,
  error_attribute_id uuid not null references rubric_error_attributes(id),
  root_cause_category text check (root_cause_category in ('skill','knowledge','process','attitude')),
  unique (audit_parameter_result_id, error_attribute_id)
);

create table audit_fatal_results (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references audits(id) on delete cascade,
  fatal_parameter_id uuid not null references fatal_parameters(id),
  severity text not null,                      -- denormalized at audit time
  unique (audit_id, fatal_parameter_id)
);

create index idx_apr_audit on audit_parameter_results(audit_id);
create index idx_aet_result on audit_error_ticks(audit_parameter_result_id);
create index idx_afr_audit on audit_fatal_results(audit_id);

-- ── RLS: read exactly what the parent audit lets you read ───
-- The exists() subqueries are themselves subject to the audits policies
-- (QA roles, a Team Lead's own team, a Manager's chain minus drafts…), so
-- a scorecard is visible to precisely the people who can see its audit —
-- no second copy of that logic to drift out of sync.
--
-- There are deliberately NO insert/update/delete policies: scorecards are
-- written only through write_audit_results() with the service role, so a
-- signed-in user can't touch these rows directly, and a submitted audit
-- can't be altered afterwards.
alter table audit_parameter_results enable row level security;
alter table audit_error_ticks enable row level security;
alter table audit_fatal_results enable row level security;

create policy apr_select on audit_parameter_results
  for select to authenticated
  using (exists (select 1 from audits a where a.id = audit_parameter_results.audit_id));

create policy aet_select on audit_error_ticks
  for select to authenticated
  using (exists (select 1 from audit_parameter_results r where r.id = audit_error_ticks.audit_parameter_result_id));

create policy afr_select on audit_fatal_results
  for select to authenticated
  using (exists (select 1 from audits a where a.id = audit_fatal_results.audit_id));

-- ── 3. Save / submit a scorecard, atomically ────────────────
-- Called ONLY by the server with the service role (the app checks who the
-- user is and passes them as p_actor). Payload — marks only, no numbers:
--   p_results  [{ "parameter_id": uuid, "passed": bool }]        scored parameters
--   p_ticks    [{ "parameter_id": uuid, "error_attribute_id": uuid,
--                 "root_cause_category": "skill"|…|null }]       ticked error attributes
--   p_fatals   [ fatal_parameter_id, … ]                         ticked fatal errors
-- The confirmed rule, enforced here: a parameter earns its full points if
-- it has NO error attribute ticked, else 0. Any Critical fatal ticked
-- zeroes the whole audit (critical_fail = true); a Major is only recorded.
-- p_finalize = false saves a draft (partial is fine); true validates
-- completeness, computes the score, freezes `passed` and submits.
create or replace function write_audit_results(
  p_audit_id uuid,
  p_actor uuid,
  p_finalize boolean,
  p_results jsonb,
  p_ticks jsonb,
  p_fatals jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_audit audits%rowtype;
  v_n int;
  v_expected int;
  v_params int;
  v_max numeric;
  v_total numeric;
  v_earned numeric;
  v_crit boolean;
  v_score numeric;
  v_green numeric;
  v_yellow numeric;
  v_passed boolean;
begin
  select * into v_audit from audits where id = p_audit_id for update;
  if not found then
    raise exception 'Audit not found.';
  end if;
  if v_audit.auditor_id is distinct from p_actor then
    raise exception 'Only the auditor who started this audit can score it.';
  end if;
  if v_audit.status <> 'draft' then
    raise exception 'This audit has already been submitted and can no longer be changed.';
  end if;

  -- Replace whatever was saved before (ticks go with their parameter row).
  delete from audit_parameter_results where audit_id = p_audit_id;
  delete from audit_fatal_results where audit_id = p_audit_id;

  -- Parameter results. points_awarded is DERIVED (full points on Pass, 0 on Fail).
  insert into audit_parameter_results (audit_id, parameter_id, passed, points_awarded)
  select p_audit_id, rp.id, (r ->> 'passed')::boolean,
         case when (r ->> 'passed')::boolean then rp.points else 0 end
  from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r
  join rubric_parameters rp on rp.id = (r ->> 'parameter_id')::uuid
  join rubric_categories rc on rc.id = rp.category_id and rc.rubric_id = v_audit.rubric_id;
  get diagnostics v_n = row_count;
  if v_n <> jsonb_array_length(coalesce(p_results, '[]'::jsonb)) then
    raise exception 'A scored parameter does not belong to this audit''s rubric (or was sent twice).';
  end if;

  -- Ticked error attributes: must belong to the parameter they were ticked under.
  insert into audit_error_ticks (audit_parameter_result_id, error_attribute_id, root_cause_category)
  select apr.id, ea.id, nullif(t ->> 'root_cause_category', '')
  from jsonb_array_elements(coalesce(p_ticks, '[]'::jsonb)) t
  join audit_parameter_results apr
    on apr.audit_id = p_audit_id and apr.parameter_id = (t ->> 'parameter_id')::uuid
  join rubric_error_attributes ea
    on ea.id = (t ->> 'error_attribute_id')::uuid and ea.parameter_id = apr.parameter_id;
  get diagnostics v_n = row_count;
  if v_n <> jsonb_array_length(coalesce(p_ticks, '[]'::jsonb)) then
    raise exception 'An error attribute was ticked under a parameter it does not belong to (or was sent twice).';
  end if;

  if exists (
    select 1 from audit_parameter_results apr
    where apr.audit_id = p_audit_id and apr.passed
      and exists (select 1 from audit_error_ticks et where et.audit_parameter_result_id = apr.id)
  ) then
    raise exception 'A parameter marked Pass cannot have error attributes ticked.';
  end if;

  -- Fatal errors ticked: must belong to this rubric; severity is read from
  -- the rubric, never from the caller.
  select count(distinct x) into v_expected from jsonb_array_elements_text(coalesce(p_fatals, '[]'::jsonb)) x;
  insert into audit_fatal_results (audit_id, fatal_parameter_id, severity)
  select p_audit_id, fp.id, fp.severity
  from fatal_parameters fp
  where fp.rubric_id = v_audit.rubric_id
    and fp.id in (select x::uuid from jsonb_array_elements_text(coalesce(p_fatals, '[]'::jsonb)) x);
  get diagnostics v_n = row_count;
  if v_n <> v_expected then
    raise exception 'A fatal error does not belong to this audit''s rubric.';
  end if;

  -- Draft: nothing more to check or compute.
  if not p_finalize then
    return jsonb_build_object('saved', true);
  end if;

  -- ── Submit: completeness, then the numbers ────────────────
  select coalesce(sum(rp.points), 0), count(*) into v_max, v_params
  from rubric_parameters rp
  join rubric_categories rc on rc.id = rp.category_id
  where rc.rubric_id = v_audit.rubric_id;

  select total_points into v_total from rubrics where id = v_audit.rubric_id;
  if v_max <> v_total or v_max <= 0 then
    raise exception 'This rubric''s parameter points add up to % but its total is % — fix it in Rubric Admin before submitting audits.', v_max, v_total;
  end if;

  select count(*) into v_n from audit_parameter_results where audit_id = p_audit_id;
  if v_n <> v_params then
    raise exception 'Not every parameter has been scored (% of %).', v_n, v_params;
  end if;

  if exists (
    select 1 from audit_parameter_results apr
    where apr.audit_id = p_audit_id and not apr.passed
      and not exists (select 1 from audit_error_ticks et where et.audit_parameter_result_id = apr.id)
  ) then
    raise exception 'Every failed parameter needs at least one error attribute ticked.';
  end if;

  if exists (
    select 1 from audit_error_ticks et
    join audit_parameter_results apr on apr.id = et.audit_parameter_result_id
    where apr.audit_id = p_audit_id and et.root_cause_category is null
  ) then
    raise exception 'Every ticked error attribute needs a root-cause category.';
  end if;

  select coalesce(sum(points_awarded), 0) into v_earned from audit_parameter_results where audit_id = p_audit_id;
  select exists (select 1 from audit_fatal_results where audit_id = p_audit_id and severity = 'critical') into v_crit;
  v_score := case when v_crit then 0 else round(v_earned / v_max * 100, 2) end;

  -- The pass mark in force right now: this rubric's own row, else the org-wide one.
  select t.green_min, t.yellow_min into v_green, v_yellow
  from status_thresholds t
  where t.effective_to is null and t.effective_from <= now() and t.rubric_id = v_audit.rubric_id;
  if not found then
    select t.green_min, t.yellow_min into v_green, v_yellow
    from status_thresholds t
    where t.effective_to is null and t.effective_from <= now() and t.rubric_id is null;
  end if;
  if v_yellow is null then
    raise exception 'No pass mark is configured (status_thresholds), so this audit cannot be submitted.';
  end if;

  v_passed := (not v_crit) and v_score >= v_yellow;

  update audits
     set score_percent = v_score,
         passed = v_passed,
         critical_fail = v_crit,
         pass_mark_used = v_yellow,
         status = 'submitted',
         submitted_at = now()
   where id = p_audit_id;

  return jsonb_build_object(
    'saved', true,
    'score_percent', v_score,
    'passed', v_passed,
    'critical_fail', v_crit,
    'pass_mark', v_yellow,
    'points_earned', v_earned,
    'points_possible', v_max
  );
end;
$$;

revoke all on function write_audit_results(uuid, uuid, boolean, jsonb, jsonb, jsonb) from public;
grant execute on function write_audit_results(uuid, uuid, boolean, jsonb, jsonb, jsonb) to service_role;

-- ── 4. Rubric policies: signed-in users only ────────────────
-- Step 2 wrote these as `using (true)` with no role, which in Supabase also
-- lets the public anon key (it ships in the browser) read every rubric,
-- scoring criterion and fatal-error list. Signed-in users are unaffected.
alter policy rubrics_select_all on rubrics to authenticated;
alter policy team_rubric_mapping_select_all on team_rubric_mapping to authenticated;
alter policy rubric_categories_select_all on rubric_categories to authenticated;
alter policy rubric_parameters_select_all on rubric_parameters to authenticated;
alter policy rubric_error_attributes_select_all on rubric_error_attributes to authenticated;
alter policy fatal_parameters_select_all on fatal_parameters to authenticated;
