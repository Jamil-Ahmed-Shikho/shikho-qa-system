# Shikho QA Audit Management System — Complete System Design

**Prepared by:** Claude, with Jamil Ahmed (AGM, Quality & Compliance — Telesales)
**Status:** Ready for Phase 1 build
**Stack:** Next.js 15 (TypeScript, App Router) + Supabase (Postgres/Auth/Storage) + Vercel (Hobby, $0 budget) + Gmail SMTP — same stack proven on the Shikho CMS ([github.com/Jamil-Ahmed-Shikho/shikho-cms](https://github.com/Jamil-Ahmed-Shikho/shikho-cms))

**Build process:** Phase 1 (§12) is built in the exact numbered order, one step at a time. Stop after each step for testing before starting the next — do not skip ahead or combine steps unless explicitly told to.

---

## Stack Decision: Supabase, not NeonDB + Prisma

The tech team's reference code used Prisma against a separate database. After review, this project **stays on Supabase**:
- **Row-Level Security is a real advantage for a compliance system** — Supabase enforces access control at the database level (45 RLS policies already proven on the CMS); with Prisma/NeonDB, authorization lives only in application code
- **Fewer moving parts** — Supabase bundles Auth + Storage + DB; NeonDB is database-only, requiring a separate auth layer and storage decision
- **Proven, not hypothetical** — the CMS runs this exact stack in production today; both platforms scale the same way (upgrade tier when free tier is outgrown), so switching adds risk without a concrete benefit at this stage
- Keeps the working rhythm consistent — SQL reviewed in Supabase's editor, same as the CMS

The tech team's code remains valuable as **API reference only** (endpoints, auth headers, response shape) — see §10.

---

## 1. Scope & Principles

- Audits cover **three item types**: calls, chats, complaints
- Calls are audited via **structured CRM integration** (§10) — chats and complaints via a reference link/ID (`item_reference`) for now
- Three rubrics, each versioned so historical audits never change when a rubric is edited:
  - **Telesales rubric** → used by Telesales, Retention, TS3P/BPO
  - **CX Non-Voice rubric** → used by Chat/Comments/Social Media
  - **CX Inbound & Engagement rubric** → used by Inbound, Engagement
- Every table that drives a business rule (rubrics, fatal lists, RYG thresholds, vintage slabs, PIP policy, audit targets) is **versioned/time-boxed** — never edited in place, always superseded — so history is never rewritten by a future policy change
- An **immutable audit log** covers every write in the system, not just complaints
- **Lead/call discovery stays external, in Metabase** — QA finds relevant leads there by their own query (agent, TL, duration, course, lead stage, etc.); this system's job starts once QA has a lead ID/URL in hand. See §10 for a note on eliminating this external step later.

---

## 2. Core Users & Org Structure

```sql
create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique not null,
  emp_id text unique,
  role text not null check (role in ('super_admin','qa_manager','manager','qa_auditor','team_lead','agent')),
  joining_date date,                 -- null until OJT is certified — see §7
  employment_stage text not null default 'active'
    check (employment_stage in ('ojt','re_training','active','not_certified','discontinued')),
  ojt_start_date date,
  team_name text,                    -- 'Telesales','CX Non-Voice','CX Inbound','Engagement','Retention','TS3P','BPO'
  site_name text,                    -- 'Dhaka','Jashore'
  team_leader_id uuid references users(id),
  manager_id uuid references users(id),
  quality_auditor_id uuid references users(id),
  trainer_id uuid references users(id),
  is_active boolean not null default true,
  created_at timestamptz default now()
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references users(id),
  action text not null,
  table_name text not null,
  record_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz default now()
);
```

**Roles:**
| Role | Access |
|---|---|
| `super_admin` | Everything |
| `qa_manager` | Rubrics, policies, org-wide reporting, calibration |
| `manager` | Business/ops role (sales or CX) — sees performance for **their own reporting chain only** (see below) |
| `qa_auditor` | Conducts audits, sees own queue + targets |
| `team_lead` | Audits **own team only** (the agents whose `team_leader_id` is them), sees team dashboard — scoped like Manager, see below |
| `agent` (Counselor) | Own scores, feedback, history, briefings |

**Manager vs QA Manager:** `manager` is a business/ops role overseeing sales or CX performance; `qa_manager` runs the QA function (rubrics, policies, calibration, org-wide QA reporting). A Manager is **not tied to one team or site** — one Manager can oversee Team Leads across teams (e.g. Retention + Dhaka Sales), another CX, another the Jashore site. A Manager typically oversees 5–10 Team Leads and 100–150 agents (a Team Lead: 15–25 agents). **BPO Team Leads report to a QA Manager directly**, so a Team Lead's `manager_id` may point at a `manager` *or* a `qa_manager`.

**Reporting chain (Manager scoping):** Team Leads report to a Manager via `manager_id`; agents report to a Team Lead via `team_leader_id`. A Manager's chain = users with `role = 'team_lead'` and `manager_id = them`, plus everyone whose `team_leader_id` is in the chain (walked recursively). Access is scoped to that chain and nothing else — enforced in the database by `manager_chain_ids()` (schema_007), not just in the UI. **Any table a Manager can read must be scoped through `manager_chain_ids()`** (add a `manager`-role RLS policy, as `users`/`audits` have) — never grant `manager` a company-wide policy. `super_admin`/`qa_manager` may request any manager's chain; everyone else gets only their own.

**Every agent has a Team Leader.** There is no case where an agent reports straight to a Manager — an active agent with no `team_leader_id` is a data-entry error, prevented rather than designed around. Enforced three ways: the `users_agent_requires_team_leader` CHECK constraint (schema_008; applies to active agents, so a leaver can be deactivated without one), `validateTeamLeaderRequired()` in the form and server actions, and the bulk import rejecting agent rows with no (or an invalid) Team Leader Email. Agents are therefore always reachable through a Team Lead, so Manager and Team Lead rollups never miss anyone.

**An agent's `manager_id` stays on the profile, by decision — as informational only.** It is kept for reference / future use and is optional; the form labels it "(reference only)". It grants **no access**: Manager and Team Lead scoping never read it, they go through `team_leader_id` (schema_009 removed the last place that did — the `manager_id = me` branch of `users_select_self`). Don't remove the field from agent profiles or the bulk-import template, and don't build scoping or reporting on it. On a **Team Lead**, `manager_id` is functional: it is what places them in a Manager's reporting chain.

**Team Lead scoping:** a Team Lead's team = agents with `team_leader_id` = them, and nothing else. Enforced in the database via `team_agent_ids()` (schema_008), the same pattern as `manager_chain_ids()`: Team Leads read only their own agents' users/audits (plus QA staff names, to see who audited), can start audits only on their own agents, and `startAudit` additionally requires the call's real owner (resolved from the CRM) to be one of their agents. `users_select_qa_roles` / `audits_select_qa` cover only `super_admin`/`qa_manager`/`qa_auditor`. Any new table a Team Lead can read must be scoped through `team_agent_ids()` too.

**Standing principle — QA Auditor scoping on dashboards/reports: default to a "My View" / "Team View" toggle, not a single fixed rule.** A `qa_auditor` has `quality_auditor_id` links to agents (§2 schema above) suggesting a natural "my assigned agents" scope, the same shape as a Team Lead's `team_agent_ids()` — but unlike a Team Lead, a QA Auditor is QA staff, not org-chart management, and different screens legitimately want different defaults: an auditor's own queue/target screen wants **My View** (their own portfolio, `quality_auditor_id`), while a cross-cutting report (like the Campaign Report, §4 Part B3) wants **Team View** (everyone, unrestricted — company-wide, same as QA Manager) since the auditor is asking "what is everyone answering", not "how am I doing". **Don't pick a scoping rule ad hoc per screen** — build the toggle (default to whichever view suits that screen, let the auditor switch) so later steps (audit targets §9/Step 6, RYG/performance dashboards §6/Step 7, QA performance ranking §11) don't each reinvent this decision or drift to different defaults. This was corrected twice already, on the Campaign Report (§4 Part B3): first it shipped with QA Auditors excluded entirely, corrected to Team View (unrestricted, never scoped to `quality_auditor_id`); separately, **Team Lead access was simply missing from the first build** — an ambiguous instruction, not a deliberate exclusion — corrected by adding it scoped through `team_agent_ids()`, same as everywhere else Team Lead appears (own team only, no toggle — a Team Lead's scoping is always the one view, unlike a QA Auditor's).

**On OJT candidates:** their `users` row is created at ID-creation time, before joining — with QA/TL/Manager/Site tagging already set, `employment_stage = 'ojt'`, and `joining_date = null`. See §7.

**Profile-only accounts (`users.account_status`, schema_020, added 2026-09-23).** The normal account-creation path (`createAccount()`, both the single Add-user form and bulk import) always did two things at once: create a Supabase Auth login, and email a temporary password. That's wrong while the system is still local/in development — importing the real ~300-person roster the normal way would hand every one of them a "your account is ready" email for a system they can't use yet. `account_status` splits the two: `'profile_only'` (no `auth_id`, no login, no email — just enough data for matching: name, email, team, site, CRM fields) vs `'active'` (has a real login, as before). **No RLS or matching changes were needed** — `users.auth_id` was already nullable (`unique references auth.users(id) on delete set null`, schema_001) and every RLS helper matches on `auth_id = auth.uid()`, where SQL's `null = null` is never true, so a profile-only row is structurally inert for login purposes; agent-matching (`src/lib/audits/agent-matching.ts`, `scripts/backfill-revenue.mjs`) reads only `users.email` / `users.crm_agent_id`, never `account_status`, so matching works identically regardless of activation state. **Bulk import defaults to `profile_only`** (a checkbox on the upload panel can override to the old create-logins-immediately behaviour); the single Add-user form is unchanged and still always creates an active login (nobody asked for that to change, and it's rarely used for real-roster-scale imports anyway). **Activation is a separate, explicit step** (`activateAccount()` in `users.service.ts`, same auth-creation logic `createAccount()` uses, factored out) — "Activate & invite" on the Users screen, single-row or bulk-select, creates the login and sends the welcome email at that point, not before. Same principle as everywhere else in this system: don't do a consequential, hard-to-take-back action (sending a real person a real login) as a side effect of something else (importing their profile data) — make it its own deliberate step.

---

## 3. Rubric Engine

```sql
create table rubrics (
  id uuid primary key default gen_random_uuid(),
  name text not null,                 -- 'Telesales Scorecard' | 'CX Non-Voice' | 'CX Inbound & Engagement'
  version int not null default 1,
  total_points numeric not null default 100,
  is_active boolean not null default true,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table team_rubric_mapping (
  team_name text not null,
  rubric_id uuid not null references rubrics(id),
  primary key (team_name, rubric_id)
);

create table rubric_categories (
  id uuid primary key default gen_random_uuid(),
  rubric_id uuid not null references rubrics(id),
  name text not null,
  sort_order int not null
);

create table rubric_parameters (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references rubric_categories(id),
  name text not null,
  points numeric not null,
  sort_order int not null
);

create table rubric_error_attributes (
  id uuid primary key default gen_random_uuid(),
  parameter_id uuid not null references rubric_parameters(id),
  description text not null,
  sort_order int not null
);

-- Fatal errors: separate list per rubric, tiered Critical / Major, auto-zero on Critical
create table fatal_parameters (
  id uuid primary key default gen_random_uuid(),
  rubric_id uuid not null references rubrics(id),
  description text not null,
  severity text not null check (severity in ('critical','major')),
  sort_order int not null
);
```

**Confirmed data loaded at launch:**
- Telesales: 16 parameters / 100 pts + 13 fatal items (10 Critical, 3 Major)
- CX Non-Voice: 11 parameters / 100 pts + 5 fatal items (all Critical) — "Social Media" fatal list
- CX Inbound & Engagement: 16 parameters / 100 pts + 12 fatal items (11 Critical, 1 Major)

**Scoring rule (confirmed):** A parameter scores its full points if zero error attributes are ticked, 0 if one or more are ticked. Total = sum of parameter points earned. Any Critical fatal tick = whole audit auto-zeroed (`critical_fail = true`).

---

## 4. Audit Engine

```sql
create table audits (
  id uuid primary key default gen_random_uuid(),
  audit_type text not null check (audit_type in ('call','chat','complaint')),
  agent_id uuid not null references users(id),
  auditor_id uuid not null references users(id),
  rubric_id uuid not null references rubrics(id),      -- locked at creation
  item_reference text,                                  -- chat link / complaint ID — calls use structured fields below

  -- Structured CRM call data (populated for audit_type = 'call'; see §10)
  crm_lead_id text,
  crm_call_id text,
  call_started_at timestamptz,
  call_ended_at timestamptz,
  call_recording_url text,
  call_status text,
  call_destination text,

  score_percent numeric,
  passed boolean,
  overall_feedback text,                                 -- optional coaching summary (schema_012; optional since 013)
  critical_fail boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft','submitted','acknowledged','disputed','resolved')),
  re_audit_of uuid references audits(id),                -- CAPA linkage
  capa_status text check (capa_status in ('pending_reaudit','passed','failed_again')),
  created_at timestamptz not null default now(),
  submitted_at timestamptz
);

create unique index idx_audits_crm_call_id on audits(crm_call_id) where crm_call_id is not null;

create table audit_parameter_results (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references audits(id),
  parameter_id uuid not null references rubric_parameters(id),
  passed boolean not null,
  points_awarded numeric not null,
  feedback text                                          -- REQUIRED at submit when passed = false; null when passed (schema_012/013)
);

create table audit_error_ticks (
  id uuid primary key default gen_random_uuid(),
  audit_parameter_result_id uuid not null references audit_parameter_results(id),
  error_attribute_id uuid not null references rubric_error_attributes(id),
  root_cause_category text check (root_cause_category in ('skill','knowledge','process','attitude'))
);

create table audit_fatal_results (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references audits(id),
  fatal_parameter_id uuid not null references fatal_parameters(id),
  severity text not null,                                -- denormalized at audit time
  feedback text                                          -- REQUIRED at submit for every ticked fatal, Critical or Major (schema_013)
);

create table disputes (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references audits(id),
  raised_by uuid not null references users(id),
  reason text not null,
  status text not null default 'open' check (status in ('open','under_review','resolved')),
  resolution_note text,
  resolved_by uuid references users(id),
  resolved_at timestamptz,
  created_at timestamptz default now()
);
```

**How scoring is implemented (Step 4, schema_011).**
- **The rubric is the one locked at audit creation** (`audits.rubric_id`, chosen from `team_rubric_mapping` when the draft is started) — never re-resolved from the team later, so a rubric change never alters an audit in progress or done.
- **The database is the scoring authority.** Scorecards are written only through `write_audit_results()` (service role, one transaction). The app sends *marks* — which parameters passed, which error attributes were ticked and their root cause, which fatals — and the function derives everything else: points per parameter (full on Pass, 0 on Fail; a Fail needs ≥1 tick, a Pass has none), the score, `critical_fail`, and `passed`. It refuses an incomplete scorecard (unscored parameter, failed parameter without a tick, tick without a root cause, foreign parameter/attribute/fatal ids) and a rubric whose parameter points don't add up to its total. The three scorecard tables have **no insert/update/delete policies**, so nobody can write or alter them directly, and a submitted audit can't be changed. An auditor also can't submit by editing `audits` (the update policy's WITH CHECK keeps `status = 'draft'`).
- **`src/lib/audits/scoring.ts`** is the same rule for the live score in the UI; a randomized parity test (engine vs database, over the real seeded rubrics) keeps the two identical. Change one → change the other and re-run it.
- **Critical fatal** → score 0, `critical_fail = true`, `passed = false`; the parameter rows still record what was observed. **Major** is recorded only. Fatal severity is read from the rubric, never from the caller.
- **`audits.passed` = no critical fatal AND score ≥ the pass mark** (`status_thresholds.yellow_min`: the rubric's own open row, else the org-wide one — §6.2's single definition of "passing"; Step 7's RYG reads the same table). Frozen at submission, with the mark used stored in `audits.pass_mark_used`, so a later threshold change never rewrites or leaves an old audit unexplained. **The seeded 90/70 are PLACEHOLDERS** (the design doc's "e.g." figures) — correct them with `select set_status_thresholds(null, <green>, <yellow>);` (versioned: closes the current row, opens a new one; admins only) until the admin screen exists.
- **Feedback — what is required (schema_012, superseded by schema_013).** QA-team feedback: what the agent reads at the *parameter* level matters more than a summary, so at submit: **every FAILED parameter needs feedback** (`audit_parameter_results.feedback`, non-blank, 500 chars), **every ticked fatal error — Critical or Major — needs its own feedback** (`audit_fatal_results.feedback`, non-blank, **1000 chars**: the most consequential finding, usually needs a quote or timestamp as evidence), and the **overall summary is optional** (`audits.overall_feedback`, 2000 chars; still shown and voice-enabled, never blocks Submit). A draft may leave any of it blank — the requirement bites at submit. Enforced in `write_audit_results()` as well as the UI (the UI keeps Submit disabled and lists each failed parameter / ticked fatal still missing feedback with a "Go to" link; the function refuses with the count still missing). A Pass can't carry feedback (mirrors "a Pass can't carry ticks"), so setting a parameter to Pass — or unticking a fatal — clears it, with a confirm. `p_fatals` is `[{fatal_parameter_id, feedback}]` (a bare id from an older open tab still saves as a draft, but can't be submitted). Limits are `FEEDBACK_LIMITS` in `scoring.ts` = `c_*_max` in the function = the table CHECK constraints, counted as characters not bytes. Text is stored trimmed (spaces/tabs/line breaks only — `normalizeFeedback` and Postgres `btrim` share that definition so they never disagree about "blank"); blank becomes null. **Feedback never affects the score.** Nothing was rewritten by 012/013: audits submitted earlier simply lack feedback (columns nullable, no table constraint demands it), and the result screen shows a neutral note. All fields use `src/components/common/VoiceInputButton.tsx` — the CMS voice-input component (Web Speech API, Chrome; EN / বাং toggle, **Bangla default**, choice in `localStorage['voice-lang']`), which stops listening when its field unmounts; spoken phrases append through the latest state and are clamped to the limit (a textarea's `maxLength` can't stop a programmatic append).
- Save draft stores a partial scorecard (replaced wholesale each save); Submit validates it and flips `draft → submitted` with `submitted_at`, and writes `audit.submitted` to `audit_log`. Scorecard read access mirrors the parent audit's (QA roles; a Team Lead's own team; a Manager's chain, submitted only). Agents can't see scorecards yet.

