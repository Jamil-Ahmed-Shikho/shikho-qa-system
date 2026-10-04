-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 073 — "Sample Check" (§4/§5, Phase 3 of the 2026-10-04 UI/UX
-- redesign request) and the retirement of Team Leader Checks (schema_057).
-- Apply after schema_072. Test against the live database before relying on it.
--
-- CONFIRMED by Jamil, 2026-10-04 (AskUserQuestion, not guessed):
--   - Sample Check REPLACES Team Leader Checks entirely — not kept running
--     alongside. (team_lead_checks had 0 live rows when this was checked,
--     so retiring it outright loses nothing real.)
--   - It reuses QA's EXISTING Special Check / Campaign definitions
--     (campaigns / campaign_check_types / campaign_check_values, §4 Part
--     B1) — not a separate list the way Team Leader Checks had its own
--     tl_check_types/tl_check_values.
--   - Visibility is the SAME as a normal audit's: QA staff all, Team Lead
--     own team (team_agent_ids()), Manager own chain (manager_chain_ids()),
--     agent never.
--
-- SCHEMA SHAPE (a Claude-made call while building, per CLAUDE.md's own
-- note that this still needed deciding): a nullable-looking MODE flag on
-- `audits` itself rather than a parallel table — `check_mode` — so a
-- Sample Check reuses call lookup/recording/CRM-matching, the agent/call
-- context cards, and the audit_campaigns/audit_campaign_answers tables
-- completely unchanged. `audits.rubric_id` stays NOT NULL and is still
-- populated the same way a real audit's is (the agent's team's active
-- rubric) — purely as metadata; nothing about a Sample Check is ever
-- scored against it, and loading one never touches rubric_parameters.
--
-- A Sample Check:
--   - has NO rubric scorecard (no audit_parameter_results/audit_fatal_results
--     rows are ever written for it — enforced by submit_sample_check() below
--     simply never writing them, not by a new constraint)
--   - has NO coaching-schedule prompt after submit (app-layer: §5's
--     ScheduleCoaching component is simply not shown for check_mode =
--     'sample_check' — nothing to enforce in the database)
--   - DOES carry audit_campaigns/audit_campaign_answers — the whole point
--   - never gets a score_percent / passed / critical_fail (they stay at
--     their column defaults: null / null / false) — so every existing
--     "avg(score_percent)" computation elsewhere in this system (RYG,
--     auditor ranking, …) already ignores a Sample Check for free, since
--     Postgres's avg() skips nulls. What does NOT skip for free — raw
--     "how many audits did this agent have this week" / "when were they
--     last audited" counts — is fixed separately in schema_074, right
--     after this one, since those come from plain count()/max() with no
--     null to lean on.
-- ============================================================

-- ── 1. The mode flag ──────────────────────────────────────────
alter table audits add column check_mode text not null default 'audit'
  check (check_mode in ('audit', 'sample_check'));

comment on column audits.check_mode is
  'audit = the real, scored QA audit this table was built for. sample_check = a Special-Check-only '
  'log with no rubric scoring, no coaching-schedule prompt — same call/recording journey, replaces '
  'the old, separate Team Leader Checks feature (schema_057, retired below).';

