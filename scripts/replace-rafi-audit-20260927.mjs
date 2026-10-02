// ============================================================
// Replace one audit flagged during the Oct-gap-fill import (see CLAUDE.md,
// "Gap-fill: 30 Sep - 1 Oct 2026 audits") with Jamil's explicit instruction:
// "keep the last audit of rafi.shikho22@gmail.com for the case you
// highlighted" — i.e. the newer (30 Sep) resubmission (76%) replaces the
// older (28 Sep) one (74%) for the same call.
//
// Old audit: 73ea5f72-b969-4bc8-97f9-953576783543, score 74%, submitted
// 2026-09-28T12:15:48Z, same agent/evaluator/call/CRM-lead as row 70 of
// "audit data 30th Sep - 1st Oct.xlsx" (score 76%, Timestamp
// 2026-09-30T19:10:15Z — the later one, per "keep the last").
//
//   node --env-file=.env.local scripts/replace-rafi-audit-20260927.mjs            (dry run)
//   node --env-file=.env.local scripts/replace-rafi-audit-20260927.mjs --live     (writes for real)
// ============================================================
import ExcelJS from 'exceljs'
import pg from 'pg'
import crypto from 'crypto'

const LIVE = process.argv.includes('--live')
const SOURCE_FILE = 'import-data/audit data 30th Sep - 1st Oct.xlsx'
const OLD_AUDIT_ID = '73ea5f72-b969-4bc8-97f9-953576783543'
const TARGET_ROW = 70

const PARAM_COLS = [
  ['P1. Call Opening', 'P1. Error Attributes', 'P1. Feedback'],
  ['P2. Rapport Building', 'P2. Error Attributes', 'P2. Feedback'],
  ['P3. Pitch Personalization Based on Lead Behavior', 'P3. Error Attributes', 'P3. Feedback'],
  ['P4. Features & Benefits', 'P4. Error Attributes', 'P4. Feedback'],
  ['P5. Price Demonstration', 'P5. Error Attributes', 'P5. Feedback'],
  ['P6. Handling Objection & Overcome the barriers', 'P6. Error Attributes', 'P6. Feedback'],
  ['P7. Generate Interest and Create Urgency', 'P7. Error Attributes', 'P7. Feedback'],
  ['P8. Call Comprehension', 'P8. Error Attributes', 'P8. Feedback'],
  ['P9. Sales Closing (Conv. Summarization & Ask for sale)', 'P9. Error Attributes', 'P9. Feedback'],
  ['P10. Soft Skill & Demonstrating Empathy', 'P10. Error Attributes', 'P10. Feedback'],
  ['P11. Speech quality, Communication & Effective Listening', 'P11. Error Attributes', 'P11. Feedback'],
  ['P12.Lead Stage Update Accuracy', 'P12. Error Attributes', 'P12. Feedback'],
  ['P13.CRM Profile Management Accuracy', 'P13. Error Attributes', 'P13. Feedback'],
  ['P14.CRM Task & Follow-Up Accuracy', 'P14. Error Attributes', 'P14. Feedback'],
  ['P15.Documentation & Notes Quality', 'P15. Error Attributes', 'P15. Feedback'],
  ['P16. Call Closing & Wrap-up', 'P16. Error Attributes', 'P16. Feedback'],
]

function normText(s) {
  return String(s ?? '')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}
