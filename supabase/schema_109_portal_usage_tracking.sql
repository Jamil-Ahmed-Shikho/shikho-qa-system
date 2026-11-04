-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 109 — Portal usage tracking (Jamil, 2026-11-04). Apply after 108.
-- Test in the Supabase SQL Editor before relying on it.
--
-- DELIBERATELY NOT per-page-view logging — Jamil's own explicit constraint was "will not consume
-- much Vercel usage of CPU or other things", and this project already has one documented Vercel-
-- overage episode this session (call-recording streaming). One row per (user, CALENDAR DAY) is the
-- design: "was this person active at all today", never "what did they click". The middleware-side
-- write (src/middleware.ts) is further gated by a cookie so it only actually reaches the database
-- ONCE PER PERSON PER DAY, not once per page view — every other request that day costs nothing.
--
-- auth.users.last_sign_in_at was considered and rejected as the primary signal: Supabase refreshes
-- a session silently without a fresh "sign in" event, so someone using the portal daily on a
-- long-lived session would show a stale last-sign-in date — the day-activity table built here is
-- both cheaper (no auth-schema access needed) and more accurate.
--
-- CONFIRMED by Jamil (two short questions, 2026-11-04):
--   - Visibility: every back-office role (QA Auditor, Team Lead, Manager, QA Manager, Super Admin)
--     always sees their OWN row; Manager also sees their own chain's TEAM LEADS (not other QA staff,
--     not other Managers); Admin/QA Manager see everyone. Team Lead and QA Auditor see only
--     themselves in the Back Office report (they don't supervise other back-office staff) — plus
--     their own team/assigned-agents in the Frontline report, same shape as every other report.
--   - "Inactive" = 14+ days since last use (or never used at all, shown as its own status, 'never' —
--     a cleaner signal than lumping "stopped 20 days ago" together with "has never once logged in").
-- ============================================================

create table if not exists user_activity_days (
  user_id uuid not null references users(id),
  activity_date date not null,            -- Dhaka calendar date
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, activity_date)
);
create index if not exists idx_user_activity_days_user_date on user_activity_days(user_id, activity_date desc);

alter table user_activity_days enable row level security;
-- No insert/update/delete policy for anyone — written only by record_user_activity() below, same
-- "the function is the only writer" shape as audit_result_views (schema_092). No per-row select
-- policy either: a report role's own My View/Team View scoping varies (QA Auditor especially) in a
-- way static RLS can't express cleanly, so reads go only through portal_usage_report() below, which
-- does its own role check — same convention as campaign_report()/qa_rubric_fail_trends().

-- The only writer — called from middleware once per person per day (cookie-gated there, §middleware
-- comment). Idempotent (on conflict), so a retried/duplicate call just bumps last_seen_at.
create or replace function record_user_activity()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := current_app_user_id();
  v_today date := (now() at time zone 'Asia/Dhaka')::date;
begin
  if v_me is null then return; end if;
  insert into user_activity_days (user_id, activity_date, first_seen_at, last_seen_at)
  values (v_me, v_today, now(), now())
  on conflict (user_id, activity_date) do update set last_seen_at = now();
end $$;
revoke all on function record_user_activity() from public;
grant execute on function record_user_activity() to authenticated;

-- ── The report — one function covers both "Back Office" and "Frontline", every role's scoping ────
create or replace function portal_usage_report(p_scope text, p_view text default 'team')
returns table (
  user_id uuid,
  name text,
  role text,
  team_name text,
  site_name text,
  team_leader_name text,       -- frontline rows only: whose team this agent is on
  quality_auditor_name text,   -- frontline rows only: who audits this agent
  last_active_date date,
  days_since_active int,       -- null when last_active_date is null (never active)
  active_days_7 int,
  active_days_30 int,
  status text                  -- 'active' | 'low_usage' | 'inactive' | 'never'
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_role text := current_app_role();
  v_me uuid := current_app_user_id();
  v_today date := (now() at time zone 'Asia/Dhaka')::date;
  v_scoped_ids uuid[];
begin
  if p_scope not in ('back_office', 'frontline') then raise exception 'Choose back_office or frontline.'; end if;
  if p_view not in ('mine', 'team') then raise exception 'Choose My view or Team view.'; end if;
  if v_role is null or v_role = 'agent' then return; end if;

  if v_role in ('super_admin', 'qa_manager') then
    v_scoped_ids := null;  -- unrestricted
  elsif v_role = 'manager' then
    -- manager_chain_ids() returns this manager's Team Leads AND their agents (schema_007) — used
    -- for BOTH scopes here: intersected with the back_office role filter below it naturally yields
    -- just the chain's Team Leads, intersected with the frontline role filter it yields just the
    -- chain's agents. Always append self so the Manager's own row shows in Back Office.
    select array_agg(a) into v_scoped_ids from manager_chain_ids() as a;
    v_scoped_ids := array_append(coalesce(v_scoped_ids, '{}'::uuid[]), v_me);
  elsif v_role = 'team_lead' then
    if p_scope = 'back_office' then
      v_scoped_ids := array[v_me];  -- just themselves — a Team Lead supervises agents, not other staff
    else
      select array_agg(a) into v_scoped_ids from team_agent_ids() as a;
    end if;
  elsif v_role = 'qa_auditor' then
    if p_scope = 'back_office' then
      v_scoped_ids := array[v_me];  -- just themselves — same reasoning as Team Lead
    elsif p_view = 'mine' then
      -- Qualified: this function's own OUT parameter "role" would otherwise collide with a bare
      -- reference to users.role (§14's own documented lesson about RETURNS TABLE column names).
      select array_agg(u.id) into v_scoped_ids from users u where u.quality_auditor_id = v_me and u.role = 'agent';
    else
      v_scoped_ids := null;  -- Team View: unrestricted, matching the standing My View/Team View rule (§2)
    end if;
  else
    v_scoped_ids := array[v_me];
  end if;

  return query
  with base as (
    select u.id, u.name, u.role, u.team_name, u.site_name, u.team_leader_id, u.quality_auditor_id
      from users u
     where u.is_active
       and (
         (p_scope = 'back_office' and u.role in ('super_admin', 'qa_manager', 'manager', 'team_lead', 'qa_auditor'))
         or (p_scope = 'frontline' and u.role = 'agent')
       )
       and (v_scoped_ids is null or u.id = any(v_scoped_ids))
  ),
  agg as (
    select d.user_id,
           max(d.activity_date) as last_active,
           count(*) filter (where d.activity_date >= v_today - 6) as days7,
           count(*) filter (where d.activity_date >= v_today - 29) as days30
      from user_activity_days d
     where d.user_id in (select id from base)
     group by d.user_id
  )
  select
    b.id, b.name, b.role, b.team_name, b.site_name,
    tl.name, qa.name,
    agg.last_active,
    case when agg.last_active is null then null else (v_today - agg.last_active) end,
    coalesce(agg.days7, 0)::int, coalesce(agg.days30, 0)::int,
    case
      when agg.last_active is null then 'never'
      when agg.last_active >= v_today - 2 then 'active'
      when agg.last_active >= v_today - 13 then 'low_usage'
      else 'inactive'
    end
    from base b
    left join agg on agg.user_id = b.id
    left join users tl on tl.id = b.team_leader_id
    left join users qa on qa.id = b.quality_auditor_id
   order by b.name;
end $$;
revoke all on function portal_usage_report(text, text) from public;
grant execute on function portal_usage_report(text, text) to authenticated;