-- ── 2. Submit a Sample Check ──────────────────────────────────
-- Deliberately a SEPARATE function from write_audit_results(), not a branch
-- inside it — write_audit_results()'s own validation (every parameter
-- scored, every failed one ticked and footnoted, fatal severities, the
-- score/pass-mark computation) simply does not apply here, and threading
-- "skip all of that when check_mode = 'sample_check'" through that
-- already-dense function would have made BOTH paths harder to read for no
-- shared benefit. What IS shared — the Special Check attach/answer
-- validation and grandfathering rules — is duplicated here deliberately,
-- in trimmed form (CLAUDE.md §14: "duplicate the small piece a new caller
-- needs rather than widen a shared helper"): a Sample Check's needs are a
-- strict subset (no rubric-parameter cross-checks to interleave with), so
-- copying is clearer than factoring both functions through a shared
-- sub-routine neither can use as-is.
--
-- Same "service role only" shape as write_audit_results() — called from a
-- server action using the admin client, after the action's own session
-- client has already confirmed the caller is this draft's own auditor.
create or replace function submit_sample_check(
  p_audit_id uuid,
  p_actor uuid,
  p_finalize boolean,
  p_campaigns jsonb,
  p_overall_feedback text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  c_overall_max constant int := 2000;
  v_audit audits%rowtype;
  v_overall text;
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
  v_n int;
begin
  select * into v_audit from audits where id = p_audit_id for update;
  if not found then
    raise exception 'Sample Check not found.';
  end if;
  if v_audit.check_mode <> 'sample_check' then
    raise exception 'This is a real audit, not a Sample Check — use the scorecard instead.';
  end if;
  if v_audit.auditor_id is distinct from p_actor then
    raise exception 'Only the person who started this Sample Check can log it.';
  end if;
  if v_audit.status <> 'draft' then
    raise exception 'This Sample Check has already been submitted and can no longer be changed.';
  end if;

  v_overall := nullif(btrim(p_overall_feedback, E' \t\r\n'), '');
  if char_length(v_overall) > c_overall_max then
    raise exception 'Overall feedback is too long (% characters — the limit is %).', char_length(v_overall), c_overall_max;
  end if;
  update audits set overall_feedback = v_overall where id = p_audit_id;

  -- ── Special Checks (identical rules to write_audit_results()'s own campaign section) ──
  if p_campaigns is not null then
    if jsonb_typeof(p_campaigns) <> 'array' then
      raise exception 'The Special Check data is malformed.';
    end if;

    select coalesce(array_agg(campaign_id), '{}'::uuid[]) into v_prev_campaigns
      from audit_campaigns where audit_id = p_audit_id;
    select coalesce(jsonb_object_agg(check_type_id::text, value_id::text), '{}'::jsonb) into v_prev_answers
      from audit_campaign_answers where audit_id = p_audit_id;
    select team_name into v_team from users where id = v_audit.agent_id;

    delete from audit_campaigns where audit_id = p_audit_id;
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

      if not (v_cid = any (v_prev_campaigns)) then
        if v_camp.is_archived then
          raise exception 'The campaign "%" is archived and can''t be attached to a Sample Check.', v_camp.name;
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

  if not p_finalize then
    return jsonb_build_object('saved', true);
  end if;

  -- ── Submit: a Sample Check must actually check something, and every
  --    active check it attached must be answered — overall feedback (the
  --    context for whoever reads it later, QA/Team Lead/Manager) is
  --    required, same rule as a scorecard with a campaign attached. ──
  select count(*) into v_n from audit_campaigns where audit_id = p_audit_id;
  if v_n = 0 then
    raise exception 'Attach at least one Special Check campaign before submitting a Sample Check.';
  end if;

  select count(*) into v_n
  from audit_campaigns ac
  join campaign_check_types t on t.campaign_id = ac.campaign_id and not t.is_archived
  where ac.audit_id = p_audit_id
    and not exists (select 1 from audit_campaign_answers a where a.audit_id = ac.audit_id and a.check_type_id = t.id);
  if v_n > 0 then
    raise exception 'Every check in an attached Special Check campaign needs an answer (% still missing).', v_n;
  end if;

  if v_overall is null then
    raise exception 'Overall feedback is required for a Sample Check — it gives whoever reads it later the context.';
  end if;

  update audits set status = 'submitted', submitted_at = now() where id = p_audit_id;

  return jsonb_build_object('saved', true);
end;
$$;

revoke all on function submit_sample_check(uuid, uuid, boolean, jsonb, text) from public;
grant execute on function submit_sample_check(uuid, uuid, boolean, jsonb, text) to service_role;

-- ── 3. Retire Team Leader Checks (schema_057) entirely ────────
-- Confirmed empty (0 rows in team_lead_checks) before this was written —
-- a clean retirement, not a destructive one. Dropped in FK-respecting
-- order; nothing here is referenced by any other table in the system.
drop function if exists manager_tl_check_counts(uuid, timestamptz, timestamptz);
drop function if exists submit_team_lead_check(uuid, text, text, timestamptz, timestamptz, text, text, text, text, jsonb);
drop table if exists team_lead_check_answers;
drop table if exists team_lead_checks;
drop table if exists tl_check_values;
drop table if exists tl_check_types;
