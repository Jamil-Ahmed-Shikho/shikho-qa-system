-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 006 — User management
-- Test this in the Supabase SQL Editor before relying on it.
--
-- Accounts created by an admin (single or Excel bulk import) get an
-- emailed temporary password. This flag forces the user to set their
-- own password on first login (enforced in middleware) so an emailed
-- password never stays valid.
--
-- Existing users (e.g. your own super_admin row) default to false —
-- they are NOT forced to change anything.
-- ============================================================

alter table users add column must_change_password boolean not null default false;
