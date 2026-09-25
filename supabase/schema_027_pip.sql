-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 027 — Agent Status Engine, part 3: PIP module (§6.4)
-- Test this in the Supabase SQL Editor before relying on it.
-- Requires 018 (revenue), 019 (currency), 022 (sales_week_start),
-- and 008/007 (team_agent_ids / manager_chain_ids). Apply after 026.
--
-- DATA MODEL + WORKFLOW ONLY. Nothing here sends any email or notification
-- — by design (PIP messages to real people need a human review first).
--
-- WHAT IT DOES
--   pip_policies    versioned parameters (superseded, never edited, §1)
--   pip_cycles      one per month; starts the 2nd Saturday, runs duration_weeks
--   pip_candidates  suggested -> excluded | approved -> completed | failed
--   pip_trainings   session tracking for an approved candidate
--   pip_tl_feedback append-only Team Lead notes about their own agent
--   generate_pip_candidates()  bottom-N-per-site suggestion (needs the
--                   policy's revenue window + unit to be SET first)
--   pip_decide()    the ONLY way a candidate changes state
--
-- !! OPEN BUSINESS QUESTIONS (docs/questions-2026-09-25.md) — the model is
-- !! built so none of these are hard-coded guesses:
-- !!  1. What period is "revenue" measured over, and in which unit?
-- !!     -> policy.revenue_window_weeks / revenue_unit, NULL until an admin
-- !!        sets them; suggestions REFUSE to run while they are NULL.
-- !!  2. Is revenue_benchmark a CEILING (only agents below it can be
-- !!     suggested)? Implemented that way; say if it means something else.
-- !!  3. Suggestions/exclusions are visible to QA Manager / Super Admin /
-- !!     QA Auditor ONLY. Team Leads, Managers and the agent see a candidate
-- !!     only once APPROVED (a conservative default for a sensitive list).
-- !!  4. Who approves: Super Admin and QA Manager (same as policy admin).
-- !!  5. incentive_downgraded can be set only when a PIP is marked failed.
-- ============================================================

-- ── Policy (versioned) ──────────────────────────────────────
create table pip_policies (
  id uuid primary key default gen_random_uuid(),
  revenue_benchmark numeric not null default 400,
  vintage_min_days int not null default 60,
  duration_weeks int not null default 3,
  target_revenue numeric not null default 300,
  bottom_n_per_site int not null default 10,
  -- Not in the original design and deliberately NOT defaulted — see question 1.
  revenue_window_weeks int,
  revenue_unit text,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_by uuid references users(id),
  constraint pip_policies_ranges check (
    revenue_benchmark > 0 and vintage_min_days >= 0 and duration_weeks between 1 and 12
    and target_revenue >= 0 and bottom_n_per_site between 1 and 100
  ),
  constraint pip_policies_window check (
    (revenue_window_weeks is null and revenue_unit is null)
    or (revenue_window_weeks is not null and revenue_window_weeks between 1 and 26
        and revenue_unit is not null and revenue_unit in ('BDT', 'USD'))   -- explicit NOT NULLs: a NULL check result would PASS
  ),
  constraint pip_policies_period check (effective_to is null or effective_to >= effective_from)
);
create unique index uq_pip_policies_open on pip_policies ((true)) where effective_to is null;

-- The design's recorded defaults (CLAUDE.md §6.4): 400 / 60 days / 3 weeks / 300 / 10.
insert into pip_policies (revenue_benchmark, vintage_min_days, duration_weeks, target_revenue, bottom_n_per_site)
values (400, 60, 3, 300, 10);

-- ── Cycles ──────────────────────────────────────────────────
create table pip_cycles (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references pip_policies(id),
  month date not null unique,               -- first day of the month
  start_date date not null,                 -- the 2nd Saturday of the month
  end_date date not null,                   -- start + duration_weeks * 7 - 1 (a Friday)
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  constraint pip_cycles_month_first check (extract(day from month) = 1),
  constraint pip_cycles_starts_saturday check (extract(dow from start_date) = 6),
  constraint pip_cycles_span check (end_date > start_date)
);

-- ── Candidates ──────────────────────────────────────────────
create table pip_candidates (
  id uuid primary key default gen_random_uuid(),
  pip_cycle_id uuid not null references pip_cycles(id),
  agent_id uuid not null references users(id),
  site_name text,                           -- the agent's site when selected
  revenue_at_selection numeric,             -- in revenue_unit_used
  revenue_unit_used text check (revenue_unit_used in ('BDT', 'USD')),
  revenue_window_start date,
  revenue_window_end date,
  vintage_days_at_selection int,
  status text not null check (status in ('suggested', 'excluded', 'approved', 'completed', 'failed')),
  exclusion_reason text,
  excluded_by uuid references users(id),
  approved_by uuid references users(id),
  decision_note text,                       -- optional note on complete / fail
  incentive_downgraded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pip_cycle_id, agent_id),
  constraint pip_candidates_excluded_has_reason check (
    status <> 'excluded' or (length(btrim(coalesce(exclusion_reason, ''))) > 0 and excluded_by is not null)
  ),
  constraint pip_candidates_active_has_approver check (
    status not in ('approved', 'completed', 'failed') or approved_by is not null
  ),
  constraint pip_candidates_downgrade_only_failed check (not incentive_downgraded or status = 'failed')
);
create index idx_pip_candidates_agent on pip_candidates(agent_id);

