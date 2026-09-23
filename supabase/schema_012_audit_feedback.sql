-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 012 — Step 4 addition: audit feedback
-- Test this in the Supabase SQL Editor before relying on it.
-- Requires schema_011 already applied. Run it BEFORE deploying the code
-- that sends feedback (the app now calls the 7-argument function below).
--
-- What this adds
--   1. audits.overall_feedback — the auditor's coaching summary. Optional
--      while the audit is a draft, REQUIRED to submit.
--   2. audit_parameter_results.feedback — an optional short note on a
--      parameter, allowed only when that parameter was failed.
--   3. write_audit_results() gains p_overall_feedback and reads a
--      "feedback" key on each result. Same function, same rules as before
--      (the database derives the score; the app never supplies one) plus:
--        - submit is refused without overall feedback;
--        - a Pass can't carry feedback (mirrors "a Pass can't carry ticks");
--        - length limits (overall 2000 / parameter 500 characters).
--      Text is stored trimmed; blank parameter feedback is stored as null.
--
-- Existing audits (drafts or already-submitted ones) simply have no
-- feedback: the columns are nullable, nothing is rewritten. Only NEW
-- submissions must carry overall feedback.
-- ============================================================

-- ── 1 + 2. Columns, with the limits as table constraints too ─
-- (so the limits hold even for a direct update on the audit row, not just
-- through the function)
alter table audits add column overall_feedback text;
alter table audits add constraint audits_overall_feedback_len
  check (overall_feedback is null or char_length(overall_feedback) <= 2000);

alter table audit_parameter_results add column feedback text;
alter table audit_parameter_results add constraint apr_feedback_len
  check (feedback is null or char_length(feedback) <= 500);
alter table audit_parameter_results add constraint apr_feedback_only_on_fail
  check (feedback is null or not passed);

-- ── 3. write_audit_results with feedback ────────────────────
-- The old 6-argument version is replaced (dropped, not overloaded, so the
-- app can't accidentally call a version that ignores feedback). The new
-- argument has a default, so a 6-argument call still resolves — it just
-- means "no overall feedback".
drop function write_audit_results(uuid, uuid, boolean, jsonb, jsonb, jsonb);

create function write_audit_results(
  p_audit_id uuid,
  p_actor uuid,
  p_finalize boolean,
  p_results jsonb,
  p_ticks jsonb,
  p_fatals jsonb,
  p_overall_feedback text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  -- keep in step with the table constraints above and FEEDBACK_LIMITS in
  -- src/lib/audits/scoring.ts
  c_overall_max constant int := 2000;
  c_param_max constant int := 500;
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
  v_overall text;
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

  -- Feedback text: trimmed (spaces, tabs, line breaks), blank -> null.
  v_overall := nullif(btrim(p_overall_feedback, E' \t\r\n'), '');
  if char_length(v_overall) > c_overall_max then
    raise exception 'Overall feedback is too long (% characters — the limit is %).', char_length(v_overall), c_overall_max;
  end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r
    where char_length(nullif(btrim(r ->> 'feedback', E' \t\r\n'), '')) > c_param_max
  ) then
    raise exception 'Feedback on a parameter is too long (the limit is % characters).', c_param_max;
  end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r
    where (r ->> 'passed')::boolean
      and nullif(btrim(r ->> 'feedback', E' \t\r\n'), '') is not null
  ) then
    raise exception 'A parameter marked Pass cannot have feedback — feedback is only for failed parameters.';
  end if;

  -- Replace whatever was saved before (ticks go with their parameter row).
  delete from audit_parameter_results where audit_id = p_audit_id;
  delete from audit_fatal_results where audit_id = p_audit_id;

  update audits set overall_feedback = v_overall where id = p_audit_id;

  -- Parameter results. points_awarded is DERIVED (full points on Pass, 0 on Fail).
  insert into audit_parameter_results (audit_id, parameter_id, passed, points_awarded, feedback)
  select p_audit_id, rp.id, (r ->> 'passed')::boolean,
         case when (r ->> 'passed')::boolean then rp.points else 0 end,
         case when (r ->> 'passed')::boolean then null
              else nullif(btrim(r ->> 'feedback', E' \t\r\n'), '') end
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

  if v_overall is null then
    raise exception 'Overall feedback is required before submitting — write a short coaching summary for the agent.';
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

revoke all on function write_audit_results(uuid, uuid, boolean, jsonb, jsonb, jsonb, text) from public;
grant execute on function write_audit_results(uuid, uuid, boolean, jsonb, jsonb, jsonb, text) to service_role;
