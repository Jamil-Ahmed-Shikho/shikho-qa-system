// ============================================================
// Historical Telesales audit import (26k Google-Form rows -> real `audits` rows).
// All decisions confirmed by Jamil (see CLAUDE.md / memory project_historical_audit_import.md):
//   - imported audits DO count toward current RYG/PIP/priority
//   - critical fatal (matched against live fatal_parameters) -> score recomputed to 0%
//   - "DNP CQC" fatal category has no live match -> dropped to a text note only
//   - duplicate (same agent email + same call time) -> keep the newer one by Audit time
//   - departed agents/evaluators get inactive profile_only accounts
//   - 10 reworded tick-reason texts mapped to specific live attributes one by one (2 of
//     them deliberately cross-parameter, accepted with the resulting minor inconsistency)
//
//   node --env-file=.env.local scripts/import-historical-audits.mjs            (dry run, default)
//   node --env-file=.env.local scripts/import-historical-audits.mjs --live     (writes for real)
// ============================================================
import ExcelJS from 'exceljs'
import pg from 'pg'
import crypto from 'crypto'

const LIVE = process.argv.includes('--live')
const SOURCE_FILE = 'import-data/Telesales Evaluations - Shikho 2025 - Audit Box 2025 - Form Responses 1.xlsx'
const DUPLICATE_HEADER_ROWS = new Set([1653])
const BATCH_SIZE = 250 // audits per transaction

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

// old wording -> live attribute description (global match, cross-parameter allowed by design)
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

// Evaluator name -> email, confirmed with Jamil (2026-09-30/10-01)
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

function parseAuditTime(v) {
  if (v instanceof Date) return v
  if (typeof v === 'string') {
    const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/)
    if (m) { const [, mo, d, y, h, mi, s] = m; return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) }
  }
  return null
}
function parseCallDateTime(v) {
  if (v instanceof Date) return v
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

// ---- Load + dedup spreadsheet ----
const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile(SOURCE_FILE)
const ws = wb.worksheets[0]
const headers = []
ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => { headers[col] = cell.value })
const rawRows = []
ws.eachRow((row, rowNumber) => {
  if (rowNumber === 1 || DUPLICATE_HEADER_ROWS.has(rowNumber)) return
  const obj = { __row: rowNumber }
  row.eachCell({ includeEmpty: true }, (cell, col) => { obj[headers[col] ?? `col${col}`] = cell.value })
  if (obj['Contact Stage'] === 'Contact Stage') return
  rawRows.push(obj)
})
function dedupKey(r) {
  const email = String(r['Email Address'] ?? '').trim().toLowerCase()
  const callTime = r['Call Date & time'] instanceof Date ? r['Call Date & time'].toISOString() : String(r['Call Date & time'])
  return `${email}|${callTime}`
}
const groups = new Map()
for (const r of rawRows) { const k = dedupKey(r); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r) }
const keptRows = []
for (const [, group] of groups) {
  if (group.length === 1) { keptRows.push(group[0]); continue }
  let best = group[0]
  for (const r of group) {
    const bt = parseAuditTime(best['Audit time']), rt = parseAuditTime(r['Audit time'])
    if ((rt && bt && rt > bt) || (rt && !bt) || (!rt && !bt && r.__row > best.__row)) best = r
  }
  keptRows.push(best)
}
console.log(`Source rows: ${rawRows.length}, after dedup: ${keptRows.length}`)

// ---- Live rubric structure ----
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

// ---- Threshold (pass mark) ----
const thRes = await client.query(`select yellow_min from status_thresholds where rubric_id is null and effective_to is null`)
const passMark = Number(thRes.rows[0].yellow_min)

// ---- Resolve agent + evaluator identities ----
const usersRes = await client.query(`select id, email, emp_id, is_active from users`)
const userByEmail = new Map(usersRes.rows.map((u) => [u.email.toLowerCase(), u]))
const takenEmpIds = new Set(usersRes.rows.map((u) => u.emp_id).filter(Boolean))

