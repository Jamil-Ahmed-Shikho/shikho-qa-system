-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 034 — Sampling + Priority Engine, Part 1: weekly audit targets, revenue targets, the agent queue (§9)
-- Test this in the Supabase SQL Editor before relying on it. Apply after 033.
--
-- WHAT THIS ADDS
--   * audit_target_rules / revenue_target_rules — admin-configurable, per vintage slab (or OJT) and per team
--     (or all teams). NO numbers are seeded except OJT = 3 audits/week (§7); every other target is set by an admin.
--   * agent_weekly_audit_target (§9) — each agent's target for one sales week, base + bonus, computed by
--     compute_weekly_audit_targets() and FROZEN once the week is over.
--   * qa_agent_queue() — everything the QA dashboard's queue shows, in one call (see the note on why it is a function).
--
-- TARGET CHANGES NEVER TOUCH THE PAST (Jamil, 2026-09-27)
--   Rules are append-only and effective-dated by SALES WEEK (Saturday). A change is made effective from THIS week
--   (the week in progress — only its own, not-yet-final numbers change) or from NEXT week; it can never be dated
--   earlier. A week's target is looked up as of that week's Saturday, and compute_weekly_audit_targets() only ever
--   writes the CURRENT week, so a closed week's snapshot is never recalculated whatever the rules say later.
--
-- WHAT IS NOT HERE (still to come): holiday adjustment (§9.4), RE-TRAINING agents' one-call window (§7 — they live
-- in ojt_status_history, Step 8), the sampling_queue checklist.
-- Nothing here sends any email or notification.
-- ============================================================

-- ── Vintage label as of a sales week, with a fallback ────────
-- vintage_slab_for() uses the slab set in force ON that date, so for a date before the FIRST set was recorded it
-- answers null (the seed's effective_from is the day it was applied). A target must still resolve then, so: when
-- there is no answer and the agent had joined by that date, use the earliest set on record.
create or replace function vintage_label_for_week(p_stage text, p_joining date, p_week date)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    vintage_slab_for(p_stage, p_joining, p_week),
    case when p_stage in ('ojt', 're_training') or p_joining is null or p_joining > p_week then null
    else (
      select s.label from vintage_slabs s
       where s.min_days is not null
         and s.min_days <= (p_week - p_joining)
         and (s.max_days is null or (p_week - p_joining) <= s.max_days)
         and s.effective_from = (select min(effective_from) from vintage_slabs)
       order by s.min_days desc limit 1)
    end)
$$;
revoke all on function vintage_label_for_week(text, date, date) from public;
grant execute on function vintage_label_for_week(text, date, date) to authenticated, service_role;

-- ── Rules ───────────────────────────────────────────────────
create table audit_target_rules (
  id uuid primary key default gen_random_uuid(),
  stage text check (stage in ('ojt', 're_training')),   -- set for OJT agents; else vintage_label is set
  vintage_label text,                                   -- a slab label ('1st Month' ...), NOT the slab row id: slab sets are superseded as a whole
  team_name text,                                       -- null = all teams
  weekly_audit_target int not null check (weekly_audit_target between 0 and 100),
  effective_from date not null check (extract(dow from effective_from) = 6),   -- a Saturday
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  constraint audit_target_rules_key check ((stage is not null and vintage_label is null) or (stage is null and vintage_label is not null))
);
create unique index uq_audit_target_rules on audit_target_rules (coalesce(stage, ''), coalesce(vintage_label, ''), coalesce(team_name, ''), effective_from);

create table revenue_target_rules (
  id uuid primary key default gen_random_uuid(),
  stage text check (stage in ('ojt', 're_training')),
  vintage_label text,
  team_name text,
  weekly_revenue_target_usd numeric not null check (weekly_revenue_target_usd >= 0),   -- US dollars per sales week
  effective_from date not null check (extract(dow from effective_from) = 6),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  constraint revenue_target_rules_key check ((stage is not null and vintage_label is null) or (stage is null and vintage_label is not null))
);
create unique index uq_revenue_target_rules on revenue_target_rules (coalesce(stage, ''), coalesce(vintage_label, ''), coalesce(team_name, ''), effective_from);