function blankish(v) {
  const t = String(v ?? '').trim()
  return !t || t === '-' ? null : t
}
const ERROR_ATTR_ALIASES = new Map([
  [normText('Failed to greet according to script/protocol'), normText('Failed to greet according to script, protocol')],
  [normText('Failed to share Main Features and USP of the relevant courses'), normText('Failed to clearly highlight the main features of the course (Live & Recorded Classes, Animated Videos, Report Card, Practice & Live MCQs, Class & Smart Notes)')],
  [normText('Failed to generate student/guardian interest after solving the barriers (Free Live Class Demonstration, App Walkthrough - Asking to watch animated Lessons on the App'), normText('Failed to promote free trial/App experience or send relevant materials via WhatsApp to spark interest')],
  [normText('Lack of confidence on product, failed to make student/gurdian explain why they should choose Shikho'), normText("Failed to speak confidently about Shikho's offerings or explain convincingly why a student/guardian should choose Shikho")],
  [normText('Failed to share specialized teachers names of relevant subjects (profile, background, experience, Profession, etc)'), normText('Failed to share specialized teacher details (names, subject relevance, profile/background, and comparison with local teachers)')],
  [normText('Opportunity Creation (making the student feel exclusive), Urgency Creation'), normText('Failed to use offers (Discounts, Early Bird, Gifts) to create urgency or make the student feel exclusive')],
  [normText('Failed to share Feature and Benefit in a meaningful, interesting and beneficial way'), normText("Failed to relate features to the student's life and explain how it can improve results, learning, and subject expertise.")],
  [normText('Lack of proper sale approaches'), normText('Failed to summarize the call and use effective sales tactics to close the deal')],
  [normText('Failed to avoid repeating concerns/queries or responses'), normText('Failed to acknowledge responses/avoid being inactive while listening')],
  [normText("Failed to demonstrate the effectiveness of Shikho's specialized teachers compared to local teachers"), normText('Failed to share specialized teacher details (names, subject relevance, profile/background, and comparison with local teachers)')],
])
const FATAL_ALIASES = new Map([
  [normText('Failed to maintain CRM Hygine'), normText('Failed to maintain CRM Hygine properly')],
  [normText('Failed to maintain professional language in all call notes in CRM'), normText('Failed to Maintain organized and professional language in all call notes in CRM for accuracy and coherence')],
])
const DNP_CQC_NORM = normText('Failed to avoid selecting "DNP" CQC after a successful conversation')
const DNP_CQC_NOTE = 'Historical note (migrated from the pre-2026 audit process): the original evaluation recorded a "Failed to avoid selecting \'DNP\' CQC after a successful conversation" compliance issue. This category has no equivalent in the current rubric and was not re-added as an official rule, so it is kept here as a note only.'
const EVALUATOR_EMAIL = new Map([
  ['jamil ahmed', 'jamil.ahmed@shikho.com'],
  ['mahmuda hossain panna', 'mahmuda.panna@shikho.com'],
  ['sobhana hossain', 'sobhana.hossain@shikho.com'],
  ['ikramul hasan', 'ikramul.hasan@shikho.com'],
  ['md musa ahmed', 'musa.ahmed@shikho.com'],
  ['sabiha afrin dristy', 'sabiha.dristy@shikho.com'],
  ['shahrin ahammad', 'shahrin.ahammad@shikho.com'],
  ['farjana akter popy', 'farjana.akter@shikho.com'],
  ['farjana afrose shoma', 'farjana.afrose@shikho.com'],
  ['raiyan rahman', 'raiyan.rahman+departed@shikho.com'],
  ['sumiaya islam', 'sumiaya.islam+departed@shikho.com'],
])
function parseTimestamp(v) {
  if (v instanceof Date) return v
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400 * 1000))
  return null
}
function extractLeadId(v) {
  if (!v) return null
  const url = typeof v === 'object' ? (v.hyperlink || v.text) : String(v)
  const m = String(url ?? '').match(/(\d{5,})\s*$/)
  return m ? m[1] : null
}
function durationSeconds(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 86400)
}

console.log(LIVE ? '=== LIVE — writing to the database ===' : '=== DRY RUN — no writes ===')

const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile(SOURCE_FILE)
const ws = wb.worksheets[0]
const headers = []
ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => { headers[col] = cell.value })
const row = ws.getRow(TARGET_ROW)
const r = { __row: TARGET_ROW }
row.eachCell({ includeEmpty: true }, (cell, col) => { r[headers[col] ?? `col${col}`] = cell.value })
if (String(r['Email Address']).trim().toLowerCase() !== 'rafi.shikho22@gmail.com') {
  throw new Error(`Row ${TARGET_ROW} is not the expected row (got ${r['Email Address']}) — stopping.`)
}

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL })
await client.connect()

