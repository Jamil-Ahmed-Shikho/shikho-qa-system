#!/usr/bin/env node
// ============================================================
// SHIKHO QA AUDIT MANAGEMENT SYSTEM
// Re-match unmatched revenue rows (§8 safety net)
//
// STANDALONE. Answers: "can agent_id be filled in later, for rows the
// backfill/daily sync already wrote as unmatched, once more of the
// roster exists in `users`?" — yes, safely, with NO re-fetch from the
// CRM's /events endpoint. Every agent_revenue_transactions row already
// stores lead_owner_crm_id (the raw CRM id, independent of whatever it
// resolved to at write time — schema_018's whole reason for keeping that
// column). Re-matching only needs, per DISTINCT unmatched
// lead_owner_crm_id: one users.crm_agent_id lookup (free), and if that
// misses, one CRM GET /users/{id} call to get an email or confirm there
// isn't one — the same two-step pipeline agent-matching.ts and this
// project's backfill script both already use. Run this any time the
// roster changes (a new hire added, a profile activated) — it's cheap,
// idempotent, and never touches revenue_amount/course_name/dates/etc.,
// only agent_id.
//
//   node --env-file=.env.local scripts/rematch-revenue.mjs
//     Dry run — reports how many rows WOULD be updated, writes nothing.
//
//   node --env-file=.env.local scripts/rematch-revenue.mjs --live
//     Actually updates agent_id on rows that now resolve.
//
// Flags:
//   --live            Write the resolved agent_id back. Omit for a dry run.
//   --delay-ms=N        Delay between CRM /users/{id} lookups (default 800ms).
// ============================================================

import { createClient } from '@supabase/supabase-js'

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  })
)
const LIVE = args.has('live')
const REQUEST_DELAY_MS = args.has('delay-ms') ? Number(args.get('delay-ms')) : 800

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function requireEnv(name) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

const CRM_API_BASE = requireEnv('CRM_API_BASE').replace(/\/$/, '').replace(/\/api\/v1$/, '')
const CRM_BEARER_TOKEN = requireEnv('CRM_BEARER_TOKEN')
const supabase = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
})

async function crmFetch(path) {
  const res = await fetch(`${CRM_API_BASE}/api/v1${path}`, {
    headers: {
      Authorization: `Bearer ${CRM_BEARER_TOKEN}`,
      Accept: 'application/json',
      'X-Log-Ref-Id': `shikho-qa-rematchscript-${Date.now()}`,
    },
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`CRM API ${res.status} on ${path}: ${body.slice(0, 300)}`)
  }
  return res.json()
}

async function getCrmUserEmail(crmUserId) {
  try {
    const raw = await crmFetch(`/users/${crmUserId}`)
    return typeof raw?.email === 'string' && raw.email.trim() ? raw.email.trim().toLowerCase() : null
  } catch (err) {
    console.error('  CRM user lookup failed for', crmUserId, ':', err.message)
    return null
  }
}

// Same two-step pipeline as backfill-revenue.mjs's resolveAgentId() and
// src/lib/audits/agent-matching.ts's matchUser() — kept in sync manually.
async function resolveAgentId(leadOwnerId) {
  const { data: byCrmId } = await supabase.from('users').select('id').eq('crm_agent_id', leadOwnerId).maybeSingle()
  if (byCrmId) return byCrmId.id

  await sleep(REQUEST_DELAY_MS)
  const email = await getCrmUserEmail(leadOwnerId)
  if (!email) return null

  const { data: byEmail } = await supabase.from('users').select('id, crm_agent_id').eq('email', email).maybeSingle()
  if (!byEmail) return null

  if (byEmail.crm_agent_id === null && LIVE) {
    await supabase.from('users').update({ crm_agent_id: leadOwnerId }).eq('id', byEmail.id).is('crm_agent_id', null)
  }
  return byEmail.id
}

async function main() {
  console.log(LIVE ? '=== LIVE — updating agent_id where it now resolves ===' : '=== DRY RUN — no writes ===')

  // PostgREST caps an unranged select at 1000 rows, so page through everything —
  // otherwise this silently only ever sees the first 1000 unmatched rows (a real
  // bug found 2026-09-30: with ~43k unmatched, that missed 97%+ of distinct owners
  // every single run).
  const PAGE_SIZE = 1000
  const unmatched = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, error } = await supabase
      .from('agent_revenue_transactions')
      .select('lead_owner_crm_id')
      .is('agent_id', null)
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`Reading unmatched rows failed: ${error.message}`)
    unmatched.push(...(page ?? []))
    if (!page || page.length < PAGE_SIZE) break
  }

  const distinctIds = [...new Set(unmatched.map((r) => r.lead_owner_crm_id))]
  console.log(`${unmatched.length} unmatched rows, ${distinctIds.length} distinct lead_owner ids`)

  let resolvedCount = 0,
    rowsUpdated = 0

  for (const leadOwnerId of distinctIds) {
    const agentId = await resolveAgentId(leadOwnerId)
    if (!agentId) continue
    resolvedCount++

    const { count } = await supabase
      .from('agent_revenue_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('lead_owner_crm_id', leadOwnerId)
      .is('agent_id', null)
    const n = count ?? 0
    console.log(`  lead_owner ${leadOwnerId} -> resolved -> ${n} row(s) ${LIVE ? 'updating' : 'would update'}`)

    if (LIVE) {
      const { error: updateError } = await supabase
        .from('agent_revenue_transactions')
        .update({ agent_id: agentId })
        .eq('lead_owner_crm_id', leadOwnerId)
        .is('agent_id', null)
      if (updateError) {
        console.error('  update failed:', updateError.message)
        continue
      }
    }
    rowsUpdated += n
  }

  console.log('\n=== summary ===')
  console.log('distinct unmatched lead_owner ids checked:', distinctIds.length)
  console.log('newly resolved:', resolvedCount)
  console.log(LIVE ? 'rows updated:' : 'rows that WOULD be updated:', rowsUpdated)
  if (!LIVE) console.log('\nThis was a dry run — nothing was written. Pass --live to update for real.')
}

main().catch((err) => {
  console.error('\nFATAL:', err.message)
  process.exit(1)
})
