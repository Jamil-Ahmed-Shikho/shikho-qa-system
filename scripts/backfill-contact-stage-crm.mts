// ============================================================
// Backfill audits.contact_stage (schema_115) for LIVE-SCORED audits (since
// launch — not the historical import, which backfill-contact-stage.mjs
// already covers from the source files with zero CRM calls). These never
// had a "Contact Stage" source row, so the only way to get this is one CRM
// call per audit: GET /calling-histories/{crm_call_id} returns the call's
// OWN lead_stage_id — the stage AT THE TIME OF THE CALL (frozen), proven
// live (2026-11-10) to differ from GET /leads/{id}'s CURRENT stage, which
// would be wrong to use here.
//
// Read-only against the CRM (GET only, no writes to it) — a much smaller,
// lower-impact batch than the original revenue backfill (§8), but still
// paced conservatively (small delay between calls) rather than hammering
// the CRM. Per Jamil (2026-11-10): "the 2548 backfill you can schedule at
// night as well if it takes much time" — safe to run anytime given the
// modest volume and read-only nature, but paced regardless.
//
//   npx tsx --env-file=.env.local scripts/backfill-contact-stage-crm.mts                 (dry run, --limit 5 by default)
//   npx tsx --env-file=.env.local scripts/backfill-contact-stage-crm.mts --limit 5 --live (small live test)
//   npx tsx --env-file=.env.local scripts/backfill-contact-stage-crm.mts --live           (full run, all candidates)
// ============================================================
import pg from 'pg'
import { getCallById, getLeadStages } from '@/lib/crm/client'

const LIVE = process.argv.includes('--live')
const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : (LIVE ? Infinity : 5)
const DELAY_MS = 200

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL })
await client.connect()

const candidatesRes = await client.query(`
  select id, crm_call_id, auditor_id
    from audits
   where status = 'submitted' and audit_type = 'call' and check_mode = 'audit'
     and contact_stage is null and crm_call_id is not null
   order by submitted_at desc
`)
const candidates = candidatesRes.rows.slice(0, LIMIT)
console.log(`${LIVE ? '=== LIVE ===' : '=== DRY RUN (pass --live to write) ==='} Candidates: ${candidatesRes.rows.length}, processing: ${candidates.length}`)

const stages = await getLeadStages(null)
console.log(`Loaded ${stages.length} lead stages from the CRM.`)
const stageById = new Map(stages.map((s) => [s.id, s.name]))

let ok = 0, noStageOnCall = 0, failed = 0, written = 0
for (let i = 0; i < candidates.length; i++) {
  const c = candidates[i]
  try {
    const call = await getCallById(c.crm_call_id, c.auditor_id)
    const stageId = call?.lead_stage_id != null ? Number(call.lead_stage_id) : null
    const stageName = stageId != null && Number.isFinite(stageId) ? stageById.get(stageId) ?? null : null
    if (!stageName) { noStageOnCall++ }
    else {
      ok++
      if (LIVE) {
        await client.query(`update audits set contact_stage = $1 where id = $2`, [stageName, c.id])
        written++
      }
    }
  } catch (err) {
    failed++
    console.error(`  call ${c.crm_call_id} (audit ${c.id}) failed:`, err instanceof Error ? err.message : err)
  }
  if ((i + 1) % 200 === 0) console.log(`  processed ${i + 1}/${candidates.length} (resolved: ${ok}, no stage: ${noStageOnCall}, failed: ${failed})`)
  if (i < candidates.length - 1) await new Promise((r) => setTimeout(r, DELAY_MS))
}

console.log(`\nDone. Resolved a stage: ${ok}. No stage on the call: ${noStageOnCall}. CRM/lookup failures: ${failed}.`)
console.log(LIVE ? `Written to the database: ${written}.` : 'Dry run — nothing written. Pass --live to write for real.')
await client.end()
