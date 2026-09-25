-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 025 — Agent Status Engine, part 1: Vintage slabs (§6.1)
-- Test this in the Supabase SQL Editor before relying on it.
-- Independent of the other status-engine schemas (026 RYG, 027 PIP) —
-- but apply the three in order. The app falls back to the same default
-- slabs until this exists, so code can be deployed before or after it.
--
-- Vintage is COMPUTED, not stored: an agent in OJT / re-training is "OJT"
-- (a direct read of employment_stage); anyone else is placed by
-- (as-of date - joining_date) in days against the slab set that was in
-- force on that date. Versioned like every rule table here: a slab set is
-- superseded, never edited, so a later change never rewrites history.
--
-- Day boundaries CONFIRMED by Jamil (2026-09-25): 1st Month 0-30, 1-3 Months
-- 31-90, 3-6 Months 91-180, 6-9 Months 181-270, 9-12 Months 271-365,
-- 1 Year Plus 366+ (he wrote "365+"; day 365 is already in 9-12 Months, and
-- every day must fall in exactly one slab, so it starts at 366).
-- Change any time with:  select set_vintage_slabs('[...]'::jsonb);  (below).
-- ============================================================

create table vintage_slabs (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  min_days int,                        -- inclusive; null ONLY for the 'OJT' label (read from employment_stage)
  max_days int,                        -- inclusive; null = open-ended
  sort_order int not null,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,            -- null = the current row
  created_by uuid references users(id),
  constraint vintage_slabs_label_present check (length(btrim(label)) > 0),
  constraint vintage_slabs_ojt_shape check ((min_days is null) = (label = 'OJT') and (label <> 'OJT' or max_days is null)),
  constraint vintage_slabs_range check (min_days is null or (min_days >= 0 and (max_days is null or max_days >= min_days))),
  constraint vintage_slabs_period check (effective_to is null or effective_to >= effective_from)
);

-- At most one CURRENT row per label.
create unique index uq_vintage_slabs_open on vintage_slabs (label) where effective_to is null;

alter table vintage_slabs enable row level security;

-- Everyone signed in may read (the audit page shows it; anon may not).
create policy vintage_slabs_select on vintage_slabs
  for select to authenticated using (true);

-- Admins may insert / supersede, never delete (history is never destroyed).
create policy vintage_slabs_insert_admin on vintage_slabs
  for insert to authenticated
  with check (current_app_role() in ('super_admin', 'qa_manager'));
create policy vintage_slabs_update_admin on vintage_slabs
  for update to authenticated
  using (current_app_role() in ('super_admin', 'qa_manager'))
  with check (current_app_role() in ('super_admin', 'qa_manager'));

-- Seed = the confirmed boundaries above.
insert into vintage_slabs (label, min_days, max_days, sort_order) values
  ('OJT',           null, null, 0),
  ('1st Month',     0,    30,   1),
  ('1-3 Months',    31,   90,   2),
  ('3-6 Months',    91,   180,  3),
  ('6-9 Months',    181,  270,  4),
  ('9-12 Months',   271,  365,  5),
  ('1 Year Plus',   366,  null, 6);

-- ── Lookup ──────────────────────────────────────────────────
-- The slab label for an agent on a given day (default: today, Dhaka), using
-- the slab set in force ON THAT DAY. Null when there is no answer (no or a
-- future joining date) — never a made-up label.
create or replace function vintage_slab_for(
  p_stage text,
  p_joining date,
  p_on date default ((now() at time zone 'Asia/Dhaka')::date)
)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when p_stage in ('ojt', 're_training') then 'OJT'
    when p_joining is null or p_joining > p_on then null
    else (
      select s.label
        from vintage_slabs s
       where s.min_days is not null
         and s.min_days <= (p_on - p_joining)
         and (s.max_days is null or (p_on - p_joining) <= s.max_days)
         and (s.effective_from at time zone 'Asia/Dhaka')::date <= p_on
         and (s.effective_to is null or (s.effective_to at time zone 'Asia/Dhaka')::date > p_on)
       order by s.min_days desc
       limit 1
    )
  end;
$$;

revoke all on function vintage_slab_for(text, date, date) from public;
grant execute on function vintage_slab_for(text, date, date) to authenticated, service_role;

-- ── Change the slabs (supersede, never edit) ─────────────────
--   select set_vintage_slabs('[
--     {"label":"1st Month","min_days":0,"max_days":30},
--     {"label":"1-3 Months","min_days":31,"max_days":90}, ... ,
--     {"label":"1 Year Plus","min_days":366,"max_days":null}]');
-- Pass the day-count slabs only (OJT is implicit and carried over). They
-- must start at day 0, follow each other with no gap or overlap, and end
-- open-ended — so every possible tenure lands in exactly one slab.
-- Runs with the caller's rights: only super_admin / qa_manager can do it.
create or replace function set_vintage_slabs(p_slabs jsonb)
returns int
language plpgsql
set search_path = public
as $$
declare
  v_row jsonb;
  v_prev_max int := -1;
  v_prev_open boolean := false;
  v_n int := 0;
  v_label text;
  v_min int;
  v_max int;
begin
  if current_app_role() not in ('super_admin', 'qa_manager') then
    raise exception 'Only a Super Admin or QA Manager can change the vintage slabs.';
  end if;
  if p_slabs is null or jsonb_typeof(p_slabs) <> 'array' or jsonb_array_length(p_slabs) = 0 then
    raise exception 'Provide at least one slab.';
  end if;

  -- Validate: sorted by min_days, starting at 0, contiguous, last one open.
  for v_row in select value from jsonb_array_elements(p_slabs) order by (value->>'min_days')::int loop
    v_label := btrim(coalesce(v_row->>'label', ''));
    v_min := (v_row->>'min_days')::int;
    v_max := nullif(v_row->>'max_days', '')::int;
    if v_label = '' or v_label = 'OJT' then raise exception 'Each slab needs a label ("OJT" is reserved).'; end if;
    if v_prev_open then raise exception 'Only the last slab may be open-ended.'; end if;
    if v_min is null or v_min <> v_prev_max + 1 then
      raise exception 'Slabs must start at day 0 and follow each other with no gap or overlap (problem at "%").', v_label;
    end if;
    if v_max is not null and v_max < v_min then raise exception 'Slab "%" ends before it starts.', v_label; end if;
    v_prev_open := (v_max is null);
    v_prev_max := coalesce(v_max, v_min);
    v_n := v_n + 1;
  end loop;
  if not v_prev_open then raise exception 'The last slab must be open-ended (no max_days).'; end if;

  -- Close the current day-count slabs (OJT stays), open the new set — atomically.
  update vintage_slabs set effective_to = now() where effective_to is null and min_days is not null;

  insert into vintage_slabs (label, min_days, max_days, sort_order, created_by)
  select btrim(value->>'label'), (value->>'min_days')::int, nullif(value->>'max_days', '')::int,
         row_number() over (order by (value->>'min_days')::int), current_app_user_id()
    from jsonb_array_elements(p_slabs);

  return v_n;
end;
$$;

revoke all on function set_vintage_slabs(jsonb) from public;
grant execute on function set_vintage_slabs(jsonb) to authenticated;
