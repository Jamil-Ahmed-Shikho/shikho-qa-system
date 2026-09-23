-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 002 — Fix infinite RLS recursion on users
--
-- Bug: current_app_user_id() / current_app_role() queried `users`
-- as plain (non security definer) functions. Since RLS was still
-- enforced inside them, and the users_select_self policy calls
-- them, every self-select on users recursed into itself and
-- Postgres raised "infinite recursion detected in policy for
-- relation users" — which the app then misreported as an
-- inactive account.
--
-- Fix: make the helper functions SECURITY DEFINER with a locked
-- search_path, so their internal lookup bypasses RLS instead of
-- re-triggering it. Test this in the Supabase SQL Editor.
-- ============================================================

create or replace function current_app_user_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select id from users where auth_id = auth.uid()
$$;

create or replace function current_app_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from users where auth_id = auth.uid()
$$;

-- These functions now run with the privileges of their owner
-- (bypassing RLS internally) — restrict who can call them to
-- logged-in app users, not the public/anon role.
revoke all on function current_app_user_id() from public;
revoke all on function current_app_role() from public;
grant execute on function current_app_user_id() to authenticated;
grant execute on function current_app_role() to authenticated;
