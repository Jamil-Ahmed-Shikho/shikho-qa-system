-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 057 — Team Leader Checks: a NEW, lightweight, Special-Check-only
-- mechanism for Team Leads to log a quick check on their own agents' calls,
-- entirely separate from the real QA audit system.
-- Apply after schema_056. Test against the live database before relying on it.
--
-- Jamil, 2026-09-30, scoped via a dedicated round of AskUserQuestion (this
-- was NOT in the original design doc — a new feature surfaced mid-build):
--   - v1 has NO scoring/rubric at all — a Team Lead answers a closed set of
--     questions (e.g. "sales pipeline followed up?", "follow-up call made?")
--     with no pass/fail, no points. Deliberately not reusing QA's existing
--     Special Checks (campaigns, §4 Part B1) — a SEPARATE TL-only set, so
--     the two are never mixed up or accidentally shared.
--   - Tied to a real CRM call, but AGENT-WISE only: a Team Lead browses
--     their OWN agent's calls (reusing the existing agent-scoped call
--     browser, §9 Part 2 — already reachable by team_lead) and logs a check
--     against one. The manual lead-ID/URL paste-and-audit flow is NOT
--     extended to this — not needed for v1, per Jamil.
--   - NEVER touches an agent's real score, RYG, or any QA-facing dashboard —
--     this is why it is a fully separate set of tables, not a variant audit
--     row. A Team Lead sees their own checks in full; their Manager sees
--     ONLY A COUNT per Team Lead (never the actual answers — "a lighter
--     version," Jamil's own words); Super Admin sees everything, in full,
--     for oversight ("Admin will have the view what TL's/manager are
--     doing"). QA Manager and QA Auditor get NO access to results at all —
--     not even a count — matching "no need to show in QA manager, QA
--     auditor." Definitions (the check types/values themselves) ARE
--     manageable by Super Admin + QA Manager together, the same "admin
--     duo" pattern every other settings screen in this system uses
--     (rubrics, targets, PIP policy, campaigns) — Jamil's instruction was
--     about RESULTS not showing to QA, not about who configures the list of
--     questions, so this doesn't invent a new precedent for that part.
--   - No audit target for this — deliberately not built (Jamil: "for now,
--     can be added in future").
-- ============================================================

-- ── Definitions (TL-only, separate from campaigns) ─────────
create table tl_check_types (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0 and length(name) <= 200),
  note text check (note is null or length(note) <= 300),
  sort_order int not null default 0,
  is_archived boolean not null default false,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create unique index uq_tl_check_types_name on tl_check_types (lower(name)) where not is_archived;

create table tl_check_values (
  id uuid primary key default gen_random_uuid(),
  check_type_id uuid not null references tl_check_types(id),
  label text not null check (length(btrim(label)) > 0 and length(label) <= 100),
  sort_order int not null default 0,
  is_archived boolean not null default false
);
create unique index uq_tl_check_values_label on tl_check_values (check_type_id, lower(label)) where not is_archived;

alter table tl_check_types enable row level security;
alter table tl_check_values enable row level security;

-- Definitions: Super Admin + QA Manager manage; Team Leads read (to fill the form). QA Auditor / Manager / agent: no access.
create policy tl_check_types_select on tl_check_types for select to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager', 'team_lead'));
create policy tl_check_types_write on tl_check_types for all to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager'))
  with check (current_app_role() in ('super_admin', 'qa_manager'));
create policy tl_check_values_select on tl_check_values for select to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager', 'team_lead'));
create policy tl_check_values_write on tl_check_values for all to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager'))
  with check (current_app_role() in ('super_admin', 'qa_manager'));

-- ── The checks themselves ────────────────────────────────────
create table team_lead_checks (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references users(id),
  team_lead_id uuid not null references users(id),   -- always the caller — no delegation, same as Briefings (§5)

  crm_lead_id text,
  crm_call_id text,
  call_started_at timestamptz,
  call_ended_at timestamptz,
  call_recording_url text,
  call_status text,
  call_destination text,

  notes text check (notes is null or length(notes) <= 2000),
  created_at timestamptz not null default now()
);
create unique index idx_team_lead_checks_crm_call_id on team_lead_checks (crm_call_id) where crm_call_id is not null;
create index idx_team_lead_checks_agent on team_lead_checks (agent_id);
create index idx_team_lead_checks_team_lead on team_lead_checks (team_lead_id);

create table team_lead_check_answers (
  team_lead_check_id uuid not null references team_lead_checks(id),
  check_type_id uuid not null references tl_check_types(id),
  value_id uuid not null references tl_check_values(id),
  primary key (team_lead_check_id, check_type_id)
);

alter table team_lead_checks enable row level security;
alter table team_lead_check_answers enable row level security;

-- Read: the Team Lead who conducted it, own rows only; Super Admin, everything (oversight). NO ONE ELSE —
-- not QA Manager, not QA Auditor, not the agent, not a Manager (a Manager gets a COUNT only, via the function
-- below, never row-level access to this table).
create policy team_lead_checks_select_self on team_lead_checks for select to authenticated
  using (current_app_role() = 'team_lead' and team_lead_id = current_app_user_id());
create policy team_lead_checks_select_admin on team_lead_checks for select to authenticated
  using (current_app_role() = 'super_admin');
-- Write: insert only, by the Team Lead themself, only for one of their own agents. No update/delete for
-- anyone (immutable — same "never destroy" shape used throughout this system) — log a fresh one instead.
create policy team_lead_checks_insert on team_lead_checks for insert to authenticated
  with check (
    current_app_role() = 'team_lead'
    and team_lead_id = current_app_user_id()
    and agent_id in (select a from team_agent_ids() as a)
  );

create policy team_lead_check_answers_select on team_lead_check_answers for select to authenticated
  using (exists (
    select 1 from team_lead_checks c where c.id = team_lead_check_answers.team_lead_check_id
      and (
        (current_app_role() = 'team_lead' and c.team_lead_id = current_app_user_id())
        or current_app_role() = 'super_admin'
      )
  ));
create policy team_lead_check_answers_insert on team_lead_check_answers for insert to authenticated
  with check (exists (
    select 1 from team_lead_checks c where c.id = team_lead_check_answers.team_lead_check_id
      and c.team_lead_id = current_app_user_id() and current_app_role() = 'team_lead'
  ));

-- ── Submit (atomic, validated) ────────────────────────────────
-- p_answers = [{"check_type_id": uuid, "value_id": uuid}, ...] — any subset of the active check types (all
-- optional; a Team Lead may answer only what's relevant to this call). Every answer must belong to an
-- ACTIVE check type and an ACTIVE value of that same check type (a foreign-key-safe pair).
create or replace function submit_team_lead_check(
  p_agent_id uuid,
  p_crm_lead_id text,
  p_crm_call_id text,
  p_call_started_at timestamptz,
  p_call_ended_at timestamptz,
  p_call_recording_url text,
  p_call_status text,
  p_call_destination text,
  p_notes text,
  p_answers jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := current_app_user_id();
  v_check_id uuid;
  v_answer jsonb;
begin
  if current_app_role() <> 'team_lead' then
    raise exception 'Only a Team Lead can log a check.';
  end if;
  if p_agent_id not in (select a from team_agent_ids() as a) then
    raise exception 'That agent is not on your team.';
  end if;
  if p_notes is not null and length(p_notes) > 2000 then
    raise exception 'Notes must be 2000 characters or fewer.';
  end if;

  insert into team_lead_checks (
    agent_id, team_lead_id, crm_lead_id, crm_call_id, call_started_at, call_ended_at,
    call_recording_url, call_status, call_destination, notes
  ) values (
    p_agent_id, v_me, p_crm_lead_id, p_crm_call_id, p_call_started_at, p_call_ended_at,
    p_call_recording_url, p_call_status, p_call_destination, nullif(btrim(coalesce(p_notes, '')), '')
  ) returning id into v_check_id;

  if p_answers is not null then
    for v_answer in select * from jsonb_array_elements(p_answers) loop
      if not exists (select 1 from tl_check_types t where t.id = (v_answer->>'check_type_id')::uuid and not t.is_archived) then
        raise exception 'That check is no longer available.';
      end if;
      if not exists (select 1 from tl_check_values v where v.id = (v_answer->>'value_id')::uuid
                       and v.check_type_id = (v_answer->>'check_type_id')::uuid and not v.is_archived) then
        raise exception 'That answer is no longer available for this check.';
      end if;
      insert into team_lead_check_answers (team_lead_check_id, check_type_id, value_id)
      values (v_check_id, (v_answer->>'check_type_id')::uuid, (v_answer->>'value_id')::uuid);
    end loop;
  end if;

  return v_check_id;
end;
$$;
revoke all on function submit_team_lead_check(uuid, text, text, timestamptz, timestamptz, text, text, text, text, jsonb) from public;
grant execute on function submit_team_lead_check(uuid, text, text, timestamptz, timestamptz, text, text, text, text, jsonb) to authenticated;

-- ── Manager's lighter view: a COUNT per Team Lead, never the answers ──
create or replace function manager_tl_check_counts(p_manager_id uuid, p_from timestamptz, p_to timestamptz)
returns table (
  team_lead_id uuid,
  team_lead_name text,
  checks_count int
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_role text := current_app_role();
begin
  if v_role not in ('super_admin', 'qa_manager', 'manager') then
    return;
  end if;
  if v_role = 'manager' and p_manager_id <> current_app_user_id() then
    p_manager_id := current_app_user_id();
  end if;
  if p_to <= p_from then
    raise exception 'The period''s end must be after its start.';
  end if;

  return query
  select tl.id, tl.name, count(c.id)::int
    from users tl
    left join team_lead_checks c on c.team_lead_id = tl.id and c.created_at >= p_from and c.created_at < p_to
   where tl.role = 'team_lead' and tl.manager_id = p_manager_id
   group by tl.id, tl.name
   order by tl.name;
end;
$$;
revoke all on function manager_tl_check_counts(uuid, timestamptz, timestamptz) from public;
grant execute on function manager_tl_check_counts(uuid, timestamptz, timestamptz) to authenticated;