-- ── Trainings ───────────────────────────────────────────────
create table pip_trainings (
  id uuid primary key default gen_random_uuid(),
  pip_candidate_id uuid not null references pip_candidates(id),
  session_number int not null check (session_number >= 1),   -- 1 = pre-PIP, 2, 3, ...
  scheduled_at timestamptz,
  conducted_by uuid references users(id),
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  attended boolean,
  notes text check (notes is null or length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pip_candidate_id, session_number),
  constraint pip_trainings_attended_when_completed check ((status = 'completed') = (attended is not null))
);

-- ── Team Lead feedback (append-only) ────────────────────────
create table pip_tl_feedback (
  id uuid primary key default gen_random_uuid(),
  pip_candidate_id uuid not null references pip_candidates(id),
  team_leader_id uuid not null references users(id),
  feedback text not null,
  created_at timestamptz not null default now(),
  constraint pip_tl_feedback_text check (length(btrim(feedback)) > 0 and length(feedback) <= 2000)
);
create index idx_pip_tl_feedback_candidate on pip_tl_feedback(pip_candidate_id);

create trigger trg_pip_candidates_touch before update on pip_candidates for each row execute function touch_updated_at();
create trigger trg_pip_trainings_touch before update on pip_trainings for each row execute function touch_updated_at();

-- A training can only be booked against an APPROVED candidate. (SECURITY DEFINER so the status
-- check sees the candidate whoever is inserting; the row-level policies then decide WHO may insert.)
create or replace function pip_trainings_require_approved()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  select status into v_status from pip_candidates where id = new.pip_candidate_id;
  if v_status is distinct from 'approved' then
    raise exception 'Training sessions can only be added while the PIP is approved and running (this one is %).', coalesce(v_status, 'missing');
  end if;
  return new;
end $$;
create trigger trg_pip_trainings_approved before insert on pip_trainings
  for each row execute function pip_trainings_require_approved();

-- ── Row-level security ──────────────────────────────────────
alter table pip_policies enable row level security;
alter table pip_cycles enable row level security;
alter table pip_candidates enable row level security;
alter table pip_trainings enable row level security;
alter table pip_tl_feedback enable row level security;

-- Policy + cycles: QA staff only. NO write policies for anyone: every change
-- goes through the SECURITY DEFINER functions below (which check the role).
create policy pip_policies_select_qa on pip_policies for select to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager', 'qa_auditor'));
create policy pip_cycles_select_qa on pip_cycles for select to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager', 'qa_auditor'));

-- A Team Lead / Manager / agent can read the CYCLE (dates only) of a PIP they can already see —
-- the candidate policies below decide which; without this they would see a PIP with no dates.
create policy pip_cycles_select_via_candidates on pip_cycles for select to authenticated
  using (current_app_role() in ('team_lead', 'manager', 'agent')
         and id in (select pip_cycle_id from pip_candidates));

-- Candidates: QA staff see everything (suggested / excluded included).
create policy pip_candidates_select_qa on pip_candidates for select to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager', 'qa_auditor'));
-- Team Lead / Manager / the agent: only an APPROVED-or-later PIP of someone in their scope.
create policy pip_candidates_select_team_lead on pip_candidates for select to authenticated
  using (current_app_role() = 'team_lead' and status in ('approved', 'completed', 'failed')
         and agent_id in (select a from team_agent_ids() as a));
