-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 021 — Briefings, Part A: schedule + email (§5)
-- Test this in the Supabase SQL Editor before relying on it.
-- Requires schema_011 (audits/write_audit_results) already applied.
--
-- Confirmed design (see CLAUDE.md §5 for the full write-up):
--   - Strictly 1:1. Each auditor has their own 11:00-3:00 PM, Sun-Thu grid
--     (Asia/Dhaka), 15-minute slots, one agent per slot.
--   - One briefing row per audit, ever (audit_id unique) — rescheduling
--     updates the row, cancelling flips status, never a second row.
--   - priority is DERIVED from audits.critical_fail by trigger, never
--     caller-supplied — same pattern as fatal severity (§4).
--   - Scheduling is QA-only (role check in RLS); conducted_by is always
--     the actor, never delegated.
-- ============================================================

create table briefings (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null unique references audits(id),
  agent_id uuid not null references users(id),
  scheduled_at timestamptz not null,
  slot_duration_minutes int not null default 15,
  priority text not null default 'normal' check (priority in ('normal', 'critical_same_day')),
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  conducted_by uuid not null references users(id),
  attended boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A slot is 11:00-15:00 inclusive-start, Sun-Thu, on the 15-minute grid,
  -- Asia/Dhaka wall-clock time (the business rule is stated in BD local
  -- time, not UTC — scheduled_at is stored as timestamptz as usual).
  -- dow: 0=Sunday .. 4=Thursday (5=Friday, 6=Saturday excluded).
  constraint briefings_valid_slot check (
    extract(dow from scheduled_at at time zone 'Asia/Dhaka') between 0 and 4
    and (
      extract(hour from scheduled_at at time zone 'Asia/Dhaka') between 11 and 14
      or (extract(hour from scheduled_at at time zone 'Asia/Dhaka') = 15
          and extract(minute from scheduled_at at time zone 'Asia/Dhaka') = 0)
    )
    and extract(minute from scheduled_at at time zone 'Asia/Dhaka')::int in (0, 15, 30, 45)
    and extract(second from scheduled_at at time zone 'Asia/Dhaka') = 0
  ),
  -- Attendance only means something once the session happened.
  constraint briefings_attended_only_when_completed check (
    (status = 'completed') = (attended is not null)
  )
);

-- One live booking per auditor per slot — a cancelled row frees the slot
-- for a fresh booking (a new row can't be made anyway, audit_id is
-- unique; this is about MOVING an existing row back to that slot).
create unique index uq_briefings_conductor_slot
  on briefings(conducted_by, scheduled_at)
  where status <> 'cancelled';

create index idx_briefings_agent on briefings(agent_id);
create index idx_briefings_conductor_time on briefings(conducted_by, scheduled_at);

create trigger trg_briefings_touch before update on briefings
  for each row execute function touch_updated_at();

-- priority is derived from the linked audit's critical_fail, never from
-- the caller — same principle as fatal severity being read from the
-- rubric, never the request (§4). Also fills agent_id from the audit at
-- insert, so the app never has to send it (and can't send a mismatched one).
create or replace function briefings_derive_from_audit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_agent_id uuid;
  v_critical boolean;
  v_status text;
begin
  select agent_id, critical_fail, status into v_agent_id, v_critical, v_status
    from audits where id = new.audit_id;

  if v_agent_id is null then
    raise exception 'Audit % not found.', new.audit_id;
  end if;
  if v_status = 'draft' then
    raise exception 'This audit has not been submitted yet — a briefing can only be scheduled against a submitted audit.';
  end if;

  new.agent_id := v_agent_id;
  new.priority := case when v_critical then 'critical_same_day' else 'normal' end;
  return new;
end;
$$;

create trigger trg_briefings_derive before insert or update on briefings
  for each row execute function briefings_derive_from_audit();

alter table briefings enable row level security;

-- ── Read ─────────────────────────────────────────────────────
-- QA Manager / Super Admin: everything (org-wide, unrestricted).
create policy briefings_select_qa_unrestricted on briefings
  for select to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager'));

-- QA Auditor: only briefings they themselves conduct — "My View" for
-- their own coaching schedule (§2 standing principle; this screen is a
-- personal queue, not a cross-cutting report, so it gets the "My View"
-- side of the toggle by default, with no "Team View" for this role here
-- — that's what QA Manager/Super Admin's unrestricted access already is).
create policy briefings_select_qa_auditor on briefings
  for select to authenticated
  using (current_app_role() = 'qa_auditor' and conducted_by = current_app_user_id());

-- Team Lead: view-only, own team's agents (same team_agent_ids() pattern
-- used everywhere else Team Lead appears — no scheduling access, §5).
create policy briefings_select_team_lead on briefings
  for select to authenticated
  using (current_app_role() = 'team_lead' and agent_id in (select a from team_agent_ids() as a));

-- Manager: view-only, own reporting chain (manager_chain_ids()) — no
-- scheduling access.
create policy briefings_select_manager on briefings
  for select to authenticated
  using (current_app_role() = 'manager' and agent_id in (select a from manager_chain_ids() as a));

-- Agent: their own briefings only.
create policy briefings_select_self on briefings
  for select to authenticated
  using (agent_id = current_app_user_id());

-- ── Write ────────────────────────────────────────────────────
-- INSERT and UPDATE only — deliberately no DELETE policy for anyone
-- (cancel via status, never a hard delete; same "never destroy" pattern
-- as Campaigns, §4 Part B1). "for all" is avoided here specifically
-- because it would silently include delete too.

-- QA Manager / Super Admin: can schedule/reschedule/cancel/mark
-- attendance on ANY briefing (unrestricted, same as their read access).
create policy briefings_insert_qa_unrestricted on briefings
  for insert to authenticated
  with check (current_app_role() in ('super_admin', 'qa_manager'));

create policy briefings_update_qa_unrestricted on briefings
  for update to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager'))
  with check (current_app_role() in ('super_admin', 'qa_manager'));

-- QA Auditor: only their OWN briefings (conducted_by = self on both the
-- existing row and whatever they're writing — no delegating to or
-- editing another auditor's grid).
create policy briefings_insert_qa_auditor on briefings
  for insert to authenticated
  with check (current_app_role() = 'qa_auditor' and conducted_by = current_app_user_id());

create policy briefings_update_qa_auditor on briefings
  for update to authenticated
  using (current_app_role() = 'qa_auditor' and conducted_by = current_app_user_id())
  with check (current_app_role() = 'qa_auditor' and conducted_by = current_app_user_id());
