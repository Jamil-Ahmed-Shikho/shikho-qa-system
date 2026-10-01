// ============================================================
// FULL RE-DERIVATION of historical Telesales audit dates from the pristine
// source file — supersedes the year-shift logic in both
// import-historical-audits.mjs's original post-import fix AND
// fix-historical-audit-time-swap.mjs's own year-shift step.
//
// WHY THIS EXISTS: the original post-import fix assumed "roughly half the
// sheet has year 2026 typo'd for 2025" (confirmed by Jamil at the time, off
// a narrow slice of evidence — ~1,330 audits that looked future-dated).
// That was WRONG. Re-checking the raw source file directly (2026-10-02,
// prompted by Jamil spot-checking one agent) showed:
//   - Both "Audit time" and "Call Date & time" have a smooth, continuous
//     month-by-month spread from Jan 2025 through Sep 2026 (900-1900
//     rows/month, no gap, no discontinuity) -- real continuous data, not a
//     corrupted subset.
//   - 202 agents' historical audits were dated BEFORE their own confirmed
//     real joining_date once shifted to 2025 -- impossible. (E.g. Md
//     Asfakuzzaman joined 2026-07-17; his audits only make sense as 2026.)
//   - The sheet's last entry is 2026-09-30 -- literally "yesterday" relative
//     to today's system clock (2026-10-01), exactly what a continuously-
//     updated live tracking sheet exported "as of now" would look like.
// Jamil confirmed: apply the fix (undo every year-shift, re-derive from
// scratch, no year adjustment at all).
//
// ALSO FIXES a second bug found while rebuilding this: the day/month swap
// fix (fix-historical-audit-time-swap.mjs) reconstructed its corrected
// "Audit time" using plain Date.UTC(...), i.e. treating the clock reading
// AS IF it were already UTC. But the ORIGINAL import's string-cell parsing
// used `new Date(y, mo-1, d, h, mi, s)` -- LOCAL time on the machine running
// it, which happens to be Asia/Dhaka (UTC+6, confirmed) -- so string-parsed
// "Audit time" values were correctly converted from Dhaka local to UTC (a
// -6h shift), while the swap-fixed Date-typed cells were NOT, leaving a
// spurious 6-hour inconsistency between the two groups. This script builds
// EVERY submitted_at the same way, explicitly pinned to +06:00 (not relying
// on the host machine's local timezone setting), matching this project's
// established convention for zoneless Bangladesh timestamps (see
// src/lib/crm/time.mjs's crmTimestamp()).
//
// "Call Date & time" (-> call_started_at) is untouched beyond undoing the
// year-shift: it's Google Forms' own canonical timestamp field (100%
// Date-typed in source, never ambiguous text), taken as-is, exactly as the
// original import always did for this field.
//
//   node --env-file=.env.local scripts/redate-historical-audits.mjs            (dry run, default)
//   node --env-file=.env.local scripts/redate-historical-audits.mjs --live     (writes for real)
// ============================================================
import ExcelJS from 'exceljs'
import pg from 'pg'

const LIVE = process.argv.includes('--live')
const SOURCE_FILE = 'import-data/Telesales Evaluations - Shikho 2025 - Audit Box 2025 - Form Responses 1.xlsx'
const DUPLICATE_HEADER_ROWS = new Set([1653])
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000

function parseAuditTime(v) {
  if (v instanceof Date) return v
  if (typeof v === 'string') {
    const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/)
    if (m) { const [, mo, d, y, h, mi, s] = m; return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) }
  }
  return null
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
const rawRows = []
ws.eachRow((row, rowNumber) => {
  if (rowNumber === 1 || DUPLICATE_HEADER_ROWS.has(rowNumber)) return
  const obj = { __row: rowNumber }
  row.eachCell({ includeEmpty: true }, (cell, col) => { obj[headers[col] ?? `col${col}`] = cell.value })
  if (obj['Contact Stage'] === 'Contact Stage') return
  rawRows.push(obj)
})

// Same dedup as the original import, so "kept" rows line up 1:1 with the DB.
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

// ---- Correct date derivation, NO year adjustment anywhere ----
function trueSubmittedAt(auditTimeVal) {
  let y, mo, d, h, mi, s
  if (auditTimeVal instanceof Date) {
    // Swap bug: Google's xlsx export auto-converted some ambiguous (day<=12)
    // text cells to a real Date using day-first order, so the stored month
    // field actually holds the true day, and vice versa.
    y = auditTimeVal.getUTCFullYear()
    mo = auditTimeVal.getUTCDate()        // stored day-field = true month
    d = auditTimeVal.getUTCMonth() + 1    // stored month-field = true day
    h = auditTimeVal.getUTCHours(); mi = auditTimeVal.getUTCMinutes(); s = auditTimeVal.getUTCSeconds()
  } else if (typeof auditTimeVal === 'string') {
    const m = auditTimeVal.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/)
    if (!m) return null
    ;[, mo, d, y, h, mi, s] = m.map(Number)
  } else {
    return null
  }
  // Pin explicitly to Dhaka (+06:00) rather than relying on host timezone —
  // matches the original import's (accidentally-correct) local-time
  // construction for string cells, now applied uniformly to every row.
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s) - DHAKA_OFFSET_MS)
}

