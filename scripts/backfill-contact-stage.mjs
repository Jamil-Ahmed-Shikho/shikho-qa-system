// ============================================================
// Backfill audits.contact_stage (schema_115) for every historical-shaped
// audit (~25,940) from the two source spreadsheets that already carry a
// "Contact Stage" column — ZERO CRM calls, pure file + DB. Jamil asked for
// this directly: "As far i remember the historic data also had lead stage
// when i uploaded it here" — confirmed correct (see CLAUDE.md).
//
// Reuses the EXACT matching technique proven in redate-historical-audits.mjs:
// match a source row to its DB audit by (agent email -> agent_id) + a
// "yearless key" of the call's own date-time (month/day/time-of-day,
// ignoring year) against audits.call_started_at, restricted to the
// historical-import signature (created_at = submitted_at on the Telesales
// Scorecard rubric). That key is immune to every date-fix this project has
// ever applied (all of them only ever shifted whole years or did the one
// documented day/month swap on "Audit time", never on "Call Date & time").
//
// Covers BOTH source files in one pass (same DB audit set, no file-specific
// filtering needed — a yearless-key collision between the two files would
// require the same agent + identical month/day/time-of-day across
// different years, which does not happen in this data):
//   - the main 25,672-row sheet (needs the same dedup as the original
//     import, so "kept" rows line up 1:1 with DB rows)
//   - the Oct gap-fill sheet (no dedup needed, just its own SKIP_ROWS)
//
//   node --env-file=.env.local scripts/backfill-contact-stage.mjs            (dry run, default)
//   node --env-file=.env.local scripts/backfill-contact-stage.mjs --live     (writes for real)
// ============================================================
import ExcelJS from 'exceljs'
import pg from 'pg'

const LIVE = process.argv.includes('--live')
const MAIN_FILE = 'import-data/Telesales Evaluations - Shikho 2025 - Audit Box 2025 - Form Responses 1.xlsx'
const GAP_FILE = 'import-data/audit data 30th Sep - 1st Oct.xlsx'
const MAIN_DUPLICATE_HEADER_ROWS = new Set([1653])
const GAP_SKIP_ROWS = new Set([70]) // the rafi.shikho22 near-duplicate row, excluded from the gap import too

function parseAuditTime(v) {
  if (v instanceof Date) return v
  if (typeof v === 'string') {
    const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/)
    if (m) { const [, mo, d, y, h, mi, s] = m; return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) }
  }
  return null
}
function yearlessKeyOf(ct) {
  return `${String(ct.getUTCMonth() + 1).padStart(2, '0')}-${String(ct.getUTCDate()).padStart(2, '0')}T${String(ct.getUTCHours()).padStart(2, '0')}:${String(ct.getUTCMinutes()).padStart(2, '0')}:${String(ct.getUTCSeconds()).padStart(2, '0')}.${String(ct.getUTCMilliseconds()).padStart(3, '0')}`
}
function cleanStage(v) {
  const s = String(v ?? '').trim()
  return s ? s : null
}

console.log(LIVE ? '=== LIVE — writing to the database ===' : '=== DRY RUN — no writes ===')

// ---- Read the main sheet, with the original import's own dedup ----
async function readMainSheet() {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(MAIN_FILE)
  const ws = wb.worksheets[0]
  const headers = []
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => { headers[col] = cell.value })
  const rawRows = []
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1 || MAIN_DUPLICATE_HEADER_ROWS.has(rowNumber)) return
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
  console.log(`Main sheet: ${rawRows.length} source rows, ${keptRows.length} after dedup`)

  const out = []
  for (const r of keptRows) {
    const email = String(r['Email Address'] ?? '').trim().toLowerCase()
    const ct = r['Call Date & time']
    if (!email || !(ct instanceof Date)) continue
    out.push({ source: 'main', row: r.__row, email, yearlessKey: yearlessKeyOf(ct), contactStage: cleanStage(r['Contact Stage']) })
  }
  return out
}

