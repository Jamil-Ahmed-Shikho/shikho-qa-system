-- ============================================================
-- Add My view / Team view to ojt_candidates() (2026-10-03), so a re-training
-- agent can be appended to the bottom of "Who to audit next" (QueueSection)
-- scoped the same way the rest of that screen already is — a QA Auditor's
-- My view should show only their own assigned agents, not every re-training
-- agent company-wide. Same standing pattern as qa_agent_queue()/
-- qa_auditor_ranking()/qa_channel_progress() (§11's "every Stage 3-6
-- function gets My View/Team View from the start"): super_admin/qa_manager
-- always unrestricted; qa_auditor scoped to quality_auditor_id on 'mine';
-- team_lead/manager unchanged (own scope only, no toggle — §2's own rule).
-- ============================================================

-- Drop the old zero-argument signature FIRST — a default-valued new argument
-- would otherwise coexist with it as a second overload, and a bare
-- ojt_candidates() call could resolve ambiguously between the two.
drop function if exists ojt_candidates();

create or replace function ojt_candidates(p_view text default 'team')
returns table (
  agent_id uuid, name text, email text, team_name text, site_name text,
  team_leader_name text, trainer_name text, employment_stage text,
  ojt_start_date date, days_in_stage int,
  re_training_start_date date, re_training_end_date date, re_training_days_left int,
  ojt_calls_this_week int, ojt_target int,
  re_training_call_done boolean
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_role text := current_app_role();
  v_me uuid := current_app_user_id();
  v_week date := sales_week_start((now() at time zone 'Asia/Dhaka')::date);
  v_wk_start timestamptz := (v_week::timestamp at time zone 'Asia/Dhaka');
  v_wk_end timestamptz := ((v_week + 7)::timestamp at time zone 'Asia/Dhaka');
  v_today date := (now() at time zone 'Asia/Dhaka')::date;
begin
  if v_role not in ('super_admin', 'qa_manager', 'qa_auditor', 'team_lead', 'manager') then return; end if;
  if p_view not in ('mine', 'team') then raise exception 'Choose My view or Team view.'; end if;

  return query
  select u.id, u.name, u.email, u.team_name, u.site_name,
         tl.name, tr.name, u.employment_stage,
         u.ojt_start_date,
         (v_today - coalesce(
            case when u.employment_stage = 're_training' then h.re_training_start_date end,
            u.ojt_start_date, u.created_at::date))::int,
         h.re_training_start_date, h.re_training_end_date,
         case when u.employment_stage = 're_training' and h.re_training_end_date is not null
              then greatest(0, (h.re_training_end_date - v_today))::int end,
         (select count(*)::int from audits a where a.agent_id = u.id and a.status <> 'draft'
           and a.submitted_at >= v_wk_start and a.submitted_at < v_wk_end),
         audit_target_for(true, null, u.team_name, v_week),
         case when u.employment_stage = 're_training' and h.re_training_start_date is not null then exists (
                select 1 from audits a where a.agent_id = u.id and a.status <> 'draft'
                 and a.submitted_at >= (h.re_training_start_date::timestamp at time zone 'Asia/Dhaka')
                 and a.submitted_at < ((h.re_training_end_date + 1)::timestamp at time zone 'Asia/Dhaka')
              ) end
    from users u
    left join users tl on tl.id = u.team_leader_id
    left join users tr on tr.id = u.trainer_id
    left join lateral (
      select h2.re_training_start_date, h2.re_training_end_date
        from ojt_status_history h2
       where h2.agent_id = u.id and h2.to_stage = 're_training'
       order by h2.changed_at desc limit 1
    ) h on true
   where u.role = 'agent' and u.is_active and u.employment_stage in ('ojt', 're_training')
     and (
       v_role in ('super_admin', 'qa_manager')
       or (v_role = 'qa_auditor' and (p_view = 'team' or u.quality_auditor_id = v_me))
       or (v_role = 'team_lead' and u.team_leader_id = v_me)
       or (v_role = 'manager' and u.id in (select a from manager_chain_ids() as a))
     )
   order by u.employment_stage, u.name;
end;
$$;
revoke all on function ojt_candidates(text) from public;
grant execute on function ojt_candidates(text) to authenticated;
