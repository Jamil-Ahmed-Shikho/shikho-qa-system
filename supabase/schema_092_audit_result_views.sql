-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 092 — Evaluation-email tracking: did the agent click through to
-- their result? (Jamil, 2026-10-12.) Apply after 091. Test in the Supabase
-- SQL Editor first.
--
-- APPROACH, confirmed with Jamil before building: a tracking PIXEL (open
-- tracking) was proposed and rejected — iPhone Mail and several corporate
-- scanners auto-fetch every image in every email regardless of whether a
-- human looked at it, so an "opened" count would read close to 100% and
-- mean nothing. Instead, the email's EXISTING "View full result" button now
-- routes through a tracking redirect first — a real click is a trustworthy
-- signal, and the agent does exactly what they already do (one click, no
-- new step, no second button).
--
-- audit_result_views: one row per audit, written only by
-- record_audit_result_view() (called from the new /api/audits/[id]/view
-- redirect route, via the service-role client — the agent may not be
-- logged in yet when they click from email, so this can't go through the
-- normal session-scoped RLS path). No write policy for any signed-in role.
-- ============================================================

create table audit_result_views (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null unique references audits(id),
  agent_id uuid not null references users(id),   -- denormalized, for read-scoping (same pattern as every other QA-visible table)
  first_viewed_at timestamptz not null,
  last_viewed_at timestamptz not null,
  view_count int not null default 1
);
create index idx_audit_result_views_agent on audit_result_views(agent_id);

alter table audit_result_views enable row level security;

-- Read: QA staff all; Team Lead own team; Manager own chain — same scoping shape used throughout
-- this system (§2). No agent policy — an agent doesn't need to read this, they know they clicked.
create policy audit_result_views_select_qa on audit_result_views for select to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager', 'qa_auditor'));
create policy audit_result_views_select_team_lead on audit_result_views for select to authenticated
  using (current_app_role() = 'team_lead' and agent_id in (select a from team_agent_ids() as a));
create policy audit_result_views_select_manager on audit_result_views for select to authenticated
  using (current_app_role() = 'manager' and agent_id in (select a from manager_chain_ids() as a));

-- The only writer. Idempotent (on conflict), so a second/third click just bumps last_viewed_at
-- and view_count rather than erroring — a QA Manager caring "did they look more than once" gets
-- that for free, not that it's asked for yet.
create or replace function record_audit_result_view(p_audit_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent_id uuid;
begin
  select agent_id into v_agent_id from audits where id = p_audit_id;
  if v_agent_id is null then return; end if;

  insert into audit_result_views (audit_id, agent_id, first_viewed_at, last_viewed_at, view_count)
  values (p_audit_id, v_agent_id, now(), now(), 1)
  on conflict (audit_id) do update
    set last_viewed_at = now(), view_count = audit_result_views.view_count + 1;
end;
$$;
revoke all on function record_audit_result_view(uuid) from public;
grant execute on function record_audit_result_view(uuid) to service_role;

-- ── The report: has each recent audit's agent clicked through yet? ─────────────────────────────
-- Same shape/role-check pattern as qa_rubric_fail_trends() / repeat_mistake_report() — security
-- definer, does its own scoping, never relies on RLS per row. check_mode = 'audit' only (a Sample
-- Check is never emailed to an agent, §4 Part 3) — matches every other "real audits only" report.
create or replace function evaluation_tracking_report(p_from timestamptz, p_to timestamptz, p_view text default 'team')
returns table (
  audit_id uuid,
  agent_id uuid,
  agent_name text,
  team_name text,
  site_name text,
  team_leader_name text,
  submitted_at timestamptz,
  viewed_at timestamptz,
  view_count int
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_role text := current_app_role();
  v_me uuid := current_app_user_id();
begin
  if v_role not in ('super_admin', 'qa_manager', 'qa_auditor', 'team_lead', 'manager') then
    return;
  end if;
  if p_to <= p_from then
    raise exception 'The period''s end must be after its start.';
  end if;
  if p_view not in ('mine', 'team') then
    raise exception 'Choose My view or Team view.';
  end if;

  return query
  select a.id, a.agent_id, u.name, u.team_name, u.site_name, tl.name,
         a.submitted_at, v.last_viewed_at, coalesce(v.view_count, 0)
    from audits a
    join users u on u.id = a.agent_id
    left join users tl on tl.id = u.team_leader_id
    left join audit_result_views v on v.audit_id = a.id
   where a.status = 'submitted' and a.check_mode = 'audit'
     and a.submitted_at >= p_from and a.submitted_at < p_to
     and (
       v_role in ('super_admin', 'qa_manager')
       or (v_role = 'qa_auditor' and (p_view = 'team' or u.quality_auditor_id = v_me))
       or (v_role = 'team_lead' and a.agent_id in (select x from team_agent_ids() as x))
       or (v_role = 'manager' and a.agent_id in (select x from manager_chain_ids() as x))
     )
   order by a.submitted_at desc;
end;
$$;
revoke all on function evaluation_tracking_report(timestamptz, timestamptz, text) from public;
grant execute on function evaluation_tracking_report(timestamptz, timestamptz, text) to authenticated;