// ---- Read the gap-fill sheet, no dedup, just its own skip list ----
async function readGapSheet() {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(GAP_FILE)
  const ws = wb.worksheets[0]
  const headers = []
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => { headers[col] = cell.value })
  const out = []
  let seen = 0
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1 || GAP_SKIP_ROWS.has(rowNumber)) return
    const obj = { __row: rowNumber }
    row.eachCell({ includeEmpty: true }, (cell, col) => { obj[headers[col] ?? `col${col}`] = cell.value })
    if (obj['Contact Stage'] === 'Contact Stage') return
    seen++
    const email = String(obj['Email Address'] ?? '').trim().toLowerCase()
    let ct = obj['Call Date & time']
    if (typeof ct === 'number') ct = new Date((ct - 25569) * 86400 * 1000) // Excel 1900-epoch serial -> JS Date, same formula exceljs uses
    if (!email || !(ct instanceof Date)) return
    out.push({ source: 'gap', row: rowNumber, email, yearlessKey: yearlessKeyOf(ct), contactStage: cleanStage(obj['Contact Stage']) })
  })
  console.log(`Gap-fill sheet: ${seen} rows read`)
  return out
}

const [mainCandidates, gapCandidates] = await Promise.all([readMainSheet(), readGapSheet()])
const candidates = [...mainCandidates, ...gapCandidates]
console.log(`Total candidates with an email + call time: ${candidates.length}`)

const withStage = candidates.filter((c) => c.contactStage)
console.log(`Of those, with a non-blank Contact Stage value: ${withStage.length}`)
const sampleStages = new Map()
for (const c of withStage) sampleStages.set(c.contactStage, (sampleStages.get(c.contactStage) ?? 0) + 1)
console.log('Distinct Contact Stage values (top 20):', [...sampleStages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20))

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL })
await client.connect()

const usersRes = await client.query(`select id, email from users`)
const userIdByEmail = new Map(usersRes.rows.map((u) => [u.email.toLowerCase(), u.id]))

const auditsRes = await client.query(`
  select a.id, a.agent_id, a.call_started_at, a.contact_stage
  from audits a
  join rubrics r on r.id = a.rubric_id
  where r.name = 'Telesales Scorecard' and a.created_at = a.submitted_at
`)
console.log(`Historical-import-shaped audits in DB: ${auditsRes.rows.length}`)

const auditByKey = new Map()
let dupKeyCount = 0
for (const a of auditsRes.rows) {
  const ct = new Date(a.call_started_at)
  const key = `${a.agent_id}|${yearlessKeyOf(ct)}`
  if (auditByKey.has(key)) dupKeyCount++
  auditByKey.set(key, a)
}
if (dupKeyCount > 0) console.log(`NOTE: ${dupKeyCount} duplicate (agent, yearless call time) keys in DB — those matches may be ambiguous.`)

let matched = 0, noUserMatch = 0, noAuditMatch = 0, noStageValue = 0, alreadySet = 0
const toUpdate = []
for (const c of candidates) {
  const agentId = userIdByEmail.get(c.email)
  if (!agentId) { noUserMatch++; continue }
  const audit = auditByKey.get(`${agentId}|${c.yearlessKey}`)
  if (!audit) { noAuditMatch++; continue }
  matched++
  if (!c.contactStage) { noStageValue++; continue }
  if (audit.contact_stage === c.contactStage) { alreadySet++; continue }
  toUpdate.push({ auditId: audit.id, from: audit.contact_stage, to: c.contactStage })
}
console.log(`Matched to a DB audit: ${matched} (no user match: ${noUserMatch}, no audit match: ${noAuditMatch})`)
console.log(`Of matched: no stage value in source: ${noStageValue}, already correctly set: ${alreadySet}, rows to write: ${toUpdate.length}`)
console.log('Sample of 10 writes:', toUpdate.slice(0, 10))

if (!LIVE) {
  console.log('\n--dry-run: no writes performed. Pass --live to actually update.')
  await client.end()
  process.exit(0)
}

let done = 0
await client.query('BEGIN')
try {
  for (const u of toUpdate) {
    await client.query(`update audits set contact_stage = $1 where id = $2`, [u.to, u.auditId])
    done++
    if (done % 2000 === 0) console.log(`  updated ${done}/${toUpdate.length}`)
  }
  await client.query('COMMIT')
  console.log(`\n=== LIVE backfill complete: ${done} audits updated with a contact_stage ===`)
} catch (err) {
  await client.query('ROLLBACK')
  console.error('Failed, rolled back:', err.message)
  throw err
}
await client.end()
