-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 064 — In-app notifications. Apply after 063.
--
-- Scoped exactly to Jamil's own list (2026-10-02) plus one addition flagged
-- and confirmed ("build that scoped version"): audit submitted -> agent;
-- Red/critical-fatal -> Manager + every QA Manager; calibration scheduled
-- -> each invited participant (except the scheduler); a Review Request
-- landing on someone's desk -> whoever now holds it (Team Lead / assignee /
-- every QA Manager if unassigned). A general "notify anyone about anything"
-- framework was deliberately NOT built — five triggers, nothing generic.
--
-- Coaching-session reminders ("before schedule") are NOT a stored row or a
-- new cron job — Vercel Hobby's 2-job cap is already fully spent (revenue
-- sync, briefing digest; CLAUDE.md §14), so a third timed job isn't
-- available. Computed instead, at read time, from `briefings` directly
-- (src/lib/notifications/notifications.service.ts) — a virtual
-- notification for any session starting within the next 2 hours, shown to
-- both the agent and the conductor. It needs no schema here.
-- ============================================================

create table notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references users(id),
  type text not null check (type in (
    'audit_submitted', 'audit_red_fatal', 'calibration_scheduled', 'review_request_landed'
  )),
  title text not null,
  body text not null,
  link text,                   -- an in-app relative path, e.g. '/my-audits/{id}'; null if nothing to open
  related_table text,
  related_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_notifications_recipient on notifications (recipient_id, created_at desc);

alter table notifications enable row level security;
create policy notifications_select_own on notifications for select to authenticated
  using (recipient_id = current_app_user_id());
-- Only read_at is ever changed by the app (mark read / mark all read) — the WITH CHECK still
-- requires recipient_id to stay the caller's own, so a row can never be reassigned to someone else.
create policy notifications_update_own on notifications for update to authenticated
  using (recipient_id = current_app_user_id())
  with check (recipient_id = current_app_user_id());
-- No insert/delete policy for anyone — written only by the service role from the specific
-- trigger points (submitScorecard, calibration create, review-request file/escalate/assign),
-- same "service role is the only writer" shape as write_audit_results()'s scorecard tables.