const candidates = []
let skippedNoEmail = 0, skippedBadAuditTime = 0, skippedNoCallTime = 0
for (const r of keptRows) {
  const email = String(r['Email Address'] ?? '').trim().toLowerCase()
  if (!email) { skippedNoEmail++; continue }
  const submittedAt = trueSubmittedAt(r['Audit time'])
  if (!submittedAt) { skippedBadAuditTime++; continue }
  const ct = r['Call Date & time']
  if (!(ct instanceof Date)) { skippedNoCallTime++; continue }
  const durSec = durationSeconds(r['Call Duration'])
  const callEnd = durSec ? new Date(ct.getTime() + durSec * 1000) : null
  candidates.push({
    row: r.__row,
    email,
    submittedAt,
    callStartedAt: ct,
    callEndedAt: callEnd,
    // Stable join key: month/day/time-of-day of the call, ignoring year —
    // every fix applied so far only ever shifted whole years, never the
    // month/day/time-of-day component, so this key is invariant across the
    // entire fix history and lets us match without needing to know which
    // prior fix touched which row.
    yearlessKey: `${String(ct.getUTCMonth() + 1).padStart(2, '0')}-${String(ct.getUTCDate()).padStart(2, '0')}T${String(ct.getUTCHours()).padStart(2, '0')}:${String(ct.getUTCMinutes()).padStart(2, '0')}:${String(ct.getUTCSeconds()).padStart(2, '0')}.${String(ct.getUTCMilliseconds()).padStart(3, '0')}`,
  })
}
console.log(`Candidates: ${candidates.length} (skipped: no email ${skippedNoEmail}, unparseable Audit time ${skippedBadAuditTime}, no call time ${skippedNoCallTime})`)

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL })
await client.connect()

const usersRes = await client.query(`select id, email from users`)
const userIdByEmail = new Map(usersRes.rows.map((u) => [u.email.toLowerCase(), u.id]))

const auditsRes = await client.query(`
  select a.id, a.agent_id, a.call_started_at, a.submitted_at, a.created_at
  from audits a
  join rubrics r on r.id = a.rubric_id
  where r.name = 'Telesales Scorecard' and a.created_at = a.submitted_at
`)
console.log(`Historical-import-shaped audits in DB: ${auditsRes.rows.length}`)

const auditByKey = new Map()
let dupKeyCount = 0
for (const a of auditsRes.rows) {
  const ct = new Date(a.call_started_at)
  const key = `${a.agent_id}|${String(ct.getUTCMonth() + 1).padStart(2, '0')}-${String(ct.getUTCDate()).padStart(2, '0')}T${String(ct.getUTCHours()).padStart(2, '0')}:${String(ct.getUTCMinutes()).padStart(2, '0')}:${String(ct.getUTCSeconds()).padStart(2, '0')}.${String(ct.getUTCMilliseconds()).padStart(3, '0')}`
  if (auditByKey.has(key)) dupKeyCount++
  auditByKey.set(key, a)
}
if (dupKeyCount > 0) console.log(`WARNING: ${dupKeyCount} duplicate (agent_id, yearless call time) keys in DB — those matches may be ambiguous.`)

let matched = 0, noUserMatch = 0, noAuditMatch = 0, alreadyCorrect = 0
const toUpdate = []
for (const c of candidates) {
  const agentId = userIdByEmail.get(c.email)
  if (!agentId) { noUserMatch++; continue }
  const key = `${agentId}|${c.yearlessKey}`
  const audit = auditByKey.get(key)
  if (!audit) { noAuditMatch++; continue }
  matched++
  const dbSubmitted = new Date(audit.submitted_at)
  const dbCallStarted = new Date(audit.call_started_at)
  const changed = dbSubmitted.getTime() !== c.submittedAt.getTime() || dbCallStarted.getTime() !== c.callStartedAt.getTime()
  if (!changed) { alreadyCorrect++; continue }
  toUpdate.push({
    auditId: audit.id,
    fromSubmitted: dbSubmitted, toSubmitted: c.submittedAt,
    fromCallStarted: dbCallStarted, toCallStarted: c.callStartedAt,
    toCallEnded: c.callEndedAt,
  })
}
console.log(`Matched to a DB audit: ${matched} (no user match: ${noUserMatch}, no audit match: ${noAuditMatch})`)
console.log(`Already correct: ${alreadyCorrect}`)
console.log(`Rows needing an update: ${toUpdate.length}`)
console.log('Sample of 10:', toUpdate.slice(0, 10).map((u) => ({
  auditId: u.auditId,
  submitted: `${u.fromSubmitted.toISOString()} -> ${u.toSubmitted.toISOString()}`,
  call: `${u.fromCallStarted.toISOString()} -> ${u.toCallStarted.toISOString()}`,
})))

// Sanity: year distribution after the fix, and future/impossible checks.
const yearCounts = {}
for (const u of toUpdate) { const y = u.toSubmitted.getUTCFullYear(); yearCounts[y] = (yearCounts[y] || 0) + 1 }
for (const c of candidates) { /* also count unchanged rows' years via already-correct set is fine to skip; toUpdate sample is enough signal */ }
console.log('Year distribution of CHANGED rows (submitted_at, after fix):', yearCounts)

const now = new Date()
const futureAfterFix = candidates.filter((c) => c.submittedAt.getTime() > now.getTime())
console.log(`Candidates landing in the future after re-derivation (should be 0 or near it): ${futureAfterFix.length}`)
if (futureAfterFix.length) console.log('Sample future rows:', futureAfterFix.slice(0, 5).map((c) => ({ row: c.row, email: c.email, submittedAt: c.submittedAt.toISOString() })))

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
      `update audits set submitted_at = $1, created_at = $1, call_started_at = $2, call_ended_at = $3 where id = $4`,
      [u.toSubmitted.toISOString(), u.toCallStarted.toISOString(), u.toCallEnded ? u.toCallEnded.toISOString() : null, u.auditId]
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