create policy pip_candidates_select_manager on pip_candidates for select to authenticated
  using (current_app_role() = 'manager' and status in ('approved', 'completed', 'failed')
         and agent_id in (select a from manager_chain_ids() as a));
create policy pip_candidates_select_self on pip_candidates for select to authenticated
  using (agent_id = current_app_user_id() and status in ('approved', 'completed', 'failed'));

-- Trainings: visible wherever the candidate is visible (the sub-select applies the candidate policies).
create policy pip_trainings_select on pip_trainings for select to authenticated
  using (pip_candidate_id in (select id from pip_candidates));
-- QA staff manage them; an auditor only their own sessions.
create policy pip_trainings_insert_qa on pip_trainings for insert to authenticated
  with check (
    current_app_role() in ('super_admin', 'qa_manager')
    or (current_app_role() = 'qa_auditor' and conducted_by = current_app_user_id())
  );
create policy pip_trainings_update_qa on pip_trainings for update to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager')
         or (current_app_role() = 'qa_auditor' and conducted_by = current_app_user_id()))
  with check (current_app_role() in ('super_admin', 'qa_manager')
         or (current_app_role() = 'qa_auditor' and conducted_by = current_app_user_id()));

-- Feedback: QA staff read all; a Team Lead reads their team's; a Manager their chain; the agent NONE.
create policy pip_tl_feedback_select_qa on pip_tl_feedback for select to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager', 'qa_auditor'));
create policy pip_tl_feedback_select_scope on pip_tl_feedback for select to authenticated
  using (current_app_role() in ('team_lead', 'manager') and pip_candidate_id in (select id from pip_candidates));
-- A Team Lead writes ONLY as themself, about an approved-or-later PIP of their own agent. No update / delete, ever.
create policy pip_tl_feedback_insert_team_lead on pip_tl_feedback for insert to authenticated
  with check (
    current_app_role() = 'team_lead'
    and team_leader_id = current_app_user_id()
    and pip_candidate_id in (select id from pip_candidates)   -- already limited to their team's approved+ PIPs
  );

