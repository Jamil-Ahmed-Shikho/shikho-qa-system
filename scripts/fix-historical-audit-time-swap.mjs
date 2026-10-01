// ============================================================
// Fix: "Audit time" day/month swap in the historical Telesales import
// (scripts/import-historical-audits.mjs, 2026-10-01).
//
// Root cause: the source spreadsheet's "Audit time" column came from Google
// Forms as plain text, "M/D/YYYY H:Mi:S" (month first). When the sheet was
// exported to .xlsx, Google auto-converted any cell it could parse as a
// valid date into a real Excel date value -- using DAY-FIRST order. That
// succeeds only when the TRUE day-of-month is <= 12 (otherwise the implied
// "month" would be >12, invalid, so the cell is left as text instead).
// Where it succeeded, the resulting Date is WRONG: its month field actually
// holds the true DAY, and its day field actually holds the true MONTH.
// import-historical-audits.mjs's parseAuditTime() trusted `v instanceof Date`
// cells blindly (reasonably -- a real Excel Date has no string-parsing
// ambiguity in the normal case) and never saw this upstream corruption.
//
// Confirmed, not guessed: of 25,672 "Audit time" cells, 10,249 were
// Date-typed (every single one with a true day <= 12, 0 exceptions checked
// against the source file) and 15,835 were left as text (every one
// correctly parsed by the existing M/D/YYYY regex). "Call Date & time"
// (-> audits.call_started_at) is NEVER Date-typed-with-swap -- it comes
// from Google Forms' own canonical timestamp field, not a re-parsed string,
// and was independently confirmed to match the true month on every checked
// row -- so it is the reliable field used here to join back to the DB.
//
// Fix: true_month = stored.getUTCDate(), true_day = stored.getUTCMonth()+1
// (swap the two fields back), year untouched by the swap itself, then the
// SAME already-applied 2026->2025 rule (year 2026 -> year - 1) is reapplied
// on the corrected value, matching what the original post-import fix did
// for the (already-correct) text-parsed rows.
//
//   node --env-file=.env.local scripts/fix-historical-audit-time-swap.mjs            (dry run, default)
//   node --env-file=.env.local scripts/fix-historical-audit-time-swap.mjs --live     (writes for real)
// ============================================================
import ExcelJS from 'exceljs'
import pg from 'pg'

const LIVE = process.argv.includes('--live')
const SOURCE_FILE = 'import-data/Telesales Evaluations - Shikho 2025 - Audit Box 2025 - Form Responses 1.xlsx'
const DUPLICATE_HEADER_ROWS = new Set([1653])

function parseAuditTime(v) {
  if (v instanceof Date) return v
  if (typeof v === 'string') {
    const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/)
    if (m) { const [, mo, d, y, h, mi, s] = m; return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) }
  }
  return null
}

console.log(LIVE ? '=== LIVE — writing to the database ===' : '=== DRY RUN — no writes ===')

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

// Same dedup as the original import, so "kept" rows line up 1:1 with what's in the DB.
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

// ---- Only the Date-typed "Audit time" cells are affected ----
function swapCorrect(dateVal) {
  const trueMonth = dateVal.getUTCDate()       // stored day-field held the true month
  const trueDay = dateVal.getUTCMonth() + 1    // stored month-field held the true day
  const y = dateVal.getUTCFullYear()
  const h = dateVal.getUTCHours(), mi = dateVal.getUTCMinutes(), s = dateVal.getUTCSeconds()
  const correctedYear = y === 2026 ? y - 1 : y // same rule already applied post-import
  return new Date(Date.UTC(correctedYear, trueMonth - 1, trueDay, h, mi, s))
}
function expectedCallStartedAt(dateVal) {
  if (!(dateVal instanceof Date)) return null
  const y = dateVal.getUTCFullYear()
  const correctedYear = y === 2026 ? y - 1 : y
  return new Date(Date.UTC(correctedYear, dateVal.getUTCMonth(), dateVal.getUTCDate(), dateVal.getUTCHours(), dateVal.getUTCMinutes(), dateVal.getUTCSeconds(), dateVal.getUTCMilliseconds()))
}

