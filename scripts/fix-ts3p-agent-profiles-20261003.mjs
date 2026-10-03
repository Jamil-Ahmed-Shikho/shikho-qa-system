// ============================================================
// Fix 8 TS3P agents whose profiles were auto-created by the historical
// audit import (2026-10-01) as "departed" Telesales/Dhaka profiles — their
// emails weren't in the real roster at the time, so import-historical-
// audits.mjs's fallback path created them inactive/discontinued, team
// guessed as 'Telesales'/'Dhaka'. Jamil confirmed (2026-10-03) all 9 are
// real, currently-active TS3P agents; he'd already fixed one (Arifa Islam
// Samia) by hand via the Users UI. This applies the same correction to the
// other 8, using her already-corrected row as the template (team=TS3P,
// site=Dhaka, same Team Lead/QA Auditor — both already real users).
//
// Their historical AUDITS need no change — audits.agent_id is unchanged,
// and audits never store a frozen copy of the agent's team/site (always a
// live join to users), so every report/email already reads the corrected
// team the instant this runs. What DOES need a refresh: agent_current_status
// (RYG) and agent_weekly_sales/agent_zero_seller_status were computed with
// these agents EXCLUDED the whole time (discontinued, joining_date null —
// both disqualifying) — run recompute_weekly_sales()/compute_agent_status()
// after this (done via the live revenue-sync cron route, which runs both).
//
// NOT done here, by decision: account_status stays 'profile_only' (no
// login, no email) for all 8 — Jamil activated Arifa's login himself, as
// its own deliberate step (§2's standing rule: never activate a login as a
// side effect of something else). Flagged separately, not assumed.
//
//   node --env-file=.env.local scripts/fix-ts3p-agent-profiles-20261003.mjs            (dry run)
//   node --env-file=.env.local scripts/fix-ts3p-agent-profiles-20261003.mjs --live     (writes for real)
// ============================================================
import pg from 'pg'

const LIVE = process.argv.includes('--live')
const TEAM_LEADER_ID = '5619661e-8c82-4258-937a-5fa11eb1463b' // zahid.hasan@issl.com.bd, team_lead, TS3P/Dhaka
const QA_AUDITOR_ID = 'a570f39d-9b26-4892-b8e3-970ca37c5f17'  // naznin.mitu@issl.com.bd, qa_auditor, TS3P/Dhaka

const AGENTS = [
  { email: 'jahidulhasaneftyissl@gmail.com', empId: '10818', joiningDate: '2026-07-20' },
  { email: 'safayet.issl2@gmail.com', empId: '10837', joiningDate: '2026-07-30' },
  { email: 'nishatmoni.issl@gmail.com', empId: '10816', joiningDate: '2026-07-19' },
  { email: 'issljeimy@gmail.com', empId: '10809', joiningDate: '2026-07-07' },
  { email: 'saikhul999.issl@gmail.com', empId: '10918', joiningDate: '2026-08-06' },
  { email: 'niloy17issl@gmail.com', empId: '10917', joiningDate: '2026-08-22' },
  { email: 'yeasminrimu.issl@gmail.com', empId: '10967', joiningDate: '2026-09-22' },
  { email: 'tanishamitu.issl@gmail.com', empId: '10968', joiningDate: '2026-09-22' },
]

console.log(LIVE ? '=== LIVE — writing to the database ===' : '=== DRY RUN — no writes ===')

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL })
await client.connect()

// Verify every precondition before touching anything.
const tl = await client.query(`select id, role, team_name, site_name from users where id = $1`, [TEAM_LEADER_ID])
const qa = await client.query(`select id, role, team_name, site_name from users where id = $1`, [QA_AUDITOR_ID])
if (tl.rows[0]?.role !== 'team_lead') throw new Error('Team Leader id does not resolve to a team_lead role — stopping.')
if (qa.rows[0]?.role !== 'qa_auditor') throw new Error('QA Auditor id does not resolve to a qa_auditor role — stopping.')

const empIds = AGENTS.map((a) => a.empId)
const collisions = await client.query(`select email, emp_id from users where emp_id = any($1::text[])`, [empIds])
if (collisions.rows.length) throw new Error(`emp_id collision(s), stopping: ${JSON.stringify(collisions.rows)}`)

const current = await client.query(
  `select id, email, name, team_name, site_name, is_active, employment_stage, account_status, joining_date
   from users where lower(email) = any($1::text[])`,
  [AGENTS.map((a) => a.email.toLowerCase())]
)
if (current.rows.length !== AGENTS.length) {
  throw new Error(`Expected ${AGENTS.length} matching users, found ${current.rows.length} — stopping.`)
}
for (const row of current.rows) {
  if (row.account_status !== 'profile_only' || row.is_active) {
    throw new Error(`${row.email} is not in the expected pre-fix state (profile_only, inactive) — stopping rather than overwriting something already changed.`)
  }
}

console.log(`\nWill update ${current.rows.length} users:`)
for (const row of current.rows) {
  const a = AGENTS.find((x) => x.email.toLowerCase() === row.email.toLowerCase())
  console.log(`  ${row.name} (${row.email}): team Telesales->TS3P, site ${row.site_name}->Dhaka, emp_id null->${a.empId}, joining_date null->${a.joiningDate}, discontinued->active, inactive->active`)
}

if (!LIVE) {
  console.log('\n--dry-run: no writes performed. Pass --live to actually update.')
  await client.end()
  process.exit(0)
}

await client.query('BEGIN')
try {
  for (const a of AGENTS) {
    const res = await client.query(
      `update users set
         team_name = 'TS3P',
         site_name = 'Dhaka',
         emp_id = $2,
         team_leader_id = $3,
         quality_auditor_id = $4,
         joining_date = $5::date,
         employment_stage = 'active',
         is_active = true
       where lower(email) = lower($1)`,
      [a.email, a.empId, TEAM_LEADER_ID, QA_AUDITOR_ID, a.joiningDate]
    )
    if (res.rowCount !== 1) throw new Error(`Expected to update exactly 1 row for ${a.email}, updated ${res.rowCount}`)
  }
  await client.query('COMMIT')
  console.log(`\n=== LIVE: ${AGENTS.length} users updated ===`)
} catch (err) {
  await client.query('ROLLBACK')
  console.error('Rolled back:', err.message)
  throw err
}

await client.end()
