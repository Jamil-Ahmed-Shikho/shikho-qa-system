// ============================================================
// Two more TS3P agents from Jamil's 2026-10-03 message:
//   - Md. Ajyeann Siddique (ajyeann.issl@gmail.com) — ALREADY in the system,
//     mis-profiled the same way as the other 9 (historical-import fallback:
//     team='Telesales', discontinued, profile_only).
//   - MD. Ratul Hasan (ratulhasan.issl@gmail.com) — genuinely new, no row yet.
//
// The sheet's "Joining Date: Retraining" / "Employment Stage: Active" /
// "OJT Start Date: 22-Sep-26" conflicted (Active vs Retraining) — asked
// Jamil rather than guessed. Confirmed: both are CURRENTLY in re-training,
// window started 2026-09-30 (so ends 2026-10-02, the DB's own "3-day span"
// rule, schema_038).
//
// ojt_transition() can't be used here — it only moves someone OUT of
// ojt/re_training, requiring the CURRENT stage already be one of those
// (schema_038: "if u.employment_stage not in ('ojt','re_training') then
// raise"). Neither agent's row satisfies that (one doesn't exist yet, the
// other is 'discontinued') — there is no function path for "this agent was
// actually in OJT/re-training in reality the whole time, retroactively
// enter that". So this writes `employment_stage='re_training'` directly
// (the only option) and inserts the matching `ojt_status_history` row by
// hand so `/admin/ojt` and `ojt_candidates()` still read real dates instead
// of nothing. `from_stage='ojt'` on that row isn't literally what the users
// row held a moment before (it's the only value the CHECK constraint
// allows, schema_038's `ojt_status_history_from_stage_check`) — the note
// says so explicitly, so this is never mistaken for a normal transition.
//
//   node --env-file=.env.local scripts/fix-ts3p-retraining-agents-20261003.mjs            (dry run)
//   node --env-file=.env.local scripts/fix-ts3p-retraining-agents-20261003.mjs --live     (writes for real)
// ============================================================
import pg from 'pg'
import crypto from 'crypto'

const LIVE = process.argv.includes('--live')
const TEAM_LEADER_ID = '5619661e-8c82-4258-937a-5fa11eb1463b' // zahid.hasan@issl.com.bd
const QA_AUDITOR_ID = 'a570f39d-9b26-4892-b8e3-970ca37c5f17'  // naznin.mitu@issl.com.bd
const JAMIL_ID_EMAIL = 'jamil.ahmed@shikho.com'
const RETRAIN_START = '2026-09-30'
const RETRAIN_END = '2026-10-02' // start + 2, per schema_038's own CHECK
const NOTE = 'Profile corrected 2026-10-03 (Jamil): agent was already in re-training in reality; this system never had a prior ojt/re_training record for them (either mis-imported as a departed Telesales agent, or not entered at all) — from_stage is recorded as the required placeholder "ojt", not a literal prior state.'

console.log(LIVE ? '=== LIVE — writing to the database ===' : '=== DRY RUN — no writes ===')

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL })
await client.connect()

const jamil = await client.query(`select id from users where lower(email) = lower($1)`, [JAMIL_ID_EMAIL])
if (!jamil.rows[0]) throw new Error('Could not find Jamil\'s user row for changed_by — stopping.')
const JAMIL_ID = jamil.rows[0].id

const ajyeann = await client.query(`select id, account_status, employment_stage from users where lower(email) = lower($1)`, ['ajyeann.issl@gmail.com'])
if (!ajyeann.rows[0]) throw new Error('ajyeann.issl@gmail.com not found — expected an existing row.')
if (ajyeann.rows[0].account_status !== 'profile_only') throw new Error('ajyeann is not profile_only — stopping rather than overwriting something already changed.')
const AJYEANN_ID = ajyeann.rows[0].id

const ratul = await client.query(`select id from users where lower(email) = lower($1)`, ['ratulhasan.issl@gmail.com'])
if (ratul.rows[0]) throw new Error('ratulhasan.issl@gmail.com already exists — expected no row. Stopping rather than guessing which one is right.')
const RATUL_ID = crypto.randomUUID()

console.log(`\nWill update ajyeann (${AJYEANN_ID}): team Telesales->TS3P, site->Dhaka, TL/QA set, discontinued->re_training, is_active->true`)
console.log(`Will create ratulhasan (${RATUL_ID}): team TS3P, site Dhaka, TL/QA set, re_training, is_active true, profile_only`)
console.log(`Both get an ojt_status_history row: re_training ${RETRAIN_START} -> ${RETRAIN_END}`)

if (!LIVE) {
  console.log('\n--dry-run: no writes performed. Pass --live to actually update/create.')
  await client.end()
  process.exit(0)
}

await client.query('BEGIN')
try {
  await client.query(
    `update users set
       team_name = 'TS3P', site_name = 'Dhaka',
       team_leader_id = $2, quality_auditor_id = $3,
       employment_stage = 're_training', is_active = true
     where id = $1`,
    [AJYEANN_ID, TEAM_LEADER_ID, QA_AUDITOR_ID]
  )
  await client.query(
    `insert into ojt_status_history (agent_id, from_stage, to_stage, re_training_start_date, re_training_end_date, note, changed_by)
     values ($1, 'ojt', 're_training', $2::date, $3::date, $4, $5)`,
    [AJYEANN_ID, RETRAIN_START, RETRAIN_END, NOTE, JAMIL_ID]
  )

  await client.query(
    `insert into users (id, name, email, role, team_name, site_name, team_leader_id, quality_auditor_id, employment_stage, is_active, account_status)
     values ($1, 'MD.Ratul Hasan', 'ratulhasan.issl@gmail.com', 'agent', 'TS3P', 'Dhaka', $2, $3, 're_training', true, 'profile_only')`,
    [RATUL_ID, TEAM_LEADER_ID, QA_AUDITOR_ID]
  )
  await client.query(
    `insert into ojt_status_history (agent_id, from_stage, to_stage, re_training_start_date, re_training_end_date, note, changed_by)
     values ($1, 'ojt', 're_training', $2::date, $3::date, $4, $5)`,
    [RATUL_ID, RETRAIN_START, RETRAIN_END, NOTE, JAMIL_ID]
  )

  await client.query('COMMIT')
  console.log('\n=== LIVE: both agents updated/created ===')
} catch (err) {
  await client.query('ROLLBACK')
  console.error('Rolled back:', err.message)
  throw err
}

await client.end()
