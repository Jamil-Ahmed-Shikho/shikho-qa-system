// ============================================================
// Prep pass for the historical Telesales audit import (26k rows, 2026-09-30).
// READ-ONLY against the live database and the source spreadsheet — writes nothing,
// just produces analysis/preview output under import-data/ (gitignored) so the
// real import can run fast once Jamil's roster + evaluator emails arrive.
//   node --env-file=.env.local scripts/prepare-historical-import.mjs
// ============================================================
import ExcelJS from 'exceljs'
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const SOURCE_FILE = 'import-data/Telesales Evaluations - Shikho 2025 - Audit Box 2025 - Form Responses 1.xlsx'
const DUPLICATE_HEADER_ROWS = new Set([1653]) // found during investigation; re-verified below anyway

const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile(SOURCE_FILE)
const ws = wb.worksheets[0]
const headerRow = ws.getRow(1)
const headers = []
headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => { headers[colNumber] = cell.value })

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

const rows = []
ws.eachRow((row, rowNumber) => {
  if (rowNumber === 1 || DUPLICATE_HEADER_ROWS.has(rowNumber)) return
  const obj = { __row: rowNumber }
  row.eachCell({ includeEmpty: true }, (cell, colNumber) => { obj[headers[colNumber] ?? `col${colNumber}`] = cell.value })
  if (obj['Contact Stage'] === 'Contact Stage') return // any other stray duplicate header row, defensive
  rows.push(obj)
})

// ---- Dedup: same email + same Call Date&time -> keep the one with the LATER Audit time ----
function parseAuditTime(v) {
  if (v instanceof Date) return v
  if (typeof v === 'string') {
    const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/)
    if (m) { const [, mo, d, y, h, mi, s] = m; return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) }
  }
  return null
}
function dedupKey(r) {
  const email = String(r['Email Address'] ?? '').trim().toLowerCase()
  const callTime = r['Call Date & time'] instanceof Date ? r['Call Date & time'].toISOString() : String(r['Call Date & time'])
  return `${email}|${callTime}`
}
const groups = new Map()
for (const r of rows) {
  const k = dedupKey(r)
  if (!groups.has(k)) groups.set(k, [])
  groups.get(k).push(r)
}
const keptRows = []
let droppedAsDuplicate = 0
for (const [, group] of groups) {
  if (group.length === 1) { keptRows.push(group[0]); continue }
  let best = group[0]
  for (const r of group) {
    const bt = parseAuditTime(best['Audit time'])
    const rt = parseAuditTime(r['Audit time'])
    if ((rt && bt && rt > bt) || (rt && !bt) || (!rt && !bt && r.__row > best.__row)) best = r
  }
  keptRows.push(best)
  droppedAsDuplicate += group.length - 1
}