const candidates = []
let skippedNoEmail = 0, skippedNotDate = 0, skippedNoCallTime = 0
for (const r of keptRows) {
  const email = String(r['Email Address'] ?? '').trim().toLowerCase()
  if (!email) { skippedNoEmail++; continue }
  const at = r['Audit time']
  if (!(at instanceof Date)) { skippedNotDate++; continue } // text cells were already correct
  const ct = r['Call Date & time']
  if (!(ct instanceof Date)) { skippedNoCallTime++; continue }
  candidates.push({
    row: r.__row,
    email,
    correctedSubmittedAt: swapCorrect(at),
    expectedCallStartedAt: expectedCallStartedAt(ct),
    rawAuditTime: at,
  })
}
console.log(`Candidates needing the swap fix: ${candidates.length} (skipped: no email ${skippedNoEmail}, not Date-typed ${skippedNotDate}, no call time ${skippedNoCallTime})`)

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL })
await client.connect()

const usersRes = await client.query(`select id, email from users`)
const userIdByEmail = new Map(usersRes.rows.map((u) => [u.email.toLowerCase(), u.id]))

// Historical-import audits are identifiable without guessing: this script's
// own insert always set created_at = submitted_at exactly (see
// import-historical-audits.mjs), which a live-submitted audit never does
// (created_at is set at draft time, before submission). Restricting the
// match to that signature, plus the Telesales rubric, keeps this fix from
// ever touching a live-submitted audit by accident.
const auditsRes = await client.query(`
  select a.id, a.agent_id, a.call_started_at, a.submitted_at, a.created_at
  from audits a
  join rubrics r on r.id = a.rubric_id
  where r.name = 'Telesales Scorecard' and a.created_at = a.submitted_at
`)
console.log(`Historical-import-shaped audits in DB: ${auditsRes.rows.length}`)

// Index by (agent_id, call_started_at ISO) for exact matching.
const auditByKey = new Map()
let dupKeyCount = 0
for (const a of auditsRes.rows) {
  const key = `${a.agent_id}|${new Date(a.call_started_at).toISOString()}`
  if (auditByKey.has(key)) dupKeyCount++
  auditByKey.set(key, a)
}
if (dupKeyCount > 0) console.log(`WARNING: ${dupKeyCount} duplicate (agent_id, call_started_at) keys in DB — matching may be ambiguous for those.`)

let matched = 0, noUserMatch = 0, noAuditMatch = 0, alreadyCorrect = 0, toUpdate = []
for (const c of candidates) {
  const agentId = userIdByEmail.get(c.email)
  if (!agentId) { noUserMatch++; continue }
  const key = `${agentId}|${c.expectedCallStartedAt.toISOString()}`
  const audit = auditByKey.get(key)
  if (!audit) { noAuditMatch++; continue }
  matched++
  const dbSubmittedAt = new Date(audit.submitted_at)
  if (dbSubmittedAt.getTime() === c.correctedSubmittedAt.getTime()) { alreadyCorrect++; continue }
  toUpdate.push({ auditId: audit.id, from: dbSubmittedAt, to: c.correctedSubmittedAt })
}
console.log(`Matched to a DB audit: ${matched} (no user match: ${noUserMatch}, no audit match: ${noAuditMatch})`)
console.log(`Already correct (no change needed): ${alreadyCorrect}`)
console.log(`Rows needing an update: ${toUpdate.length}`)
console.log('Sample of 10 updates:', toUpdate.slice(0, 10).map((u) => ({ auditId: u.auditId, from: u.from.toISOString(), to: u.to.toISOString() })))

// Sanity: after correction, how many land in the future relative to now?
const now = new Date()
const futureAfterFix = toUpdate.filter((u) => u.to.getTime() > now.getTime())
console.log(`Of the updates, landing in the future after correction: ${futureAfterFix.length}`)

if (!LIVE) {
  console.log('\n--dry-run: no writes performed. Pass --live to actually update.')
  await client.end()
  process.exit(0)
}

let done = 0
await client.query('BEGIN')
try {
  for (const u of toUpdate) {
    await client.query(
      `update audits set submitted_at = $1, created_at = $1 where id = $2`,
      [u.to.toISOString(), u.auditId]
    )
    done++
    if (done % 1000 === 0) console.log(`  updated ${done}/${toUpdate.length}`)
  }
  await client.query('COMMIT')
  console.log(`\n=== LIVE fix complete: ${done} audits corrected ===`)
} catch (err) {
  await client.query('ROLLBACK')
  console.error('Failed, rolled back:', err.message)
  throw err
}
await client.end()