-- ── Change the policy (supersede, never edit) ───────────────
create or replace function set_pip_policy(
  p_revenue_benchmark numeric, p_vintage_min_days int, p_duration_weeks int,
  p_target_revenue numeric, p_bottom_n_per_site int,
  p_revenue_window_weeks int default null, p_revenue_unit text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if current_app_role() not in ('super_admin', 'qa_manager') then
    raise exception 'Only a Super Admin or QA Manager can change the PIP policy.';
  end if;
  update pip_policies set effective_to = now() where effective_to is null;
  insert into pip_policies (revenue_benchmark, vintage_min_days, duration_weeks, target_revenue, bottom_n_per_site,
                            revenue_window_weeks, revenue_unit, created_by)
  values (p_revenue_benchmark, p_vintage_min_days, p_duration_weeks, p_target_revenue, p_bottom_n_per_site,
          p_revenue_window_weeks, nullif(btrim(p_revenue_unit), ''), current_app_user_id())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function set_pip_policy(numeric, int, int, numeric, int, int, text) from public;
grant execute on function set_pip_policy(numeric, int, int, numeric, int, int, text) to authenticated;

-- ── Create a monthly cycle ──────────────────────────────────
-- Starts on the 2nd Saturday of the month (design §6.4), runs duration_weeks
-- (whole sales weeks, Saturday-Friday) under the policy in force NOW.
create or replace function create_pip_cycle(p_month date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first date := date_trunc('month', p_month)::date;
  v_first_sat date;
  v_start date;
  v_policy pip_policies%rowtype;
  v_id uuid;
begin
  if current_app_role() not in ('super_admin', 'qa_manager') then
    raise exception 'Only a Super Admin or QA Manager can create a PIP cycle.';
  end if;
  select * into v_policy from pip_policies where effective_to is null;
  if not found then raise exception 'There is no current PIP policy.'; end if;
  if exists (select 1 from pip_cycles where month = v_first) then
    raise exception 'A PIP cycle already exists for %.', to_char(v_first, 'FMMonth YYYY');
  end if;

  v_first_sat := v_first + ((6 - extract(dow from v_first)::int + 7) % 7);
  v_start := v_first_sat + 7;   -- the 2nd Saturday

  insert into pip_cycles (policy_id, month, start_date, end_date, created_by)
  values (v_policy.id, v_first, v_start, v_start + v_policy.duration_weeks * 7 - 1, current_app_user_id())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function create_pip_cycle(date) from public;
grant execute on function create_pip_cycle(date) to authenticated;

-- ── Suggest candidates ──────────────────────────────────────
-- Bottom N per site by revenue, among agents who are: an active agent, certified
-- (employment_stage active), on the job at least vintage_min_days on the cycle's
-- start date, BELOW the revenue benchmark, and not already in a PIP that is
-- still running. Revenue = sum over the policy's window of COMPLETED sales
-- weeks ending the Friday before the cycle starts, in the policy's unit (USD
-- converts each sale at the rate in force WHEN THAT SALE HAPPENED, §8).
--
-- Refuses when the policy has no revenue window / unit (question 1), when
-- the cycle already has candidates, and unless the caller acknowledges that
-- revenue is only counted where a sale is matched to an agent — while most
-- sales are unmatched, an agent's revenue here can be far lower than real.
-- Runs as its definer because it must read every agent's revenue.
create or replace function generate_pip_candidates(p_cycle_id uuid, p_acknowledge_partial_revenue boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle pip_cycles%rowtype;
  v_policy pip_policies%rowtype;
  v_w_start date;
  v_w_end date;
  v_from timestamptz;
  v_to timestamptz;
  v_events bigint;
  v_attributed bigint;
  v_share numeric;
  v_inserted int;
begin
  if current_app_role() not in ('super_admin', 'qa_manager') then
    raise exception 'Only a Super Admin or QA Manager can generate PIP suggestions.';
  end if;
  select * into v_cycle from pip_cycles where id = p_cycle_id;
  if not found then raise exception 'That PIP cycle does not exist.'; end if;
  select * into v_policy from pip_policies where id = v_cycle.policy_id;

  if v_policy.revenue_window_weeks is null or v_policy.revenue_unit is null then
    raise exception 'Set the revenue window (weeks) and unit (BDT or USD) on the PIP policy before suggesting candidates — they decide who looks "lowest", so they are not guessed.';
  end if;
  if exists (select 1 from pip_candidates where pip_cycle_id = p_cycle_id) then
    raise exception 'Suggestions were already generated for this cycle.';
  end if;

  v_w_end := v_cycle.start_date - 1;                                   -- the Friday before the cycle
  v_w_start := v_cycle.start_date - 7 * v_policy.revenue_window_weeks;  -- a Saturday
  v_from := (v_w_start::timestamp) at time zone 'Asia/Dhaka';
  v_to := ((v_w_end + 1)::timestamp) at time zone 'Asia/Dhaka';

  select count(*), count(*) filter (where agent_id is not null) into v_events, v_attributed
    from agent_revenue_transactions where purchase_created_at >= v_from and purchase_created_at < v_to;
  v_share := case when v_events = 0 then 0 else round(100.0 * v_attributed / v_events, 1) end;
  if not coalesce(p_acknowledge_partial_revenue, false) then
    raise exception 'Only % %% of the % sales in this window are matched to an agent; the rest count for nobody, so agents can look lower than they really are. Confirm you understand this to continue.', v_share, v_events;
  end if;

  with revenue as (
    select a.id as agent_id, a.site_name, a.joining_date,
           coalesce(sum(case v_policy.revenue_unit
                          when 'USD' then t.revenue_amount / currency_rate_at(t.purchase_created_at)
                          else t.revenue_amount end), 0) as rev
      from users a
      left join agent_revenue_transactions t
        on t.agent_id = a.id and t.purchase_created_at >= v_from and t.purchase_created_at < v_to
     where a.role = 'agent' and a.is_active and a.employment_stage = 'active'
       and a.joining_date is not null
       and (v_cycle.start_date - a.joining_date) >= v_policy.vintage_min_days
       -- not already inside a PIP that is still running when this one starts
       and not exists (
         select 1 from pip_candidates pc join pip_cycles c on c.id = pc.pip_cycle_id
          where pc.agent_id = a.id and pc.status = 'approved' and c.end_date >= v_cycle.start_date)
     group by a.id, a.site_name, a.joining_date
  ),
  ranked as (
    select r.*, row_number() over (partition by coalesce(r.site_name, '(no site)') order by r.rev asc, r.agent_id) as rn
      from revenue r
     where r.rev < v_policy.revenue_benchmark
  ),
  ins as (
    insert into pip_candidates (pip_cycle_id, agent_id, site_name, revenue_at_selection, revenue_unit_used,
                                revenue_window_start, revenue_window_end, vintage_days_at_selection, status)
    select p_cycle_id, agent_id, site_name, round(rev, 2), v_policy.revenue_unit, v_w_start, v_w_end,
           (v_cycle.start_date - joining_date), 'suggested'
      from ranked where rn <= v_policy.bottom_n_per_site
    returning 1
  )
  select count(*) into v_inserted from ins;

  return jsonb_build_object('inserted', v_inserted, 'attributed_share_pct', v_share, 'sales_in_window', v_events,
                            'window_start', v_w_start, 'window_end', v_w_end);
end $$;
revoke all on function generate_pip_candidates(uuid, boolean) from public;
grant execute on function generate_pip_candidates(uuid, boolean) to authenticated;

-- ── The workflow: the only way a candidate changes state ────────
--   suggested -> excluded  (a reason is required)   excluded -> suggested (restore)
--   suggested -> approved                            approved -> completed | failed
-- completed / failed are final. Only Super Admin / QA Manager.
create or replace function pip_decide(p_candidate_id uuid, p_action text, p_note text default null, p_downgrade boolean default false)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c pip_candidates%rowtype;
  v_actor uuid := current_app_user_id();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if current_app_role() not in ('super_admin', 'qa_manager') then
    raise exception 'Only a Super Admin or QA Manager can change a PIP candidate.';
  end if;
  select * into v_c from pip_candidates where id = p_candidate_id for update;
  if not found then raise exception 'That PIP candidate does not exist.'; end if;

  if p_action = 'exclude' then
    if v_c.status <> 'suggested' then raise exception 'Only a suggested candidate can be excluded (this one is %).', v_c.status; end if;
    if v_note is null then raise exception 'A reason is required to exclude a candidate.'; end if;
    update pip_candidates set status = 'excluded', exclusion_reason = v_note, excluded_by = v_actor where id = p_candidate_id;
  elsif p_action = 'restore' then
    if v_c.status <> 'excluded' then raise exception 'Only an excluded candidate can be restored (this one is %).', v_c.status; end if;
    update pip_candidates set status = 'suggested', exclusion_reason = null, excluded_by = null where id = p_candidate_id;
  elsif p_action = 'approve' then
    if v_c.status <> 'suggested' then raise exception 'Only a suggested candidate can be approved (this one is %).', v_c.status; end if;
    update pip_candidates set status = 'approved', approved_by = v_actor where id = p_candidate_id;
  elsif p_action = 'complete' then
    if v_c.status <> 'approved' then raise exception 'Only an approved PIP can be completed (this one is %).', v_c.status; end if;
    update pip_candidates set status = 'completed', decision_note = v_note where id = p_candidate_id;
  elsif p_action = 'fail' then
    if v_c.status <> 'approved' then raise exception 'Only an approved PIP can be marked failed (this one is %).', v_c.status; end if;
    update pip_candidates set status = 'failed', decision_note = v_note, incentive_downgraded = coalesce(p_downgrade, false) where id = p_candidate_id;
  else
    raise exception 'Unknown action "%" (use exclude, restore, approve, complete or fail).', p_action;
  end if;
  return (select status from pip_candidates where id = p_candidate_id);
end $$;
revoke all on function pip_decide(uuid, text, text, boolean) from public;
grant execute on function pip_decide(uuid, text, text, boolean) to authenticated;

-- ── For the sampling / priority engine (§9.3, Step 6) ────────
-- "Approved PIP candidates automatically feed the sampling engine": this view
-- is that feed — agents in an approved PIP whose cycle covers today (Dhaka).
create or replace view active_pip_agents
with (security_invoker = true) as
  select pc.agent_id, pc.id as pip_candidate_id, c.start_date, c.end_date
    from pip_candidates pc
    join pip_cycles c on c.id = pc.pip_cycle_id
   where pc.status = 'approved'
     and ((now() at time zone 'Asia/Dhaka')::date) between c.start_date and c.end_date;
grant select on active_pip_agents to authenticated;