// Google Forms/Excel exports use "smart quotes" and other Unicode punctuation our
// live rubric text doesn't; normalize both sides before comparing so a real wording
// difference isn't confused with an encoding difference.
function normText(s) {
  return s
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// ---- Live rubric fetch ----
const { data: rubric } = await supabase.from('rubrics').select('id').eq('name', 'Telesales Scorecard').eq('is_active', true).maybeSingle()
const { data: categories } = await supabase.from('rubric_categories').select('id, name, rubric_parameters(id, name, points, rubric_error_attributes(id, description))').eq('rubric_id', rubric.id)
const liveParams = categories.flatMap((c) => c.rubric_parameters)
const { data: fatals } = await supabase.from('fatal_parameters').select('id, description, severity').eq('rubric_id', rubric.id)
const fatalBySevereText = new Map(fatals.map((f) => [normText(f.description), f]))
// known near-text aliases found during investigation (old wording -> live description)
const FATAL_ALIASES = new Map([
  [normText('Failed to maintain CRM Hygine'), normText('Failed to maintain CRM Hygine properly')],
  [normText('Failed to maintain professional language in all call notes in CRM'), normText('Failed to Maintain organized and professional language in all call notes in CRM for accuracy and coherence')],
])
function matchParam(name) {
  const norm = normText(name)
  return liveParams.find((p) => normText(p.name) === norm)
}
function matchErrorAttribute(param, text) {
  if (!param) return null
  const norm = normText(text)
  return param.rubric_error_attributes.find((a) => normText(a.description) === norm) ?? null
}
function matchFatal(text) {
  const norm = normText(text)
  const direct = fatalBySevereText.get(norm)
  if (direct) return direct
  const alias = FATAL_ALIASES.get(norm)
  if (alias) return fatalBySevereText.get(alias) ?? null
  return null
}

// ---- Walk every kept row, transform, and collect stats ----
let paramMismatches = new Set()
let errorAttrMismatches = new Map() // "Param|Text" -> count
let fatalMismatches = new Map()
let criticalRecomputed = 0
let majorRecorded = 0
let unmatchedFatalDropped = 0
let scoreMismatchVsSum = 0
const distinctAgentEmails = new Map()
const distinctEvaluators = new Map()

for (const r of keptRows) {
  // parameters
  let sumPoints = 0
  for (const [scoreCol, errCol, fbCol] of PARAM_COLS) {
    const pts = Number(r[scoreCol] ?? 0)
    sumPoints += pts
    const liveParam = matchParam(scoreCol.replace(/^P\d+\.?\s*/, ''))
    if (!liveParam) paramMismatches.add(scoreCol)
    const errText = r[errCol]
    if (errText && errText !== '-' && liveParam) {
      const attr = matchErrorAttribute(liveParam, String(errText))
      if (!attr) {
        const key = `${liveParam.name} :: ${errText}`
        errorAttrMismatches.set(key, (errorAttrMismatches.get(key) ?? 0) + 1)
      }
    }
  }
  const reportedScore = Number(String(r['Score']).split('/')[0].trim())
  if (Math.abs(reportedScore - sumPoints) > 0.01) scoreMismatchVsSum++

  // fatal
  const fatalText = r['P17. Error Attributes']
  if (fatalText && fatalText !== '-') {
    const f = matchFatal(String(fatalText))
    if (f) {
      if (f.severity === 'critical') criticalRecomputed++
      else majorRecorded++
    } else {
      unmatchedFatalDropped++
      fatalMismatches.set(String(fatalText), (fatalMismatches.get(String(fatalText)) ?? 0) + 1)
    }
  }

  // identity
  const email = String(r['Email Address'] ?? '').trim().toLowerCase()
  if (!distinctAgentEmails.has(email)) distinctAgentEmails.set(email, { name: r['Agent Name'], agentId: r['Agent ID'], count: 0 })
  distinctAgentEmails.get(email).count++

  const ev = String(r['Evaluator Name'] ?? '').trim()
  distinctEvaluators.set(ev, (distinctEvaluators.get(ev) ?? 0) + 1)
}

console.log('=== Historical import prep report ===')
console.log('Source rows (excluding header rows):', rows.length)
console.log('After dropping older duplicates:', keptRows.length, '(dropped', droppedAsDuplicate, ')')
console.log('\n--- Parameter name matching (should be empty) ---')
console.log([...paramMismatches])
console.log('\n--- Score sum vs reported "Score" mismatches ---', scoreMismatchVsSum)
console.log('\n--- Fatal severity outcome (post Jamil\'s recompute rule) ---')
console.log('  Critical -> would recompute score to 0%:', criticalRecomputed)
console.log('  Major -> recorded only, score unaffected:', majorRecorded)
console.log('  No live match -> dropped to a text note only:', unmatchedFatalDropped, [...fatalMismatches.entries()])
console.log('\n--- Error-attribute text mismatches (need review before import; top 20) ---', errorAttrMismatches.size, 'distinct mismatches')
;[...errorAttrMismatches.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([k, c]) => console.log(` ${c}\t${k}`))

console.log('\n--- Identity summary ---')
console.log('Distinct agent emails needed:', distinctAgentEmails.size)
console.log('Distinct evaluators needed:', distinctEvaluators.size, [...distinctEvaluators.keys()])

// Write out the distinct-agents list Jamil's roster will need to be cross-checked against
const agentList = [...distinctAgentEmails.entries()].map(([email, v]) => ({ email, name: v.name, agentIdSeen: v.agentId, auditCount: v.count }))
agentList.sort((a, b) => b.auditCount - a.auditCount)
writeFileSync('import-data/distinct-agents-needed.json', JSON.stringify(agentList, null, 1))
console.log('\nWrote import-data/distinct-agents-needed.json (', agentList.length, 'agents ) for cross-checking against the roster once it arrives.')