const distinctAgents = new Map() // email -> { name, empId, siteGuess }
const distinctEvaluatorNames = new Set()
let skippedNoEmail = 0
for (const r of keptRows) {
  const email = String(r['Email Address'] ?? '').trim().toLowerCase()
  if (!email) { skippedNoEmail++; continue }
  if (!distinctAgents.has(email)) {
    const empId = r['Agent ID'] ? String(r['Agent ID']).trim() : null
    distinctAgents.set(email, { name: String(r['Agent Name'] ?? '').trim() || email, empId, siteGuess: empId && /^J/i.test(empId) ? 'Jashore' : 'Dhaka' })
  }
  const ev = String(r['Evaluator Name'] ?? '').trim().toLowerCase()
  if (ev) distinctEvaluatorNames.add(ev)
}
console.log(`Distinct agent emails in sheet: ${distinctAgents.size} (skipped ${skippedNoEmail} rows with no email)`)

const unknownEvaluators = [...distinctEvaluatorNames].filter((n) => !EVALUATOR_EMAIL.has(n))
if (unknownEvaluators.length) throw new Error(`Unmapped evaluator name(s): ${unknownEvaluators.join(', ')}`)

const newAgentProfiles = []
let empIdCollisions = 0
const usedNewEmpIds = new Set()
for (const [email, info] of distinctAgents) {
  if (userByEmail.has(email)) continue
  let empId = info.empId
  if (empId && (takenEmpIds.has(empId) || usedNewEmpIds.has(empId))) { empIdCollisions++; empId = null }
  if (empId) usedNewEmpIds.add(empId)
  newAgentProfiles.push({ email, name: info.name, empId, site: info.siteGuess })
}
console.log(`New (departed) agent profiles to create: ${newAgentProfiles.length} (emp_id collisions with current roster, left null: ${empIdCollisions})`)

const newEvaluatorEmails = [...distinctEvaluatorNames]
  .map((n) => EVALUATOR_EMAIL.get(n))
  .filter((email) => !userByEmail.has(email))
console.log(`New (departed) evaluator profiles to create: ${newEvaluatorEmails.length}`, newEvaluatorEmails)

if (LIVE) {
  if (newEvaluatorEmails.length) {
    const names = [...distinctEvaluatorNames].filter((n) => newEvaluatorEmails.includes(EVALUATOR_EMAIL.get(n)))
    for (const n of names) {
      const email = EVALUATOR_EMAIL.get(n)
      const id = crypto.randomUUID()
      await client.query(
        `insert into users (id, name, email, role, employment_stage, is_active, account_status, must_change_password)
         values ($1, $2, $3, 'qa_auditor', 'discontinued', false, 'profile_only', false)`,
        [id, n.replace(/\b\w/g, (c) => c.toUpperCase()), email]
      )
      userByEmail.set(email, { id, email, is_active: false })
    }
  }
  if (newAgentProfiles.length) {
    for (const batchStart of range(newAgentProfiles.length, 500)) {
      const batch = newAgentProfiles.slice(batchStart, batchStart + 500)
      batch.forEach((a) => { a.id = crypto.randomUUID() })
      await client.query(
        `insert into users (id, name, email, role, team_name, site_name, employment_stage, is_active, account_status)
         select * from unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::bool[], $9::text[])`,
        [
          batch.map((a) => a.id),
          batch.map((a) => a.name),
          batch.map((a) => a.email),
          batch.map(() => 'agent'),
          batch.map(() => 'Telesales'),
          batch.map((a) => a.site),
          batch.map(() => 'discontinued'),
          batch.map(() => false),
          batch.map(() => 'profile_only'),
        ]
      )
      for (const a of batch) userByEmail.set(a.email, { id: a.id, email: a.email, is_active: false })
    }
  }
} else {
  // dry run: assign fake ids so the rest of the pipeline can still be validated
  for (const a of newAgentProfiles) userByEmail.set(a.email, { id: crypto.randomUUID(), email: a.email, is_active: false, __fake: true })
  for (const email of newEvaluatorEmails) userByEmail.set(email, { id: crypto.randomUUID(), email, is_active: false, __fake: true })
}

function* range(total, step) { for (let i = 0; i < total; i += step) yield i }

// ---- Transform every kept row ----
let unresolvedAttr = 0
let unresolvedFatal = 0
let dnpCqcCount = 0
let criticalCount = 0
let majorCount = 0
let scoreMismatch = 0
let builtAudits = 0
const toInsert = []

