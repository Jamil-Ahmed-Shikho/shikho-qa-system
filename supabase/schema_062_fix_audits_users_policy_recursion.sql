-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 062 — fixes a real "infinite recursion detected in policy for
-- relation audits" bug introduced by schema_061, caught in testing before
-- schema_061 was ever relied on live.
--
-- schema_061's new audits_insert_own policy added two bare (non-security-
-- definer) subqueries against `users` to compare the caller's own
-- team_name with the target agent's. That's a plain subquery, so it runs
-- under `users`' own RLS — and schema_059 (applied earlier the same
-- session) had just added users_select_auditor_for_agent, a `users`
-- SELECT policy that itself queries `audits`. Two independently-reasonable
-- changes, each fine alone, created a genuine cross-table policy cycle:
-- audits policy -> bare subquery on users -> users' own RLS -> references
-- audits -> back into audits' policy. §14's recursion lesson, just one
-- table removed from its original single-table form.
--
-- Fixed the same way §14 already prescribes for a self-referencing helper:
-- wrap the users lookup in a SECURITY DEFINER function (bypasses users'
-- own RLS, the same reason current_app_role()/current_app_user_id() never
-- recurse), rather than a bare subquery.
-- ============================================================

create or replace function user_team_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$ select team_name from users where id = p_user_id $$;
revoke all on function user_team_name(uuid) from public;
grant execute on function user_team_name(uuid) to authenticated;

drop policy if exists audits_insert_own on audits;
create policy audits_insert_own on audits for insert
to authenticated
with check (
  auditor_id = current_app_user_id()
  and (
    current_app_role() = any (array['super_admin', 'qa_manager'])
    or (
      current_app_role() = 'qa_auditor'
      and (
        user_team_name(current_app_user_id()) is null
        or user_team_name(current_app_user_id()) = user_team_name(agent_id)
      )
    )
    or (current_app_role() = 'team_lead' and agent_id in (select t.t from team_agent_ids() t(t)))
  )
);