const rubricRes = await client.query(`select id from rubrics where name = 'Telesales Scorecard' and is_active`)
const rubricId = rubricRes.rows[0].id
const paramsRes = await client.query(
  `select rp.id, rp.name, rp.points from rubric_parameters rp join rubric_categories rc on rc.id = rp.category_id where rc.rubric_id = $1`,
  [rubricId]
)
const attrsRes = await client.query(
  `select rea.id, rea.description, rea.parameter_id from rubric_error_attributes rea join rubric_parameters rp on rp.id = rea.parameter_id join rubric_categories rc on rc.id = rp.category_id where rc.rubric_id = $1`,
  [rubricId]
)
const fatalsRes = await client.query(`select id, description, severity from fatal_parameters where rubric_id = $1`, [rubricId])
const paramsByColName = new Map()
for (const [scoreCol] of PARAM_COLS) {
  const shortName = scoreCol.replace(/^P\d+\.?\s*/, '')
  const p = paramsRes.rows.find((p) => normText(p.name) === normText(shortName))
  if (!p) throw new Error(`No live parameter matches column "${scoreCol}"`)
  paramsByColName.set(scoreCol, p)
}
const attrsByParamId = new Map()
const attrsByNormDescGlobal = new Map()
for (const a of attrsRes.rows) {
  if (!attrsByParamId.has(a.parameter_id)) attrsByParamId.set(a.parameter_id, new Map())
  attrsByParamId.get(a.parameter_id).set(normText(a.description), a.id)
  attrsByNormDescGlobal.set(normText(a.description), a.id)
}
const fatalsByNormDesc = new Map(fatalsRes.rows.map((f) => [normText(f.description), f]))
function resolveErrorAttribute(paramId, text) {
  const norm = normText(text)
  const own = attrsByParamId.get(paramId)?.get(norm)
  if (own) return own
  const alias = ERROR_ATTR_ALIASES.get(norm)
  if (alias) return attrsByNormDescGlobal.get(alias) ?? null
  return null
}
function resolveFatal(text) {
  const norm = normText(text)
  const direct = fatalsByNormDesc.get(norm)
  if (direct) return direct
  const alias = FATAL_ALIASES.get(norm)
  if (alias) return fatalsByNormDesc.get(alias) ?? null
  return null
}
const thRes = await client.query(`select yellow_min from status_thresholds where rubric_id is null and effective_to is null`)
const passMark = Number(thRes.rows[0].yellow_min)
const usersRes = await client.query(`select id, email from users`)
const userByEmail = new Map(usersRes.rows.map((u) => [u.email.toLowerCase(), u]))

const email = String(r['Email Address']).trim().toLowerCase()
const agentUser = userByEmail.get(email)
const evName = String(r['Evaluator Name'] ?? '').trim().toLowerCase()
const evEmail = EVALUATOR_EMAIL.get(evName)
if (!evEmail) throw new Error(`Unmapped evaluator: ${r['Evaluator Name']}`)
const auditorUser = userByEmail.get(evEmail)
if (!agentUser || !auditorUser) throw new Error('Agent or evaluator not found — stopping.')

const auditId = crypto.randomUUID()
const paramResults = []
let sumPoints = 0
let notes = []
let unresolvedAttr = 0, unresolvedFatal = 0

for (const [scoreCol, errCol, fbCol] of PARAM_COLS) {
  const param = paramsByColName.get(scoreCol)
  const pts = Number(r[scoreCol] ?? 0)
  sumPoints += pts
  const passed = pts > 0
  const errText = blankish(r[errCol])
  let feedback = blankish(r[fbCol])
  const prId = crypto.randomUUID()
  let tick = null
  if (!passed && errText) {
    const attrId = resolveErrorAttribute(param.id, errText)
    if (attrId) tick = attrId
    else { unresolvedAttr++; notes.push(`[${param.name}] unmatched tick: ${errText}`) }
  }
  if (passed && feedback) { notes.push(`[${param.name}, passed] ${feedback}`); feedback = null }
  if (feedback && feedback.length > 500) { notes.push(`[${param.name}, full feedback] ${feedback}`); feedback = feedback.slice(0, 497) + '...' }
  paramResults.push({ id: prId, parameterId: param.id, passed, points: pts, feedback, tickAttrId: tick })
}
const reportedScore = Number(String(r['Score'] ?? '0').split('/')[0].trim())
const scoreMismatch = Math.abs(reportedScore - sumPoints) > 0.01

let fatal = null
const fatalText = blankish(r['P17. Error Attributes'])
if (fatalText) {
  if (normText(fatalText) === DNP_CQC_NORM) { notes.push(DNP_CQC_NOTE) }
  else {
    const f = resolveFatal(fatalText)
    if (f) fatal = { fatalParameterId: f.id, severity: f.severity, feedback: blankish(r['P17. Feedback']) }
    else { unresolvedFatal++; notes.push(`unmatched fatal: ${fatalText}`) }
  }
}
const criticalFail = fatal?.severity === 'critical'
const scorePercent = criticalFail ? 0 : sumPoints
const passedOverall = !criticalFail && scorePercent >= passMark
const submittedAt = parseTimestamp(r['Timestamp']) ?? parseTimestamp(r['Call Date & time']) ?? new Date()
const callStart = parseTimestamp(r['Call Date & time'])
const durSec = durationSeconds(r['Call Duration'])
const callEnd = callStart && durSec ? new Date(callStart.getTime() + durSec * 1000) : null

