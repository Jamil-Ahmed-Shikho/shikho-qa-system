-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 039 — Team/channel consolidation: TS3P and BPO are the same channel (2026-09-27, Jamil).
-- Stage 1 of the PIP rebuild (§6.4, Section C) — done first because everything else in that rebuild
-- depends on the team/channel list being correct. Test in the Supabase SQL Editor before relying on it.
--
-- CONFIRMED: "TS3P (Third Party Telesales/BPO vendor) and BPO have always referred to the same channel" —
-- a real data correction, not a rename-only. Every row using 'BPO' as a team/channel value is migrated to
-- 'TS3P', never left as a duplicate. `TEAM_NAMES` (src/types/database.types.ts) drops 'BPO'.
--
-- GROUPING RULE (confirmed, applies going forward — noted here, enforced where the PIP rebuild's bottom-N
-- selection is (re)built in a later stage, not by this migration): TS3P's `site_name` is "Dhaka" (it is
-- physically located there), but it must NEVER be grouped with Dhaka Telesales for bottom-N selection or
-- reporting. Group by team/channel (`team_name`), not raw `site_name` — Dhaka Telesales, TS3P, Jashore
-- Telesales, CX, and Retention are each their own distinct group.
-- ============================================================

-- ── users ────────────────────────────────────────────────────
update users set team_name = 'TS3P' where team_name = 'BPO';

-- ── team_rubric_mapping (primary key: team_name, rubric_id — migrate without creating a duplicate) ──
insert into team_rubric_mapping (team_name, rubric_id)
select 'TS3P', rubric_id from team_rubric_mapping where team_name = 'BPO'
on conflict (team_name, rubric_id) do nothing;
delete from team_rubric_mapping where team_name = 'BPO';

-- ── campaigns.team_names (an array — replace the element, de-duplicating if TS3P is already listed) ──
update campaigns
   set team_names = (
     select array_agg(distinct t order by t)
       from unnest(team_names) as t(t_raw), lateral (select case when t_raw = 'BPO' then 'TS3P' else t_raw end as t) x
   )
 where 'BPO' = any(team_names);

-- ── audit_target_rules / revenue_target_rules ──────────────────────────────────────────────────────
-- Unique key is (stage, vintage_label, team_name, effective_from): a BPO row and a TS3P row for the exact
-- same key+date would collide once renamed. Keep the newer one (by created_at), drop the older duplicate —
-- and RAISE NOTICE so a real conflict (meaning BPO and TS3P had genuinely different target numbers set for
-- the same week) is visible when this migration is applied, rather than silently picked for you.
do $$
declare
  r record;
begin
  for r in
    select bpo.id as bpo_id, ts3p.id as ts3p_id, bpo.created_at as bpo_created, ts3p.created_at as ts3p_created
      from audit_target_rules bpo
      join audit_target_rules ts3p
        on ts3p.team_name = 'TS3P'
       and coalesce(ts3p.stage, '') = coalesce(bpo.stage, '')
       and coalesce(ts3p.vintage_label, '') = coalesce(bpo.vintage_label, '')
       and ts3p.effective_from = bpo.effective_from
     where bpo.team_name = 'BPO'
  loop
    raise notice 'audit_target_rules: BPO and TS3P both had a rule for the same key/date — keeping the newer, dropping id %', case when r.bpo_created > r.ts3p_created then r.ts3p_id else r.bpo_id end;
    if r.bpo_created > r.ts3p_created then
      delete from audit_target_rules where id = r.ts3p_id;
    else
      delete from audit_target_rules where id = r.bpo_id;
    end if;
  end loop;
end $$;
update audit_target_rules set team_name = 'TS3P' where team_name = 'BPO';

do $$
declare
  r record;
begin
  for r in
    select bpo.id as bpo_id, ts3p.id as ts3p_id, bpo.created_at as bpo_created, ts3p.created_at as ts3p_created
      from revenue_target_rules bpo
      join revenue_target_rules ts3p
        on ts3p.team_name = 'TS3P'
       and coalesce(ts3p.stage, '') = coalesce(bpo.stage, '')
       and coalesce(ts3p.vintage_label, '') = coalesce(bpo.vintage_label, '')
       and ts3p.effective_from = bpo.effective_from
     where bpo.team_name = 'BPO'
  loop
    raise notice 'revenue_target_rules: BPO and TS3P both had a rule for the same key/date — keeping the newer, dropping id %', case when r.bpo_created > r.ts3p_created then r.ts3p_id else r.bpo_id end;
    if r.bpo_created > r.ts3p_created then
      delete from revenue_target_rules where id = r.ts3p_id;
    else
      delete from revenue_target_rules where id = r.bpo_id;
    end if;
  end loop;
end $$;
update revenue_target_rules set team_name = 'TS3P' where team_name = 'BPO';

-- ── calibration_sessions.team_name (not unique-keyed on team; a plain rename is enough) ──
update calibration_sessions set team_name = 'TS3P' where team_name = 'BPO';

-- ── The allow-list used when setting a target rule (schema_034) — drop 'BPO' ──
create or replace function _validate_target_key(p_ojt boolean, p_label text, p_team text)
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if p_team is not null and p_team not in ('Telesales', 'CX Non-Voice', 'CX Inbound', 'Engagement', 'Retention', 'TS3P') then
    raise exception 'Unknown team "%".', p_team;
  end if;
  if not p_ojt then
    if p_label is null or not exists (select 1 from vintage_slabs where label = p_label and effective_to is null and min_days is not null) then
      raise exception 'Unknown vintage slab "%".', coalesce(p_label, '');
    end if;
  end if;
end;
$$;
