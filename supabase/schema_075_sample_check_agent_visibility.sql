-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 075 — enforce "agent never" for a Sample Check (§4 Part 1,
-- confirmed visibility: "Same as a normal audit's visibility" but an agent
-- is explicitly excluded there too — QA all, Team Lead own team, Manager
-- own chain, agent never). Apply after schema_073.
--
-- Without this, an agent's OWN Sample Check (one logged on one of their
-- own calls) would have been readable through the existing
-- audits_select_agent_own / audit_campaigns_select / audit_campaign_
-- answers_select policies (schema_028/048), which only checked
-- `agent_id = self and status <> 'draft'` — never check_mode. This is the
-- real boundary (RLS), not just an app-layer filter — the agent-facing
-- `/my-audits` page already happens to only read what RLS hands it, so no
-- application code change was needed once this is fixed here.
-- ============================================================

drop policy if exists audits_select_agent_own on audits;
create policy audits_select_agent_own on audits
  for select to authenticated
  using (agent_id = current_app_user_id() and status <> 'draft' and check_mode = 'audit');

drop policy if exists audit_campaigns_select on audit_campaigns;
create policy audit_campaigns_select on audit_campaigns for select to authenticated
  using (
    (coalesce(current_app_role(), '') <> 'agent' and exists (select 1 from audits a where a.id = audit_campaigns.audit_id))
    or (current_app_role() = 'agent'
        and exists (select 1 from audits a where a.id = audit_campaigns.audit_id and a.agent_id = current_app_user_id() and a.status <> 'draft' and a.check_mode = 'audit'))
  );
drop policy if exists audit_campaign_answers_select on audit_campaign_answers;
create policy audit_campaign_answers_select on audit_campaign_answers for select to authenticated
  using (
    (coalesce(current_app_role(), '') <> 'agent' and exists (select 1 from audits a where a.id = audit_campaign_answers.audit_id))
    or (current_app_role() = 'agent'
        and exists (select 1 from audits a where a.id = audit_campaign_answers.audit_id and a.agent_id = current_app_user_id() and a.status <> 'draft' and a.check_mode = 'audit'))
  );
