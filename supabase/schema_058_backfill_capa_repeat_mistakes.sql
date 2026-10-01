-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 058 — One-time backfill of capa_repeat_mistakes for audits that
-- never went through write_audit_results() (§4 Part 2a, schema_049)
-- Apply after schema_057.
--
-- Why this exists: the automatic 3-of-5 repeat-mistake tracker (schema_049,
-- 2026-09-30) only ever writes to capa_repeat_mistakes from inside
-- write_audit_results() — the live scoring funnel. The 25,672-row historical
-- Telesales import (2026-10-01) correctly bypassed that function entirely
-- (its live-submission validation doesn't fit a bulk backfill), so it left
-- capa_repeat_mistakes with no idea those audits ever happened. This was
-- flagged as a known gap when both features shipped (CLAUDE.md §4 Part 2a
-- and the historical-import section) — this migration is that backfill.
--
-- backfill_capa_repeat_mistakes() REBUILDS THE WHOLE TABLE FROM SCRATCH
-- (delete, then replay) rather than only inserting for historical rows,
-- because capa_repeat_mistakes is a derived/computed table, not a source of
-- truth — audit_parameter_results is the source of truth, this table is
-- just a cache of what a 3-of-5 scan over it would find. The safe way to
-- backfill is to replay EVERY submitted audit (historical and the handful
-- already live-submitted since schema_049) in the exact order they were
-- actually submitted, applying the identical per-parameter logic
-- write_audit_results() already uses — so the end state is exactly what it
-- would be had every audit, historical or not, gone through that function.
-- (Confirmed safe to truncate-and-replay: capa_repeat_mistakes held 0 rows
-- at the time this was written — no live audit has crossed the 3-of-5
-- threshold yet since schema_049 landed — but the function is written to be
-- correct and idempotent even if that's no longer true by the time it runs.)
--
-- Per CLAUDE.md's own "Claude-made call, not explicitly specified" note on
-- schema_049: a revised (superseded) audit's ORIGINAL vs REVISED parameter
-- results aren't special-cased — audits are replayed in plain submitted_at
-- order, matching live behaviour exactly, not re-litigated here.
-- ============================================================

create or replace function backfill_capa_repeat_mistakes()
returns table (agents_flagged int, pairs_flagged int, audits_replayed int)
language plpgsql
set search_path = public
as $$
declare
  v_audit record;
  v_param_id uuid;
  v_this_passed boolean;
  v_fail_window int;
  v_count int;
begin
  delete from capa_repeat_mistakes;
  v_count := 0;

  for v_audit in
    select a.id as audit_id, a.agent_id, a.rubric_id, a.submitted_at
    from audits a
    where a.status = 'submitted'
    order by a.submitted_at asc, a.id asc
  loop
    v_count := v_count + 1;

    for v_param_id, v_this_passed in
      select parameter_id, passed from audit_parameter_results where audit_id = v_audit.audit_id
    loop
      if exists (
        select 1 from capa_repeat_mistakes where agent_id = v_audit.agent_id and parameter_id = v_param_id
      ) then
        update capa_repeat_mistakes
           set fail_count = fail_count + (case when v_this_passed then 0 else 1 end),
               status = case when v_this_passed then 'improved' else 'still_failing' end,
               last_checked_audit_id = v_audit.audit_id,
               last_checked_at = v_audit.submitted_at,
               updated_at = v_audit.submitted_at
         where agent_id = v_audit.agent_id and parameter_id = v_param_id;
      else
        select count(*) into v_fail_window
        from (
          select apr.passed
          from audits a2
          join audit_parameter_results apr on apr.audit_id = a2.id and apr.parameter_id = v_param_id
          where a2.agent_id = v_audit.agent_id and a2.rubric_id = v_audit.rubric_id and a2.status = 'submitted'
            and (a2.submitted_at, a2.id) <= (v_audit.submitted_at, v_audit.audit_id)
          order by a2.submitted_at desc, a2.id desc
          limit 5
        ) recent
        where not recent.passed;

        if v_fail_window >= 3 then
          insert into capa_repeat_mistakes
            (agent_id, parameter_id, fail_count, status, first_flagged_audit_id, first_flagged_at,
             last_checked_audit_id, last_checked_at, updated_at)
          values
            (v_audit.agent_id, v_param_id, v_fail_window, 'not_yet_rechecked', v_audit.audit_id, v_audit.submitted_at,
             null, null, v_audit.submitted_at);
        end if;
      end if;
    end loop;
  end loop;

  return query
    select count(distinct agent_id)::int, count(*)::int, v_count
    from capa_repeat_mistakes;
end;
$$;

-- A one-time DBA tool, not an app-facing function — nobody signed in should
-- ever call this (it rewrites a whole table). Run once via the migration
-- runner / SQL editor, then leave it defined as a record of what was done
-- (same "don't delete the historical-import script either" convention).
revoke all on function backfill_capa_repeat_mistakes() from public;