const newAudit = {
  id: auditId, agent_id: agentUser.id, auditor_id: auditorUser.id, rubric_id: rubricId, audit_type: 'call',
  crm_lead_id: extractLeadId(r['CRM Lead Link']), call_started_at: callStart, call_ended_at: callEnd,
  call_status: blankish(r['Call CQC']), score_percent: scorePercent, passed: passedOverall, pass_mark_used: passMark,
  critical_fail: criticalFail, overall_feedback: notes.length ? notes.join('\n').slice(0, 2000) : null,
  status: 'submitted', submitted_at: submittedAt, created_at: submittedAt,
}

console.log('\n=== New audit (from row 70) ===')
console.log('agent:', agentUser.email, '| auditor:', auditorUser.email)
console.log('score:', scorePercent, '| passed:', passedOverall, '| critical_fail:', criticalFail)
console.log('submitted_at:', submittedAt.toISOString(), '| call_started_at:', callStart?.toISOString())
console.log('score-sum mismatch:', scoreMismatch, '| unresolved ticks:', unresolvedAttr, '| unresolved fatals:', unresolvedFatal)
console.log('\nReplacing audit:', OLD_AUDIT_ID)

if (scoreMismatch || unresolvedAttr || unresolvedFatal) {
  throw new Error('Row did not transform cleanly — stopping before any write.')
}

if (!LIVE) {
  console.log('\n--dry-run: no writes performed. Pass --live to actually replace.')
  await client.end()
  process.exit(0)
}

await client.query('BEGIN')
try {
  // capa_repeat_mistakes is a fully-derived cache (CLAUDE.md §4 Part 2a) and some of
  // its rows point at the old audit via last_checked_audit_id — cleared here and
  // rebuilt from scratch afterward via backfill_capa_repeat_mistakes(), the same
  // pattern used elsewhere whenever historical audit data changes underneath it.
  await client.query(`delete from capa_repeat_mistakes`)

  await client.query(`delete from audit_error_ticks where audit_parameter_result_id in (select id from audit_parameter_results where audit_id = $1)`, [OLD_AUDIT_ID])
  await client.query(`delete from audit_parameter_results where audit_id = $1`, [OLD_AUDIT_ID])
  await client.query(`delete from audit_fatal_results where audit_id = $1`, [OLD_AUDIT_ID])
  const delRes = await client.query(`delete from audits where id = $1`, [OLD_AUDIT_ID])
  console.log('Old audit deleted:', delRes.rowCount)

  await client.query(
    `insert into audits (id, agent_id, auditor_id, rubric_id, audit_type, crm_lead_id, call_started_at, call_ended_at, call_status, score_percent, passed, pass_mark_used, critical_fail, overall_feedback, status, submitted_at, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [newAudit.id, newAudit.agent_id, newAudit.auditor_id, newAudit.rubric_id, newAudit.audit_type, newAudit.crm_lead_id,
     newAudit.call_started_at, newAudit.call_ended_at, newAudit.call_status, newAudit.score_percent, newAudit.passed,
     newAudit.pass_mark_used, newAudit.critical_fail, newAudit.overall_feedback, newAudit.status, newAudit.submitted_at, newAudit.created_at]
  )
  for (const pr of paramResults) {
    await client.query(
      `insert into audit_parameter_results (id, audit_id, parameter_id, passed, points_awarded, feedback) values ($1,$2,$3,$4,$5,$6)`,
      [pr.id, newAudit.id, pr.parameterId, pr.passed, pr.points, pr.feedback]
    )
    if (pr.tickAttrId) {
      await client.query(
        `insert into audit_error_ticks (id, audit_parameter_result_id, error_attribute_id) values ($1,$2,$3)`,
        [crypto.randomUUID(), pr.id, pr.tickAttrId]
      )
    }
  }
  if (fatal) {
    await client.query(
      `insert into audit_fatal_results (id, audit_id, fatal_parameter_id, severity, feedback) values ($1,$2,$3,$4,$5)`,
      [crypto.randomUUID(), newAudit.id, fatal.fatalParameterId, fatal.severity, fatal.feedback]
    )
  }

  await client.query('COMMIT')
  console.log('New audit inserted:', newAudit.id)
} catch (err) {
  await client.query('ROLLBACK')
  console.error('Rolled back:', err.message)
  throw err
}

console.log('\nRe-running backfill_capa_repeat_mistakes()...')
await client.query('select backfill_capa_repeat_mistakes()')
console.log('capa_repeat_mistakes rows:', (await client.query('select count(*) from capa_repeat_mistakes')).rows[0].count)

console.log('Re-running compute_agent_status()...')
await client.query('select compute_agent_status()')

await client.end()
console.log('\n=== Done ===')
