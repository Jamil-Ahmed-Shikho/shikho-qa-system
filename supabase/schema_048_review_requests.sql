-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 048 — Section D, Part 1: Review Request, REPLACING Disputes entirely (§4).
-- Test in the Supabase SQL Editor before relying on it. Apply after 047.
--
-- This is a full rebuild, not an extension: everything Disputes built (schema_028's
-- §"DISPUTES" section — the `disputes` table, `file_dispute()`, `start_dispute_review()`,
-- `resolve_dispute()`, its RLS policies) is DROPPED below and replaced by `review_requests`.
-- CAPA (schema_028's §"CAPA" section — capa_status, flag_reaudit/unflag_reaudit,
-- pending_reaudits) is UNCHANGED — Part 2 of this same request keeps the manual CAPA flag
-- exactly as it is, running alongside the new automatic repeat-mistake tracking (a later
-- stage, not in this migration).
--
-- CONFIRMED by Jamil, asked rather than guessed: a Team Lead's OWN resolution of a Review
-- Request (the "resolve it themselves" branch, as opposed to escalating) can ONLY uphold the
-- original audit — it can never change the score or feedback. Any actual revision, for
-- ANY agent including the Team Lead's own team, must go through QA Manager (an assigned
-- re-audit + QA Manager's approval). This keeps score-revision authority concentrated in
-- QA even though a Team Lead already has rubric/audit authority over their own team
-- elsewhere in this system (§2) — a deliberate choice, not an oversight.
--
-- THE RE-AUDIT REUSES THE EXISTING SCORING ENGINE UNCHANGED. A re-audit is just another
-- `audits` row (audit_type/rubric_id/agent_id/the CRM call fields copied from the original),
-- scored via the SAME write_audit_results() / scorecard UI as any other audit — draft, then
-- submit. The only two schema changes this needs are (1) a `review_request_id` column
-- tagging it as a re-audit rather than a normal new audit, and (2) narrowing the existing
-- one-audit-per-call unique index so a re-audit doesn't collide with the original audit
-- on the same call. Nothing about scoring itself changes.
--
-- "Nothing changes until QA Manager approves" (Q16, now answered): approving a re-audit's
-- result sets the ORIGINAL audit's `superseded_by` to point at the re-audit's audit row —
-- the original stays exactly as it was (immutable, historical record, §4's own principle),
-- and anything reading "the current score for this audit" should follow `superseded_by`
-- if it is set. NOT propagated automatically: an already-frozen RYG period, a past week's
-- audit-target snapshot, or any other aggregate computed and frozen before the revision —
-- consistent with this system's own established "never rewrite a frozen historical period"
-- principle (§6.2's `agent_status_log`, §9's `agent_weekly_audit_target`), not a shortcut.
-- Flag this specific consequence for Jamil's awareness, not guessed silently.
--
-- Agent visibility (Q22, now answered) is Part 1's other change: an agent can now see the
-- Special Check answers, root-cause tags, the auditor's name and the CRM lead link on their
-- OWN audits. They still cannot see any re-audit/CAPA flag, or another agent's anything.
-- The Special-Check-answer RLS change is below; root-cause/auditor-name/CRM-lead-link are
-- pure UI conditionals with no RLS gate today, so they are a Stage 2 (UI) change, not here.
-- ============================================================

-- ═══ 1. Remove Disputes entirely ═════════════════════════════════════════════════
-- Functions first (DROP TABLE does not track a plpgsql function body's use of a table).
drop function if exists file_dispute(uuid, text);
drop function if exists start_dispute_review(uuid);
drop function if exists resolve_dispute(uuid, text, text);
drop table if exists disputes;

-- Any audit actually left mid-dispute is put back to 'submitted' before the CHECK is
-- tightened below — a real data correction (schema_039's own precedent), not a guess:
-- the dispute that put it there no longer exists, so there is nothing left for it to mean.
update audits set status = 'submitted' where status in ('disputed', 'resolved');
alter table audits drop constraint if exists audits_status_check;
alter table audits add constraint audits_status_check check (status in ('draft', 'submitted', 'acknowledged'));

-- ═══ 2. review_requests -- created BEFORE audits references it (§14's ordering lesson,
-- applied to a table dependency rather than a function signature this time) ══════════
create table review_requests (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null unique references audits(id),   -- ONE Review Request per audit, ever (no appeal)
  agent_id uuid not null references users(id),            -- whose audit — denormalized for read-scoping
  raised_by uuid not null references users(id),           -- who actually filed it
  filer_role text not null check (filer_role in ('agent', 'team_lead', 'manager')),
  reason text not null check (length(btrim(reason)) > 0 and length(reason) <= 2000),

  status text not null check (status in ('with_team_lead', 'with_qa_manager', 'resolved')),

  -- The Team Lead's OWN decision -- uphold is FINAL (no score change, ever, from here);
  -- escalate hands it to QA Manager. Only ever set when filer_role = 'agent'.
  team_lead_decision text check (team_lead_decision in ('upheld', 'escalated')),
  team_lead_decided_by uuid references users(id),
  team_lead_decided_at timestamptz,
  team_lead_note text check (team_lead_note is null or length(team_lead_note) <= 2000),

  -- QA Manager's handling once it reaches them (directly filed, or escalated).
  assigned_to uuid references users(id),      -- QA Manager themself, or a QA Auditor
  assigned_by uuid references users(id),
  assigned_at timestamptz,
  reaudit_audit_id uuid references audits(id), -- the linked re-audit's own audits row, once started

  -- QA Manager's final decision -- the ONLY way a score/feedback can actually change.
  final_outcome text check (final_outcome in ('no_change', 'revised')),
  final_decided_by uuid references users(id),
  final_decided_at timestamptz,
  final_note text check (final_note is null or length(final_note) <= 2000),

  created_at timestamptz not null default now(),

  -- Every column pair below is required-together or forbidden-together, spelled out with
  -- explicit IS NOT NULL on every column involved (§14 — a NULL check result PASSES).
  constraint review_requests_tl_decision_together check (
    (team_lead_decision is null and team_lead_decided_by is null and team_lead_decided_at is null)
    or (team_lead_decision is not null and team_lead_decided_by is not null and team_lead_decided_at is not null)
  ),
  constraint review_requests_assignment_together check ((assigned_by is null) = (assigned_at is null)),
  constraint review_requests_final_together check (
    (final_outcome is null and final_decided_by is null and final_decided_at is null and final_note is null)
    or (final_outcome is not null and final_decided_by is not null and final_decided_at is not null
        and final_note is not null and length(btrim(final_note)) > 0)
  ),
  -- Resolved either by a Team Lead upholding, or by a QA Manager's final decision -- never both empty.
  constraint review_requests_resolved_has_a_decision check (
    status <> 'resolved' or team_lead_decision = 'upheld' or final_outcome is not null
  )
);
create index idx_review_requests_agent on review_requests(agent_id);
create index idx_review_requests_status on review_requests(status);

-- ═══ 3. Re-audit support on `audits` (reusing the existing scoring engine, unchanged) ══
alter table audits add column if not exists review_request_id uuid references review_requests(id);
-- `superseded_by` lives on the ORIGINAL audit, pointing at the approved re-audit that
-- replaces its effective score/feedback. The original row itself is never edited (§4).
alter table audits add column if not exists superseded_by uuid references audits(id);

-- Narrow the one-audit-per-call rule: a re-audit (tagged review_request_id) is a deliberate
-- SECOND scoring of the same call and must not collide with the original's uniqueness.
drop index if exists idx_audits_crm_call_id;
create unique index idx_audits_crm_call_id on audits(crm_call_id) where crm_call_id is not null and review_request_id is null;

alter table review_requests enable row level security;

-- Read: QA Manager/Super Admin all; a QA Auditor the ones assigned to them or on audits they
-- conducted; a Team Lead their own team's; a Manager their chain's (§2); the agent their own.
-- NO write policy for anyone -- every change goes through the functions below.
create policy review_requests_select_admin on review_requests for select to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager'));
create policy review_requests_select_auditor on review_requests for select to authenticated
  using (current_app_role() = 'qa_auditor'
         and (assigned_to = current_app_user_id()
              or audit_id in (select id from audits where auditor_id = current_app_user_id())));
create policy review_requests_select_team_lead on review_requests for select to authenticated
  using (current_app_role() = 'team_lead' and agent_id in (select a from team_agent_ids() as a));
create policy review_requests_select_manager on review_requests for select to authenticated
  using (current_app_role() = 'manager' and agent_id in (select a from manager_chain_ids() as a));
create policy review_requests_select_self on review_requests for select to authenticated
  using (agent_id = current_app_user_id());

-- A review request in progress is also visible on its LINKED re-audit's own audits row --
-- the re-auditor and QA Manager already see the audits row through the ordinary audits
-- policies (auditor_id = self, or QA-wide), this just lets them see the request it belongs to
-- via the reverse link too (covered by review_requests_select_auditor's `assigned_to` branch
-- already for a QA Auditor; QA Manager/Super Admin already see everything unconditionally).

-- ═══ 4. review_requests workflow functions ═══════════════════════════════════════

-- ── 4a. File a Review Request -- the agent, or their Team Lead/Manager ON THEIR BEHALF,
-- no agent consent needed. Within 7 days of submission. Once per audit. ────────────────────
create or replace function file_review_request(p_audit_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := current_app_role();
  v_me uuid := current_app_user_id();
  v_audit audits%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_filer_role text;
  v_status text;
  v_id uuid;
begin
  if v_me is null then raise exception 'You are not signed in.'; end if;
  select * into v_audit from audits where id = p_audit_id;
  if not found then raise exception 'That audit does not exist.'; end if;
  if v_audit.status = 'draft' then raise exception 'This audit has not been submitted yet.'; end if;
  if v_audit.review_request_id is not null then raise exception 'This audit is itself a re-audit and cannot have its own Review Request.'; end if;
  if exists (select 1 from review_requests where audit_id = p_audit_id) then
    raise exception 'A Review Request has already been filed for this audit.';
  end if;
  if v_audit.submitted_at is null or now() > v_audit.submitted_at + interval '7 days' then
    raise exception 'The 7-day window to file a Review Request on this audit has passed.';
  end if;
  if v_reason = '' then raise exception 'Explain what you are requesting a review of.'; end if;
  if length(v_reason) > 2000 then raise exception 'The reason can be at most 2000 characters.'; end if;

  if v_role = 'agent' then
    if v_audit.agent_id <> v_me then raise exception 'You can only request a review of your own audits.'; end if;
    v_filer_role := 'agent'; v_status := 'with_team_lead';
  elsif v_role = 'team_lead' then
    if v_audit.agent_id not in (select a from team_agent_ids() as a) then
      raise exception 'You can only request a review for an agent on your own team.';
    end if;
    v_filer_role := 'team_lead'; v_status := 'with_qa_manager';
  elsif v_role = 'manager' then
    if v_audit.agent_id not in (select a from manager_chain_ids() as a) then
      raise exception 'You can only request a review for an agent in your own reporting chain.';
    end if;
    v_filer_role := 'manager'; v_status := 'with_qa_manager';
  else
    raise exception 'Only the agent, or their Team Lead or Manager on their behalf, can file a Review Request.';
  end if;

  insert into review_requests (audit_id, agent_id, raised_by, filer_role, reason, status)
  values (p_audit_id, v_audit.agent_id, v_me, v_filer_role, v_reason, v_status)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function file_review_request(uuid, text) from public;
grant execute on function file_review_request(uuid, text) to authenticated;

-- ── 4b. The Team Lead's own resolution -- UPHOLD (final, no score change) or ESCALATE.
-- Only reachable while status = 'with_team_lead' (i.e. only ever an agent-filed request). ──
create or replace function team_lead_decide_review_request(p_id uuid, p_decision text, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r review_requests%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if current_app_role() <> 'team_lead' then raise exception 'Only a Team Lead can make this decision.'; end if;
  if p_decision not in ('uphold', 'escalate') then raise exception 'Choose uphold or escalate.'; end if;
  select * into v_r from review_requests where id = p_id for update;
  if not found then raise exception 'That Review Request does not exist.'; end if;
  if v_r.agent_id not in (select a from team_agent_ids() as a) then
    raise exception 'You can only decide a Review Request for an agent on your own team.';
  end if;
  if v_r.status <> 'with_team_lead' then raise exception 'This Review Request is not waiting on you.'; end if;
  if v_note = '' then raise exception 'A note is required.'; end if;
  if length(v_note) > 2000 then raise exception 'The note can be at most 2000 characters.'; end if;

  if p_decision = 'uphold' then
    update review_requests
       set status = 'resolved', team_lead_decision = 'upheld',
           team_lead_decided_by = current_app_user_id(), team_lead_decided_at = now(), team_lead_note = v_note
     where id = p_id;
  else
    update review_requests
       set status = 'with_qa_manager', team_lead_decision = 'escalated',
           team_lead_decided_by = current_app_user_id(), team_lead_decided_at = now(), team_lead_note = v_note
     where id = p_id;
  end if;
end;
$$;
revoke all on function team_lead_decide_review_request(uuid, text, text) from public;
grant execute on function team_lead_decide_review_request(uuid, text, text) to authenticated;

-- ── 4c. QA Manager assigns the re-audit -- to themself, or to a QA Auditor (same or
-- different from the original). Super Admin may act identically. ───────────────────────────
create or replace function qa_manager_assign_review_request(p_id uuid, p_assignee uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r review_requests%rowtype;
  v_role text;
begin
  if current_app_role() not in ('super_admin', 'qa_manager') then
    raise exception 'Only a Super Admin or QA Manager can assign a Review Request.';
  end if;
  select * into v_r from review_requests where id = p_id for update;
  if not found then raise exception 'That Review Request does not exist.'; end if;
  if v_r.status <> 'with_qa_manager' then raise exception 'This Review Request is not waiting on QA Manager.'; end if;
  if v_r.reaudit_audit_id is not null then raise exception 'The re-audit has already been started.'; end if;
  select role into v_role from users where id = p_assignee;
  if v_role not in ('super_admin', 'qa_manager', 'qa_auditor') then
    raise exception 'A Review Request can only be assigned to QA staff.';
  end if;

  update review_requests set assigned_to = p_assignee, assigned_by = current_app_user_id(), assigned_at = now() where id = p_id;
end;
$$;
revoke all on function qa_manager_assign_review_request(uuid, uuid) from public;
grant execute on function qa_manager_assign_review_request(uuid, uuid) to authenticated;

-- ── 4d. Start the re-audit -- creates the linked `audits` row, a normal draft scored
-- through the EXISTING scoring engine unchanged (write_audit_results(), the scorecard UI).
-- Callable by whoever is assigned, or unilaterally by QA Manager/Super Admin (the same
-- "unilateral authority always available to QA Manager" shape used throughout, e.g. PIP §6.4). ──
create or replace function start_review_reaudit(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r review_requests%rowtype;
  v_orig audits%rowtype;
  v_me uuid := current_app_user_id();
  v_role text := current_app_role();
  v_new_id uuid;
begin
  if v_role not in ('super_admin', 'qa_manager', 'qa_auditor') then
    raise exception 'Only QA staff can start a re-audit.';
  end if;
  select * into v_r from review_requests where id = p_id for update;
  if not found then raise exception 'That Review Request does not exist.'; end if;
  if v_r.status <> 'with_qa_manager' then raise exception 'This Review Request is not ready for a re-audit.'; end if;
  if v_r.reaudit_audit_id is not null then raise exception 'The re-audit has already been started.'; end if;
  if v_role = 'qa_auditor' and v_r.assigned_to is distinct from v_me then
    raise exception 'This Review Request has not been assigned to you.';
  end if;

  select * into v_orig from audits where id = v_r.audit_id;

  insert into audits (
    audit_type, agent_id, auditor_id, rubric_id, item_reference,
    crm_lead_id, crm_call_id, call_started_at, call_ended_at, call_recording_url, call_status, call_destination,
    review_request_id, status
  ) values (
    v_orig.audit_type, v_orig.agent_id, v_me, v_orig.rubric_id, v_orig.item_reference,
    v_orig.crm_lead_id, v_orig.crm_call_id, v_orig.call_started_at, v_orig.call_ended_at,
    v_orig.call_recording_url, v_orig.call_status, v_orig.call_destination,
    p_id, 'draft'
  ) returning id into v_new_id;

  update review_requests set reaudit_audit_id = v_new_id, assigned_to = coalesce(assigned_to, v_me) where id = p_id;
  return v_new_id;
end;
$$;
revoke all on function start_review_reaudit(uuid) from public;
grant execute on function start_review_reaudit(uuid) to authenticated;

-- ── 4e. QA Manager's final decision once the re-audit is SUBMITTED -- the only way an
-- audit's effective score/feedback can actually change. No restriction on a QA Manager
-- deciding about an audit (or a re-audit) they conducted themselves (confirmed, Q20). ──────
create or replace function qa_manager_decide_review_revision(p_id uuid, p_decision text, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r review_requests%rowtype;
  v_reaudit audits%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if current_app_role() not in ('super_admin', 'qa_manager') then
    raise exception 'Only a Super Admin or QA Manager can decide a Review Request.';
  end if;
  if p_decision not in ('approve', 'reject') then raise exception 'Choose approve or reject.'; end if;
  select * into v_r from review_requests where id = p_id for update;
  if not found then raise exception 'That Review Request does not exist.'; end if;
  if v_r.status <> 'with_qa_manager' then raise exception 'This Review Request is not waiting on a decision.'; end if;
  if v_r.reaudit_audit_id is null then raise exception 'The re-audit has not been started yet.'; end if;
  select * into v_reaudit from audits where id = v_r.reaudit_audit_id;
  if v_reaudit.status = 'draft' then raise exception 'The re-audit has not been submitted yet.'; end if;
  if v_note = '' then raise exception 'A note is required.'; end if;
  if length(v_note) > 2000 then raise exception 'The note can be at most 2000 characters.'; end if;

  if p_decision = 'approve' then
    update audits set superseded_by = v_r.reaudit_audit_id where id = v_r.audit_id;
    update review_requests
       set status = 'resolved', final_outcome = 'revised',
           final_decided_by = current_app_user_id(), final_decided_at = now(), final_note = v_note
     where id = p_id;
  else
    update review_requests
       set status = 'resolved', final_outcome = 'no_change',
           final_decided_by = current_app_user_id(), final_decided_at = now(), final_note = v_note
     where id = p_id;
  end if;
end;
$$;
revoke all on function qa_manager_decide_review_revision(uuid, text, text) from public;
grant execute on function qa_manager_decide_review_revision(uuid, text, text) to authenticated;

-- ═══ 5. Agent visibility of Special Check answers (Q22) -- their OWN non-draft audits
-- only; everyone else's visibility (already broad, by §4 Part B3's own design) unchanged. ══
drop policy if exists audit_campaigns_select on audit_campaigns;
create policy audit_campaigns_select on audit_campaigns for select to authenticated
  using (
    (coalesce(current_app_role(), '') <> 'agent' and exists (select 1 from audits a where a.id = audit_campaigns.audit_id))
    or (current_app_role() = 'agent'
        and exists (select 1 from audits a where a.id = audit_campaigns.audit_id and a.agent_id = current_app_user_id() and a.status <> 'draft'))
  );
drop policy if exists audit_campaign_answers_select on audit_campaign_answers;
create policy audit_campaign_answers_select on audit_campaign_answers for select to authenticated
  using (
    (coalesce(current_app_role(), '') <> 'agent' and exists (select 1 from audits a where a.id = audit_campaign_answers.audit_id))
    or (current_app_role() = 'agent'
        and exists (select 1 from audits a where a.id = audit_campaign_answers.audit_id and a.agent_id = current_app_user_id() and a.status <> 'draft'))
  );
