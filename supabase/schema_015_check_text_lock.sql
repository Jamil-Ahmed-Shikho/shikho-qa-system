-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 015 — Special Checks: freeze a check's TEXT once it has been answered
-- Test this in the Supabase SQL Editor before relying on it.
-- Requires schema_014 already applied.
--
-- schema_014 froze an OPTION's text once a submitted audit used it. The same
-- reasoning applies to the check itself: changing "Mentioned the new course
-- launch?" into a different question would silently change what every past
-- answer to it meant. So a check's NAME is now frozen, by the same rule:
--
--   - once at least one SUBMITTED audit has answered the check, its name can't
--     change — archive it and add a new check instead;
--   - drafts don't count (a draft isn't a record yet);
--   - everything else about it stays editable: reordering, archiving and
--     un-archiving, and its optional note to the auditor.
--
-- SECURITY DEFINER so the check always sees every audit, whoever is editing.
-- Nothing is rewritten: this only adds a trigger, and no existing row changes.
-- ============================================================

create or replace function campaign_check_type_text_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name is distinct from old.name and exists (
    select 1 from audit_campaign_answers a
    join audits au on au.id = a.audit_id
    where a.check_type_id = old.id and au.status <> 'draft'
  ) then
    raise exception 'This check has been answered in a submitted audit, so its text can''t be changed. Archive it and add a new check instead.';
  end if;
  return new;
end;
$$;
revoke all on function campaign_check_type_text_lock() from public;

create trigger trg_campaign_check_types_lock
  before update of name on campaign_check_types
  for each row execute function campaign_check_type_text_lock();
