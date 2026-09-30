-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 049 — Automatic CAPA repeat-mistake tracking (§4 Part 2, "Part 2a")
-- Apply after schema_048. Test against the live database before relying on it.
--
-- What this adds
--   "When the same rubric parameter fails in 3 of an agent's last 5 audits,
--   track it immediately — no QA confirmation, dismissal or judgment call,
--   since it is just counting existing data." (CLAUDE.md §4 Part 2.1)
--
--   capa_repeat_mistakes: one row per (agent, parameter) EVER — never deleted,
--   same "never destroy" shape as Campaigns/Briefings/PIP history. Created the
--   moment a submit crosses the 3-of-last-5 threshold for that pair; from then
--   on, `fail_count` is a running total of every time that parameter has failed
--   for that agent (the "recurrence count" the report ranks by), and `status`
--   reflects only the MOST RECENT time that parameter was scored again after
--   the flag was raised:
--     not_yet_rechecked -> nothing has scored this parameter again since flagging
--     still_failing     -> the most recent re-check also failed
--     improved          -> the most recent re-check passed
--   This is entirely mechanical, hooked into write_audit_results() itself (the
--   single funnel for every submit, including a Review Request re-audit) so it
--   runs on every submission, not a batch job. Manual CAPA (`capa_status`,
--   schema_028) is untouched and keeps working exactly as before — this is the
--   automatic HALF of Part 2, sitting alongside it (CLAUDE.md is explicit that
--   the two never conflict, verified in schema_048's regression tests).
--
--   Visibility deliberately follows the EXISTING manual CAPA flag's own rule
--   ("Still hidden from the agent: any re-audit/CAPA flag" — §4, Q22) — QA
--   staff (all), Team Lead (own team), Manager (own chain); no agent policy.
--   No write policy for anyone — written only inside write_audit_results(),
--   which runs under the service role.
--
--   `repeat_mistake_report(p_parameter_id)` — SECURITY DEFINER, does its own
--   role/scope check like campaign_report() (schema_017) rather than relying on
--   RLS per row: QA Auditor gets the SAME company-wide Team View as the
--   Campaign Report (this is a cross-cutting training-needs report, not a
--   personal queue — same §2 reasoning), Team Lead/Manager get their own
--   team/chain via the ordinary team_agent_ids()/manager_chain_ids() self-call
--   (no manager_id drill-down picker — not asked for here, unlike the Campaign
--   Report). Ranked by fail_count desc (the "recurrence count"), filterable by
--   parameter via the one argument.
-- ============================================================

create table capa_repeat_mistakes (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references users(id),
  parameter_id uuid not null references rubric_parameters(id),
  fail_count int not null,
  status text not null default 'not_yet_rechecked'
    check (status in ('still_failing', 'improved', 'not_yet_rechecked')),
  first_flagged_at timestamptz not null default now(),
  first_flagged_audit_id uuid not null references audits(id),
  last_checked_audit_id uuid references audits(id),
  last_checked_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (agent_id, parameter_id)
);

alter table capa_repeat_mistakes enable row level security;

create policy capa_repeat_mistakes_select_qa on capa_repeat_mistakes for select to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager', 'qa_auditor'));
create policy capa_repeat_mistakes_select_team_lead on capa_repeat_mistakes for select to authenticated
  using (current_app_role() = 'team_lead' and agent_id in (select a from team_agent_ids() as a));
create policy capa_repeat_mistakes_select_manager on capa_repeat_mistakes for select to authenticated
  using (current_app_role() = 'manager' and agent_id in (select a from manager_chain_ids() as a));

-- ── write_audit_results(): unchanged signature, tracking added at the end of
--    the submit path (after the audit is flipped to 'submitted', so its own
--    audit_parameter_results are already in place and its own submitted_at
--    is already visible to the trailing-5 lookup below). ──
create or replace function write_audit_results(
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
  -- Repeat-mistake tracking (Part 2a)
  v_param_id uuid;
  v_this_passed boolean;
  v_fail_window int;
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

  -- ── Automatic CAPA repeat-mistake tracking (Part 2a) ──────
  -- Purely mechanical: no judgment call. Runs for every scored parameter on
  -- every submit (including a Review Request re-audit, since it goes through
  -- this same function). audits.submitted_at was just set above, so this
  -- audit is already part of its own trailing-5 window below.
  for v_param_id, v_this_passed in
    select parameter_id, passed from audit_parameter_results where audit_id = p_audit_id
  loop
    if exists (
      select 1 from capa_repeat_mistakes where agent_id = v_audit.agent_id and parameter_id = v_param_id
    ) then
      -- Already tracked: this is "a later audit scoring that same parameter again".
      update capa_repeat_mistakes
         set fail_count = fail_count + (case when v_this_passed then 0 else 1 end),
             status = case when v_this_passed then 'improved' else 'still_failing' end,
             last_checked_audit_id = p_audit_id,
             last_checked_at = now(),
             updated_at = now()
       where agent_id = v_audit.agent_id and parameter_id = v_param_id;
    else
      -- Not tracked yet: check whether the last 5 submitted audits for this
      -- agent, on the SAME rubric (so a rubric/team change starts fresh),
      -- have this parameter failing 3 or more times, ending at this audit.
      select count(*) into v_fail_window
      from (
        select apr.passed
        from audits a
        join audit_parameter_results apr on apr.audit_id = a.id and apr.parameter_id = v_param_id
        where a.agent_id = v_audit.agent_id and a.rubric_id = v_audit.rubric_id and a.status = 'submitted'
        order by a.submitted_at desc
        limit 5
      ) recent
      where not recent.passed;

      if v_fail_window >= 3 then
        insert into capa_repeat_mistakes (agent_id, parameter_id, fail_count, status, first_flagged_audit_id)
        values (v_audit.agent_id, v_param_id, v_fail_window, 'not_yet_rechecked', p_audit_id);
      end if;
    end if;
  end loop;

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

-- ── Repeat-Mistake report: ranks agents by recurrence count, filterable by parameter ──
create or replace function repeat_mistake_report(p_parameter_id uuid default null)
returns table (
  agent_id uuid,
  agent_name text,
  parameter_id uuid,
  parameter_name text,
  fail_count int,
  status text,
  first_flagged_at timestamptz,
  last_checked_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_role text := current_app_role();
begin
  if v_role not in ('super_admin', 'qa_manager', 'qa_auditor', 'team_lead', 'manager') then
    return;
  end if;

  return query
  select crm.agent_id, u.name, crm.parameter_id, rp.name,
         crm.fail_count, crm.status, crm.first_flagged_at, crm.last_checked_at
  from capa_repeat_mistakes crm
  join users u on u.id = crm.agent_id
  join rubric_parameters rp on rp.id = crm.parameter_id
  where (p_parameter_id is null or crm.parameter_id = p_parameter_id)
    and (
      v_role in ('super_admin', 'qa_manager', 'qa_auditor')
      or (v_role = 'team_lead' and crm.agent_id in (select a from team_agent_ids() as a))
      or (v_role = 'manager' and crm.agent_id in (select a from manager_chain_ids() as a))
    )
  order by crm.fail_count desc, crm.status, u.name;
end;
$$;

revoke all on function repeat_mistake_report(uuid) from public;
grant execute on function repeat_mistake_report(uuid) to authenticated;
