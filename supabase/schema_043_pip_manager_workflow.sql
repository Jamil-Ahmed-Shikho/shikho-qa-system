-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 043 — PIP rebuild, Stage 3: the Manager-review workflow (§6.4, Section C, Q9/Q11).
-- Test in the Supabase SQL Editor before relying on it. Apply after 042.
--
-- REPLACES the simple suggested -> approved flow with:
--   1. QA generates the initial suggestion list (generate_pip_candidates(), unchanged).
--   2. The business Manager (role='manager' — Telesales/CX/Retention Manager, distinct from QA
--      Manager) sees the suggestion list BEFORE approval, scoped to their OWN chain
--      (manager_chain_ids()) — never the full company-wide list. They may REQUEST Exclude (with
--      reason) of someone on the list, or REQUEST Include (with reason) of someone in their chain
--      who isn't — these are REQUESTS, never direct edits (pip_manager_requests, a new table).
--   3. QA Manager / Super Admin reviews the QA-generated list AND every Manager's requests
--      together (pip_decide_request(): accept or reject each one).
--   4. QA Manager / Super Admin PUBLISHES the final list (pip_publish_cycle()) — this is what
--      finally flips every still-'suggested' candidate to 'approved' (replacing the old
--      per-candidate pip_decide('approve', ...) action, which is REMOVED: approval is now a
--      list-level decision, not a per-candidate one).
--   5. Only once published: Team Lead and Manager see the final list (unchanged — the existing
--      pip_candidates_select_team_lead / _manager policies already gate on
--      status in ('approved','completed','failed'), so nothing there needed to change). The
--      agent-facing portal view is Stage 6, not built here.
--
-- CONFIRMED by Jamil (2026-09-27), asked rather than guessed: QA Manager / Super Admin RETAINS
-- FULL UNILATERAL AUTHORITY throughout — accepting/rejecting a Manager's request is one input,
-- not the only route to a change. The existing pip_decide('exclude', ...) action (unilateral,
-- no Manager request needed) is UNCHANGED and still available at any point before publish.
-- ============================================================

alter table pip_cycles add column if not exists published_at timestamptz;
alter table pip_cycles add column if not exists published_by uuid references users(id);
alter table pip_cycles add constraint pip_cycles_published_together check ((published_at is null) = (published_by is null));

create table pip_manager_requests (
  id uuid primary key default gen_random_uuid(),
  pip_cycle_id uuid not null references pip_cycles(id),
  agent_id uuid not null references users(id),
  request_type text not null check (request_type in ('exclude', 'include')),
  reason text not null check (length(btrim(reason)) > 0 and length(reason) <= 1000),
  requested_by uuid not null references users(id),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  decided_by uuid references users(id),
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 1000),
  created_at timestamptz not null default now(),
  constraint pip_manager_requests_decision_together check ((status = 'pending') or (decided_by is not null and decided_at is not null)),
  -- at most one PENDING request per (cycle, agent, type) — a second attempt while one is already
  -- pending is refused by the function below with a clear message, not a raw constraint error
  unique (pip_cycle_id, agent_id, request_type, status)
);
create index idx_pip_manager_requests_cycle on pip_manager_requests(pip_cycle_id);

alter table pip_manager_requests enable row level security;
-- QA staff see every request (they need the full picture to decide); a Manager sees only their own.
-- No write policy for anyone: written only by the functions below.
create policy pip_manager_requests_select_qa on pip_manager_requests for select to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager', 'qa_auditor'));
create policy pip_manager_requests_select_own on pip_manager_requests for select to authenticated
  using (current_app_role() = 'manager' and requested_by = current_app_user_id());