alter table audit_target_rules enable row level security;
alter table revenue_target_rules enable row level security;
create policy audit_target_rules_select on audit_target_rules for select to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager', 'qa_auditor'));
create policy revenue_target_rules_select on revenue_target_rules for select to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager', 'qa_auditor'));
-- no insert/update/delete policies: written only by set_audit_target_rule / set_revenue_target_rule.

-- The only seeded number: OJT agents owe 3 audits a week (§7), all teams, from the start of the week this migration lands.
insert into audit_target_rules (stage, team_name, weekly_audit_target, effective_from)
values ('ojt', null, 3, (((now() at time zone 'Asia/Dhaka')::date) - (((extract(dow from ((now() at time zone 'Asia/Dhaka')::date))::int) + 1) % 7)));

-- ── Lookups (as of a sales week; a team-specific rule beats an all-teams one; the newest in force wins) ──
create or replace function audit_target_for(p_ojt boolean, p_label text, p_team text, p_week date)
returns int
language sql
stable
set search_path = public
as $$
  select r.weekly_audit_target
    from audit_target_rules r
   where r.effective_from <= p_week
     and ((p_ojt and r.stage = 'ojt') or (not p_ojt and r.vintage_label = p_label))
     and (r.team_name = p_team or r.team_name is null)
   order by (r.team_name is not null) desc, r.effective_from desc
   limit 1
$$;

create or replace function revenue_target_for(p_ojt boolean, p_label text, p_team text, p_week date)
returns numeric
language sql
stable
set search_path = public
as $$
  select r.weekly_revenue_target_usd
    from revenue_target_rules r
   where r.effective_from <= p_week
     and ((p_ojt and r.stage = 'ojt') or (not p_ojt and r.vintage_label = p_label))
     and (r.team_name = p_team or r.team_name is null)
   order by (r.team_name is not null) desc, r.effective_from desc
   limit 1
$$;
revoke all on function audit_target_for(boolean, text, text, date), revenue_target_for(boolean, text, text, date) from public;
grant execute on function audit_target_for(boolean, text, text, date), revenue_target_for(boolean, text, text, date) to authenticated, service_role;

-- ── Setting a rule (admins only; append-only; never earlier than the current week) ──
create or replace function _validate_target_key(p_ojt boolean, p_label text, p_team text)
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if p_team is not null and p_team not in ('Telesales', 'CX Non-Voice', 'CX Inbound', 'Engagement', 'Retention', 'TS3P', 'BPO') then
    raise exception 'Unknown team "%".', p_team;
  end if;
  if not p_ojt then
    if p_label is null or not exists (select 1 from vintage_slabs where label = p_label and effective_to is null and min_days is not null) then
      raise exception 'Unknown vintage slab "%".', coalesce(p_label, '');
    end if;
  end if;
end;
$$;

create or replace function _target_effective_week(p_from text)
returns date
language plpgsql
stable
set search_path = public
as $$
declare
  v_cur date := sales_week_start((now() at time zone 'Asia/Dhaka')::date);
begin
  if p_from = 'current' then return v_cur; end if;
  if p_from = 'next' then return v_cur + 7; end if;
  raise exception 'Choose whether the change starts this week or next week.';
end;
$$;

-- p_ojt = true: the OJT rule; otherwise p_label is a vintage slab. p_team null = all teams.
create or replace function set_audit_target_rule(p_ojt boolean, p_label text, p_team text, p_value int, p_from text)
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := current_app_user_id();
  v_from date;
  v_stage text := case when p_ojt then 'ojt' end;
  v_label text := case when p_ojt then null else p_label end;
