-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 016 — Special Checks / Campaigns, part B2: attach to an audit
-- Test this in the Supabase SQL Editor before relying on it.
-- Requires schema_015 already applied. Run it BEFORE using the new code
-- (the app now sends p_campaigns).
--
-- What this adds
--   write_audit_results() gains p_campaigns, so a scorecard can carry Special
--   Check campaigns: which campaigns are attached to the audit, and one answer
--   (a chosen option) for each check in each of them.
--
--     p_campaigns  [{ "campaign_id": uuid,
--                     "answers": [{ "check_type_id": uuid, "value_id": uuid }] }]
--       null  = "not provided": existing campaign links are left untouched
--               (so an older open browser tab can't wipe them);
--       []    = "none": detach everything;
--       else  = the full new state (replaced wholesale, like the rest of a draft).
--
--   Rules, enforced here (the app mirrors them for a clear UI, but this is the
--   authority — same pattern as the scorecard itself):
--     - A campaign can be NEWLY attached only if it is not archived, applies to
--       the agent's team (all teams, or the team is listed) and is READY: at
--       least one active check, each active check with at least 2 active options.
--       A campaign already attached to this draft is grandfathered — if it is
--       archived or edited while the auditor is mid-way, they can still finish.
--     - An answer must use an option that belongs to its check, in a check that
--       belongs to its campaign. A NEW or CHANGED answer must be live (check and
--       option not archived); the answer already stored is grandfathered too.
--     - Drafts may leave answers blank. To SUBMIT, every currently-active check in
--       every attached campaign needs exactly one answer. Only attached campaigns
--       require anything.
--     - Overall feedback becomes REQUIRED to submit as soon as any campaign is
--       attached (it is optional otherwise — schema_013).
--     - Campaigns NEVER affect scoring: score_percent, passed and critical_fail
--       are computed from the parameters and fatal errors exactly as before.
--
-- The 7-argument function is dropped and replaced (not overloaded): the new
-- argument has a default, so a call without it still resolves.
-- ============================================================

-- Is a campaign usable on a NEW audit, ignoring team? (Mirrors campaignReadiness
-- in src/lib/campaigns/rules.ts — keep the two in step.)
create or replace function campaign_is_ready(p_campaign_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (select 1 from campaigns c where c.id = p_campaign_id and not c.is_archived)
     and exists (select 1 from campaign_check_types t where t.campaign_id = p_campaign_id and not t.is_archived)
     and not exists (
       select 1 from campaign_check_types t
       where t.campaign_id = p_campaign_id and not t.is_archived
         and (select count(*) from campaign_check_values v where v.check_type_id = t.id and not v.is_archived) < 2
     )
$$;
revoke all on function campaign_is_ready(uuid) from public;
grant execute on function campaign_is_ready(uuid) to authenticated, service_role;

drop function write_audit_results(uuid, uuid, boolean, jsonb, jsonb, jsonb, text);

create function write_audit_results(
  p_audit_id uuid,
  p_actor uuid,
  p_finalize boolean,
  p_results jsonb,
  p_ticks jsonb,
  p_fatals jsonb,
  p_overall_feedback text default null,
  p_campaigns jsonb default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  -- keep in step with the table constraints and FEEDBACK_LIMITS in
  -- src/lib/audits/scoring.ts
  c_overall_max constant int := 2000;
  c_param_max constant int := 500;
  c_fatal_max constant int := 1000;
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
  v_fatals jsonb;
  -- Special Checks
  v_team text;
  v_prev_campaigns uuid[];
  v_prev_answers jsonb;
  v_seen_campaigns uuid[];
  v_seen_checks uuid[];
  v_entry jsonb;
  v_ans jsonb;
  v_cid uuid;
  v_tid uuid;
  v_vid uuid;
  v_camp campaigns%rowtype;
  v_type campaign_check_types%rowtype;
  v_val campaign_check_values%rowtype;
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

  -- Normalise p_fatals to [{fatal_parameter_id, feedback}]: a bare id (older
  -- page) becomes an entry with no feedback.
  select coalesce(jsonb_agg(
           case when jsonb_typeof(f) = 'string'
                then jsonb_build_object('fatal_parameter_id', f #>> '{}', 'feedback', null::text)
                else f end), '[]'::jsonb)
    into v_fatals
  from jsonb_array_elements(coalesce(p_fatals, '[]'::jsonb)) f;

  if exists (
    select 1 from jsonb_array_elements(v_fatals) f
    where jsonb_typeof(f) <> 'object' or (f ->> 'fatal_parameter_id') is null
  ) then
    raise exception 'A fatal error entry is malformed.';
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
    select 1 from jsonb_array_elements(v_fatals) f
    where char_length(nullif(btrim(f ->> 'feedback', E' \t\r\n'), '')) > c_fatal_max
  ) then
    raise exception 'Feedback on a fatal error is too long (the limit is % characters).', c_fatal_max;
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

  -- Fatal errors ticked: must belong to this rubric, each listed once;
  -- severity is read from the rubric, never from the caller.
  select count(distinct f ->> 'fatal_parameter_id') into v_expected from jsonb_array_elements(v_fatals) f;
  if v_expected <> jsonb_array_length(v_fatals) then
    raise exception 'A fatal error was sent twice.';
  end if;
  insert into audit_fatal_results (audit_id, fatal_parameter_id, severity, feedback)
  select p_audit_id, fp.id, fp.severity, nullif(btrim(f ->> 'feedback', E' \t\r\n'), '')
  from jsonb_array_elements(v_fatals) f
  join fatal_parameters fp
    on fp.id = (f ->> 'fatal_parameter_id')::uuid and fp.rubric_id = v_audit.rubric_id;
  get diagnostics v_n = row_count;
  if v_n <> v_expected then
    raise exception 'A fatal error does not belong to this audit''s rubric.';
  end if;

  -- ── Special Checks (never touches the score) ──────────────
  if p_campaigns is not null then
    if jsonb_typeof(p_campaigns) <> 'array' then
      raise exception 'The Special Check data is malformed.';
    end if;

    -- What this draft already had, so a campaign or an answer that was valid
    -- when picked can still be kept after it is archived or edited.
    select coalesce(array_agg(campaign_id), '{}'::uuid[]) into v_prev_campaigns
      from audit_campaigns where audit_id = p_audit_id;
    select coalesce(jsonb_object_agg(check_type_id::text, value_id::text), '{}'::jsonb) into v_prev_answers
      from audit_campaign_answers where audit_id = p_audit_id;
    select team_name into v_team from users where id = v_audit.agent_id;

    delete from audit_campaigns where audit_id = p_audit_id;          -- answers go with them
    v_seen_campaigns := '{}'::uuid[];

    for v_entry in select e from jsonb_array_elements(p_campaigns) e loop
      if jsonb_typeof(v_entry) <> 'object' or (v_entry ->> 'campaign_id') is null then
        raise exception 'A Special Check entry is malformed.';
      end if;
      v_cid := (v_entry ->> 'campaign_id')::uuid;

      select * into v_camp from campaigns where id = v_cid;
      if not found then
        raise exception 'A Special Check campaign no longer exists.';
      end if;
      if v_cid = any (v_seen_campaigns) then
        raise exception 'The campaign "%" was attached twice.', v_camp.name;
      end if;
      v_seen_campaigns := v_seen_campaigns || v_cid;

      -- Newly attached: must be usable on a new audit for THIS agent's team.
      if not (v_cid = any (v_prev_campaigns)) then
        if v_camp.is_archived then
          raise exception 'The campaign "%" is archived and can''t be attached to an audit.', v_camp.name;
        end if;
        if not (v_camp.all_teams or (v_team is not null and v_team = any (v_camp.team_names))) then
          raise exception 'The campaign "%" doesn''t apply to this agent''s team.', v_camp.name;
        end if;
        if not campaign_is_ready(v_cid) then
          raise exception 'The campaign "%" isn''t ready to use yet — it needs at least one check, each with at least 2 active options.', v_camp.name;
        end if;
      end if;

      insert into audit_campaigns (audit_id, campaign_id) values (p_audit_id, v_cid);

      v_seen_checks := '{}'::uuid[];
      for v_ans in select a from jsonb_array_elements(coalesce(v_entry -> 'answers', '[]'::jsonb)) a loop
        if jsonb_typeof(v_ans) <> 'object' or (v_ans ->> 'check_type_id') is null or (v_ans ->> 'value_id') is null then
          raise exception 'A Special Check answer is malformed.';
        end if;
        v_tid := (v_ans ->> 'check_type_id')::uuid;
        v_vid := (v_ans ->> 'value_id')::uuid;

        select * into v_type from campaign_check_types where id = v_tid and campaign_id = v_cid;
        if not found then
          raise exception 'An answer is for a check that isn''t part of the campaign "%".', v_camp.name;
        end if;
        select * into v_val from campaign_check_values where id = v_vid and check_type_id = v_tid;
        if not found then
          raise exception 'An answer uses an option that isn''t one of the choices for "%".', v_type.name;
        end if;
        if v_tid = any (v_seen_checks) then
          raise exception 'The check "%" was answered twice.', v_type.name;
        end if;
        v_seen_checks := v_seen_checks || v_tid;

        -- A new or changed answer must use live items; the stored one is grandfathered.
        if (v_prev_answers ->> v_tid::text) is distinct from v_vid::text then
          if v_type.is_archived then
            raise exception 'The check "%" is archived and can no longer be answered.', v_type.name;
          end if;
          if v_val.is_archived then
            raise exception 'The option "%" is archived and can no longer be chosen.', v_val.label;
          end if;
        end if;

        insert into audit_campaign_answers (audit_id, campaign_id, check_type_id, value_id)
        values (p_audit_id, v_cid, v_tid, v_vid);
      end loop;
    end loop;
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

  select count(*) into v_n from audit_parameter_results where audit_id = p_audit_id and not passed and feedback is null;
  if v_n > 0 then
    raise exception 'Every failed parameter needs feedback for the agent (% still missing).', v_n;
  end if;

  select count(*) into v_n from audit_fatal_results where audit_id = p_audit_id and feedback is null;
  if v_n > 0 then
    raise exception 'Every fatal error you tick needs feedback (% still missing).', v_n;
  end if;

  -- Special Checks: every ACTIVE check in every attached campaign needs an
  -- answer, and overall feedback becomes required. (Judged on what is stored,
  -- so it also holds when p_campaigns was null and the links are the old ones.)
  if exists (select 1 from audit_campaigns where audit_id = p_audit_id) then
    select count(*) into v_n
    from audit_campaigns ac
    join campaign_check_types t on t.campaign_id = ac.campaign_id and not t.is_archived
    where ac.audit_id = p_audit_id
      and not exists (select 1 from audit_campaign_answers a where a.audit_id = ac.audit_id and a.check_type_id = t.id);
    if v_n > 0 then
      raise exception 'Every check in an attached Special Check campaign needs an answer (% still missing).', v_n;
    end if;

    if v_overall is null then
      raise exception 'Overall feedback is required when a Special Check campaign is attached — it gives the agent the context for the check.';
    end if;
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

revoke all on function write_audit_results(uuid, uuid, boolean, jsonb, jsonb, jsonb, text, jsonb) from public;
grant execute on function write_audit_results(uuid, uuid, boolean, jsonb, jsonb, jsonb, text, jsonb) to service_role;