### Special Checks / Campaigns (Step 4 addition, Part B — built in sub-steps B1 → B2 → B3)

A lightweight, admin-configurable layer for ad-hoc management checks ("is the agent mentioning the new course launch?") that don't belong in the permanent rubrics. **It never touches `score_percent`, `passed` or `critical_fail`** — same principle as a Major fatal error. Unlike rubrics it is not versioned; instead **nothing that has been used is ever destroyed**.

```sql
campaigns              (name, description, is_archived, all_teams, team_names[])   -- scope: all teams XOR a non-empty list (CHECK)
  campaign_check_types   (campaign_id, name, description, sort_order, is_archived)  -- the things to check
    campaign_check_values  (check_type_id, label, sort_order, is_archived)          -- a CLOSED list: no free-text "Other"
audit_campaigns        (audit_id, campaign_id)                                      -- an audit links to several campaigns
audit_campaign_answers (audit_id, campaign_id, check_type_id, value_id)             -- one answer per check per audit
```

**B1 (schema_014 + admin, built).**
- **Access.** Super Admin + QA Manager manage (`/admin/campaigns`, card on the admin dashboard); QA roles, Team Leads and Managers can read definitions (the scorecard and report need them); agents can't. The audit link/answer tables are read-only to everyone (mirroring the parent audit's visibility) and are written only by `write_audit_results()` with the service role (B2), like the scorecard tables. The answer tables exist from B1 (empty) so the protections below hold from day one.
- **Options: 2–10 active per check** (corrected from an earlier, wrong 5–10: two is the practical floor — a dropdown with one choice means nothing — and ten is a sanity ceiling). The database allows **at most 10 ACTIVE** options per check (trigger; archived ones don't count, so retiring one and adding its replacement always works). The **minimum 2 is a readiness rule**, not a constraint, so an admin can build a check one option at a time: a campaign is only *offered on new audits* when it isn't archived, has ≥1 active check, and every active check has 2–10 active options (`campaignReadiness` in `src/lib/campaigns/rules.ts`); otherwise the admin sees "setup incomplete" and why. **Warn, don't block:** archiving or deleting an option that would take a check from ≥2 to <2 active options (`optionRemovalWarning`), or archiving/deleting a campaign's last active check (`checkRemovalWarning`), asks for confirmation first — same pattern as the scorecard's Pass-clears-feedback confirm — and proceeds if confirmed. It speaks only when the action *crosses* the floor (a check already short, an already-archived item, or an archived check/campaign has nothing new to break). Un-archiving never warns.
- **Archive, never destroy.** Anything (campaign / check / option) can be archived and un-archived: hidden from new audits, fully visible on old audits and in reports. **Anything referenced by ANY audit — draft or submitted — can't be deleted** (foreign keys with no cascade; the composite keys also make it impossible to store an answer whose option isn't in its check, whose check isn't in its campaign, or for a campaign the audit isn't linked to). Unused items delete cleanly; deleting a campaign takes its unused checks and options with it. Releasing a draft audit removes its answers, freeing the items.
- **A check's or option's TEXT is frozen once a SUBMITTED audit used it** (triggers, `SECURITY DEFINER` so they see every audit whoever is editing — options in schema_014, the check's name in schema_015): a rename is refused with "archive it and add a new one instead", and the editor shows the reason (disabled field + explanation). Drafts don't count. Reordering, archiving and un-archiving stay allowed, and a check's optional *note to the auditor* stays editable. **Not locked: a campaign's name and description** (by the letter of the rule; ask if you want that extended too).
- Names are unique ignoring case (campaign; check within a campaign; option within a check); lengths 100 / 200 (check) + 300 (note) / 100 (option) / 500 (description), mirrored in `validation.ts`. New items go to the end (`sort_order` assigned by a trigger); reordering is atomic (`reorder_campaign_check_types / _values` RPCs, up/down buttons, hopping over hidden archived items). Usage counts on the admin screens come from SQL functions (`campaign_audit_counts`, `campaign_item_usage`) — not fetched rows, so a busy campaign can't silently exceed the API's row limit and understate its use.
- Team scope: an agent's `users.team_name` against `campaigns.team_names` / `all_teams` (`campaignAppliesToTeam`), used by B2's scorecard.
- Server actions (`src/lib/campaigns/actions.ts`) return `{ok,error}`, write through the session client (RLS is the boundary), map database errors to plain language, and write `campaign*.*` entries to `audit_log`.

**B2 (scorecard integration — schema_016 + scorecard, built).** An optional **"Special Check"** section on the scorecard (`SpecialChecks.tsx`), off by default: turn it on → the campaigns that apply to the agent's team → tick one or more (an audit can carry several) → each ticked campaign's active checks each ask for exactly one option from a fixed dropdown (no free text). **Only ticked campaigns ask for anything.** Answers are draft-editable and locked on submit like the rest of the scorecard. The section shows on the result screen (read-only: campaign, each answered check → the option chosen, "not part of the score").
- **Never affects scoring.** `score_percent`, `passed`, `critical_fail` are computed from the parameters and fatal errors exactly as before — proven by a database test (identical scorecards with/without campaigns give identical results) and by the randomized engine-vs-database parity test.
- **Overall feedback becomes required the moment any campaign is attached** (database + UI; the heading turns to a starred "— required" with a note saying why, and the section carries the same note). Otherwise it stays optional (schema_013). Removing the last campaign restores optional.
- **Which campaigns can be NEWLY attached** — enforced in `write_audit_results()` (8th argument `p_campaigns`), mirrored in the UI: not archived, applies to the agent's team (all teams, or the team is listed; an agent with no team only gets all-teams campaigns), and **ready** (≥1 active check, each active check 2–10 active options; SQL `campaign_is_ready()` and TS `campaignReadiness()` are kept identical by a randomized parity test). Answers must use an option that belongs to its check in a check that belongs to its campaign (composite keys + friendly checks), one per check; a NEW or CHANGED answer must be live (check and option not archived).
- **An audit in progress can always be finished (grandfathering).** A campaign already attached to a draft stays attachable/submittable after it is archived, edited or the agent's team changes; an option already chosen stays chosen after it is archived (shown "(archived)"). Only NEW attachments/answers are held to the live rules. A check ADDED to an attached campaign mid-draft becomes required; an archived check is not.
- **To SUBMIT:** every currently-active check in every attached campaign needs an answer (the error counts what's missing), and overall feedback must be written. Drafts may leave answers blank. `p_campaigns` is `[{campaign_id, answers:[{check_type_id, value_id}]}]`: `null` = not provided (an older open tab: existing links untouched), `[]` = detach all, otherwise the full new state.
- Scorecard behaviour: turning the section off, or unticking a campaign, that has answers asks for confirmation first (same pattern as Pass-clears-feedback) and clears them; the "still needed" list names each unanswered check ("Go to" scrolls to its dropdown) and the overall feedback; the unsaved-changes comparison is normalised (`toPayload` with the campaign definitions gives a stable order) rather than trusting database row order. `loadScorecard` takes the agent's team and whether the audit is a draft, and throws on a failed read (like the rest of the loader).

**B3 (Campaign Report — schema_017 + `/reports/campaigns`, built).** Pick a campaign (a plain GET-form filter bar — team, site, agent, QA auditor, submitted-date range, and for an admin which manager's chain to view — so the page is a server component with no client state); see each check's answer distribution as a table (count + %) and a plain CSS bar chart (no charting dependency). **Submitted audits only** — a draft that attached the campaign never counts, in the report or in the header's audit total.
- **Access (corrected twice — see §2's "My View / Team View" standing principle):** Super Admin / QA Manager / **QA Auditor** all see every campaign's every audit, company-wide (Team View) — a QA Auditor is **deliberately not scoped to `quality_auditor_id`** (their "assigned agents" link is informational for this report, the same way an agent's `manager_id` is informational elsewhere, §2), and, like the other two, may narrow to one specific manager's chain via the picker. A **Manager** sees only their own reporting chain, always — passing another manager's id is silently ignored (they get their own chain back, not an error). A **Team Lead** sees only their own team's agents, always — the exact same scoping Team Lead gets everywhere else (`team_agent_ids()`, §2) — and, like a Manager, has no drill-down lever at all (a `p_manager_id` from a Team Lead is never even consulted). `/reports` is a middleware `ROLE_ROUTES` entry (`super_admin`/`qa_manager`/`qa_auditor`/`manager`/`team_lead`) **outside `/admin`**, since a Manager or Team Lead can't reach `/admin/*`. The report first shipped with Team Lead access simply missing (an ambiguous instruction, per the user, not a deliberate exclusion) — added as this second correction.
- **Same pattern as `manager_agent_stats()` (schema_007):** `campaign_report()` / `campaign_report_audit_count()` / `campaign_report_participants()` are `SECURITY DEFINER` and do their own role/chain check via a shared `campaign_report_scope()` helper rather than relying on RLS per row — a disallowed role or an out-of-chain request gets zero rows back, never an error, so a stale defence-in-depth check in the app can't leak data, only mis-word a message. All three unrestricted roles may narrow to one manager's chain via `p_manager_id` — but for a QA Auditor doing that, `campaign_report_scope()` does **not** call `manager_chain_ids()` (which only trusts super_admin/qa_manager to look up someone else's chain, and also backs `manager_agent_stats()` — the Manager Dashboard's detailed per-agent stats); widening that shared helper would have handed a QA Auditor the Manager Dashboard's data too, as an unasked-for side effect. The chain walk is duplicated locally in `campaign_report_scope()` instead, specifically to keep the widening contained to this report (a test asserts `manager_chain_ids()` / `manager_agent_stats()` are unaffected). The "which managers can I view" picker reuses the existing `listManagerOptions()` (`src/lib/manager/dashboard.service.ts`) rather than a new function — that one already knows a BPO Team Lead's manager can be a `qa_manager` (§2), which a from-scratch version here would have missed.
- **Archived checks/options still show, with the exact text the auditor saw** — never hidden, since their text is frozen the moment a submitted audit uses it (schema_014/015), so showing them is always accurate. An option with zero matching answers still shows as a "0" row (the app fills it in from the campaign's current definition; the database only returns rows that exist), so "nobody picked this" reads the same as any other count.
- **Bug the tests caught:** an early version of `campaign_report_participants()` applied the chain filter *after* `distinct`, which listed an auditor once per agent they'd audited instead of once. Fixed by filtering inside the subquery, before the `distinct`.

---

## 5. Sampling, Briefings & Calibration

`sampling_queue` tracks *"random samples QA still needs to cover this week"* as a checklist — it does **not** auto-fetch or filter calls (that discovery happens in Metabase, outside this system; see §10 for the future-proofing note on eventually replacing that external step).

```sql
create table sampling_queue (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references users(id),
  audit_type text not null,
  week_start date not null,               -- sales week (Saturday)
  source text not null default 'manual',  -- 'manual' (QA found it in Metabase) | 'system' (future auto-fetch, see §10)
  status text not null default 'pending' check (status in ('pending','completed','skipped')),
  assigned_to uuid references users(id),
  created_at timestamptz default now()
);

-- Briefings (confirmed design, 2026-09-23 — see prose below the sampling_queue block above and after this one)
create table briefings (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null unique references audits(id),   -- ONE briefing per audit — reschedule = update this row, never a second row
  agent_id uuid not null references users(id),            -- denormalized from audits.agent_id at creation
  scheduled_at timestamptz not null,                       -- must land on a valid slot — see the CHECK / rules.ts below
  slot_duration_minutes int not null default 15,           -- fixed for now, not admin-configurable (see prose)
  priority text not null default 'normal' check (priority in ('normal','critical_same_day')),  -- DERIVED from audits.critical_fail by trigger, never caller-supplied
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled')),
  conducted_by uuid not null references users(id),         -- always the scheduler themselves — no delegation
  attended boolean,                                         -- set together with status='completed'; null until then
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table calibration_sessions (
  id uuid primary key default gen_random_uuid(),
  item_reference text not null,           -- the shared call/chat everyone scores
  rubric_id uuid not null references rubrics(id),
  created_by uuid references users(id),
  created_at timestamptz default now()
);

create table calibration_scores (
  id uuid primary key default gen_random_uuid(),
  calibration_session_id uuid not null references calibration_sessions(id),
  auditor_id uuid not null references users(id),
  score_percent numeric not null,
  notes text
);
```

**Briefings (confirmed design, 2026-09-23) — built in sub-steps, stopped for testing between each: Part A (schema + scheduling + email), Part B (dashboard views), Part C (the daily digest cron).** This is the direct fix for the original competitive benchmark's D-1-vs-same-day coaching gap.

- **Strictly 1:1, fixed grid — not a configurable capacity.** Each auditor (QA Auditor / QA Manager / Super Admin — see "who can schedule" below) has their own personal 15-minute grid, **11:00 AM–3:00 PM, Sunday–Thursday only** (Asia/Dhaka), 17 slots/day (11:00, 11:15, … 3:00, ending 3:15). One agent per slot, always — never a group session. Friday/Saturday are never offered. **Thursday gets a soft warning, never a hard block** ("Are you sure you want to schedule on Thursday?" — same warn-don't-block pattern as the campaign option-removal confirm, §4 Part B1) — this is a client-side confirm only, not a database rule. The window and days are hardcoded constants for now (`src/lib/briefings/rules.ts`, mirrored in the table's own CHECK constraint) — not an admin-editable policy table like `status_thresholds`; nobody asked for that yet, and it's a contained follow-up if they do.
- **Entry point: "Schedule Coaching?" on a specific submitted audit's page** — picks from the current user's own available slots (already-booked ones excluded) and assigns that audit's agent into the chosen one.
- **Who can schedule: QA function only — QA Auditor, QA Manager, Super Admin. Not Team Lead, not any business Manager.** Confirmed deliberately, even though a Team Lead can audit their own team (§2): a Team Lead who personally audits their agent still can't schedule that audit's formal briefing — someone on the QA side has to. Viewing is broader (Part B) but scheduling stays QA-only. A QA Auditor may only schedule/manage their **own** briefings (`conducted_by = self`, checked in RLS); QA Manager/Super Admin can act on any auditor's — same "unrestricted QA Manager/Super Admin, self-scoped QA Auditor" shape used elsewhere. **No delegation** — whoever clicks "Schedule Coaching?" is booking into **their own** grid and will conduct it themselves; `conducted_by` is always the actor, never chosen from a dropdown (a Claude-made call, not explicitly asked — flagged for correction if wrong).
- **Priority is derived, never chosen.** `priority = 'critical_same_day'` exactly when the linked audit has `critical_fail = true`, set by a trigger reading `audits.critical_fail` (mirrors how `audit_fatal_results.severity` is read from the rubric, never the caller, §4) — the scheduler can't override it either way. **Flag only, confirmed — never enforced**: a critical-fail audit doesn't force same-day scheduling, but the picker UI must make it visually unmissable (an "URGENT — critical fatal" badge, soonest slots surfaced first) so it doesn't quietly get scheduled three days out. This was the whole reason Briefings exists, so the UI carrying it clearly matters more than usual.
- **Lifecycle, a Claude-made call (not explicitly specified — flag if wrong):** `status` is `scheduled` → `completed` (attendance recorded, `attended` set true/false) or `cancelled` (called off before it happened; the row stays — audit trail — and a fresh slot can be booked afterward via the same row). One row per audit throughout: scheduling inserts it, rescheduling updates `scheduled_at` on the same row, cancelling flips `status`. No hard delete, ever (same "never destroy" pattern as Campaigns, §4 Part B1).
- **Slot collision is DB-enforced**, not just app logic: `unique (conducted_by, scheduled_at) where status <> 'cancelled'` — the same auditor can never hold two live bookings in the same slot; a cancelled one frees it.
- **Email (Part A, its own testable slice): scheduling AND rescheduling send a dedicated email to the agent, with their Team Leader CC'd — not the auditor** (the auditor sees their own schedule in-app instead, Part B). Cancelling also emails a cancellation notice to the same two people — not explicitly asked, a reasonable extension of "keep the agent and TL informed of their own calendar," flagged for correction if wrong.
- **Part A refinements (2026-09-24, from the team's testing).** (1) *Instant click feedback:* the clicked slot turns brand-coloured and reads "Booking…" the moment it is clicked (state set synchronously, before any server work), the other slots dim, and a "Saving your booking…" line shows — previously a `disabled` button looked identical, so nothing seemed to happen. The slow part was also removed from the critical path: the notification email is now sent **after** the response (`after()` from `next/server`), so the screen no longer waits on SMTP. Trade-off: the screen can't say "the email failed" any more, so a failure is written to `audit_log` as `briefing.email_failed` (and server logs) instead of vanishing — check there if an agent says they got nothing. (2) *The email names the auditor:* subject "Your coaching session with {Name} is scheduled", body "you have a coaching session with {Name}" plus a With/When table; reschedule and cancel emails name them too. The name is the briefing's own `conducted_by` — not whoever clicked — since a QA Manager can reschedule or cancel someone else's session. (3) *Coaching history on the "Schedule Coaching?" screen* (`agent_coaching_history()`, schema_024; `CoachingHistory.tsx`): shown on the audit page before anything is clicked and again inside the picker — any upcoming session (and with whom, flagged if it is for this audit or another), the last session (when, "N days ago" counted in Dhaka calendar days, attended / did not attend / attendance not recorded yet) and how many are on record. **Warn, don't block:** picking a slot when the agent already has an upcoming session on a *different* audit asks for confirmation first. A failed history read is shown as "could not be loaded" — never as "no history", which would invite a double-booking. **Why a function:** a QA Auditor can only read briefings they conduct (My View), but this decision needs the agent's *whole* history including other auditors' sessions (Team View, §2) — so it is a narrow SECURITY DEFINER window (scheduling roles only, zero rows for everyone else, cancelled sessions excluded, newest 20) rather than a widened briefings read policy, which would also have exposed everyone's whole coaching schedule.
- **Viewing (Part B — separate from and broader than scheduling access), each scoped to their own slice, same shape as everywhere else in this system:** Auditor sees their own upcoming/past briefings (`conducted_by = self`) on their dashboard; QA Manager/Super Admin see an org-wide count/view (unrestricted); Team Lead sees a view-only count of their own team's agents' briefings (`team_agent_ids()`); a business Manager (Telesales/CX/Retention/BPO) sees the same, rolled up across their whole chain (`manager_chain_ids()`) — neither Team Lead nor Manager can schedule, only look. The agent sees their own (`agent_id = self`).
- **Daily digest (Part C):** one email at 11 PM BD (~17:00 UTC) to every Team Lead and Manager, personalized to their own scope (same scoping as their dashboard view above) — tomorrow's briefings for THEIR people only, never company-wide. Skip sending to anyone with nothing to report rather than emailing a blank digest. A normal once-a-day Vercel cron, same pattern as every other scheduled job in this system (§14 Hobby-cron lesson).

---

## 6. Agent Status Engine

### 6.1 Vintage (computed, not stored)
```sql
create table vintage_slabs (
  id uuid primary key default gen_random_uuid(),
  label text not null,     -- 'OJT','1st Month','1-3 Months','3-6 Months','6-9 Months','9-12 Months','1 Year Plus'
  min_days int,             -- null for the 'OJT' label — it's read from employment_stage, not a day count
  max_days int,             -- null = open-ended
  sort_order int not null,
  effective_from timestamptz default now(),
  effective_to timestamptz
);
-- Vintage lookup: if employment_stage in ('ojt','re_training') → 'OJT'
-- otherwise → lookup(today() - joining_date) against the active slab set, computed at query time
```

### 6.2 Red / Yellow / Green
```sql
create table status_thresholds (
  id uuid primary key default gen_random_uuid(),
  rubric_id uuid references rubrics(id),     -- null = org-wide default
  green_min numeric not null,                -- e.g. 90
  yellow_min numeric not null,               -- e.g. 70
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_by uuid references users(id)
);

create table agent_status_log (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references users(id),
  period_start date, period_end date,
  avg_audit_score numeric,
  status text check (status in ('red','yellow','green')),
  status_reason text,      -- 'score_threshold' | 'critical_fatal_override'
  computed_at timestamptz default now()
);
```
**Rule:** status = score-band lookup, overridden to **Red** automatically if any Critical fatal occurred in the period, regardless of score.

> `status_thresholds` was created early, in schema_011 (Step 4), because `audits.passed` needs it — see §4 "How scoring is implemented". It holds one org-wide default row (green 90 / yellow 70, **placeholders to confirm**) and may hold a rubric-specific row that overrides it. Rows are superseded, never edited (`set_status_thresholds`). Step 7 adds the admin screen and the RYG computation on top of this table — don't create a second threshold table. `audits.passed` uses `yellow_min`.

### 6.3 Zero-Seller
Sales week = **Saturday–Friday**, independent of QA's Sun–Thu working week. This is the canonical week boundary used everywhere in the system (audit targets, RYG periods, PIP cycles).

```sql
create table agent_weekly_sales (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references users(id),
  week_start date not null,      -- Saturday
  week_end date not null,        -- Friday
  total_revenue numeric not null default 0,
  target_revenue numeric,
  is_zero_seller boolean not null default false,
  computed_at timestamptz default now(),
  unique (agent_id, week_start)
);

create table agent_zero_seller_status (
  agent_id uuid primary key references users(id),
  current_streak_weeks int not null default 0,
  streak_start_week date,
  last_sale_date date,
  updated_at timestamptz default now()
);
```
One-click view: `select * from agent_zero_seller_status order by current_streak_weeks desc`.

**Built (schema_022, 2026-09-24) — `recompute_weekly_sales()`.** Rolls `agent_revenue_transactions` up into `agent_weekly_sales` (one row per agent per Saturday–Friday week, Asia/Dhaka — `sales_week_start()` matches `src/lib/dates/sales-week.ts`) and derives `agent_zero_seller_status`. Run it with `select recompute_weekly_sales();` in the SQL editor or `node --env-file=.env.local scripts/recompute-weekly-sales.mjs` (local only, no CRM). **Idempotent**: every run recomputes the whole covered range from the transactions as they are now (upsert, then delete rows that no longer belong), so it is safe to re-run as the backfill continues and as `scripts/rematch-revenue.mjs` attributes more revenue; `target_revenue` is never touched. Service-role / SQL-editor only; no app role can run it or write either table (read access mirrors revenue: QA all, Team Lead `team_agent_ids()`, Manager `manager_chain_ids()`, agent own).
- **Three rules stop partial data producing false zero-sellers:** (1) only weeks the loaded data fully covers — a week counts once data reaches a day *before* its Saturday (the oldest loaded day may be a partial page); (2) only completed weeks — the week's Friday must be in the past *and* newer data must exist past it, so a stale sync can't mark the latest week zero; (3) only agents who were active and certified for the whole week — role agent, `is_active`, `employment_stage = 'active'`, `joining_date` on/before the Saturday (OJT, leavers and mid-week joiners are excluded; it uses the agent's *current* stage/active flag since no stage history exists).
- **Streak** = consecutive zero-seller weeks counted back from the agent's latest computed week; `streak_start_week` = first week of that run (null at 0); `last_sale_date` = Dhaka date of their latest attributed sale in the loaded data (includes the in-progress week).
- **The caveat that matters:** unattributed revenue (`agent_id is null`) counts for nobody, so while most events are unmatched, many agents will show as zero-sellers because their sales aren't matched, not because they didn't sell. Read `select * from revenue_coverage;` (operator view — attributed vs unattributed events and revenue %) before trusting any streak, and re-run `recompute_weekly_sales()` after every re-match. Streaks are also capped by how far back the backfill has loaded.
- Views: `zero_seller_leaderboard` (longest streak first, `security_invoker` so each role sees only their own slice) and `revenue_coverage` (aggregates only, service role / SQL editor, not granted to app roles). The daily sync (§8 Part C) calls it at the end of every run once deployed; until then run it by hand. **Do not trust week totals until `supabase/fix_001_crm_timestamps_dhaka.sql` (§8) has been applied** — rows stored before that fix are 6 hours late, which puts every Friday-evening sale in the next week.

### 6.4 PIP
```sql
create table pip_policies (
  id uuid primary key default gen_random_uuid(),
  revenue_benchmark numeric not null default 400,
  vintage_min_days int not null default 60,
  duration_weeks int not null default 3,
  target_revenue numeric not null default 300,
  bottom_n_per_site int not null default 10,
  effective_from timestamptz default now(),
  effective_to timestamptz,
  created_by uuid references users(id)
);

create table pip_cycles (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references pip_policies(id),
  month date not null,
  start_date date not null,        -- 2nd Saturday of the month
  end_date date not null,
  created_at timestamptz default now()
);

create table pip_candidates (
  id uuid primary key default gen_random_uuid(),
  pip_cycle_id uuid not null references pip_cycles(id),
  agent_id uuid not null references users(id),
  revenue_at_selection numeric,
  vintage_days_at_selection int,
  status text not null check (status in ('suggested','excluded','approved','completed','failed')),
  exclusion_reason text,
  excluded_by uuid references users(id),
  approved_by uuid references users(id),
  incentive_downgraded boolean default false,
  created_at timestamptz default now()
);

create table pip_trainings (
  id uuid primary key default gen_random_uuid(),
  pip_candidate_id uuid not null references pip_candidates(id),
  session_number int not null,      -- 1 = pre-PIP, 2, 3
  scheduled_at timestamptz,
  conducted_by uuid references users(id),
  status text
);

create table pip_tl_feedback (
  id uuid primary key default gen_random_uuid(),
  pip_candidate_id uuid not null references pip_candidates(id),
  team_leader_id uuid not null references users(id),
  feedback text,
  created_at timestamptz default now()
);
```
**Approved PIP candidates automatically feed the sampling/priority engine** — no separate manual step to get them into QA's queue.

---

## 7. OJT & Re-Training Lifecycle

New joiners go through On-Job Training before their official `joining_date` exists. Their `users` row is created at ID-creation time (§2) with `employment_stage = 'ojt'`, full org tagging (QA/TL/Manager/Site) already set, and `joining_date = null`.

**State machine:**
`ojt` → `re_training` (3-day extension) → `certified` (flips `employment_stage` to `active`, prompts for `joining_date`) / `not_certified` / `discontinued`

```sql
create table ojt_status_history (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references users(id),
  from_stage text,
  to_stage text not null,
  re_training_start_date date,      -- set only when to_stage = 're_training'
  re_training_end_date date,        -- start + 2 days (3-day span)
  note text,
  changed_by uuid references users(id),
  changed_at timestamptz default now()
);
```

**Dedicated OJT Management view** — lists everyone in `ojt`/`re_training`, with actions: Certify (prompts for joining date), Re-Train, Not Certify, Discontinue. Every transition logs here, giving a full history of who went through re-training and when.

**Vintage:** agents in `ojt` or `re_training` show Vintage = "OJT" — a direct read of `employment_stage`, matching the original vintage taxonomy (OJT / <90 Days / ≥90 Days) from the very first reports shared.

**Audit targets during OJT/Re-Training** (ties into §9):
- `ojt`: flat **3 calls/week**
- `re_training`: flat **1 call total** for the whole 3-day window (not per day) — checked off once, tracked via `re_training_start_date`/`re_training_end_date` on `ojt_status_history`, not through the weekly target table

**Mid-cycle discontinuation:** if an OJT candidate (or any active agent) is marked `discontinued`, their remaining target for the current period freezes at whatever's already completed — see §9.5. This is the same mechanism regardless of whether the agent was in OJT, re-training, or fully active.

---

## 8. Revenue Data — live CRM sync (replaces the original Google Sheet plan)

**The Google Sheet import in the original design was never built and is now superseded.** Revenue comes live from the CRM instead, staged into three sub-steps (schema → backfill script → daily sync), each stopped for testing before the next — same discipline as every other step. `agent_revenue_transactions` was only ever a design-doc stub (this section, before this rewrite) — it had never actually been created, so schema_018 is a clean build, not an ALTER of live data (confirmed via a live check before writing it).

**Source, both confirmed event types (the tech team's own scope, §8 open questions below):** `GET /events?search=type:shikho_purchase_completed,installment_enrollment&conditions=type:in&join=and&page=N&limit=500&orderBy=created_at&sortedBy=desc` — `type:in` with comma-separated values is the CMS's own proven multi-type syntax, confirmed by reading its live source (`src/app/api/crm/lookup/route.ts`, read-only, then discarded — same discipline as every other CRM investigation here), not guessed. The single-type form (`search=type:shikho_purchase_completed&conditions=type:=`) was the one actually probed live against the CRM before this addition; the multi-type form is pending one more live read-only check (a valid `CRM_BEARER_TOKEN` — a short-lived JWT — is required; the one in `.env.local` had expired by the time this was added). 500 rows/page was accepted with no cap encountered, on the single-type probe.

**The list response carries everything — confirmed by direct comparison, not assumed.** Fetching one event both via the list and via `/events/{id}` (which does exist) gave byte-identical `custom_field` data, including a populated `cf_amount`. **No per-event detail fetch is ever needed** — not for the backfill, and not for the daily sync's change-detection either (the corrected data is already sitting in the same list row that revealed the change). This was the single most consequential thing to confirm before building further: a detail-fetch-per-event design would have needed tens of thousands of extra requests for a 12-month backfill; the list-only design needs a few hundred.

**Agent attribution reuses the existing pipeline unchanged.** An event's `lead_owner_id` (nested `lead_owner: {id, name}`, confirmed no email) is the counselor credited for the sale — **not** `created_by`, which is a system identity ("Shikho App") on every event, confirmed by direct inspection. `lead_owner_id` resolved through `/users/{id}` — the same endpoint `getCrmUser()` already calls for calls — and returned a real user with an email, confirming the id space is shared with `created_by.id` on calls. So: `lead_owner_id → getCrmUser() → email → users.email` (caching `users.crm_agent_id`), identically to `src/lib/audits/agent-matching.ts`. No new matching logic.

**Ownership is corrected, not fixed, for roughly 4–5 days after a sale** (disputed/validated claims — two people claiming the same sale, a delayed claim). `agent_revenue_transactions.lead_owner_crm_id` stores the CRM's raw id independently of whatever it currently resolves to, so a later re-sync can tell "the owner changed" apart from "we finally matched them," without another CRM round trip. `crm_updated_at` (confirmed present per event, in the list) is what the daily sync compares to notice a correction happened at all.

**Each event attributes independently — installments are never merged back to one "original" salesperson (confirmed intentional, not a bug to guard against).** An `installment_enrollment` event is its own CRM event with its own `lead_owner_id`, exactly as `shikho_purchase_completed` is. First installments and later ones are routinely collected by different teams (an original Telesales sale, a later installment collected by CX/Retention) — each row credits whoever owned the lead at the moment that specific event happened, full stop. `agent_revenue_transactions` has no notion of a "deal" or "original owner" spanning multiple installments and none is added: a course paid in three installments by three different agents produces three rows crediting three different people, and that's correct, not a data quality problem.

**Currency: `cf_amount` is BDT, confirmed.** Stored as the raw BDT figure at ingestion, no conversion — `revenue_amount` is a BDT amount, not a USD one. A versioned `currency_conversion_rates` table (schema_019; same never-edit-in-place, always-superseded pattern as `status_thresholds`, seeded with the confirmed 110 BDT = 1 USD) holds the rate over time; `currency_rate_at(timestamptz)` returns whichever rate was in force at a given moment. Any future USD display must convert each transaction using `currency_rate_at(purchase_created_at)` — the rate active when THAT sale happened — never today's rate applied retroactively, the same "never rewrite history with a later policy change" principle as rubric versions and PIP policy.

```sql
create table agent_revenue_transactions (
  id uuid primary key default gen_random_uuid(),
  crm_event_id bigint not null,              -- unique — the CRM event's own id, the dedupe key
  agent_id uuid references users(id),        -- resolved; null = unmatched (kept, not dropped, for the revenue total)
  lead_owner_crm_id integer not null,        -- the raw CRM id, independent of agent_id — see above
  revenue_amount numeric not null,           -- cf_amount — NOT cf_discounted_amount (confirmed separate field, unused)
  course_name text,                          -- cf_course_name
  crm_lead_prospect_id text,                 -- for a future drill-down to the CRM lead
  purchase_created_at timestamptz not null,  -- the event's created_at
  crm_updated_at timestamptz not null,       -- the event's updated_at — change detection
  last_synced_at timestamptz not null default now(),
  source text not null default 'crm_api' check (source in ('crm_api', 'gsheet')),
  created_at timestamptz not null default now()
);

-- One row per sync job, durable and inspectable in the SQL editor — NOT a
-- local file, because the daily sync genuinely needs a persistent
-- watermark and both jobs read the same CRM data.
create table revenue_sync_state (
  id text primary key check (id in ('backfill', 'daily')),
  cursor_page int,             -- backfill: last completed page (ascending — see below)
  watermark timestamptz,       -- daily: newest event's created_at as of the last successful run
  events_synced bigint not null default 0,
  last_run_at timestamptz,
  last_run_status text check (last_run_status in ('ok', 'error', 'partial')),
  last_run_note text,
  updated_at timestamptz not null default now()
);
```
This feeds `agent_weekly_sales` (§6.3) and PIP candidate suggestion (§6.4) — unchanged from the original plan; only where the rows come from changed.

**Access:** read policies mirror who already sees revenue-adjacent data — QA staff (all), Team Lead (own team, `team_agent_ids()`), Manager (own chain, `manager_chain_ids()`), an agent their own rows. An unmatched row (`agent_id is null`) is invisible to Team Lead/Manager/self scoping by construction — only QA roles see it, which is also where an eventual "needs review" screen belongs. **No write policies for any signed-in role** — written only by the backfill script and the daily sync, both via the service role, same as `write_audit_results()` and the CRM org-sync writes (§10).

**Backfill AND daily sync both page DESCENDING — corrected from the original ascending-backfill sketch.** The first sketch of this design had the backfill page ascending, specifically so a new sale mid-backfill would append at the end and never shift already-fetched pages, keeping a page number a safe resumable checkpoint. That reasoning assumed an unbounded, possibly-long-running backfill. Once scope narrowed to **12 months only** (this round) — with no confirmed date-range query operator (see below, still true) — ascending stopped making sense: there's no way to START at "12 months ago" without a date filter, so ascending would have to page from the CRM's entire event history from day one, burning many more requests than the whole point of the 12-month scope was meant to save. Descending solves this directly: start at today, stop once a page is entirely older than the cutoff — the same direction already proven live for the daily sync. Its downside (a new sale mid-run shifts page *positions*) matters far less for a backfill that's a single short supervised sitting (minutes, not days) with every write an idempotent upsert on `crm_event_id` — replaying a page on resume is always safe, and a full restart is cheap. `revenue_sync_state.cursor_page` is kept as a resume courtesy, not a correctness requirement. Neither job needs a date-range query operator — no reference code anywhere uses one, and none was tested against the live CRM; both are built entirely on confirmed behaviour: ordered pagination, and an empty page as the only reliable "no more data" signal (`meta.pagination.total` came back `0` on a real page of 500 rows — not reliable, never used).

**Superseded for the BACKFILL by an event-ID cursor (2026-09-24, after two live findings).** Page-number paging failed in practice: pages 1–7 (500 rows each) fetched fine, then page 8 timed out on every attempt (30s × 4), and **ordering by `id` did not fix it** (page 8 by id also timed out at 45s) — it is the OFFSET that is slow, whatever the sort key. The API honors cursor filters, so `scripts/backfill-revenue.mjs` always requests `page=1` and moves a cursor. Two cursors were measured read-only, same depth, 500 rows: at the stored boundary **id 3.2s vs date 3.8s**; about six months back **id 0.8s vs date 7.9s** — the date cursor slows as it goes deeper, the id cursor does not, so **the id cursor is used**: `orderBy=id&sortedBy=desc` with `search=type:a,b;id:N&conditions=type:in;id:<` (only events with id < N), next cursor = lowest id on the page — exact, no day-granularity overlap. (The date form `…;created_at:YYYY-MM-DD` + `created_at:<` also works but is date-granular; the rolling form `created_at:15;…` + `created_at:last_n_days` is what the daily sync uses.)
- **Ids do not track creation time exactly:** ~1.1% of events (39 of 3,500 loaded) were created earlier than an event with a *lower* id — mostly 6–24h, worst case 5.5 days (back-dated events). So the id cursor changes only **traversal**, never bucketing — a sales week is decided by the stored `created_at`, full stop — but it needs two margins: the **stop rule** waits for a page whose *newest* `created_at` is 7 days before the 12-month cutoff, and **resume** starts 400,000 ids above the lowest stored id (~9 days; ids run ~45k/day across all event types) so back-dated events just above what date-ordered paging already loaded are re-fetched. Overlap is harmless (upserts). The cursor must strictly decrease or the script stops instead of looping.
- Resume point = the lowest `crm_event_id` in `agent_revenue_transactions` (the table is the source of truth); `--before-id=N` overrides. `revenue_sync_state.watermark` records the oldest `created_at` reached, for inspection.

**CRM timestamps are Dhaka local time, not UTC (found 2026-09-24 — a real bug in the first run).** `created_at`/`updated_at` arrive as zoneless `YYYY-MM-DD hh:mm:ss`. The first backfill run stored them as if UTC, i.e. 6 hours late. Evidence they are Dhaka time: as stored, the 3,500 events are almost absent 01:00–08:00 and peak at 18:00 — a dead zone across the Dhaka daytime; read as Dhaka time it is an ordinary student-purchase day (quiet overnight, evening peak). Effect of the bug: every event after 18:00 Dhaka (~36% of them) landed on the *next* Dhaka calendar day, corrupting the Friday/Saturday sales-week boundary that Zero-Seller depends on. **Code fixed:** `crmTimestamp()` in `scripts/lib/revenue-mapping.mjs` pins a zoneless value to `+06:00` (a value that already carries a zone is left alone), used by both the backfill and the daily sync. **Existing rows:** `supabase/fix_001_crm_timestamps_dhaka.sql` shifts the pre-fix rows back 6 hours, guarded by `last_synced_at` and stamping it so a second run is a no-op — **run it ONCE, before resuming the backfill or letting the sync run, then `select recompute_weekly_sales();`**. Not checked: the same zoneless-string reading may affect *call* times (`calling-histories.started_at`, shown on audits); worth verifying separately.

**Daily sync (sub-step C — built 2026-09-24, not yet deployed or run).** `GET /api/cron/revenue-sync` (`src/app/api/cron/revenue-sync/route.ts`, Bearer `CRON_SECRET`, fails closed if unset; `vercel.json` cron `0 22 * * *` = 22:00 UTC = 04:00 Bangladesh; `maxDuration = 60`) → `runDailyRevenueSync()` (`sync-runner.ts`, production wiring) → `runRevenueSync()` (`src/lib/revenue/sync.ts`, the rules, dependency-injected and unit-tested with no CRM/DB). It **replaces** the earlier "new events + `updated_at` comparison" plan with something simpler, confirmed by the user: every day, fetch the **whole rolling 15-day window** (`created_at:15;type:…` with `created_at:last_n_days;type:in`; it returned events back to the 15th day before today) and **UPSERT by `crm_event_id`** — never delete-then-reinsert, so a failed re-fetch cannot leave a gap. It fetches every page *before* touching the database. The confirmed 4–5 day ownership-correction window is covered with wide margin, and changes to anything in the window apply silently (no approval or notice). Cost ≈ 4–5 requests a day (~1,900 events).
- **Guardrails (approved):** (1) *reuse known owners* — an owner already resolved (`users.crm_agent_id`, or an agent already stored for that owner) costs no CRM lookup; an owner already stored as unmatched is not re-asked daily; only genuinely new owner ids are looked up, capped at 25 per run and within a 40s budget; an unmatched stored row is upgraded for free once its owner becomes known (roster grew). (2) *never overwrite a matched agent on a failed lookup* — a timeout is not "no match": a failed/skipped lookup on an owner change keeps the stored owner and agent exactly as they were (retried next run); a failed lookup on a NEW event stores it unmatched and the rematch script heals it. Matching itself is the app's existing pipeline (`resolveAgentForCall`, which already reports `lookupFailed` separately from "no such person") — no new matching logic. (3) *`recompute_weekly_sales()` runs at the end*; every outcome is written to `revenue_sync_state` id `daily` — `ok`, `partial` (window not fully fetched, or the recompute failed — the data is still upserted), or `error` (fetch failed; nothing written) — with a note of counts and problems. Check it with `select * from revenue_sync_state;`.
- **Flag, do not delete (schema_023):** a run that fetched the complete window flags events that stopped appearing (`missing_from_crm_since`, set once; `last_seen_at` refreshed on every sighting; cleared automatically if the event reappears) — likely a cancellation/refund, but **we do not know that and do not guess**: nothing is deleted, amounts are untouched, flagged rows keep counting until a person decides. Only events created within the last 13 days are eligible (the window edge is fuzzy), and nothing is flagged after an incomplete fetch. Review list: `select * from revenue_events_missing_from_crm;` (operator view, service role / SQL editor only).
- To go live: apply schema_023 (and fix_001, once); set `CRON_SECRET` (Secret type) on Vercel; deploy. It needs a valid CRM token — a short-lived JWT that has expired between sessions more than once — so a stale token shows as a 401 in `last_run_note`, not a silent gap.

**Backfill scope: last 12 months only, not full history** — confirmed sufficient for every reporting feature this unblocks (PIP, Zero-Seller, weekly/monthly revenue); deeper history can be a second, equally supervised backfill later if that ever changes. **Manual, supervised, once** — the tech team warned heavy request volume can affect the CRM (~300 active agents, 300+ sales/day; CRM traffic is heaviest 10 AM–9 PM BD, safe window 9 PM–5 AM BD). The backfill is run by hand, during that window, in one sitting, with the user present — never unattended, at least for this first run. The daily sync's cron is scheduled early in the same window (~4–5 AM BD = ~22:00–23:00 UTC) — light enough (new events + a ~10-day recheck) not to need the same caution.

**Sub-step B (`scripts/backfill-revenue.mjs`, standalone, built) — status: script works, live-confirmed, but the request/time estimate is on hold pending one business question.**
- **The multi-type query is now confirmed live, not just by source-code cross-check** — `search=type:shikho_purchase_completed,installment_enrollment&conditions=type:in&join=and&...` fetched 500 real events on 2026-09-23 without error.
- **Measured combined throughput is much lower than the tech team's 300+/day figure**: that one page of 500 events spanned ~4 days (oldest event ~2026-09-19), implying roughly ~125 events/day combined — barely above the single-type-only estimate (~117.5/day) from before `installment_enrollment` was added. At that rate, 12 months of `/events` pagination alone would need only ~90–100 requests, well under the original ~519-request estimate. This throughput gap (~125/day measured vs ~300+/day stated) is unexplained and separate from the event-type-scope question already resolved above — flagged, not chased further without the user's input.
- **The dominant cost is NOT `/events` pagination — it's per-event agent matching, and the measured match rate is alarmingly low: 2 matched out of 500 (0.4%) on that same live page.** Nearly every event's `lead_owner_id` triggered a fresh CRM `/users/{id}` lookup (nothing pre-cached in `users.crm_agent_id` — expected, since this is the first time anything has looked up a revenue lead-owner id rather than a call's `created_by` id) and most of those lookups still didn't resolve to a `users.email` match. **This is an open business question, not something to guess past:** is it expected that most revenue `lead_owner_id`s (particularly on `installment_enrollment` events, often collected by CX/Retention) don't yet correspond to a `users` row in this QA system? If so, the 12-month backfill's real bottleneck is this matching pipeline (~800ms per distinct unmatched lookup — a page like the one measured took ~2 minutes, almost entirely on this, not the event fetch itself), and the request-count/time estimate needs to be rebuilt around that, not around `/events` pagination. Unmatched rows are still written (`agent_id = null`, revenue total preserved, §"Access" above already covers this — QA-only visibility, a future "needs review" screen), so nothing is silently lost either way; the concern is purely about the backfill's running time and how much of the revenue ends up per-agent-attributable vs. not.
- **First live run (2026-09-23, supervised) — PARTIAL, paused by the user.** 3,500 events written (pages 1–7, ~2026-09-01 → 2026-09-23), 499 matched to an agent (14.3%), the rest stored unattributed (`agent_id = null`). Stopped on the page-8 timeouts above; nothing corrupted, nothing to undo. The script was redesigned to an id cursor (above) but **has not been re-run** — waiting for the user's explicit go in the next supervised 9 PM–5 AM BD session, after schema_023 and the one-time timestamp fix (fix_001) are applied, resuming from the lowest stored id. Also added: `crmFetch` retries transient timeouts/5xx up to 3 times (4xx like an expired token fail immediately). Roughly 3 weeks of the 12 months are loaded.
- Offline-tested (26 unit tests, `scripts/lib/revenue-mapping.mjs` — pure event→row mapping, no live CRM/DB) and live-smoke-tested (one real page, dry run, no writes). Not yet run with `--live`; holding for the user's explicit go-ahead as agreed, and now also for their answer on the match-rate question above, since that changes the running-time estimate materially.

**Resolved (2026-09-23):**
- **Event type scope** — both `shikho_purchase_completed` and `installment_enrollment` are in scope, confirmed by the user. Each event attributes independently (no merging installments to one "original" salesperson) — confirmed intentional. See the multi-type query and the independent-attribution note above.
- **Currency** — BDT, confirmed. See the currency table above.
- **Live confirmation of the multi-type `/events` query** — done, see sub-step B above.

**Still open (do not guess — ask before Part B's live `--live` run depends on the answer):**
- **Agent-match rate on revenue events.** See sub-step B above — the single most important open question right now, since it may mean the backfill takes materially longer than the original estimate assumed.
- **Request delay / rate limit.** No `X-RateLimit-*` or `Retry-After` header was ever observed on any response — genuinely no signal. A conservative, configurable default (~750ms–1s between requests) is proposed (`scripts/backfill-revenue.mjs --delay-ms`); the user hasn't yet confirmed or adjusted it.

---

## 9. Audit Targets, Holidays, Priority Ranking & Discontinuation

```sql
create table audit_target_rules (
  id uuid primary key default gen_random_uuid(),
  vintage_slab_id uuid references vintage_slabs(id),   -- nullable — see 'stage' below
  stage text check (stage in ('ojt','re_training')),    -- exactly one of vintage_slab_id / stage is set
  team_name text,                       -- null = all teams
  weekly_audit_target int not null,
  effective_from timestamptz default now(),
  effective_to timestamptz,
  created_by uuid references users(id)
);

create table holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null,
  name text not null,
  site_name text,                       -- null = all sites
  created_by uuid references users(id),
  created_at timestamptz default now(),
  unique (holiday_date, site_name)
);

create table agent_weekly_audit_target (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references users(id),
  week_start date not null,             -- sales week, Saturday
  base_target int not null,             -- from vintage/team/OJT rule
  bonus_applied boolean not null default false,     -- red / pip / zero-seller (any combo → same +1)
  bonus_reasons text[],
  holiday_adjusted boolean not null default false,
  target_frozen boolean not null default false,      -- true once agent is discontinued mid-week
  adjustment_reason text,
  final_target int not null,
  computed_at timestamptz default now(),
  unique (agent_id, week_start)
);
```

### 9.1 Week & counting rule (confirmed)
Sales week = Saturday–Friday. **Every audit counts into whichever sales week its date falls in** — no special-case logic needed; a Saturday audit naturally lands in the week that starts that day, a Friday audit in the week that ends that day. Same `sales_week(date)` function used for Zero-Seller.

### 9.2 Bonus rule (confirmed)
If an agent is Red **or** PIP **or** Zero-Seller (any one, or all three) → **+1 audit** for the week, never stacked.

### 9.3 Priority ranking (confirmed tier order)
1. **Critical fatal error in trailing period** → top of list, unconditionally
2. **Active PIP status** → above non-PIP within the same tier
3. **Zero-Seller streak length** → longest streak first
4. **RYG status** → Red, then Yellow, then Green
5. **Revenue achievement %** → lowest first (final tiebreaker)

### 9.4 Holiday target adjustment (confirmed algorithm)
1. `adjusted_total = round(sum(base_targets) × available_working_days / normal_working_days)`
2. Every agent keeps a **floor of 1 audit**, no exceptions
3. The shortfall is absorbed by trimming audits from the **bottom of the priority list first** (Green, healthy revenue, no flags) — working upward only if still short
4. Red / PIP / Zero-Seller / low-revenue-achievement agents keep their full target as long as mathematically possible

### 9.5 Mid-cycle discontinuation (confirmed)
When an agent's `employment_stage` flips to `discontinued` mid-week, their current week's `agent_weekly_audit_target.final_target` freezes at whatever's already completed (`target_frozen = true`, `adjustment_reason = 'agent_discontinued'`) — no further audits owed for the rest of that week. Since a QA auditor's weekly total is a sum across their assigned agents' `final_target` values, this **automatically reduces the auditor's total** with no separate adjustment step.

Auditors see: daily target, weekly target, agent-wise breakdown, channel-wise breakdown — all derived from `agent_weekly_audit_target`, no separate reporting table needed.

---

## 10. CRM Call-History Integration

QA discovers relevant leads in **Metabase**, using their own filters (agent, TL, duration, course, lead stage, etc.) — that step stays external and manual for v1. Once QA has a lead ID or lead URL, this system takes over:

1. QA pastes a lead ID (`12345`) or a full URL (`crm.shikho.com/leads/12345`) — a parser normalizes either to the numeric ID
2. System calls the CRM API for that lead's call history and shows it as a list — date, duration, agent, and an **audit status per call**: `available` / `in_progress_mine` / `taken` (another QA has it open) / `audited` — cross-checked against our own `audits` table by `crm_call_id`
3. QA clicks a call → opens the audit screen, pre-loaded with lead + agent + call info, recording streamed in-place (never downloaded/stored — keeps this on the free tier)
4. QA scores it; the structured fields in §4 (`crm_lead_id`, `crm_call_id`, `call_recording_url`, etc.) get populated

**Reference API (confirmed from the tech team's code, adapted for our own backend, not reused as-is per the stack decision above):**
- Base URL: `crm-api.shikho.com/api/v1`
- Auth: `Authorization: Bearer <CRM_BEARER_TOKEN>` (a server-side secret, called only from our backend, never exposed to the browser) plus a required `X-Log-Ref-Id` header. The CRM rejects a missing/malformed one with 400 and checks only the **shape**: exactly four hyphen-separated parts, `{serviceName}-{clientName}-{userId}-{timestamp}` (its example: `crm-web-240-273492392`). We send `shikho-qa-<signed-in users.id with hyphens stripped>-<ms>` (`buildLogRefId` in `src/lib/crm/client.ts`), so a CRM-side log line traces back to the QA person who opened a customer's calls; `system` stands in when no user is behind the request. **Never put a raw UUID in the userId slot** — its four hyphens make eight parts and the CRM answers 400. `getCallsForLead` / `getCallById` take the actor id as a required argument, so every caller has to say who the request is for.
- `GET /leads/{leadId}` — lead profile
- `GET /calling-histories?search=lead_id:{leadId}&...` — call list for a lead
- `GET /calling-histories/{callId}` — single call by ID

**Matching a call to one of our users — via the CRM user's email, never the display name.** A call's `created_by` is only `{ id, name, status_id, deleted_at }` and `name` is a *display name* ("First Last"), not the email. The agent's email (the CRM login = our `users.email`) comes from `GET /users/{created_by.id}` (`getCrmUser`; the record also has `employee_id`, `reporting_to`, `role`, `mobile` — we keep only what we need). `agent-matching.ts` matches `users.crm_agent_id = created_by.id` first, else asks the CRM for the email, matches `users.email`, and caches `crm_agent_id` (only where it's still null). The same lookup backs the Team Lead ownership check (`findCallOwner`), which fails closed. (Until this was fixed, both compared the display name to `users.email`, so nothing ever auto-matched and no Team Lead could have started an audit.) When there's no match, the call list shows **"CRM says: name · email — …"** so QA knows who to pick, or that the person has no profile yet (`describeUnmatched` in `src/lib/audits/crm-agent.ts` distinguishes: no profile / CRM has no email / CRM lookup failed / CRM named nobody).

**Org data vs the CRM's reporting line (informational).** The CRM keeps agent → Team Leader → Manager (`GET /users/{id}` returns `reporting_to: { id, name }` — no email — and the person it points at has role "Team Leaders" / "Managers"). We compare it with ours at two levels: an agent's `team_leader_id`, and a Team Lead's `manager_id`. What the CRM said is remembered on the user row (`crm_reporting_to_id/_name/_email`, `crm_org_checked_at`, schema_010; system-written like `crm_agent_id`) and re-asked only when a **matched** agent comes up on the call list and that check is >24h old — opportunistic, **no scheduled sweep**. Sync status is *not* stored: it's computed at read time from the stored CRM view vs our current assignment (`compareLink` / `orgSyncByUser` in `src/lib/crm/org-compare.ts`), so correcting our data in Users clears the flag with no CRM call. The Manager level only runs for OUR Team Leader and only once we know their CRM id (learned when the CRM's Team Leader is provably ours by email), so it never asks about the wrong person. Surfaces: one amber banner above the call list (`OrgSyncBanner`), an "Out of sync with CRM" badge + filter on the Users screen, and a note in the user edit form. It is **information only — it never blocks or alters an audit**, and any CRM failure yields no note rather than an error. The CRM is not treated as authoritative; the fix is to correct our data (or the CRM's) by hand.

**CRM call times are Dhaka local time, not UTC (confirmed 2026-09-24 — same bug as the revenue timestamps, §8).** A call's `started_at` / `ended_at` are zoneless `YYYY-MM-DD hh:mm:ss` in Dhaka time. Evidence: the recorder's own filename timestamp (`server3-…-20260923-043239.mp3`, UTC) is exactly 6 hours before `started_at` on every RECENT call checked — but not on old ones: an Oct-2025 recording was stamped in Dhaka local time, so the filename is a good check for recent calls only. The definitive check is against the CRM itself: after fix_002, every stored call time was compared with the CRM's own `started_at` (read as Dhaka) and all 24 audits matched exactly. `startAudit` had stored them as UTC (6 hours late in `audits.call_started_at`/`call_ended_at`) and screens formatted them with `toLocaleString()`, which prints whatever timezone the machine is in (UTC on Vercel). Fixed: `crmTimestamp()` / `parseCrmTime()` in `src/lib/crm/time.mjs` (one definition shared by the app and the scripts) pins the zone at ingestion and when the call list parses raw CRM values; `formatDhakaDateTime()` / `formatCrmDateTime()` (`src/lib/dates/format.ts`) always print Dhaka time. **Existing audits:** `supabase/fix_002_call_times_dhaka.sql` — a check query (compares each stored time to its recording filename: ~6 hours apart before the fix, ~0 after), then the fix, guarded by `created_at` and by a run-once row in `audit_log`. Not yet applied.

**Call status colours (brand palette only):** `Answer` → Primary Indigo (`--brand`), `No Answer` → Alert Coral (`--alert`), via `callStatusPresentation()` (`src/lib/crm/call-status.ts`) and `CallStatusPill`; any other status the CRM might send shows neutrally with its own text rather than borrowing a colour that would imply a meaning we haven't been given.

**What the CRM actually returns (checked 2026-09-24, field names only):** a `calling-histories` item has **no nested `lead` object** (the old types/sample said it did — so the lead header and the audit page's `getCallById` lead lookup have been returning nothing). Lead data comes from `GET /leads/{id}`: `lead_stage {id,name}`, `last_dist_name` (the distribution list, may be null), `latest_task {id,name,task_priority,started_at,lead_id}`, `latest_called_at`, `owner`, `owner_assigned_at`, `mobile`, `name`, `product`, … `GET /tasks?search=lead_id:N&conditions=lead_id:=&join=and&…` exists and **honours the lead filter** (~350ms): each task has `id`, `name`, `created_at`, `started_at`/`ended_at` (scheduled), `task_status`, `assign_to {id,name,email}`, `lead_id`, and `created_by` (often null). `GET /leads/{id}/tasks` is a 404. Timestamps in these responses are zoneless (and some use a 12-hour `hh:mm:ss am/pm` form) — treat as Dhaka local like the rest.

**Recordings — `recording_url` is a filename, not a URL.** The CRM returns e.g. `server3-1789805655.26873-20260918-153012.mp3` (empty for unanswered calls); the field name is misleading and the API exposes no playable address. Playback therefore goes through our own proxy, `/api/audits/[id]/recording` (`src/lib/crm/recording.ts`), which builds the address from `CRM_RECORDING_BASE_URL` (+ optional `CRM_RECORDING_AUTH=bearer`), supports Range requests, streams without storing, and only lets people who can already see the audit hear it (RLS). It accepts only a strict filename pattern — never a URL — so it can't be pointed at internal hosts, sends the CRM token only to the configured host (never across a redirect), and refuses to stream a non-audio response (e.g. a login page). `startAudit` re-fetches the call from the CRM server-side and stores that, never a browser-supplied call object. The live call object uses `destination_number` (not `destination`) and also carries `duration` (seconds), `call_type`, `service_provider`, `provider_history_id`.

**Still needed from the tech team:** the full field list `calling-histories` accepts for filtering (beyond `lead_id`) — confirmed the same underlying data Metabase draws from, which is what makes the roadmap item below possible.

**Roadmap (not v1):** since the CRM API can filter the same way Metabase does, QA's manual Metabase lookup step could eventually be replaced by calling `calling-histories` directly with broader filters (agent/TL/duration/course/lead stage) — same integration already being built, just more parameters. `sampling_queue.source = 'system'` is reserved for this. This avoids adding Metabase as a second, separate integration later.

```sql
create table crm_event_outbox (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references audits(id),
  event_type text not null default 'audit_completed',
  payload jsonb not null,        -- score, pass/fail, fatal flags, lead/student reference
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  attempts int not null default 0,
  created_at timestamptz default now(),
  sent_at timestamptz
);
```
Sending audit results *back* to the CRM (as events tied to a lead) stays scoped but not built — this outbox table queues completions immediately so no rework is needed once that integration is greenlit.

---

## 11. Dashboards by Role

**Agent (Counselor):** last & this-week audits, score trend, per-parameter breakdown, fatal errors (if any), upcoming/past briefings, dispute status, own PIP/status if applicable

**Manager:** rolled-up performance across every Team Lead reporting to them and all agents under those Team Leads — a compiled overview plus a Team-Lead-by-Team-Lead breakdown (drill down to agents), for a chosen sales week / last 30 days. Scoped to their own chain (§2). Built on submitted audits so far; RYG status, target coverage, zero-seller and revenue rollups get added as Steps 6, 7 and 10 create that data. `super_admin`/`qa_manager` can view any manager's dashboard.

**Team Lead:** team coverage vs target, team avg score + trend, agent-level RYG + Vintage view, fatal incidents, briefing attendance, own audit queue (can audit own team)

**QA Auditor:** daily/weekly target (agent-wise, channel-wise), priority-sorted sampling queue, lead call-history lookup, calibration sessions, dispute queue

**QA Manager / Super Admin:** QA performance ranking, QA:agent ratio & calibration consistency, parameter-wise error trend (WoW), revenue/briefing impact, PIP & Zero-Seller matrices, rubric/policy administration, holiday calendar, **OJT Management view**

**Analytics — cross-cutting requirement, not a separate role:** every dashboard's underlying data supports slicing by **site, team/channel, agent, QA auditor, and Team Lead** — these are all first-class columns on `users` (§2) and referenced throughout the schema, so parameter-wise / site-wise / agent-wise / QA-wise / TL-wise breakdowns are query filters, not separate tables.

---

## 12. Phase 1 Build Plan (for Claude Code)

Build strictly in this order. **Stop after each numbered step and wait for confirmation that it's tested before starting the next one.**

1. **Foundation** — Next.js scaffold, Supabase project, auth, RBAC, brand theme (reuse CMS setup)
2. **Rubric admin** — CRUD for rubrics/categories/parameters/error attributes/fatal lists; seed the 3 confirmed rubrics
3. **CRM call-history integration** — lead ID/URL parser, backend proxy route, call-list view with audit-status enrichment, in-place recording player
4. **Audit workflow** — create/score/submit audit, binary scoring engine, critical-fatal auto-zero, root-cause tagging
5. **CAPA + disputes** — re-audit linkage, dispute workflow
6. **Sampling + priority engine** — implement the 5-tier ranking (§9.3) and holiday-adjusted targets (§9.4)
7. **Status engine** — RYG computation, vintage lookup, zero-seller streak tracker (Sat–Fri week logic)
8. **OJT & Re-Training module** — state machine, OJT Management view, target rules (§7)
9. **PIP module** — policy admin, monthly cycle generation, candidate suggestion, TL feedback, training tracking
10. **Revenue import** — Google Sheet → `agent_revenue_transactions`, weekly aggregation job
11. **Briefings + calibration** — slot booking with capacity limits, calibration session scoring
12. **Dashboards** — build all role views (§11), with site/team/agent/QA/TL filtering throughout
13. **CRM outbox table** — created but inert (§10)

---

## 13. Explicitly Deferred (not v1)

- Metabase-replacement via CRM API filters for automated sampling (§10 roadmap note)
- Outbound CRM event delivery — table exists, no sender
- AI-assisted call transcription/audit — Phase 3 per the competitive benchmark roadmap

---

## 14. Lessons Learned (CMS build + this project)

These bit us. Don't repeat them:

- **A plain (non `security definer`) RLS helper function that queries table X, used inside table X's own policy, causes infinite recursion** — the function's internal query re-triggers the same policy, which calls the function again, forever (Postgres raises "infinite recursion detected in policy for relation ..."). Hit this on `current_app_user_id()` / `current_app_role()` in Step 1 — a bad function definition, not an actual inactive account, produced the misleading "Your account is inactive" login error. Fix: any helper function that queries a RLS-protected table and is called from that table's own policy must be `security definer` with `set search_path = public` locked down, plus `revoke ... from public` / `grant execute ... to authenticated`. Watch for this again wherever a new helper function is added that looks up something from `users` (org-chart checks in Step 6/8 are the likely next spot) or from any other table with self-referencing policies.
- **A role `switch` with a `/dashboard` default redirects forever for any role it forgot.** `getPostLoginRedirect` sends users to `/dashboard`, which calls it again — a role with no case loops. It now ends in a `never` exhaustiveness check so adding a role without a home page is a compile error. When adding a role, also update the `users_role_check` constraint, `middleware.ts` `ROLE_ROUTES`, `LoginPage` redirect, `AppShell` labels and `USER_ROLES`.
- **An RLS policy with no `TO` clause applies to `anon` too — and the anon key ships in the browser.** Step 2 wrote its rubric read policies as `using (true)` with no role, so anyone with the public key could read every rubric, scoring criterion and fatal-error list (verified against a Postgres replica of the migrations, not assumed). schema_011 restricts them `to authenticated`. Every new read policy must say `to authenticated`; a `for all` write policy that calls `current_app_role()` makes anon fail with a permission error, which is safe but is not a substitute for scoping the read policy.
- **Don't mix a shorthand style with its long-hand overrides in a React `style` object** (`border` + `borderColor`/`borderWidth`). React warns ("can lead to styling bugs") and can mis-apply the border when the state changes — which matters where the colour *is* the feedback (the scorecard's pass/fail borders). Use long-hand properties throughout any base style that gets overridden per state. Also watch the Next dev overlay's "N Issue" badge: it was the only sign of this.
- **Don't fetch a value a second time when the page already has it — and never let a failed read look like an empty result.** The result screen took `overall_feedback` from a separate query in the scorecard loader although the `audits` row it had already loaded carried it; a failure of that second read would have shown "nothing" with no error, while the status and score beside it looked fine. `loadScorecard` now takes the value from the audit row and **throws** (and logs) if any of its reads errors — a silently empty scorecard is worse than an error, because "saving" it would overwrite a real draft with emptiness.
- **Before widening a shared `SECURITY DEFINER` helper's trust for one new caller, check every OTHER caller it already has.** Giving a QA Auditor unrestricted Campaign Report access seemed to need widening `manager_chain_ids()`'s "who may look up someone else's chain" check — but that function also backs `manager_agent_stats()` (the Manager Dashboard), so the same edit would have quietly handed a QA Auditor the Manager Dashboard's detailed per-agent stats too, which nobody asked for. Caught by re-reading the helper's call sites before shipping, not by a test. Fix: don't widen a shared helper for one caller's sake — duplicate the small piece of logic that specific caller needs (`campaign_report_scope()`, §4 Part B3), so the blast radius is exactly the one thing being changed.
- **A scoping filter applied AFTER `distinct` doesn't do its job — filter first, then collapse.** `campaign_report_participants()` (schema_017) joined an auditor's every scoped-and-unscoped audit, took `distinct(auditor_id, agent_id)`, then filtered by agent scope — so an auditor who'd audited two agents in scope came back twice. Move the scope condition into the subquery that feeds `distinct`, so the row is collapsed to one per auditor only after the filter has already narrowed it. (Caught by the test suite, not by review — same lesson as the trigger one below: write the randomized/edge-case test, don't just eyeball the query.)
- **One trigger function shared by two tables can't reference a column only one of them has.** `campaign_parent_is_fixed()` tested `tg_table_name` before reading `new.campaign_id`, but plpgsql doesn't short-circuit — it failed with 'record "new" has no field' on the other table. Write one function per table. (Caught by the PGlite suite, not by review.)
- **When two tables can be joined by more than one path, name the foreign key in the PostgREST embed.** `audit_campaign_answers` links both checks and options, giving `campaign_check_types` → `campaign_check_values` a second (many-to-many) path besides the direct foreign key; PostgREST refuses to guess. `campaigns.service.ts` embeds with explicit `table!fk_name(...)` hints. The same applies to any later embed across these tables.
- **Run the migration before the code that calls it — and expect the old page to keep working through the gap.** schema_016 adds an 8th argument to `write_audit_results` (with a default, and the old 7-argument function dropped, not overloaded). New code sends `p_campaigns`; an older page open in a browser tab sends none, so the function treats `null` as "leave the stored campaign links alone" instead of wiping them. Any argument that means "replace the whole state" needs a distinct "not provided" value like this.
- **When a migration changes a function's signature, `drop` the old one first — and apply the migration BEFORE deploying the code that calls the new one.** `create or replace` with different arguments silently creates an *overload*, so the app could keep calling a version that ignores the new input (here: one that would save a scorecard without feedback). schema_012 drops the 6-argument `write_audit_results` and adds the 7-argument one with `p_overall_feedback text default null`; the server action now sends that argument, so running the SQL first matters.
- **A component that starts something with side effects (the microphone) must stop it on unmount.** The scorecard shows and hides fields as you work (a parameter's feedback box disappears when it's set back to Pass); the CMS copy of `VoiceInputButton` would have kept listening behind a field that no longer exists.
- **A form that must not lose work needs a Save + an unsaved-changes guard.** The scorecard saves a draft explicitly and warns on leaving with unsaved changes (`beforeunload`).
- **Server actions must return `{ ok, error }` objects, not throw.** Next.js replaces the message of an error thrown from a server action with a generic one in production builds, so a thrown `Error('No rubric is mapped…')` shows fine in `next dev` and turns into an opaque failure on Vercel. The user-management actions (`src/lib/users/actions.ts`) follow the result-object pattern; the Step 2/3 actions (`src/lib/rubrics/actions.ts`, `src/lib/audits/actions.ts`) still throw and need converting before deploy.
- **A DB migration that adds a column read by `middleware.ts` must be applied before the code that reads it.** Middleware now selects `users.must_change_password` on every page request; if the column doesn't exist, the profile query fails, the role check treats it as "no role", and every protected route redirect-loops through `/dashboard`.
- **`current_time` is a reserved word in Postgres** — never use it as a column name.
- **`RETURNING id` inside a `DO` block needs `RETURNING id INTO variable_name`** — bare `RETURNING id` is a syntax error outside a query context.
- **Next.js 15 dynamic route params must be awaited** — `params` (and `searchParams`) are now `Promise`s in route handlers and page/layout components.
- **Vercel Hobby cron jobs run at most once per day**, regardless of the schedule expression — don't design anything (e.g. the weekly aggregation job in §12 step 10, or `crm_event_outbox` delivery) assuming finer granularity on Hobby.
- **Environment variables: default to Config type; use Secret type only for things like the Supabase service role key and the CRM API token.** Secret-type values can't be read back later — set them carefully and record them somewhere safe outside Vercel if you need to double check them.
- **`node_modules/` and `.next/` must be in `.gitignore` before the first commit.**
- **Use `exceljs`, not `xlsx`, for any Excel file handling** — `xlsx` has unpatched CVEs.
- **A zoneless timestamp from an API is not automatically UTC — check the shape of the data, do not assume.** The CRM's `created_at` (`YYYY-MM-DD hh:mm:ss`, no zone) is Dhaka local time; storing it as UTC pushed ~36% of events onto the next calendar day and would have quietly corrupted the Friday/Saturday week boundary. Caught by looking at the hour-of-day distribution of what was loaded (quiet 01:00–08:00 and an 18:00 peak only make sense as Dhaka time), not by any test. Pin the zone explicitly at ingestion (`crmTimestamp()`), and sanity-check a new time source against when its events plausibly happen.
- **Offset (page-number) pagination degrades with depth on this CRM — page a cursor instead.** Page 8 × 500 rows timed out on every attempt, and changing the sort key did not help; the OFFSET is the cost. A cursor filter (`id:<N`) stays fast at any depth. Measure before assuming which cursor is better (id vs date differed 10× at depth), and note that ids do not perfectly track creation time (back-dated events), so an id cursor needs stop/resume margins.
- **Slow pages here are usually round-trip COUNT, not slow calls — measure, then count sequential awaits.** Profiled 2026-09-24: a CRM call is ~200–400ms and a database round trip ~90–320ms, so no single call was slow; the lead-lookup → Start Audit → audit page flow was slow because it stacked ~13–15 sequential round trips, several of them redundant. Fixed: `getAuthUser` is wrapped in React `cache()` (it cost two network round trips and ran 3–4× per page render); independent loads run in `Promise.all` (agent list alongside the CRM call; scorecard alongside coaching history; rubric mappings alongside the owner lookup); a lead's calls are matched per DISTINCT agent, not per call; Start Audit fetches the one call (`getCallById`, verified to carry every field it needs, and checked to belong to the lead) instead of re-fetching the whole call list; the audit page no longer calls the CRM for a `lead` object the CRM stopped returning. And a slow page must still SAY it is working: `loading.tsx` on `/audits/leads/[leadId]` and `/audits/[id]`, and instant pending states on the lookup and Start Audit buttons. When adding a page, don't `await` independent things one after another, and don't add a per-row query for something that repeats across rows.
- **Test all SQL in the Supabase SQL Editor before putting it in code.**

---

## 15. Brand Guidelines

| Name | Hex | Use |
|---|---|---|
| Primary Indigo | `#304090` | Primary actions, nav, headers |
| Accent Magenta | `#C02080` | Secondary accents, highlights |
| Highlight Sunrise | `#E0A010` | Warnings/attention, RYG-Yellow adjacent accents |
| Alert Coral | `#E03050` | Errors, destructive actions, RYG-Red |
| Paper White | `#FFFFFF` | Backgrounds |
| Dark Ink | `#0F1322` | Text, dark surfaces |

- **Rounded corners everywhere** — minimum 8px, prefer 12px, on cards/buttons/inputs/modals.
- **Typography:** Poppins for English UI text, Hind Siliguri for Bangla text.
- **Icons:** Tabler Icons.
- Reuse the CMS's theme setup (`Brand/` assets, Tailwind config, font loading) as the starting point rather than rebuilding from scratch.