-- ── A Manager's landing list: open (unpublished) cycles, with how many of THEIR OWN people are
-- currently suggested/excluded on each ─────────────────────────────────────────────────────────
-- Needed because pip_cycles has no direct SELECT policy for 'manager' pre-publish (only via an
-- approved-or-later candidate, schema_027's pip_cycles_select_via_candidates) — a Manager cannot
-- see an open cycle exists at all without this. SECURITY DEFINER, same "manager sees only their
-- own chain" shape as pip_manager_review() below.
create or replace function pip_manager_open_cycles()
returns table (cycle_id uuid, month date, start_date date, end_date date, my_count bigint)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if current_app_role() <> 'manager' then return; end if;
  return query
  select c.id, c.month, c.start_date, c.end_date,
         (select count(*) from pip_candidates pc
           where pc.pip_cycle_id = c.id and pc.status in ('suggested', 'excluded')
             and pc.agent_id in (select a from manager_chain_ids() as a))
    from pip_cycles c
   where c.published_at is null
   order by c.month desc
   limit 12;
end;
$$;
revoke all on function pip_manager_open_cycles() from public;
grant execute on function pip_manager_open_cycles() to authenticated;

-- ── A Manager's pre-publish view of one cycle, scoped to their own chain ────────────────────────
-- SECURITY DEFINER, same pattern as campaign_report_scope() (§4 Part B3, §14): a narrow, purpose-
-- built window rather than widening the shared pip_candidates RLS (which deliberately keeps a
-- Manager to approved-or-later rows everywhere else in the system). Returns nothing for anyone but
-- a manager, and nothing for a chain that isn't theirs.
create or replace function pip_manager_review(p_cycle_id uuid)
returns table (
  candidate_id uuid, agent_id uuid, agent_name text, team_name text, site_name text,
  status text, revenue_at_selection numeric, revenue_unit_used text,
  vintage_weeks_at_selection int, exclusion_reason text,
  my_pending_request_type text
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_me uuid := current_app_user_id();
begin
  if current_app_role() <> 'manager' then return; end if;
  return query
  select pc.id, pc.agent_id, u.name, coalesce(pc.team_name, u.team_name), coalesce(pc.site_name, u.site_name),
         pc.status, pc.revenue_at_selection, pc.revenue_unit_used, pc.vintage_weeks_at_selection, pc.exclusion_reason,
         (select r.request_type from pip_manager_requests r
           where r.pip_cycle_id = p_cycle_id and r.agent_id = pc.agent_id and r.status = 'pending' and r.requested_by = v_me
           limit 1)
    from pip_candidates pc
    join users u on u.id = pc.agent_id
   where pc.pip_cycle_id = p_cycle_id
     and pc.status in ('suggested', 'excluded')
     and pc.agent_id in (select a from manager_chain_ids() as a)
   order by u.name;
end;
$$;
revoke all on function pip_manager_review(uuid) from public;
grant execute on function pip_manager_review(uuid) to authenticated;

-- ── A cycle's month/dates, for a Manager's review-detail page header. Dates alone aren't sensitive
-- (no per-agent data), so this doesn't scope by chain or published state — just confirms the caller
-- is a Manager and the cycle exists.
create or replace function pip_manager_cycle_info(p_cycle_id uuid)
returns table (month date, start_date date, end_date date, published_at timestamptz)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if current_app_role() <> 'manager' then return; end if;
  return query select c.month, c.start_date, c.end_date, c.published_at from pip_cycles c where c.id = p_cycle_id;
end;
$$;
revoke all on function pip_manager_cycle_info(uuid) from public;
grant execute on function pip_manager_cycle_info(uuid) to authenticated;

-- ── A Manager's own agents who are NOT currently on the list (candidates for an Include request) ──
create or replace function pip_manager_chain_not_listed(p_cycle_id uuid)
returns table (agent_id uuid, agent_name text, team_name text, site_name text)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if current_app_role() <> 'manager' then return; end if;
  return query
  select u.id, u.name, u.team_name, u.site_name
    from users u
   where u.id in (select a from manager_chain_ids() as a)
     and u.role = 'agent' and u.is_active
     and not exists (
       select 1 from pip_candidates pc
        where pc.pip_cycle_id = p_cycle_id and pc.agent_id = u.id and pc.status in ('suggested', 'approved'))
   order by u.name;
end;
$$;
revoke all on function pip_manager_chain_not_listed(uuid) from public;
grant execute on function pip_manager_chain_not_listed(uuid) to authenticated;

-- ── A Manager requests a change (never a direct edit) ───────────────────────────────────────────
create or replace function pip_request_change(p_cycle_id uuid, p_agent_id uuid, p_type text, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := current_app_user_id();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_cycle pip_cycles%rowtype;
  v_id uuid;
begin
  if current_app_role() <> 'manager' then raise exception 'Only a Manager can request a PIP list change.'; end if;
  if p_type not in ('exclude', 'include') then raise exception 'Choose exclude or include.'; end if;
  if v_reason is null then raise exception 'A reason is required.'; end if;
  if p_agent_id not in (select a from manager_chain_ids() as a) then
    raise exception 'You can only request a change for someone in your own reporting chain.';
  end if;

  select * into v_cycle from pip_cycles where id = p_cycle_id;
  if not found then raise exception 'That PIP cycle does not exist.'; end if;
  if v_cycle.published_at is not null then raise exception 'This cycle has already been published — requests are closed.'; end if;

  if p_type = 'exclude' then
    if not exists (select 1 from pip_candidates where pip_cycle_id = p_cycle_id and agent_id = p_agent_id and status = 'suggested') then
      raise exception 'This person is not currently on the suggested list.';
    end if;
  else -- include
    if exists (select 1 from pip_candidates where pip_cycle_id = p_cycle_id and agent_id = p_agent_id and status in ('suggested', 'approved')) then
      raise exception 'This person is already on the list.';
    end if;
  end if;

  if exists (select 1 from pip_manager_requests where pip_cycle_id = p_cycle_id and agent_id = p_agent_id and request_type = p_type and status = 'pending') then
    raise exception 'You already have a pending request for this person.';
  end if;

  insert into pip_manager_requests (pip_cycle_id, agent_id, request_type, reason, requested_by)
  values (p_cycle_id, p_agent_id, p_type, v_reason, v_me)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function pip_request_change(uuid, uuid, text, text) from public;
grant execute on function pip_request_change(uuid, uuid, text, text) to authenticated;

-- ── QA Manager / Super Admin accepts or rejects a Manager's request ─────────────────────────────
create or replace function pip_decide_request(p_request_id uuid, p_action text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := current_app_user_id();
  v_req pip_manager_requests%rowtype;
  v_cycle pip_cycles%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_agent users%rowtype;
begin
  if current_app_role() not in ('super_admin', 'qa_manager') then
    raise exception 'Only a Super Admin or QA Manager can decide a Manager''s request.';
  end if;
  if p_action not in ('accept', 'reject') then raise exception 'Choose accept or reject.'; end if;
  select * into v_req from pip_manager_requests where id = p_request_id for update;
  if not found then raise exception 'That request does not exist.'; end if;
  if v_req.status <> 'pending' then raise exception 'This request was already decided.'; end if;
  select * into v_cycle from pip_cycles where id = v_req.pip_cycle_id;
  if v_cycle.published_at is not null then raise exception 'This cycle has already been published.'; end if;

  if p_action = 'accept' then
    if v_req.request_type = 'exclude' then
      update pip_candidates set status = 'excluded', exclusion_reason = v_req.reason, excluded_by = v_me
       where pip_cycle_id = v_req.pip_cycle_id and agent_id = v_req.agent_id and status = 'suggested';
      if not found then raise exception 'This person is no longer a suggested candidate — someone else already changed their status.'; end if;
    else -- include
      if exists (select 1 from pip_candidates where pip_cycle_id = v_req.pip_cycle_id and agent_id = v_req.agent_id and status in ('suggested', 'approved')) then
        raise exception 'This person is already on the list.';
      end if;
      -- A previously-excluded row for this (cycle, agent) already exists (pip_candidates has a unique
      -- (pip_cycle_id, agent_id) key) — restore it rather than insert a duplicate.
      update pip_candidates set status = 'suggested', exclusion_reason = null, excluded_by = null
       where pip_cycle_id = v_req.pip_cycle_id and agent_id = v_req.agent_id and status = 'excluded';
      if not found then
        select * into v_agent from users where id = v_req.agent_id;
        insert into pip_candidates (pip_cycle_id, agent_id, team_name, site_name, vintage_weeks_at_selection, status)
        values (v_req.pip_cycle_id, v_req.agent_id, v_agent.team_name, v_agent.site_name,
                case when v_agent.joining_date is null then null else
                  (v_cycle.start_date - (
                     v_agent.joining_date + case when extract(dow from v_agent.joining_date)::int = 6 then 0
                                                 else (6 - extract(dow from v_agent.joining_date)::int + 7) % 7 end
                   )) / 7 end,
                'suggested');
      end if;
    end if;
  end if;

  update pip_manager_requests
     set status = case p_action when 'accept' then 'accepted' else 'rejected' end,
         decided_by = v_me, decided_at = now(), decision_note = v_note
   where id = p_request_id;
end $$;
revoke all on function pip_decide_request(uuid, text, text) from public;
grant execute on function pip_decide_request(uuid, text, text) to authenticated;

-- ── Publish: the list-level decision that replaces per-candidate approval ───────────────────────
create or replace function pip_publish_cycle(p_cycle_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := current_app_user_id();
  v_cycle pip_cycles%rowtype;
  v_n int;
begin
  if current_app_role() not in ('super_admin', 'qa_manager') then
    raise exception 'Only a Super Admin or QA Manager can publish a PIP cycle.';
  end if;
  select * into v_cycle from pip_cycles where id = p_cycle_id for update;
  if not found then raise exception 'That PIP cycle does not exist.'; end if;
  if v_cycle.published_at is not null then raise exception 'This cycle was already published.'; end if;
  if not exists (select 1 from pip_candidates where pip_cycle_id = p_cycle_id) then
    raise exception 'Generate suggestions before publishing.';
  end if;

  update pip_candidates set status = 'approved', approved_by = v_me
   where pip_cycle_id = p_cycle_id and status = 'suggested';
  get diagnostics v_n = row_count;

  -- The review window is closing: any request nobody acted on is closed out, not left pending forever.
  update pip_manager_requests set status = 'rejected', decided_by = v_me, decided_at = now(),
         decision_note = 'Cycle published without a decision on this request.'
   where pip_cycle_id = p_cycle_id and status = 'pending';

  update pip_cycles set published_at = now(), published_by = v_me where id = p_cycle_id;
  return v_n;
end $$;
revoke all on function pip_publish_cycle(uuid) from public;
grant execute on function pip_publish_cycle(uuid) to authenticated;

-- ── pip_decide(): 'approve' is REMOVED (publishing replaces it); 'exclude'/'restore' now also
-- refuse once the cycle is published (the review window is closed) ─────────────────────────────
create or replace function pip_decide(p_candidate_id uuid, p_action text, p_note text default null, p_downgrade boolean default false)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c pip_candidates%rowtype;
  v_cycle pip_cycles%rowtype;
  v_actor uuid := current_app_user_id();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if current_app_role() not in ('super_admin', 'qa_manager') then
    raise exception 'Only a Super Admin or QA Manager can change a PIP candidate.';
  end if;
  select * into v_c from pip_candidates where id = p_candidate_id for update;
  if not found then raise exception 'That PIP candidate does not exist.'; end if;
  select * into v_cycle from pip_cycles where id = v_c.pip_cycle_id;

  if p_action = 'exclude' then
    if v_cycle.published_at is not null then raise exception 'This cycle has already been published.'; end if;
    if v_c.status <> 'suggested' then raise exception 'Only a suggested candidate can be excluded (this one is %).', v_c.status; end if;
    if v_note is null then raise exception 'A reason is required to exclude a candidate.'; end if;
    update pip_candidates set status = 'excluded', exclusion_reason = v_note, excluded_by = v_actor where id = p_candidate_id;
  elsif p_action = 'restore' then
    if v_cycle.published_at is not null then raise exception 'This cycle has already been published.'; end if;
    if v_c.status <> 'excluded' then raise exception 'Only an excluded candidate can be restored (this one is %).', v_c.status; end if;
    update pip_candidates set status = 'suggested', exclusion_reason = null, excluded_by = null where id = p_candidate_id;
  elsif p_action = 'complete' then
    if v_c.status <> 'approved' then raise exception 'Only an approved PIP can be completed (this one is %).', v_c.status; end if;
    update pip_candidates set status = 'completed', decision_note = v_note where id = p_candidate_id;
  elsif p_action = 'fail' then
    if v_c.status <> 'approved' then raise exception 'Only an approved PIP can be marked failed (this one is %).', v_c.status; end if;
    update pip_candidates set status = 'failed', decision_note = v_note, incentive_downgraded = coalesce(p_downgrade, false) where id = p_candidate_id;
  else
    raise exception 'Unknown action "%" (use exclude, restore, complete or fail — approval is now done by publishing the whole cycle).', p_action;
  end if;
  return (select status from pip_candidates where id = p_candidate_id);
end $$;
revoke all on function pip_decide(uuid, text, text, boolean) from public;
grant execute on function pip_decide(uuid, text, text, boolean) to authenticated;