begin
  if current_app_role() not in ('super_admin', 'qa_manager') then
    raise exception 'Only a Super Admin or QA Manager can change audit targets.';
  end if;
  if p_value is null or p_value < 0 or p_value > 100 then raise exception 'The target must be between 0 and 100 audits a week.'; end if;
  perform _validate_target_key(p_ojt, v_label, p_team);
  v_from := _target_effective_week(p_from);

  -- The same rule for the same starting week is corrected in place (it has not applied to a finished week);
  -- a different starting week appends a new version. History is never rewritten.
  update audit_target_rules
     set weekly_audit_target = p_value, created_by = v_me, created_at = now()
   where stage is not distinct from v_stage and vintage_label is not distinct from v_label
     and team_name is not distinct from p_team and effective_from = v_from;
  if not found then
    insert into audit_target_rules (stage, vintage_label, team_name, weekly_audit_target, effective_from, created_by)
    values (v_stage, v_label, p_team, p_value, v_from, v_me);
  end if;
  return v_from;
end;
$$;

create or replace function set_revenue_target_rule(p_ojt boolean, p_label text, p_team text, p_value numeric, p_from text)
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := current_app_user_id();
  v_from date;
  v_stage text := case when p_ojt then 'ojt' end;
  v_label text := case when p_ojt then null else p_label end;
begin
  if current_app_role() not in ('super_admin', 'qa_manager') then
    raise exception 'Only a Super Admin or QA Manager can change revenue targets.';
  end if;
  if p_value is null or p_value < 0 then raise exception 'The target must be zero or more dollars a week.'; end if;
  perform _validate_target_key(p_ojt, v_label, p_team);
  v_from := _target_effective_week(p_from);

  update revenue_target_rules
     set weekly_revenue_target_usd = p_value, created_by = v_me, created_at = now()
   where stage is not distinct from v_stage and vintage_label is not distinct from v_label
     and team_name is not distinct from p_team and effective_from = v_from;
  if not found then
    insert into revenue_target_rules (stage, vintage_label, team_name, weekly_revenue_target_usd, effective_from, created_by)
    values (v_stage, v_label, p_team, p_value, v_from, v_me);
  end if;
  return v_from;
end;
$$;
revoke all on function _validate_target_key(boolean, text, text), _target_effective_week(text) from public;
revoke all on function set_audit_target_rule(boolean, text, text, int, text), set_revenue_target_rule(boolean, text, text, numeric, text) from public;
grant execute on function set_audit_target_rule(boolean, text, text, int, text), set_revenue_target_rule(boolean, text, text, numeric, text) to authenticated;

-- ── The weekly snapshot (§9) ────────────────────────────────
create table agent_weekly_audit_target (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references users(id),
  week_start date not null check (extract(dow from week_start) = 6),   -- sales week, Saturday
  base_target int not null,                                            -- from the vintage / team / OJT rule in force that week
  bonus_applied boolean not null default false,                        -- red / pip / zero-seller (any combination -> the same +1)
  bonus_reasons text[] not null default '{}',
  holiday_adjusted boolean not null default false,                     -- reserved: holiday adjustment (§9.4) is a later stage
  target_frozen boolean not null default false,                        -- true once the agent is discontinued mid-week (§9.5)
  adjustment_reason text,
  final_target int not null,
  computed_at timestamptz not null default now(),
  unique (agent_id, week_start)
);
create index idx_agent_weekly_audit_target_week on agent_weekly_audit_target (week_start);

alter table agent_weekly_audit_target enable row level security;
create policy agent_weekly_audit_target_select_qa on agent_weekly_audit_target for select to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager', 'qa_auditor'));
create policy agent_weekly_audit_target_select_team_lead on agent_weekly_audit_target for select to authenticated
  using (current_app_role() = 'team_lead' and agent_id in (select t from team_agent_ids() as t));
create policy agent_weekly_audit_target_select_manager on agent_weekly_audit_target for select to authenticated
  using (current_app_role() = 'manager' and agent_id in (select c from manager_chain_ids() as c));

