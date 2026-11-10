-- ============================================================
-- Contact Stage on audits (Jamil, 2026-11-10) — "what contact stage's call
-- audited what percentage." Historical source files (the main 25,672-row
-- sheet and the Oct gap-fill sheet) already carry a "Contact Stage" column
-- that was simply never imported (confirmed — see
-- scripts/backfill-contact-stage.mjs). Going forward, startAudit() captures
-- it live from the CRM at audit-creation time (the call's own lead_stage_id,
-- i.e. the stage AT THE TIME OF THE CALL, resolved to a name).
--
-- Nullable, plain text (not an FK to any stage table — the CRM's stage list
-- is looked up live via getLeadStages(), not mirrored here, same as how
-- call_status/call_destination are stored as plain text elsewhere on this
-- table). Never recomputed/rewritten once set — same "never destroy" shape
-- as every other historical field on this table.
-- ============================================================

alter table audits add column if not exists contact_stage text;

comment on column audits.contact_stage is
  'The lead''s contact stage AT THE TIME OF THE CALL (frozen) — from the historical sheet''s "Contact Stage" column, or captured live via the CRM''s lead_stage_id at audit creation. Null = unknown (not yet backfilled, or the CRM call failed).';
