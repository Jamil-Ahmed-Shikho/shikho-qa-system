-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 018 — Live CRM revenue data (replaces the Google Sheet plan, §8)
-- Test this in the Supabase SQL Editor before relying on it.
-- Requires schema_017 already applied.
--
-- `agent_revenue_transactions` was only ever a design-doc stub (§8) — this
-- migration is the first time the table actually exists, so this is a
-- clean build, not an ALTER of live data (confirmed empty/nonexistent
-- before writing this).
--
-- Source: the CRM's /events list, filtered to type:shikho_purchase_completed
-- (confirmed working, read-only, against the live CRM — see the chat for the
-- investigation). The LIST response carries full custom_field data
-- (including cf_amount) — confirmed byte-identical to the /events/{id}
-- detail response — so nothing here ever needs a per-event detail fetch.
--
-- Agent attribution: an event's lead_owner_id (the counselor credited for
-- the sale — NOT created_by, which is a system identity, "Shikho App", on
-- every event) resolves through the EXISTING agent-matching pipeline
-- unchanged: getCrmUser(lead_owner_id) -> email -> users.email, caching
-- users.crm_agent_id, exactly as src/lib/audits/agent-matching.ts already
-- does for calls. No new matching logic.
--
-- Ownership can be corrected by the CRM within roughly 4-5 days of a sale
-- (disputed/validated claims) — lead_owner_id is NOT treated as permanent
-- the moment it's first fetched. The daily sync (Part C, not built yet)
-- re-checks the trailing ~10 days by comparing crm_updated_at, and
-- overwrites agent_id/revenue_amount/etc. wholesale when it has changed.
-- ============================================================

-- ── the transactions themselves ─────────────────────────────
create table agent_revenue_transactions (
  id uuid primary key default gen_random_uuid(),

  -- The CRM's own event id — the natural, permanent dedupe key. A sale is
  -- exactly one event; re-syncing the same event always upserts the same row.
  crm_event_id bigint not null,

  -- Resolved via the agent-matching pipeline (may be null: no CRM email, no
  -- matching users.email, or a lead_owner that isn't one of our counselors —
  -- the row is still kept, with the raw CRM id below, so the revenue total
  -- isn't silently dropped and a later re-match doesn't need a fresh CRM call).
  agent_id uuid references users(id),
  -- The RAW CRM lead_owner_id, kept independent of whether it currently
  -- resolves to one of our users. Needed because ownership can change: on a
  -- re-sync, comparing this against the CRM's current lead_owner_id is what
  -- reveals "the owner actually changed" (distinct from "we finally matched
  -- them"), and lets a later admin fix (or CRM email change) re-resolve
  -- agent_id without another CRM round trip.
  lead_owner_crm_id integer not null,

  -- cf_amount from the event's custom_field array — confirmed present and
  -- populated in the LIST response (chat investigation; see header).
  -- NOT cf_discounted_amount (a separate field the CRM also has) — confirmed.
  revenue_amount numeric not null,
  course_name text,                                    -- cf_course_name

  -- The lead this sale is against, for a future drill-down from a revenue
  -- row back to its CRM lead — same naming as audits.crm_lead_id (§4),
  -- though the CRM's own field here is lead_prospect_id (a UUID), not the
  -- numeric lead id §10's call flow uses. Kept as text like the other CRM
  -- reference fields on `audits`.
  crm_lead_prospect_id text,

  purchase_created_at timestamptz not null,             -- the event's created_at: when the sale happened
  crm_updated_at timestamptz not null,                   -- the event's updated_at: change detection (ownership corrections etc.)
  last_synced_at timestamptz not null default now(),     -- when WE last wrote/confirmed this row

  -- 'gsheet' is kept only so the design doc's original provenance idea
  -- isn't lost — nothing writes it; §13's Google Sheet import stays
  -- explicitly deferred/superseded by this.
  source text not null default 'crm_api' check (source in ('crm_api', 'gsheet')),

  created_at timestamptz not null default now(),

  constraint agent_revenue_transactions_amount_ok check (revenue_amount >= 0)
);

create unique index uq_agent_revenue_transactions_crm_event on agent_revenue_transactions(crm_event_id);
-- Weekly/monthly/PIP rollups (§6.3, §6.4) all filter "this agent, this
-- period" — the composite index matches that access pattern directly.
create index idx_agent_revenue_transactions_agent_period on agent_revenue_transactions(agent_id, purchase_created_at);
create index idx_agent_revenue_transactions_period on agent_revenue_transactions(purchase_created_at);
-- Cheap "needs review" filter for an eventual admin screen — an unmatched
-- lead_owner is the revenue equivalent of §10's "CRM says: name · email — …"
-- unmatched-call note.
create index idx_agent_revenue_transactions_unmatched on agent_revenue_transactions(lead_owner_crm_id) where agent_id is null;

alter table agent_revenue_transactions enable row level security;

-- Read access mirrors who already sees revenue-adjacent data elsewhere:
-- QA staff, Team Lead (own team — scoped in the app query, not here, since
-- RLS has no team_agent_ids()-shaped join target on this table's own
-- columns without a users join; enforce it via a policy using EXISTS
-- against team_agent_ids(), same pattern as everywhere else), Manager (own
-- chain), and any signed-in agent their own rows.
create policy agent_revenue_transactions_select_qa on agent_revenue_transactions
  for select to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager', 'qa_auditor'));

create policy agent_revenue_transactions_select_team_lead on agent_revenue_transactions
  for select to authenticated
  using (
    current_app_role() = 'team_lead'
    and agent_id in (select t from team_agent_ids() as t)
  );

create policy agent_revenue_transactions_select_manager on agent_revenue_transactions
  for select to authenticated
  using (
    current_app_role() = 'manager'
    and agent_id in (select c from manager_chain_ids() as c)
  );

create policy agent_revenue_transactions_select_self on agent_revenue_transactions
  for select to authenticated
  using (agent_id = current_app_user_id());

-- No write policies for any signed-in role: written only by the daily sync
-- / backfill script, both using the service role, same as write_audit_results()
-- and the CRM org-sync writes (§10) — never a normal user session.

-- ── sync/backfill progress — durable, inspectable in the SQL editor ─
-- One row per job. The backfill (Part B) and the daily sync (Part C) are
-- deliberately separate rows/cursors even though they read the same CRM
-- data, because they page in OPPOSITE directions for a reason (see the
-- backfill script's own header once it exists): the backfill pages
-- ascending so a new sale during a long-running backfill can never shift
-- already-fetched pages, making a page number a safe resume point; the
-- daily sync pages descending (newest first) so it can stop early once it
-- reaches already-seen events.
create table revenue_sync_state (
  id text primary key check (id in ('backfill', 'daily')),
  cursor_page int,                    -- backfill: last successfully completed page (ascending)
  watermark timestamptz,              -- daily: newest event's created_at seen as of the last successful run
  events_synced bigint not null default 0,
  last_run_at timestamptz,
  last_run_status text check (last_run_status in ('ok', 'error', 'partial')),
  last_run_note text,                 -- a short summary, or an error message
  updated_at timestamptz not null default now()
);

create trigger trg_revenue_sync_state_touch before update on revenue_sync_state
  for each row execute function touch_updated_at();

alter table revenue_sync_state enable row level security;

create policy revenue_sync_state_select on revenue_sync_state
  for select to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager'));

-- No write policy: written only by the backfill script and the daily sync
-- cron, both using the service role.