for (const r of keptRows) {
  const email = String(r['Email Address'] ?? '').trim().toLowerCase()
  if (!email) continue
  const agentUser = userByEmail.get(email)
  const evName = String(r['Evaluator Name'] ?? '').trim().toLowerCase()
  const evEmail = EVALUATOR_EMAIL.get(evName)
  const auditorUser = userByEmail.get(evEmail)
  if (!agentUser || !auditorUser) continue

  const auditId = crypto.randomUUID()
  const paramResults = []
  let sumPoints = 0
  let notes = []

  for (const [scoreCol, errCol, fbCol] of PARAM_COLS) {
    const param = paramsByColName.get(scoreCol)
    const pts = Number(r[scoreCol] ?? 0)
    sumPoints += pts
    // NOT `pts >= param.points` — the Telesales rubric's per-parameter point WEIGHTS
    // changed partway through 2025 (confirmed: several parameters show two distinct
    // non-zero "full credit" values historically, one of which matches today's live
    // weight). Comparing against today's weight would wrongly fail an old row scored
    // 100% on its own then-current scale. The tick/no-tick split is clean (0 vs a
    // full value, never anything between), so points > 0 is the real pass signal;
    // points_awarded is preserved exactly as historically recorded either way.
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
    // DB constraint apr_feedback_only_on_fail: a passed parameter can't carry feedback
    // (mirrors the live "Pass clears feedback" rule). Some historical evaluators left
    // positive notes on passed parameters anyway — preserve that text as an overall note
    // instead of losing it, rather than violating the constraint.
    if (passed && feedback) { notes.push(`[${param.name}, passed] ${feedback}`); feedback = null }
    // DB constraint apr_feedback_len: 500 chars max. A handful of historical feedback
    // texts run longer — truncate the stored field but keep the full text as a note.
    if (feedback && feedback.length > 500) {
      notes.push(`[${param.name}, full feedback] ${feedback}`)
      feedback = feedback.slice(0, 497) + '...'
    }
    paramResults.push({ id: prId, parameterId: param.id, passed, points: pts, feedback, tickAttrId: tick })
  }

  const reportedScore = Number(String(r['Score'] ?? '0').split('/')[0].trim())
  if (Math.abs(reportedScore - sumPoints) > 0.01) scoreMismatch++

  let fatal = null
  const fatalText = blankish(r['P17. Error Attributes'])
  if (fatalText) {
    if (normText(fatalText) === DNP_CQC_NORM) { dnpCqcCount++; notes.push(DNP_CQC_NOTE) }
    else {
      const f = resolveFatal(fatalText)
      if (f) { fatal = { fatalParameterId: f.id, severity: f.severity, feedback: blankish(r['P17. Feedback']) }; f.severity === 'critical' ? criticalCount++ : majorCount++ }
      else { unresolvedFatal++; notes.push(`unmatched fatal: ${fatalText}`) }
    }
  }

  const criticalFail = fatal?.severity === 'critical'
  const scorePercent = criticalFail ? 0 : sumPoints
  const passedOverall = !criticalFail && scorePercent >= passMark

  const submittedAt = parseAuditTime(r['Audit time']) ?? parseCallDateTime(r['Call Date & time']) ?? new Date()
  const callStart = parseCallDateTime(r['Call Date & time'])
  const durSec = durationSeconds(r['Call Duration'])
  const callEnd = callStart && durSec ? new Date(callStart.getTime() + durSec * 1000) : null

  toInsert.push({
    audit: {
      id: auditId,
      agent_id: agentUser.id,
      auditor_id: auditorUser.id,
      rubric_id: rubricId,
      audit_type: 'call',
      crm_lead_id: extractLeadId(r['CRM Lead Link']),
      call_started_at: callStart,
      call_ended_at: callEnd,
      call_status: blankish(r['Call CQC']),
      score_percent: scorePercent,
      passed: passedOverall,
      pass_mark_used: passMark,
      critical_fail: criticalFail,
      overall_feedback: notes.length ? notes.join('\n').slice(0, 2000) : null,
      status: 'submitted',
      submitted_at: submittedAt,
      created_at: submittedAt,
    },
    paramResults,
    fatal,
  })
  builtAudits++
}