-- Computes THIS sales week's targets (service role / SQL editor / the daily job only). Idempotent. Only the current week
-- is ever written: a finished week keeps exactly what it had. Agents with no rule for their slab/team get no row
-- (the dashboard says "target not set" — nothing is invented).
create or replace function compute_weekly_audit_targets(p_as_of timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week date := sales_week_start((p_as_of at time zone 'Asia/Dhaka')::date);
  v_start timestamptz := (v_week::timestamp at time zone 'Asia/Dhaka');
  v_end timestamptz := ((v_week + 7)::timestamp at time zone 'Asia/Dhaka');
  v_written int;
  v_frozen int;
  v_norule int;
begin
  with elig as (
    select a.id, a.team_name, (a.employment_stage = 'ojt') as is_ojt,
           vintage_label_for_week(a.employment_stage, a.joining_date, v_week) as label
      from users a
     where a.role = 'agent' and a.is_active and a.employment_stage in ('ojt', 'active')
  ), base as (
    select e.id, audit_target_for(e.is_ojt, e.label, e.team_name, v_week) as base_target from elig e
  ), flagged as (
    select b.id, b.base_target,
           array_remove(array[
             case when exists (select 1 from agent_current_status s where s.agent_id = b.id and s.status = 'red') then 'red' end,
             case when exists (
                    select 1 from pip_candidates pc join pip_cycles c on c.id = pc.pip_cycle_id
                     where pc.agent_id = b.id and pc.status = 'approved' and c.start_date <= v_week + 6 and c.end_date >= v_week) then 'pip' end,
             case when exists (select 1 from agent_zero_seller_status z where z.agent_id = b.id and z.current_streak_weeks > 0) then 'zero_seller' end
           ], null) as reasons
      from base b where b.base_target is not null
  ), up as (
    insert into agent_weekly_audit_target (agent_id, week_start, base_target, bonus_applied, bonus_reasons, final_target)
    select f.id, v_week, f.base_target, cardinality(f.reasons) > 0, f.reasons,
           f.base_target + case when cardinality(f.reasons) > 0 then 1 else 0 end
      from flagged f
    on conflict (agent_id, week_start) do update
       set base_target = excluded.base_target, bonus_applied = excluded.bonus_applied, bonus_reasons = excluded.bonus_reasons,
           final_target = excluded.final_target, computed_at = now()
     where agent_weekly_audit_target.target_frozen = false
    returning 1
  )
  select count(*) into v_written from up;

  select count(*) into v_norule from users a
   where a.role = 'agent' and a.is_active and a.employment_stage in ('ojt', 'active')
     and audit_target_for(a.employment_stage = 'ojt', vintage_label_for_week(a.employment_stage, a.joining_date, v_week), a.team_name, v_week) is null;

  -- §9.5: an agent discontinued mid-week owes nothing more this week — the target freezes at what was already done.
  with fz as (
    update agent_weekly_audit_target w
       set final_target = (select count(*) from audits au where au.agent_id = w.agent_id and au.status <> 'draft'
                             and au.submitted_at >= v_start and au.submitted_at < v_end),
           target_frozen = true, adjustment_reason = 'agent_discontinued', computed_at = now()
      from users u
     where u.id = w.agent_id and u.employment_stage = 'discontinued'
       and w.week_start = v_week and w.target_frozen = false
    returning 1
  )
  select count(*) into v_frozen from fz;

  return jsonb_build_object('week_start', v_week, 'written', v_written, 'frozen', v_frozen, 'agents_without_a_rule', v_norule);
end;
$$;
revoke all on function compute_weekly_audit_targets(timestamptz) from public;
grant execute on function compute_weekly_audit_targets(timestamptz) to service_role;

-- ── The queue (one call) ────────────────────────────────────
-- WHY A FUNCTION: the dashboard needs, per agent, facts that different tables scope differently — a QA Auditor can read
-- audits and revenue for everyone, but only briefings THEY conduct. The queue needs the agent's last coaching by anyone.
-- So this is a narrow SECURITY DEFINER window for QA roles only (zero rows for everyone else), scoped to the caller's
-- own assigned agents ('mine' = users.quality_auditor_id) or everyone ('team' = Team View, §2's standing principle).
-- It returns FACTS; the priority ORDER (§9.3) is applied in src/lib/queue/priority.ts, where it is unit-tested.
create or replace function qa_agent_queue(p_view text default 'mine')
returns table (
  agent_id uuid, name text, email text, team_name text, site_name text, employment_stage text, vintage_label text,
  has_target boolean, base_target int, bonus_applied boolean, bonus_reasons text[], final_target int, target_frozen boolean,
  done_this_week int,
  last_audited_at timestamptz, last_coached_at timestamptz,
  last_week_usd numeric, this_week_usd numeric, last_week_computed boolean, last_week_revenue_target_usd numeric,
  ryg text, critical_recent boolean, on_pip boolean, zero_streak int
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_me uuid := current_app_user_id();
  v_role text := current_app_role();
  v_week date := sales_week_start((now() at time zone 'Asia/Dhaka')::date);
  v_last date := v_week - 7;
  v_start timestamptz := (v_week::timestamp at time zone 'Asia/Dhaka');
  v_end timestamptz := ((v_week + 7)::timestamp at time zone 'Asia/Dhaka');
  v_lstart timestamptz := ((v_week - 7)::timestamp at time zone 'Asia/Dhaka');
  v_has_rate boolean := exists (select 1 from currency_conversion_rates);
begin
  if v_role not in ('super_admin', 'qa_manager', 'qa_auditor') then return; end if;
  if p_view not in ('mine', 'team') then raise exception 'Choose My view or Team view.'; end if;

  return query
  select u.id, u.name, u.email, u.team_name, u.site_name, u.employment_stage,
         vintage_label_for_week(u.employment_stage, u.joining_date, (now() at time zone 'Asia/Dhaka')::date),
         (w.id is not null), w.base_target, coalesce(w.bonus_applied, false), coalesce(w.bonus_reasons, '{}'::text[]), w.final_target,
         coalesce(w.target_frozen, false),
         (select count(*)::int from audits au where au.agent_id = u.id and au.status <> 'draft' and au.submitted_at >= v_start and au.submitted_at < v_end),
         (select max(au.submitted_at) from audits au where au.agent_id = u.id and au.status <> 'draft'),
         (select max(b.scheduled_at) from briefings b where b.agent_id = u.id and b.status = 'completed'),
         case when v_has_rate then (select coalesce(sum(t.revenue_amount / currency_rate_at(t.purchase_created_at)), 0)
                                      from agent_revenue_transactions t where t.agent_id = u.id and t.purchase_created_at >= v_lstart and t.purchase_created_at < v_start) end,
         case when v_has_rate then (select coalesce(sum(t.revenue_amount / currency_rate_at(t.purchase_created_at)), 0)
                                      from agent_revenue_transactions t where t.agent_id = u.id and t.purchase_created_at >= v_start) end,
         exists (select 1 from agent_weekly_sales s where s.agent_id = u.id and s.week_start = v_last),
         revenue_target_for(u.employment_stage = 'ojt', vintage_label_for_week(u.employment_stage, u.joining_date, v_last), u.team_name, v_last),
         (select s.status from agent_current_status s where s.agent_id = u.id),
         coalesce((select s.critical_fatal_count > 0 from agent_current_status s where s.agent_id = u.id), false),
         exists (select 1 from pip_candidates pc join pip_cycles c on c.id = pc.pip_cycle_id
                  where pc.agent_id = u.id and pc.status = 'approved' and c.start_date <= v_week + 6 and c.end_date >= v_week),
         coalesce((select z.current_streak_weeks from agent_zero_seller_status z where z.agent_id = u.id), 0)
    from users u
    left join agent_weekly_audit_target w on w.agent_id = u.id and w.week_start = v_week
   where u.role = 'agent' and u.is_active and u.employment_stage in ('ojt', 'active')
     and (p_view = 'team' or u.quality_auditor_id = v_me)
   order by u.name;
end;
$$;
revoke all on function qa_agent_queue(text) from public;
grant execute on function qa_agent_queue(text) to authenticated;
