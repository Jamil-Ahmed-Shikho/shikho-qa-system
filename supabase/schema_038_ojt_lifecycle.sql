-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 038 — OJT & Re-Training Lifecycle (§7, Step 8). Test in the Supabase SQL Editor before relying on it.
-- Requires schema_008 (team_agent_ids), schema_007 (manager_chain_ids). Apply any time after those.
--
-- An OJT candidate's `users` row already exists at ID-creation time (§2, built earlier — the ordinary
-- Add-user / bulk-import form already sets `employment_stage='ojt'`, `ojt_start_date`, `trainer_id`, and full
-- QA/TL/Manager/Site tagging, with `joining_date` null). This migration adds the STATE MACHINE on top:
--
--   ojt ─────────────┬──────────────────────┬───────────────────┐
--                     ▼                      ▼                   ▼
--                 re_training  ──┬────► certified (active)   not_certified
--                     │          │
--                     └──────────┴────► discontinued
--
-- Every transition is logged (never edited or deleted) via `ojt_transition()` — the ONLY way `employment_stage`
-- moves for someone currently in `ojt`/`re_training`, and the only writer of `ojt_status_history`. This is a
-- CLAUDE-MADE CALL, flagged for correction if wrong: only Super Admin / QA Manager may call it (nobody asked
-- for a `trainer_id` person specifically to certify their own trainee — `trainer_id` stays informational, same
-- shape as an agent's `manager_id`, §2); `re_training` is reachable only from `ojt` (not a second consecutive
-- extension); `certified`/`not_certified`/`discontinued` are reachable from either `ojt` or `re_training`; a
-- reason is REQUIRED for `not_certified`/`discontinued` (mirrors PIP's required exclusion reason) and optional
-- for `re_training`/certifying. The ORDINARY Users edit form can still set `employment_stage` directly (unchanged,
-- not locked down by this migration) — going through this module instead is a discipline, not yet an enforced
-- rule; flag if `employment_stage` should be locked against direct edits once someone is in ojt/re_training.
-- ============================================================

create table ojt_status_history (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references users(id),
  from_stage text not null check (from_stage in ('ojt', 're_training')),
  to_stage text not null check (to_stage in ('re_training', 'active', 'not_certified', 'discontinued')),
  re_training_start_date date,
  re_training_end_date date,   -- start + 2 days (a 3-day span, inclusive)
  note text check (note is null or (length(btrim(note)) > 0 and length(note) <= 1000)),
  changed_by uuid not null references users(id),
  changed_at timestamptz not null default now(),
  constraint ojt_status_history_retrain_dates check (
    (to_stage = 're_training') = (re_training_start_date is not null and re_training_end_date is not null)
  ),
  constraint ojt_status_history_retrain_span check (
    re_training_end_date is null or re_training_end_date = re_training_start_date + 2
  ),
  constraint ojt_status_history_reason_required check (
    to_stage not in ('not_certified', 'discontinued') or note is not null
  )
);
create index idx_ojt_status_history_agent on ojt_status_history(agent_id, changed_at desc);

alter table ojt_status_history enable row level security;

-- Read: QA (all), a Team Lead their own team's candidates, a Manager their own chain's — same shape as
-- everywhere else in this system (§2). No insert/update/delete policy for anyone: written only by the
-- function below (never edited, never deleted — same "never destroy" pattern as Campaigns/Briefings).
create policy ojt_status_history_select_qa on ojt_status_history
  for select to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager', 'qa_auditor'));
create policy ojt_status_history_select_team_lead on ojt_status_history
  for select to authenticated
  using (current_app_role() = 'team_lead' and agent_id in (select a from team_agent_ids() as a));
create policy ojt_status_history_select_manager on ojt_status_history
  for select to authenticated
  using (current_app_role() = 'manager' and agent_id in (select a from manager_chain_ids() as a));

-- ── The transition ───────────────────────────────────────────
create or replace function ojt_transition(
  p_agent_id uuid,
  p_to_stage text,                 -- 're_training' | 'active' | 'not_certified' | 'discontinued'
  p_note text default null,
  p_joining_date date default null,    -- REQUIRED when p_to_stage = 'active' (certifying)
  p_retrain_start date default null    -- only consulted when p_to_stage = 're_training'; defaults to today (Dhaka)
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := current_app_role();
  v_me uuid := current_app_user_id();
  u users%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_start date;
  v_end date;
begin
  if v_role not in ('super_admin', 'qa_manager') then
    raise exception 'Only a Super Admin or QA Manager can change an OJT candidate''s stage.';
  end if;
  if p_to_stage not in ('re_training', 'active', 'not_certified', 'discontinued') then
    raise exception 'Choose a valid stage to move to.';
  end if;
  if p_to_stage in ('not_certified', 'discontinued') and v_note is null then
    raise exception 'A reason is required.';
  end if;

  select * into u from users where id = p_agent_id for update;
  if not found or u.role <> 'agent' then raise exception 'No such agent.'; end if;
  if u.employment_stage not in ('ojt', 're_training') then
    raise exception '% is not currently in OJT or re-training (stage: %).', u.name, u.employment_stage;
  end if;
  if p_to_stage = 're_training' and u.employment_stage <> 'ojt' then
    raise exception 'Only an OJT candidate can be moved into re-training — % is already in re-training.', u.name;
  end if;

  if p_to_stage = 'active' then
    if p_joining_date is null then raise exception 'A joining date is required to certify.'; end if;
    if p_joining_date > (now() at time zone 'Asia/Dhaka')::date then raise exception 'The joining date cannot be in the future.'; end if;
    update users set employment_stage = 'active', joining_date = p_joining_date where id = p_agent_id;
  elsif p_to_stage = 're_training' then
    v_start := coalesce(p_retrain_start, (now() at time zone 'Asia/Dhaka')::date);
    v_end := v_start + 2;
    update users set employment_stage = 're_training' where id = p_agent_id;
  else
    update users set employment_stage = p_to_stage where id = p_agent_id;
  end if;

  insert into ojt_status_history (agent_id, from_stage, to_stage, re_training_start_date, re_training_end_date, note, changed_by)
  values (p_agent_id, u.employment_stage, p_to_stage, v_start, v_end, v_note, v_me);
end;
$$;
revoke all on function ojt_transition(uuid, text, text, date, date) from public;
grant execute on function ojt_transition(uuid, text, text, date, date) to authenticated;

-- ── One-call read: everyone currently in OJT/re-training, with the facts the management view needs ──
-- SECURITY DEFINER, same pattern as qa_agent_queue() (schema_034): a QA Auditor sees audits for anyone, but
-- this needs each candidate's current-week OJT audit count and re-training window progress in one shot; kept
-- to QA roles + Team Lead + Manager (own scope), zero rows for anyone else, never an error.
create or replace function ojt_candidates()
returns table (
  agent_id uuid, name text, email text, team_name text, site_name text,
  team_leader_name text, trainer_name text, employment_stage text,
  ojt_start_date date, days_in_stage int,
  re_training_start_date date, re_training_end_date date, re_training_days_left int,
  ojt_calls_this_week int, ojt_target int,
  re_training_call_done boolean
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_role text := current_app_role();
  v_me uuid := current_app_user_id();
  v_week date := sales_week_start((now() at time zone 'Asia/Dhaka')::date);
  v_wk_start timestamptz := (v_week::timestamp at time zone 'Asia/Dhaka');
  v_wk_end timestamptz := ((v_week + 7)::timestamp at time zone 'Asia/Dhaka');
  v_today date := (now() at time zone 'Asia/Dhaka')::date;
begin
  if v_role not in ('super_admin', 'qa_manager', 'qa_auditor', 'team_lead', 'manager') then return; end if;

  return query
  select u.id, u.name, u.email, u.team_name, u.site_name,
         tl.name, tr.name, u.employment_stage,
         u.ojt_start_date,
         (v_today - coalesce(
            case when u.employment_stage = 're_training' then h.re_training_start_date end,
            u.ojt_start_date, u.created_at::date))::int,
         h.re_training_start_date, h.re_training_end_date,
         case when u.employment_stage = 're_training' and h.re_training_end_date is not null
              then greatest(0, (h.re_training_end_date - v_today))::int end,
         (select count(*)::int from audits a where a.agent_id = u.id and a.status <> 'draft'
           and a.submitted_at >= v_wk_start and a.submitted_at < v_wk_end),
         audit_target_for(true, null, u.team_name, v_week),
         case when u.employment_stage = 're_training' and h.re_training_start_date is not null then exists (
                select 1 from audits a where a.agent_id = u.id and a.status <> 'draft'
                 and a.submitted_at >= (h.re_training_start_date::timestamp at time zone 'Asia/Dhaka')
                 and a.submitted_at < ((h.re_training_end_date + 1)::timestamp at time zone 'Asia/Dhaka')
              ) end
    from users u
    left join users tl on tl.id = u.team_leader_id
    left join users tr on tr.id = u.trainer_id
    left join lateral (
      select h2.re_training_start_date, h2.re_training_end_date
        from ojt_status_history h2
       where h2.agent_id = u.id and h2.to_stage = 're_training'
       order by h2.changed_at desc limit 1
    ) h on true
   where u.role = 'agent' and u.is_active and u.employment_stage in ('ojt', 're_training')
     and (
       v_role in ('super_admin', 'qa_manager', 'qa_auditor')
       or (v_role = 'team_lead' and u.team_leader_id = v_me)
       or (v_role = 'manager' and u.id in (select a from manager_chain_ids() as a))
     )
   order by u.employment_stage, u.name;
end;
$$;
revoke all on function ojt_candidates() from public;
grant execute on function ojt_candidates() to authenticated;

-- Recent transitions (for the OJT Management view's history panel) — same scope as the table's own RLS,
-- just joined to names. Ordinary RLS already limits the underlying rows; this only adds display names.
create or replace view ojt_status_history_view
with (security_invoker = true) as
  select h.id, h.agent_id, u.name as agent_name, h.from_stage, h.to_stage,
         h.re_training_start_date, h.re_training_end_date, h.note,
         h.changed_by, c.name as changed_by_name, h.changed_at
    from ojt_status_history h
    join users u on u.id = h.agent_id
    left join users c on c.id = h.changed_by;
grant select on ojt_status_history_view to authenticated;