console.log('\n=== Transform summary ===')
console.log('Audits built:', builtAudits)
console.log('Score sum vs reported mismatches:', scoreMismatch)
console.log('Critical fatals:', criticalCount, '| Major fatals:', majorCount, '| DNP-CQC (note only):', dnpCqcCount)
console.log('Unresolved error-attribute ticks (should be 0):', unresolvedAttr)
console.log('Unresolved fatals (should be 0):', unresolvedFatal)

if (!LIVE) {
  console.log('\n--dry-run: no writes performed. Pass --live to actually import.')
  await client.end()
  process.exit(0)
}

// ---- Live insert, batched ----
let done = 0
for (const start of range(toInsert.length, BATCH_SIZE)) {
  const batch = toInsert.slice(start, start + BATCH_SIZE)
  await client.query('BEGIN')
  try {
    await client.query(
      `insert into audits (id, agent_id, auditor_id, rubric_id, audit_type, crm_lead_id, call_started_at, call_ended_at, call_status, score_percent, passed, pass_mark_used, critical_fail, overall_feedback, status, submitted_at, created_at)
       select * from unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::text[], $6::text[], $7::timestamptz[], $8::timestamptz[], $9::text[], $10::numeric[], $11::bool[], $12::numeric[], $13::bool[], $14::text[], $15::text[], $16::timestamptz[], $17::timestamptz[])`,
      [
        batch.map((b) => b.audit.id), batch.map((b) => b.audit.agent_id), batch.map((b) => b.audit.auditor_id),
        batch.map((b) => b.audit.rubric_id), batch.map((b) => b.audit.audit_type), batch.map((b) => b.audit.crm_lead_id),
        batch.map((b) => b.audit.call_started_at), batch.map((b) => b.audit.call_ended_at), batch.map((b) => b.audit.call_status),
        batch.map((b) => b.audit.score_percent), batch.map((b) => b.audit.passed), batch.map((b) => b.audit.pass_mark_used),
        batch.map((b) => b.audit.critical_fail), batch.map((b) => b.audit.overall_feedback), batch.map((b) => b.audit.status),
        batch.map((b) => b.audit.submitted_at), batch.map((b) => b.audit.created_at),
      ]
    )

    const allParamResults = batch.flatMap((b) => b.paramResults.map((pr) => ({ ...pr, auditId: b.audit.id })))
    await client.query(
      `insert into audit_parameter_results (id, audit_id, parameter_id, passed, points_awarded, feedback)
       select * from unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::bool[], $5::numeric[], $6::text[])`,
      [
        allParamResults.map((pr) => pr.id), allParamResults.map((pr) => pr.auditId), allParamResults.map((pr) => pr.parameterId),
        allParamResults.map((pr) => pr.passed), allParamResults.map((pr) => pr.points), allParamResults.map((pr) => pr.feedback),
      ]
    )

    const ticks = allParamResults.filter((pr) => pr.tickAttrId)
    if (ticks.length) {
      await client.query(
        `insert into audit_error_ticks (id, audit_parameter_result_id, error_attribute_id)
         select * from unnest($1::uuid[], $2::uuid[], $3::uuid[])`,
        [ticks.map(() => crypto.randomUUID()), ticks.map((t) => t.id), ticks.map((t) => t.tickAttrId)]
      )
    }

    const fatalRows = batch.filter((b) => b.fatal)
    if (fatalRows.length) {
      await client.query(
        `insert into audit_fatal_results (id, audit_id, fatal_parameter_id, severity, feedback)
         select * from unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::text[])`,
        [
          fatalRows.map(() => crypto.randomUUID()), fatalRows.map((b) => b.audit.id), fatalRows.map((b) => b.fatal.fatalParameterId),
          fatalRows.map((b) => b.fatal.severity), fatalRows.map((b) => b.fatal.feedback),
        ]
      )
    }

    await client.query('COMMIT')
    done += batch.length
    if (done % 2500 === 0 || done === toInsert.length) console.log(`  committed ${done}/${toInsert.length}`)
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(`Batch starting at ${start} failed, rolled back:`, err.message)
    throw err
  }
}

console.log(`\n=== LIVE import complete: ${done} audits inserted ===`)
await client.end()
